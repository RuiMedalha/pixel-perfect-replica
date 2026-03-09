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

    const { workspaceId, supplierPrefixes, productIds, batchSize = 5 } = await req.json();
    
    if (!workspaceId || !supplierPrefixes || supplierPrefixes.length === 0) {
      return new Response(JSON.stringify({ error: "workspaceId and supplierPrefixes are required" }), {
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
      // Specific products
      for (let i = 0; i < productIds.length; i += 100) {
        const batch = productIds.slice(i, i + 100);
        const { data } = await supabase.from("products")
          .select("id, sku, original_title")
          .in("id", batch);
        if (data) products.push(...data);
      }
    } else {
      // All products in workspace with SKU
      let from = 0;
      while (true) {
        const { data } = await supabase.from("products")
          .select("id, sku, original_title")
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
    const skus = products.map(p => p.sku).filter(Boolean);
    const { data: existingChunks } = await supabase.from("knowledge_chunks")
      .select("source_name")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    
    const existingSources = new Set((existingChunks || []).map((c: any) => c.source_name));

    // Filter products that don't have cached data
    const toEnrich = products.filter(p => {
      if (!p.sku) return false;
      // Check if we already have a scrape for this SKU
      return !existingSources.has(`🌐 SKU: ${p.sku}`);
    });

    console.log(`Enriching ${toEnrich.length} of ${products.length} products (${products.length - toEnrich.length} already cached)`);

    let enriched = 0;
    let failed = 0;
    const results: { sku: string; success: boolean; url?: string; error?: string }[] = [];

    // Process in batches
    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const batch = toEnrich.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (product: any) => {
        const sku = product.sku;
        
        // Find matching supplier prefix
        let matchedPrefix: any = null;
        for (const sp of supplierPrefixes) {
          if (sku.toUpperCase().startsWith(sp.prefix.toUpperCase())) {
            matchedPrefix = sp;
            break;
          }
        }

        if (!matchedPrefix) {
          return { sku, success: false, error: "No matching supplier prefix" };
        }

        // Build URL by removing prefix from SKU
        const productRef = sku.substring(matchedPrefix.prefix.length);
        const searchUrl = matchedPrefix.searchUrl.replace("{sku}", productRef);

        try {
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: searchUrl,
              formats: ['markdown'],
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

          const extractedText = markdown.substring(0, 30000);
          const title = data.data?.metadata?.title || `SKU: ${sku}`;

          // Save as uploaded file
          const { data: fileRecord } = await supabase.from("uploaded_files").insert({
            user_id: userId,
            file_name: `🌐 SKU: ${sku}`,
            file_size: extractedText.length,
            file_type: "knowledge",
            status: "processed",
            products_count: 0,
            extracted_text: extractedText.substring(0, 5000),
            workspace_id: workspaceId,
            metadata: { type: "sku_scrape", sku, source_url: searchUrl, supplier: matchedPrefix.name },
          } as any).select("id").single();

          if (fileRecord) {
            // Chunk and store
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

          return { sku, success: true, url: searchUrl };
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
