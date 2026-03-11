import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getWooConfig(supabase: any) {
  const { data: settings } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

  const settingsMap: Record<string, string> = {};
  settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

  const wooUrl = settingsMap["woocommerce_url"];
  const wooKey = settingsMap["woocommerce_consumer_key"];
  const wooSecret = settingsMap["woocommerce_consumer_secret"];

  if (!wooUrl || !wooKey || !wooSecret) return null;

  const baseUrl = wooUrl.replace(/\/+$/, "");
  const auth = btoa(`${wooKey}:${wooSecret}`);
  return { baseUrl, auth };
}

async function wooFetch(baseUrl: string, auth: string, endpoint: string) {
  const resp = await fetch(`${baseUrl}/wp-json/wc/v3${endpoint}`, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 300)}`);
  }
  const totalPages = parseInt(resp.headers.get("X-WP-TotalPages") || "1");
  const total = parseInt(resp.headers.get("X-WP-Total") || "0");
  const data = await resp.json();
  return { data, totalPages, total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
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

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    const wooConfig = await getWooConfig(supabase);
    if (!wooConfig) {
      return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { baseUrl, auth } = wooConfig;

    // ── ACTION: List categories ──
    if (action === "list_categories") {
      const allCats: any[] = [];
      let page = 1;
      while (true) {
        const { data } = await wooFetch(baseUrl, auth, `/products/categories?per_page=100&page=${page}`);
        allCats.push(...data);
        if (data.length < 100) break;
        page++;
      }
      return new Response(JSON.stringify({ categories: allCats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: List product attributes (brands, etc.) ──
    if (action === "list_attributes") {
      const { data: attributes } = await wooFetch(baseUrl, auth, `/products/attributes?per_page=100`);
      // For each attribute, get its terms
      const withTerms = [];
      for (const attr of attributes) {
        try {
          const allTerms: any[] = [];
          let page = 1;
          while (true) {
            const { data: terms } = await wooFetch(baseUrl, auth, `/products/attributes/${attr.id}/terms?per_page=100&page=${page}`);
            allTerms.push(...terms);
            if (terms.length < 100) break;
            page++;
          }
          withTerms.push({ ...attr, terms: allTerms });
        } catch (e) {
          withTerms.push({ ...attr, terms: [] });
        }
      }
      return new Response(JSON.stringify({ attributes: withTerms }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: Import products ──
    if (action === "import") {
      const {
        workspaceId,
        filters = {},
      } = body;

      if (!workspaceId) {
        return new Response(JSON.stringify({ error: "workspaceId is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Build query params from filters
      const params = new URLSearchParams();
      params.set("per_page", "100");
      
      if (filters.type && filters.type !== "all") {
        params.set("type", filters.type);
      }
      if (filters.status && filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.category) {
        params.set("category", filters.category);
      }
      if (filters.stock_status && filters.stock_status !== "all") {
        params.set("stock_status", filters.stock_status);
      }
      if (filters.search) {
        params.set("search", filters.search);
      }
      // Brand/attribute filter via attribute term
      if (filters.attribute && filters.attribute_term) {
        params.set("attribute", filters.attribute);
        params.set("attribute_term", filters.attribute_term);
      }

      // Fetch all matching products with pagination
      const allProducts: any[] = [];
      let page = 1;
      
      console.log(`Importing from WooCommerce with filters: ${JSON.stringify(filters)}`);
      
      while (true) {
        params.set("page", String(page));
        const { data: products, totalPages } = await wooFetch(baseUrl, auth, `/products?${params.toString()}`);
        allProducts.push(...products);
        console.log(`Page ${page}/${totalPages}: ${products.length} products`);
        if (page >= totalPages || products.length === 0) break;
        page++;
      }

      console.log(`Total products fetched from WooCommerce: ${allProducts.length}`);

      // For variable products, also fetch their variations
      const variableProducts = allProducts.filter((p: any) => p.type === "variable");
      const variationMap: Record<number, any[]> = {};

      for (const vp of variableProducts) {
        try {
          const allVars: any[] = [];
          let vPage = 1;
          while (true) {
            const { data: vars } = await wooFetch(baseUrl, auth, `/products/${vp.id}/variations?per_page=100&page=${vPage}`);
            allVars.push(...vars);
            if (vars.length < 100) break;
            vPage++;
          }
          variationMap[vp.id] = allVars;
        } catch (e) {
          console.error(`Failed to fetch variations for product ${vp.id}:`, e);
        }
      }

      // Get existing SKUs in workspace to avoid duplicates
      const existingSkus = new Set<string>();
      let from = 0;
      while (true) {
        const { data: existing } = await supabase.from("products")
          .select("sku")
          .eq("workspace_id", workspaceId)
          .not("sku", "is", null)
          .range(from, from + 999);
        if (!existing || existing.length === 0) break;
        existing.forEach((p: any) => existingSkus.add(p.sku));
        if (existing.length < 1000) break;
        from += 1000;
      }

      // Convert WooCommerce products to our format and insert
      let inserted = 0;
      let skipped = 0;
      let variationsInserted = 0;
      const userId = user.id;

      const toInsert: any[] = [];

      for (const wp of allProducts) {
        const sku = wp.sku || String(wp.id);
        
        if (existingSkus.has(sku)) {
          skipped++;
          continue;
        }

        // Extract brand from attributes
        const brandAttr = wp.attributes?.find((a: any) => 
          a.name.toLowerCase() === 'marca' || a.name.toLowerCase() === 'brand'
        );

        // Extract image URLs
        const imageUrls = (wp.images || []).map((img: any) => img.src).filter(Boolean);

        // Build attributes array for variable products
        const attrs = wp.type === 'variable' ? 
          (wp.attributes || []).filter((a: any) => a.variation).map((a: any) => ({
            name: a.name,
            values: a.options || [],
          })) : [];

        const product: any = {
          user_id: userId,
          workspace_id: workspaceId,
          sku,
          original_title: wp.name,
          original_description: wp.description || null,
          short_description: wp.short_description || null,
          original_price: wp.regular_price ? parseFloat(wp.regular_price) : null,
          sale_price: wp.sale_price ? parseFloat(wp.sale_price) : null,
          image_urls: imageUrls.length > 0 ? imageUrls : null,
          category: wp.categories?.[0]?.name || null,
          product_type: wp.type === 'variable' ? 'variable' : 'simple',
          status: 'pending',
          woocommerce_id: wp.id,
          source_file: 'woocommerce-import',
          supplier_ref: brandAttr?.options?.[0] || null,
          attributes: attrs.length > 0 ? attrs : [],
          tags: (wp.tags || []).map((t: any) => t.name),
        };

        toInsert.push(product);
        existingSkus.add(sku); // prevent duplicates within this import
      }

      // Batch insert products
      const parentIdMap: Record<string, string> = {}; // woo_id -> our_id

      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const { data: insertedData, error: insertErr } = await supabase
          .from("products")
          .insert(batch)
          .select("id, sku, woocommerce_id");

        if (insertErr) {
          console.error(`Insert batch error:`, insertErr);
          continue;
        }

        inserted += (insertedData?.length || 0);
        
        // Map woo IDs to our IDs for variation linking
        for (const row of (insertedData || [])) {
          if (row.woocommerce_id) {
            parentIdMap[String(row.woocommerce_id)] = row.id;
          }
        }
      }

      // Insert variations for variable products
      for (const [wooParentId, variations] of Object.entries(variationMap)) {
        const parentId = parentIdMap[wooParentId];
        if (!parentId) continue;

        const varInserts: any[] = [];

        for (const v of variations) {
          const varSku = v.sku || `${wooParentId}-${v.id}`;
          
          if (existingSkus.has(varSku)) continue;
          existingSkus.add(varSku);

          const varAttrs = (v.attributes || []).map((a: any) => ({
            name: a.name,
            value: a.option,
          }));

          const varImages = (v.image ? [v.image.src] : []).filter(Boolean);

          varInserts.push({
            user_id: userId,
            workspace_id: workspaceId,
            sku: varSku,
            original_title: `${allProducts.find((p: any) => p.id === parseInt(wooParentId))?.name || ''} - ${varAttrs.map((a: any) => a.value).join(' / ')}`.trim(),
            original_price: v.regular_price ? parseFloat(v.regular_price) : null,
            sale_price: v.sale_price ? parseFloat(v.sale_price) : null,
            image_urls: varImages.length > 0 ? varImages : null,
            product_type: 'variation',
            parent_product_id: parentId,
            attributes: varAttrs,
            status: 'pending',
            woocommerce_id: v.id,
            source_file: 'woocommerce-import',
          });
        }

        // Batch insert variations
        for (let i = 0; i < varInserts.length; i += 50) {
          const batch = varInserts.slice(i, i + 50);
          const { data: vData, error: vErr } = await supabase.from("products").insert(batch).select("id");
          if (vErr) {
            console.error(`Variation insert error for parent ${wooParentId}:`, vErr);
          } else {
            variationsInserted += (vData?.length || 0);
          }
        }
      }

      // Log activity
      await supabase.from("activity_log").insert({
        user_id: userId,
        action: "upload" as const,
        workspace_id: workspaceId,
        details: { 
          type: "woocommerce_import", 
          imported: inserted, 
          variations: variationsInserted,
          skipped,
          filters,
        },
      });

      console.log(`Import complete: ${inserted} products, ${variationsInserted} variations, ${skipped} skipped`);

      return new Response(JSON.stringify({ 
        success: true, 
        imported: inserted, 
        variations: variationsInserted,
        skipped,
        total: allProducts.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
