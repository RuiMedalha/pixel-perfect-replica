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

    const { sourceId, targetId } = await req.json();
    if (!sourceId || !targetId) {
      return new Response(JSON.stringify({ error: "sourceId and targetId are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Merging workspace ${sourceId} into ${targetId}`);

    // 1. Get products from both workspaces
    const [sourceRes, targetRes] = await Promise.all([
      fetchAllProducts(supabase, sourceId),
      fetchAllProducts(supabase, targetId),
    ]);

    const sourceProducts = sourceRes;
    const targetProducts = targetRes;

    // Build SKU map of target products
    const targetSkuMap = new Map<string, any>();
    for (const p of targetProducts) {
      if (p.sku) targetSkuMap.set(p.sku.toLowerCase(), p);
    }

    let merged = 0;
    let moved = 0;
    const toDelete: string[] = [];

    // 2. Process each source product
    for (const sp of sourceProducts) {
      const skuKey = sp.sku?.toLowerCase();
      const existing = skuKey ? targetSkuMap.get(skuKey) : null;

      if (existing) {
        // Smart merge: enrich existing target product with source data
        const updates: Record<string, any> = {};

        // Text fields: keep longer/more complete version
        const textFields = [
          'original_description', 'optimized_description', 'optimized_short_description',
          'optimized_title', 'meta_title', 'meta_description', 'seo_slug',
          'technical_specs', 'short_description',
        ];
        for (const field of textFields) {
          const sourceVal = sp[field] as string | null;
          const targetVal = existing[field] as string | null;
          if (sourceVal && (!targetVal || sourceVal.length > targetVal.length * 1.3)) {
            updates[field] = sourceVal;
          }
        }

        // Price fields: prefer non-null source if target is null
        const priceFields = ['original_price', 'optimized_price', 'sale_price', 'optimized_sale_price'];
        for (const field of priceFields) {
          if (sp[field] != null && existing[field] == null) {
            updates[field] = sp[field];
          }
        }

        // Category: prefer source if target is empty
        if (sp.category && !existing.category) updates.category = sp.category;
        if (sp.category_id && !existing.category_id) updates.category_id = sp.category_id;

        // Image URLs: merge unique
        const existingImages = existing.image_urls || [];
        const sourceImages = sp.image_urls || [];
        const allImages = [...new Set([...existingImages, ...sourceImages])];
        if (allImages.length > existingImages.length) {
          updates.image_urls = allImages;
        }

        // Attributes: merge unique
        const existingAttrs = existing.attributes || [];
        const sourceAttrs = sp.attributes || [];
        if (Array.isArray(sourceAttrs) && sourceAttrs.length > 0) {
          const existingNames = new Set((existingAttrs as any[]).map((a: any) => a.name?.toLowerCase()));
          const newAttrs = (sourceAttrs as any[]).filter((a: any) => !existingNames.has(a.name?.toLowerCase()));
          if (newAttrs.length > 0) {
            updates.attributes = [...(existingAttrs as any[]), ...newAttrs];
          }
        }

        // Tags: merge unique
        const existingTags = existing.tags || [];
        const sourceTags = sp.tags || [];
        const allTags = [...new Set([...existingTags, ...sourceTags])];
        if (allTags.length > existingTags.length) {
          updates.tags = allTags;
        }

        // Source file: append
        if (sp.source_file && sp.source_file !== existing.source_file) {
          updates.source_file = [existing.source_file, sp.source_file].filter(Boolean).join(', ');
        }

        // Supplier ref: keep if target doesn't have it
        if (sp.supplier_ref && !existing.supplier_ref) updates.supplier_ref = sp.supplier_ref;

        // FAQ: keep longer
        if (sp.faq && (!existing.faq || JSON.stringify(sp.faq).length > JSON.stringify(existing.faq).length)) {
          updates.faq = sp.faq;
        }

        // Focus keyword: merge
        if (sp.focus_keyword?.length && !existing.focus_keyword?.length) {
          updates.focus_keyword = sp.focus_keyword;
        }

        if (Object.keys(updates).length > 0) {
          const { error } = await supabase.from("products").update(updates).eq("id", existing.id);
          if (error) console.warn(`Merge product ${sp.sku}:`, error.message);
        }

        toDelete.push(sp.id);
        merged++;
      } else {
        // No match: move to target workspace
        const { error } = await supabase.from("products")
          .update({ workspace_id: targetId })
          .eq("id", sp.id);
        if (error) console.warn(`Move product ${sp.sku}:`, error.message);
        moved++;
      }
    }

    // 3. Delete merged source products
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      await supabase.from("products").delete().in("id", batch);
    }

    // 4. Move other tables
    const otherTables = ["uploaded_files", "knowledge_chunks", "categories", "activity_log", "optimization_jobs", "publish_jobs"] as const;
    for (const table of otherTables) {
      const { error } = await supabase
        .from(table)
        .update({ workspace_id: targetId } as any)
        .eq("workspace_id", sourceId);
      if (error) console.warn(`Move ${table}:`, error.message);
    }

    // 5. Delete source workspace
    const { error: delError } = await supabase.from("workspaces").delete().eq("id", sourceId);
    if (delError) {
      console.error("Delete workspace error:", delError.message);
      return new Response(JSON.stringify({ error: delError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Merge complete: ${merged} merged, ${moved} moved, ${toDelete.length} duplicates removed`);

    return new Response(
      JSON.stringify({ success: true, merged, moved, deleted: toDelete.length }),
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

async function fetchAllProducts(supabase: any, workspaceId: string) {
  const all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
