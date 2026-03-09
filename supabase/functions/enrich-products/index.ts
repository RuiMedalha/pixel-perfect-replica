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
    const results: { sku: string; success: boolean; url?: string; error?: string; images?: number; isVariable?: boolean }[] = [];

    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const batch = toEnrich.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (product: any) => {
        const sku = product.sku;
        
        // Find matching supplier prefix (optional now)
        let matchedPrefix: any = null;
        let searchUrl = '';

        if (supplierPrefixes.length > 0) {
          // Normalize: accept both searchUrl and url fields
          const normalized = supplierPrefixes.map((sp: any) => ({
            ...sp,
            searchUrl: sp.searchUrl || (sp.url ? (sp.url.includes('{sku}') ? sp.url : sp.url + '{sku}') : ''),
          }));

          // Try to match by prefix
          for (const sp of normalized) {
            if (sp.prefix && sku.toUpperCase().startsWith(sp.prefix.toUpperCase())) {
              matchedPrefix = sp;
              break;
            }
          }

          // If no prefix matched, use first supplier with full SKU
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

        // Fallback: use Firecrawl search API if no supplier URL
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
          const links = data.data?.links || data.links || [];
          
          if (!markdown || markdown.length < 50) {
            return { sku, success: false, url: searchUrl, error: "No content found" };
          }

          // --- Extract images from markdown and links ---
          const imageExtensions = /\.(jpg|jpeg|png|webp|gif)(\?[^\s)]*)?$/i;
          const mdImageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/gi;
          const foundImages: string[] = [];

          // From markdown ![alt](url)
          let match;
          while ((match = mdImageRegex.exec(markdown)) !== null) {
            const url = match[1];
            if (imageExtensions.test(url.split('?')[0])) {
              foundImages.push(url);
            }
          }

          // From links array
          if (Array.isArray(links)) {
            for (const link of links) {
              const linkUrl = typeof link === 'string' ? link : link?.url;
              if (linkUrl && imageExtensions.test(linkUrl.split('?')[0])) {
                foundImages.push(linkUrl);
              }
            }
          }

          // Also extract from markdown src= attributes
          const srcRegex = /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)/gi;
          while ((match = srcRegex.exec(markdown)) !== null) {
            foundImages.push(match[1]);
          }

          // Deduplicate images
          const uniqueImages = [...new Set(foundImages)].slice(0, 20);

          // --- Detect variations ---
          const variationPatterns = [
            /dispon[ií]vel\s+em\s*:/i,
            /cores?\s*:/i,
            /tamanhos?\s*:/i,
            /sizes?\s*:/i,
            /colou?rs?\s*:/i,
            /varia[çc][õo]es?\s*:/i,
            /selec[ct]\s+(size|color|cor|tamanho)/i,
            /\|\s*(cor|color|tamanho|size)\s*\|/i,
          ];
          const isVariable = variationPatterns.some(p => p.test(markdown));

          // --- Extract technical specs snippet ---
          let techSpecs = '';
          const specsSectionRegex = /(especifica[çc][õo]es|caracter[ií]sticas|specifications|technical|ficha\s+t[ée]cnica)[^]*?(?=\n#{1,3}\s|\n\n\n|$)/i;
          const specsMatch = markdown.match(specsSectionRegex);
          if (specsMatch) {
            techSpecs = specsMatch[0].substring(0, 3000);
          }

          // --- Update product directly ---
          const updateData: any = {};

          // Add images (merge with existing, no duplicates)
          if (uniqueImages.length > 0) {
            const existingImages = product.image_urls || [];
            const existingSet = new Set(existingImages.map((u: string) => u.toLowerCase()));
            const newImages = uniqueImages.filter(u => !existingSet.has(u.toLowerCase()));
            if (newImages.length > 0) {
              updateData.image_urls = [...existingImages, ...newImages];
            }
          }

          // Add technical specs if product doesn't have them
          if (techSpecs && !product.technical_specs) {
            updateData.technical_specs = techSpecs;
          }

          // Mark as variable if detected and currently simple
          if (isVariable && product.product_type === 'simple') {
            updateData.product_type = 'variable';
          }

          // Perform update if there's anything to update
          if (Object.keys(updateData).length > 0) {
            await supabase.from("products").update(updateData).eq("id", product.id);
          }

          // --- Save knowledge chunks (existing logic) ---
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
            metadata: { type: "sku_scrape", sku, source_url: searchUrl, supplier: matchedPrefix?.name || 'direct', imagesFound: uniqueImages.length, isVariable },
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

          return { sku, success: true, url: searchUrl, images: uniqueImages.length, isVariable };
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

      console.log(`Batch ${Math.floor(i / batchSize) + 1}: ${batchResults.filter(r => r.success).length} OK, ${batchResults.filter(r => !r.success).length} failed`);
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
