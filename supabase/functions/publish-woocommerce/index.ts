import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { productIds, publishFields } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If publishFields provided, use as a set for filtering; otherwise send everything
    const fields = publishFields && Array.isArray(publishFields) ? new Set(publishFields) : null;
    const has = (key: string) => !fields || fields.has(key);

    // Get WooCommerce settings
    const { data: settings } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

    const settingsMap: Record<string, string> = {};
    settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

    const wooUrl = settingsMap["woocommerce_url"];
    const wooKey = settingsMap["woocommerce_consumer_key"];
    const wooSecret = settingsMap["woocommerce_consumer_secret"];

    if (!wooUrl || !wooKey || !wooSecret) {
      return new Response(
        JSON.stringify({ error: "Credenciais WooCommerce não configuradas. Vá às Configurações." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get products
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (prodErr) throw prodErr;

    const results: Array<{ id: string; status: string; woocommerce_id?: number; error?: string }> = [];
    const baseUrl = wooUrl.replace(/\/+$/, "");
    const auth = btoa(`${wooKey}:${wooSecret}`);

    for (const product of products ?? []) {
      try {
        const wooProduct: Record<string, unknown> = {};

        // Content
        if (has("title")) {
          wooProduct.name = product.optimized_title || product.original_title || "Sem título";
        }
        if (has("description")) {
          wooProduct.description = product.optimized_description || product.original_description || "";
        }
        if (has("short_description")) {
          wooProduct.short_description = product.optimized_short_description || product.short_description || "";
        }

        // Price
        if (has("price")) {
          wooProduct.regular_price = String(product.optimized_price || product.original_price || "0");
        }
        if (has("sale_price")) {
          const sp = product.optimized_sale_price ?? product.sale_price;
          if (sp != null) {
            wooProduct.sale_price = String(sp);
          }
        }

        // SKU
        if (has("sku")) {
          wooProduct.sku = product.sku || undefined;
        }

        // Slug
        if (has("slug")) {
          wooProduct.slug = product.seo_slug || undefined;
        }

        // Taxonomies
        if (has("categories")) {
          wooProduct.categories = product.category ? [{ name: product.category }] : [];
        }
        if (has("tags")) {
          wooProduct.tags = (product.tags || []).map((t: string) => ({ name: t }));
        }

        // SEO meta (Yoast/RankMath)
        if (has("meta_title") || has("meta_description")) {
          const meta_data: Array<{ key: string; value: string }> = [];
          if (has("meta_title")) {
            meta_data.push({ key: "_yoast_wpseo_title", value: product.meta_title || "" });
          }
          if (has("meta_description")) {
            meta_data.push({ key: "_yoast_wpseo_metadesc", value: product.meta_description || "" });
          }
          wooProduct.meta_data = meta_data;
        }

        // Images
        if (has("images")) {
          if (product.image_urls && product.image_urls.length > 0) {
            const altTexts = product.image_alt_texts || [];
            wooProduct.images = product.image_urls.map((url: string, i: number) => {
              const img: Record<string, unknown> = { src: url, position: i };
              // Include alt text if media/image_alt_text is enabled
              if (has("image_alt_text") && altTexts[i]) {
                img.alt = typeof altTexts[i] === "string" ? altTexts[i] : (altTexts[i] as any)?.alt || "";
              }
              return img;
            });
          }
        } else if (has("image_alt_text") && !has("images")) {
          // Only update alt text on existing images — need to send images with just alt updates
          // WooCommerce requires image src or id to update alt; skip if no images field
        }

        // Upsells / Cross-sells
        const resolveSkusToWooIds = async (skus: any[]): Promise<number[]> => {
          if (!skus || skus.length === 0) return [];
          const skuList = skus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
          if (skuList.length === 0) return [];
          const { data: found } = await supabase
            .from("products")
            .select("woocommerce_id")
            .in("sku", skuList)
            .not("woocommerce_id", "is", null);
          return (found || []).map((p: any) => p.woocommerce_id).filter(Boolean);
        };

        if (has("upsells")) {
          const upsellIds = await resolveSkusToWooIds(product.upsell_skus || []);
          if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
        }
        if (has("crosssells")) {
          const crosssellIds = await resolveSkusToWooIds(product.crosssell_skus || []);
          if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;
        }

        // Skip if no fields to send
        if (Object.keys(wooProduct).length === 0) {
          results.push({ id: product.id, status: "skipped" });
          continue;
        }

        let response: Response;
        if (product.woocommerce_id) {
          response = await fetch(`${baseUrl}/wp-json/wc/v3/products/${product.woocommerce_id}`, {
            method: "PUT",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify(wooProduct),
          });
        } else {
          response = await fetch(`${baseUrl}/wp-json/wc/v3/products`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify(wooProduct),
          });
        }

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`WooCommerce ${response.status}: ${errBody.substring(0, 200)}`);
        }

        const wooData = await response.json();

        await supabase
          .from("products")
          .update({ woocommerce_id: wooData.id, status: "published" as any })
          .eq("id", product.id);

        results.push({ id: product.id, status: "published", woocommerce_id: wooData.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        results.push({ id: product.id, status: "error", error: msg });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
