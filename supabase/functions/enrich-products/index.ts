const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { workspaceId, supplierPrefixes = [], productIds, batchSize = 5 } = await req.json();
    
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Firecrawl não está configurado.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    // Load scraping instructions from supplier config
    const scrapingInstructions: Record<string, string> = {};
    for (const sp of supplierPrefixes) {
      if (sp.scrapingInstructions) {
        scrapingInstructions[sp.name || sp.prefix || 'default'] = sp.scrapingInstructions;
      }
    }

    // Get products to enrich
    let products: any[] = [];
    if (productIds && productIds.length > 0) {
      for (let i = 0; i < productIds.length; i += 100) {
        const batch = productIds.slice(i, i + 100);
        const { data } = await supabase.from("products")
          .select("id, sku, original_title, image_urls, technical_specs, product_type, attributes")
          .in("id", batch);
        if (data) products.push(...data);
      }
    } else {
      let from = 0;
      while (true) {
        const { data } = await supabase.from("products")
          .select("id, sku, original_title, image_urls, technical_specs, product_type, attributes")
          .eq("workspace_id", workspaceId)
          .not("sku", "is", null)
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        products.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
    }

    // Check which products already have knowledge cached
    const isManualSelection = productIds && productIds.length > 0;
    
    let toEnrich: any[];
    
    if (isManualSelection) {
      // Manual selection: re-enrich ALL selected, delete old cache first
      toEnrich = products.filter(p => !!p.sku);
      
      // Delete existing knowledge chunks for these SKUs so they get refreshed
      const skusToRefresh = toEnrich.map(p => `🌐 SKU: ${p.sku}`);
      if (skusToRefresh.length > 0) {
        // Find and delete uploaded_files + chunks for these sources
        const { data: oldFiles } = await supabase.from("uploaded_files")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .in("file_name", skusToRefresh);
        
        if (oldFiles && oldFiles.length > 0) {
          const oldFileIds = oldFiles.map((f: any) => f.id);
          await supabase.from("knowledge_chunks").delete().in("file_id", oldFileIds);
          await supabase.from("uploaded_files").delete().in("id", oldFileIds);
          console.log(`Cleared ${oldFiles.length} cached enrichment entries for re-enrichment`);
        }
      }
    } else {
      // Bulk: skip already enriched
      const { data: existingChunks } = await supabase.from("knowledge_chunks")
        .select("source_name")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
      
      const existingSources = new Set((existingChunks || []).map((c: any) => c.source_name));
      toEnrich = products.filter(p => {
        if (!p.sku) return false;
        return !existingSources.has(`🌐 SKU: ${p.sku}`);
      });
    }

    console.log(`Enriching ${toEnrich.length} of ${products.length} products (${products.length - toEnrich.length} already cached)`);

    let enriched = 0;
    let failed = 0;
    const results: any[] = [];
    // Track SKUs that were converted to variations by a parent in this run
    const convertedVariationSkus = new Set<string>();

    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const batch = toEnrich.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (product: any) => {
        const sku = product.sku;
        
        // Skip if this product was already converted to a variation by a parent earlier in this run
        if (convertedVariationSkus.has(sku)) {
          console.log(`Skipping ${sku} — already converted to variation by a parent in this run`);
          return { sku, success: true, skippedAsVariation: true };
        }
        
        // Find matching supplier prefix
        let matchedPrefix: any = null;
        let searchUrl = '';

        if (supplierPrefixes.length > 0) {
          const normalized = supplierPrefixes.map((sp: any) => ({
            ...sp,
            searchUrl: sp.searchUrl || (sp.url ? (sp.url.includes('{sku}') ? sp.url : sp.url + '{sku}') : ''),
          }));

          for (const sp of normalized) {
            if (sp.prefix && sku.toUpperCase().startsWith(sp.prefix.toUpperCase())) {
              matchedPrefix = sp;
              break;
            }
          }

          if (!matchedPrefix) {
            const fallback = normalized.find((sp: any) => sp.searchUrl);
            if (fallback) {
              matchedPrefix = { ...fallback, prefix: '' };
            }
          }
        }

        if (matchedPrefix) {
          const productRef = matchedPrefix.prefix ? sku.substring(matchedPrefix.prefix.length) : sku;
          searchUrl = matchedPrefix.searchUrl.replace("{sku}", productRef);
        }

        // Fallback: use Firecrawl search API
        if (!searchUrl) {
          try {
            const searchResp = await fetch('https://api.firecrawl.dev/v1/search', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: `${product.original_title || ''} ${sku}`.trim(),
                limit: 1,
                scrapeOptions: { formats: ['markdown', 'links'] },
              }),
            });
            if (searchResp.ok) {
              const searchData = await searchResp.json();
              const firstResult = searchData.data?.[0];
              if (firstResult?.url) {
                searchUrl = firstResult.url;
                matchedPrefix = { name: 'web-search', prefix: '' };
              }
            }
          } catch (e) {
            console.error(`Search fallback failed for ${sku}:`, e);
          }
        }

        if (!searchUrl) {
          return { sku, success: false, error: "No supplier URL and web search found nothing" };
        }

        try {
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: searchUrl,
              formats: ['markdown', 'html'],
              onlyMainContent: false,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return { sku, success: false, url: searchUrl, error: errData.error || `HTTP ${response.status}` };
          }

          const data = await response.json();
          const markdown = data.data?.markdown || data.markdown || '';
          const html = data.data?.html || data.html || '';
          
          if ((!markdown || markdown.length < 50) && (!html || html.length < 50)) {
            return { sku, success: false, url: searchUrl, error: "No content found" };
          }

          // --- Use AI to intelligently parse the scraped content ---
          let aiParsed: any = null;
          
          if (lovableApiKey) {
            const supplierInstructions = matchedPrefix?.scrapingInstructions 
              || scrapingInstructions[matchedPrefix?.name] 
              || Object.values(scrapingInstructions)[0] 
              || '';

            aiParsed = await parseWithAI(lovableApiKey, markdown, sku, product.original_title || '', supplierInstructions, html);
          }

          // Fallback to regex-based extraction if AI fails
          if (!aiParsed) {
            aiParsed = parseWithRegex(markdown);
          }

          // --- Update product ---
          const updateData: any = {};

          // Images: use AI-filtered images or fallback
          const productImages = aiParsed.product_images || [];
          if (productImages.length > 0) {
            const existingImages = product.image_urls || [];
            const existingSet = new Set(existingImages.map((u: string) => u.toLowerCase()));
            const newImages = productImages.filter((u: string) => !existingSet.has(u.toLowerCase()));
            if (newImages.length > 0) {
              updateData.image_urls = [...existingImages, ...newImages];
            }
          }

          // Technical specs as structured JSON
          if (aiParsed.specs && Object.keys(aiParsed.specs).length > 0) {
            updateData.technical_specs = JSON.stringify(aiParsed.specs);
          } else if (!product.technical_specs) {
            // Fallback: raw text specs
            const specsSectionRegex = /(especifica[çc][õo]es|caracter[ií]sticas|specifications|technical|ficha\s+t[ée]cnica)[^]*?(?=\n#{1,3}\s|\n\n\n|$)/i;
            const specsMatch = markdown.match(specsSectionRegex);
            if (specsMatch) {
              updateData.technical_specs = specsMatch[0].substring(0, 3000);
            }
          }

          // Variations
          if (aiParsed.variations && aiParsed.variations.length > 0) {
            // Only set as variable if there are real SKUs detected
            const mainVar = aiParsed.variations[0];
            const hasRealSkus = mainVar.skus && mainVar.skus.length > 0 && mainVar.skus.length === mainVar.values?.length;
            
            // Sort variation values by numeric size/diameter order
            const sortedVariations = aiParsed.variations.map((v: any) => ({
              ...v,
              values: [...(v.values || [])].sort((a: string, b: string) => {
                const numA = parseFloat(a.replace(/[^0-9.,]/g, '').replace(',', '.'));
                const numB = parseFloat(b.replace(/[^0-9.,]/g, '').replace(',', '.'));
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return a.localeCompare(b);
              }),
              skus: v.skus ? [...v.skus] : undefined,
            }));
            // Re-sort SKUs to match the new values order
            for (const v of sortedVariations) {
              if (v.skus && v.skus.length === aiParsed.variations.find((ov: any) => ov.name === v.name)?.values?.length) {
                const original = aiParsed.variations.find((ov: any) => ov.name === v.name);
                const indexMap = v.values.map((val: string) => original.values.indexOf(val));
                v.skus = indexMap.map((i: number) => original.skus[i]);
              }
            }
            updateData.attributes = sortedVariations;
            
            // Only convert to variable if we have real SKUs AND at least one exists in the workspace
            if (hasRealSkus && product.product_type === 'simple') {
              // Check if any of these SKUs actually exist in the workspace before converting
              const skusToCheck = mainVar.skus.filter((s: string) => s !== sku);
              let anyExist = false;
              for (let ci = 0; ci < skusToCheck.length; ci += 100) {
                const chunk = skusToCheck.slice(ci, ci + 100);
                const { data: found, count } = await supabase.from("products")
                  .select("id", { count: 'exact', head: true })
                  .eq("workspace_id", workspaceId)
                  .in("sku", chunk);
                if (count && count > 0) { anyExist = true; break; }
              }
              if (anyExist) {
                updateData.product_type = 'variable';
              }
            }
          }

          if (Object.keys(updateData).length > 0) {
            await supabase.from("products").update(updateData).eq("id", product.id);
          }

          // --- Expand variations: link existing products, flag missing ones ---
          let variationsCreated = 0;
          const missingVariations: { sku: string; value: string; url?: string }[] = [];
          
          if (aiParsed.variations && aiParsed.variations.length > 0) {
            const mainVariation = aiParsed.variations[0];
            const rawSkus = mainVariation.skus || [];
            const values = mainVariation.values || [];
            const variationUrls = aiParsed.variation_urls || [];

            if (values.length > 0 && rawSkus.length === values.length) {
              // Clean SKUs: if AI returned URLs instead of SKUs, extract the numeric part
              const skus = rawSkus.map((s: string) => {
                if (!s) return s;
                if (s.startsWith('http://') || s.startsWith('https://') || s.includes('/')) {
                  const numMatch = s.match(/\/(\d{3,})(?:[/?#]|$)/);
                  if (numMatch) return numMatch[1];
                  const parts = s.replace(/[?#].*$/, '').split('/').filter(Boolean);
                  const last = parts[parts.length - 1];
                  if (last && /^\d+$/.test(last)) return last;
                }
                return s;
              });
              
              console.log(`Checking ${values.length} variations for ${sku} (SKUs: ${skus.join(', ')})`);
              
              // Load ALL existing SKUs in workspace at once to avoid per-variation queries
              const allSkusToCheck = skus.filter((s: string) => s !== sku);
              const existingMap = new Map<string, any>();
              
              for (let ci = 0; ci < allSkusToCheck.length; ci += 100) {
                const chunk = allSkusToCheck.slice(ci, ci + 100);
                const { data: found } = await supabase.from("products")
                  .select("id, sku, product_type, parent_product_id")
                  .eq("workspace_id", workspaceId)
                  .in("sku", chunk);
                if (found) {
                  for (const f of found) existingMap.set(f.sku, f);
                }
              }
              
              const maxVariations = Math.min(skus.length, 10);
              
              for (let vi = 0; vi < maxVariations; vi++) {
                const varSku = skus[vi];
                const varValue = values[vi];
                
                // Mark this SKU so it won't be enriched independently later in this run
                if (varSku !== sku) {
                  convertedVariationSkus.add(varSku);
                }

                const existing = existingMap.get(varSku);

                if (existing) {
                  // If it exists as simple, convert to variation under this parent
                  if (existing.product_type === 'simple' && !existing.parent_product_id && existing.id !== product.id) {
                    await supabase.from("products").update({
                      product_type: 'variation',
                      parent_product_id: product.id,
                      attributes: [{ name: mainVariation.name, value: varValue }],
                    }).eq("id", existing.id);
                    variationsCreated++;
                  }
                } else if (varSku !== sku) {
                  // SKU not found in workspace — flag as missing, do NOT auto-create
                  const varUrlEntry = variationUrls.find((vu: any) => vu.sku === varSku || vu.value === varValue);
                  missingVariations.push({ 
                    sku: varSku, 
                    value: varValue,
                    url: varUrlEntry?.url || undefined,
                  });
                  console.log(`⚠️ Missing variation SKU ${varSku} (${varValue}) for parent ${sku} — not in workspace`);
                }
              }

              console.log(`Linked ${variationsCreated} existing variations for parent ${sku}, ${missingVariations.length} missing`);
            }
          }

          // --- Save knowledge chunks ---
          const extractedText = markdown.substring(0, 30000);

          const { data: fileRecord } = await supabase.from("uploaded_files").insert({
            user_id: userId,
            file_name: `🌐 SKU: ${sku}`,
            file_size: extractedText.length,
            file_type: "knowledge",
            status: "processed",
            products_count: 0,
            extracted_text: extractedText.substring(0, 5000),
            workspace_id: workspaceId,
            metadata: { 
              type: "sku_scrape", sku, source_url: searchUrl, 
              supplier: matchedPrefix?.name || 'direct', 
              imagesFound: productImages.length, 
              isVariable: (aiParsed.variations?.length || 0) > 0,
              variations: aiParsed.variations || [],
              specs: aiParsed.specs || {},
              series_name: aiParsed.series_name || null,
            },
          } as any).select("id").single();

          if (fileRecord) {
            const chunks = chunkText(extractedText, 1500);
            const chunkRows = chunks.map((content: string, idx: number) => ({
              file_id: fileRecord.id,
              user_id: userId,
              workspace_id: workspaceId,
              chunk_index: idx,
              content,
              source_name: `🌐 SKU: ${sku}`,
            }));
            for (let j = 0; j < chunkRows.length; j += 50) {
              await supabase.from("knowledge_chunks").insert(chunkRows.slice(j, j + 50) as any);
            }
          }

          return { 
            sku, success: true, url: searchUrl, 
            images: productImages.length, 
            variations: aiParsed.variations?.length || 0,
            variationsCreated,
            missingVariations: missingVariations.length > 0 ? missingVariations : undefined,
            specs: Object.keys(aiParsed.specs || {}).length,
            isVariable: (aiParsed.variations?.length || 0) > 0,
            aiParsed: !!lovableApiKey,
          };
        } catch (err) {
          return { sku, success: false, url: searchUrl, error: err instanceof Error ? err.message : "Unknown" };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        results.push(r);
        if (r.skippedAsVariation) continue; // don't count as enriched or failed
        if (r.success) enriched++;
        else failed++;
      }

      console.log(`Batch ${Math.floor(i / batchSize) + 1}: ${batchResults.filter((r: any) => r.success).length} OK, ${batchResults.filter((r: any) => !r.success).length} failed`);
    }

    // Log activity
    await supabase.from("activity_log").insert({
      user_id: userId,
      action: "upload" as const,
      workspace_id: workspaceId,
      details: { type: "bulk_enrich", total: toEnrich.length, enriched, failed },
    });

    return new Response(
      JSON.stringify({ success: true, total: toEnrich.length, enriched, failed, skipped: products.length - toEnrich.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// AI-powered parsing using Lovable AI Gateway
async function parseWithAI(apiKey: string, markdown: string, sku: string, title: string, instructions: string, html: string = ''): Promise<any> {
  try {
    // Truncate to avoid token limits
    const truncatedMd = markdown.substring(0, 12000);
    
    // Extract variation-relevant HTML snippets (radio buttons, select options, size selectors)
    let variationHtml = '';
    if (html) {
      // Extract product-size blocks, select elements, radio groups with onclick URLs
      const patterns = [
        /(<div[^>]*class="[^"]*product-size[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/gi,
        /(<select[^>]*(?:size|variation|option)[^>]*>[\s\S]*?<\/select>)/gi,
        /(<input[^>]*onclick="location\.href[^"]*"[^>]*>[\s\S]*?<\/label>)/gi,
        /(<div[^>]*class="[^"]*size-check[^"]*"[^>]*>[\s\S]*?<\/div>)/gi,
      ];
      const snippets: string[] = [];
      for (const pattern of patterns) {
        let m;
        while ((m = pattern.exec(html)) !== null) {
          snippets.push(m[1]);
        }
      }
      if (snippets.length > 0) {
        variationHtml = '\n\nVARIATION HTML SNIPPETS (contains SKUs in URLs and onclick attributes):\n' + snippets.join('\n').substring(0, 5000);
      } else {
        // Fallback: search for any onclick with location.href
        const onclickPattern = /onclick="location\.href\s*=\s*'([^']+)'"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
        const matches: string[] = [];
        let m2;
        while ((m2 = onclickPattern.exec(html)) !== null) {
          matches.push(`URL: ${m2[1]} | Value: ${m2[2].trim()}`);
        }
        if (matches.length > 0) {
          variationHtml = '\n\nVARIATION LINKS FOUND IN HTML:\n' + matches.join('\n');
        }
      }
    }

    const systemPrompt = `You are a product data extraction specialist. You analyze scraped web pages of supplier/manufacturer product pages and extract structured data.

RULES FOR IMAGES:
- Extract ONLY images that belong to THIS specific product being viewed on the page
- Focus on: the main product photo, gallery/carousel/slider images, alternate angles, zoom views, detail shots
- These are typically found inside a product image gallery container, lightbox, or carousel — usually the first set of images on the page
- STRICTLY EXCLUDE: navigation icons, category thumbnails, footer logos, newsletter banners, social media icons, cookie popup images, "related products" images, "you may also like" images, brand logos, payment method icons, shipping icons, trust badges, SVG icons, any image smaller than 100px
- DO NOT include images from "related products", "recommended products", "products from the same series", or any section that shows OTHER products
- A typical product has 1-8 images. If you find more than 10, you are probably including non-product images — be more selective
- When in doubt, EXCLUDE the image

RULES FOR VARIATIONS:
- Only detect variations if the page clearly shows a selector (size picker, color picker, dropdown) for THIS product
- CRITICAL: Only report variations that have REAL SKUs visible on the page (in URLs, onclick attributes, data attributes, or option values)
- NEVER invent or guess SKUs — if you cannot find a real SKU code for a variation, do NOT include it in the "skus" array
- If you see variation values (e.g. sizes) but NO associated SKUs, return the values WITHOUT the skus array
- The "skus" array MUST only contain short alphanumeric codes (e.g. "80020", "UD12345"), NEVER full URLs
- If a variation link is "https://supplier.com/product-name/80020", the SKU is "80020"

RULES FOR SPECS:
- Extract technical specifications as structured key-value pairs
- Identify the product series/family name if visible

${instructions ? `USER INSTRUCTIONS FOR THIS SUPPLIER:\n${instructions}\n` : ''}`;

    const userPrompt = `Analyze this scraped product page content for SKU "${sku}" (${title}).

Extract the following data and return it using the extract_product_data function.
Pay special attention to variation selectors (radio buttons, dropdowns) — extract the SKU from each variation's URL.

MARKDOWN CONTENT:
${truncatedMd}${variationHtml}`;


    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_product_data",
            description: "Extract structured product data from a scraped web page",
            parameters: {
              type: "object",
              properties: {
                product_images: {
                  type: "array",
                  items: { type: "string" },
                  description: "ONLY images of THIS product from the product gallery/carousel/slider. Include main photo, alternate angles, zoom views, detail shots. EXCLUDE: related products, recommended items, category images, logos, icons, banners, footer images, social media icons. Max 8-10 images."
                },
                variations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Attribute name (e.g., Diâmetro, Cor, Tamanho)" },
                      values: { 
                        type: "array", 
                        items: { type: "string" },
                        description: "Available values for this attribute"
                      },
                      skus: {
                        type: "array",
                        items: { type: "string" },
                        description: "SKU codes (numeric or alphanumeric) for each variation value, in matching order. Extract ONLY the SKU identifier (e.g. '80020'), NEVER full URLs. If the SKU is in a URL like '/product-name/80020', extract only '80020'."
                      }
                 },
                     required: ["name", "values"],
                     additionalProperties: false
                   },
                   description: "Product variations (sizes, colors, etc.)"
                 },
                 variation_urls: {
                   type: "array",
                   items: {
                     type: "object",
                     properties: {
                       sku: { type: "string", description: "SKU code only (e.g. '80020'), NOT the full URL" },
                       url: { type: "string" },
                       value: { type: "string" }
                     },
                     required: ["sku", "value"],
                     additionalProperties: false
                   },
                   description: "Individual URLs for each variation, if clickable links are visible on the page (e.g. size selector links)"
                 },
                specs: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description: "Technical specifications as key-value pairs (e.g., Material: Aço Inoxidável)"
                },
                series_name: {
                  type: "string",
                  description: "Product series/family name if identified"
                }
              },
              required: ["product_images", "variations", "specs"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "extract_product_data" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`AI gateway error (${response.status}):`, errText);
      return null;
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      console.error("No tool call in AI response");
      return null;
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const varSkusInfo = parsed.variations?.map((v: any) => `${v.name}:${v.values?.length || 0}vals/${v.skus?.length || 0}skus`).join(', ') || 'none';
    console.log(`AI parsed SKU ${sku}: ${parsed.product_images?.length || 0} images, variations=[${varSkusInfo}], ${Object.keys(parsed.specs || {}).length} specs`);
    return parsed;
  } catch (e) {
    console.error("AI parsing failed:", e);
    return null;
  }
}

// Fallback regex-based parsing
function parseWithRegex(markdown: string): any {
  const imageExtensions = /\.(jpg|jpeg|png|webp|gif)(\?[^\s)]*)?$/i;
  const mdImageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/gi;
  const foundImages: string[] = [];

  let match;
  while ((match = mdImageRegex.exec(markdown)) !== null) {
    const url = match[1];
    if (imageExtensions.test(url.split('?')[0]) && !url.includes('.svg')) {
      foundImages.push(url);
    }
  }

  const srcRegex = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)/gi;
  while ((match = srcRegex.exec(markdown)) !== null) {
    foundImages.push(match[1]);
  }

  return {
    product_images: [...new Set(foundImages)].slice(0, 10),
    variations: [],
    specs: {},
    series_name: null,
  };
}

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > chunkSize && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
