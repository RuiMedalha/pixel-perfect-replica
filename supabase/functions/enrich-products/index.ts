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
    const { data: existingChunks } = await supabase.from("knowledge_chunks")
      .select("source_name")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    
    const existingSources = new Set((existingChunks || []).map((c: any) => c.source_name));

    const toEnrich = products.filter(p => {
      if (!p.sku) return false;
      return !existingSources.has(`🌐 SKU: ${p.sku}`);
    });

    console.log(`Enriching ${toEnrich.length} of ${products.length} products (${products.length - toEnrich.length} already cached)`);

    let enriched = 0;
    let failed = 0;
    const results: any[] = [];

    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const batch = toEnrich.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (product: any) => {
        const sku = product.sku;
        
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
              formats: ['markdown', 'links'],
              onlyMainContent: true,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return { sku, success: false, url: searchUrl, error: errData.error || `HTTP ${response.status}` };
          }

          const data = await response.json();
          const markdown = data.data?.markdown || data.markdown || '';
          
          if (!markdown || markdown.length < 50) {
            return { sku, success: false, url: searchUrl, error: "No content found" };
          }

          // --- Use AI to intelligently parse the scraped content ---
          let aiParsed: any = null;
          
          if (lovableApiKey) {
            const supplierInstructions = matchedPrefix?.scrapingInstructions 
              || scrapingInstructions[matchedPrefix?.name] 
              || Object.values(scrapingInstructions)[0] 
              || '';

            aiParsed = await parseWithAI(lovableApiKey, markdown, sku, product.original_title || '', supplierInstructions);
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
            updateData.attributes = aiParsed.variations;
            if (product.product_type === 'simple') {
              updateData.product_type = 'variable';
            }
          }

          if (Object.keys(updateData).length > 0) {
            await supabase.from("products").update(updateData).eq("id", product.id);
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
async function parseWithAI(apiKey: string, markdown: string, sku: string, title: string, instructions: string): Promise<any> {
  try {
    // Truncate markdown to avoid token limits
    const truncatedMd = markdown.substring(0, 15000);

    const systemPrompt = `You are a product data extraction specialist. You analyze scraped web pages of supplier/manufacturer product pages and extract structured data.

RULES:
- Only include images that belong to THIS specific product (not series, related products, icons, logos, newsletter images, or footer images)
- Filter out SVG icons, tiny images, and decorative elements
- Detect product variations (sizes, colors, diameters, capacities, etc.) - each variation may have its own SKU
- Extract technical specifications as structured key-value pairs
- Identify the product series/family name if visible

${instructions ? `USER INSTRUCTIONS FOR THIS SUPPLIER:\n${instructions}\n` : ''}`;

    const userPrompt = `Analyze this scraped product page content for SKU "${sku}" (${title}).

Extract the following data and return it using the extract_product_data function:

CONTENT:
${truncatedMd}`;

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
                  description: "URLs of images that belong ONLY to this specific product (not series, icons, or related products)"
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
                        description: "SKUs for each variation value, if visible (same order as values)"
                      }
                    },
                    required: ["name", "values"],
                    additionalProperties: false
                  },
                  description: "Product variations (sizes, colors, etc.)"
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
    console.log(`AI parsed SKU ${sku}: ${parsed.product_images?.length || 0} images, ${parsed.variations?.length || 0} variations, ${Object.keys(parsed.specs || {}).length} specs`);
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
