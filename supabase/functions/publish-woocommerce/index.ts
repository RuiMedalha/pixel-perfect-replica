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

    const { productIds } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        const wooProduct: Record<string, unknown> = {
          name: product.optimized_title || product.original_title || "Sem título",
          description: product.optimized_description || product.original_description || "",
          short_description: product.optimized_short_description || product.short_description || "",
          regular_price: String(product.optimized_price || product.original_price || "0"),
          sku: product.sku || undefined,
          slug: product.seo_slug || undefined,
          categories: product.category ? [{ name: product.category }] : [],
          tags: (product.tags || []).map((t: string) => ({ name: t })),
          meta_data: [
            { key: "_yoast_wpseo_title", value: product.meta_title || "" },
            { key: "_yoast_wpseo_metadesc", value: product.meta_description || "" },
          ],
        };

        if (product.image_urls && product.image_urls.length > 0) {
          wooProduct.images = product.image_urls.map((url: string, i: number) => ({
            src: url,
            position: i,
          }));
        }

        // Resolve upsell/crosssell SKUs → WooCommerce IDs
        const resolveSkusToWooIds = async (skus: any[]): Promise<number[]> => {
          if (!skus || skus.length === 0) return [];
          // Handle both string[] and {sku}[] formats
          const skuList = skus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
          if (skuList.length === 0) return [];
          const { data: found } = await supabase
            .from("products")
            .select("woocommerce_id")
            .in("sku", skuList)
            .not("woocommerce_id", "is", null);
          return (found || []).map((p: any) => p.woocommerce_id).filter(Boolean);
        };

        const upsellIds = await resolveSkusToWooIds(product.upsell_skus || []);
        const crosssellIds = await resolveSkusToWooIds(product.crosssell_skus || []);
        if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
        if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;

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
