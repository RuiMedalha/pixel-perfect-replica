import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface WooResult {
  id: string;
  status: string;
  woocommerce_id?: number;
  error?: string;
}

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

    const { productIds, publishFields, pricing } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fields = publishFields && Array.isArray(publishFields) ? new Set(publishFields) : null;
    const has = (key: string) => !fields || fields.has(key);

    // Pricing adjustments
    const markupPercent = pricing?.markupPercent ?? 0;
    const discountPercent = pricing?.discountPercent ?? 0;

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

    // Get all requested products
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (prodErr) throw prodErr;
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ error: "Produtos não encontrados" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also fetch child variations for any variable parents in the selection
    const variableParentIds = products
      .filter((p: any) => p.product_type === "variable")
      .map((p: any) => p.id);

    let allChildVariations: any[] = [];
    if (variableParentIds.length > 0) {
      const { data: children } = await supabase
        .from("products")
        .select("*")
        .in("parent_product_id", variableParentIds);
      allChildVariations = children || [];
    }

    const results: WooResult[] = [];
    const baseUrl = wooUrl.replace(/\/+$/, "");
    const auth = btoa(`${wooKey}:${wooSecret}`);

    // Helper: WooCommerce API call
    const wooFetch = async (endpoint: string, method: string, body?: Record<string, unknown>) => {
      const resp = await fetch(`${baseUrl}/wp-json/wc/v3${endpoint}`, {
        method,
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 300)}`);
      }
      return resp.json();
    };

    // Helper: find existing WooCommerce product by SKU
    const findWooProductBySku = async (sku: string | null): Promise<number | null> => {
      if (!sku) return null;
      try {
        const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&per_page=1`, {
          method: "GET",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0 && data[0].id) {
          return data[0].id;
        }
      } catch {
        // SKU lookup failed, will create new
      }
      return null;
    };

    // Helper: resolve SKUs to WooCommerce IDs
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

    // Build base product payload (shared between simple/variable/variation)
    const buildBasePayload = async (product: any, isVariation = false): Promise<Record<string, unknown>> => {
      const wooProduct: Record<string, unknown> = {};

      // Content
      if (has("title")) {
        wooProduct.name = product.optimized_title || product.original_title || "Sem título";
      }
      if (has("description")) {
        wooProduct.description = product.optimized_description || product.original_description || "";
      }
      if (has("short_description") && !isVariation) {
        wooProduct.short_description = product.optimized_short_description || product.short_description || "";
      }

      // Price (with optional markup/discount adjustments)
      if (has("price")) {
        let basePrice = parseFloat(product.optimized_price || product.original_price || "0") || 0;
        if (markupPercent > 0) {
          basePrice = basePrice * (1 + markupPercent / 100);
        }
        wooProduct.regular_price = basePrice.toFixed(2);

        // If discount is set, auto-calculate sale_price from the adjusted regular price
        if (has("sale_price") && discountPercent > 0) {
          wooProduct.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
        }
      }
      // Sale price without markup scenario (use stored sale_price)
      if (has("sale_price") && !wooProduct.sale_price) {
        const sp = product.optimized_sale_price ?? product.sale_price;
        if (sp != null) {
          wooProduct.sale_price = String(sp);
        }
      }

      // SKU
      if (has("sku")) {
        wooProduct.sku = product.sku || undefined;
      }

      // Slug (not for variations)
      if (has("slug") && !isVariation) {
        wooProduct.slug = product.seo_slug || undefined;
      }

      // Images
      if (has("images")) {
        if (product.image_urls && product.image_urls.length > 0) {
          const altTexts = product.image_alt_texts || [];
          wooProduct.images = product.image_urls.map((url: string, i: number) => {
            const img: Record<string, unknown> = { src: url, position: i };
            if (has("image_alt_text") && altTexts[i]) {
              img.alt = typeof altTexts[i] === "string" ? altTexts[i] : (altTexts[i] as any)?.alt || "";
            }
            return img;
          });
        }
      }

      // Only for non-variations
      if (!isVariation) {
        // Taxonomies
        if (has("categories")) {
          // Resolve category_id to woocommerce_id if available
          if (product.category_id) {
            const { data: catRow } = await supabase
              .from("categories")
              .select("woocommerce_id, name, parent_id")
              .eq("id", product.category_id)
              .single();
            if (catRow?.woocommerce_id) {
              // Build full category chain (child + parents)
              const catIds: Array<{ id: number }> = [{ id: catRow.woocommerce_id }];
              let parentId = catRow.parent_id;
              while (parentId) {
                const { data: parentCat } = await supabase
                  .from("categories")
                  .select("woocommerce_id, parent_id")
                  .eq("id", parentId)
                  .single();
                if (parentCat?.woocommerce_id) {
                  catIds.push({ id: parentCat.woocommerce_id });
                }
                parentId = parentCat?.parent_id || null;
              }
              wooProduct.categories = catIds;
            } else if (catRow) {
              wooProduct.categories = [{ name: catRow.name }];
            }
          } else if (product.category) {
            wooProduct.categories = [{ name: product.category }];
          }
        }
        if (has("tags")) {
          wooProduct.tags = (product.tags || []).map((t: string) => ({ name: t }));
        }

        // SEO meta
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
      }

      return wooProduct;
    };

    // Extract unique attribute names/values from variations
    const buildAttributesForParent = (variations: any[]): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> => {
      const attrMap = new Map<string, Set<string>>();

      for (const v of variations) {
        const attrs = v.attributes || [];
        if (Array.isArray(attrs)) {
          for (const attr of attrs) {
            if (attr.name && attr.value) {
              if (!attrMap.has(attr.name)) attrMap.set(attr.name, new Set());
              attrMap.get(attr.name)!.add(attr.value);
            }
          }
        }
      }

      return Array.from(attrMap.entries()).map(([name, values]) => ({
        name,
        options: Array.from(values),
        variation: true,
        visible: true,
      }));
    };

    // Build variation attribute selection for WooCommerce
    const buildVariationAttributes = (product: any): Array<{ name: string; option: string }> => {
      const attrs = product.attributes || [];
      if (!Array.isArray(attrs)) return [];
      return attrs
        .filter((a: any) => a.name && a.value)
        .map((a: any) => ({ name: a.name, option: a.value }));
    };

    // Separate products into categories
    const variableParents = products.filter((p: any) => p.product_type === "variable");
    const simpleProducts = products.filter((p: any) =>
      p.product_type !== "variable" && !p.parent_product_id
    );
    // Standalone variations selected without their parent
    const standaloneVariations = products.filter((p: any) =>
      p.parent_product_id && !variableParentIds.includes(p.parent_product_id)
    );

    // ──────────────────────────────────────────────
    // 1) Publish SIMPLE products (unchanged logic)
    // ──────────────────────────────────────────────
    for (const product of simpleProducts) {
      try {
        const wooProduct = await buildBasePayload(product);

        // Upsells / Cross-sells
        if (has("upsells")) {
          const upsellIds = await resolveSkusToWooIds(product.upsell_skus || []);
          if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
        }
        if (has("crosssells")) {
          const crosssellIds = await resolveSkusToWooIds(product.crosssell_skus || []);
          if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;
        }

        if (Object.keys(wooProduct).length === 0) {
          results.push({ id: product.id, status: "skipped" });
          continue;
        }

        wooProduct.type = "simple";

        let existingWooId = product.woocommerce_id;
        let action: "created" | "updated" = "created";

        // If no local woocommerce_id, try to find by SKU in WooCommerce
        if (!existingWooId && product.sku) {
          const foundId = await findWooProductBySku(product.sku);
          if (foundId) {
            existingWooId = foundId;
          }
        }

        if (existingWooId) {
          action = "updated";
        }

        const wooData = existingWooId
          ? await wooFetch(`/products/${existingWooId}`, "PUT", wooProduct)
          : await wooFetch(`/products`, "POST", wooProduct);

        await supabase
          .from("products")
          .update({ woocommerce_id: wooData.id, status: "published" as any })
          .eq("id", product.id);

        results.push({ id: product.id, status: action, woocommerce_id: wooData.id });
      } catch (e) {
        results.push({ id: product.id, status: "error", error: (e as Error).message });
      }
    }

    // ──────────────────────────────────────────────
    // 2) Publish VARIABLE parents + their variations
    // ──────────────────────────────────────────────
    for (const parent of variableParents) {
      try {
        const children = allChildVariations.filter((c: any) => c.parent_product_id === parent.id);

        // Build parent payload
        const parentPayload = await buildBasePayload(parent);
        parentPayload.type = "variable";

        // Build attributes from children
        const attributes = buildAttributesForParent(children);
        if (attributes.length > 0) {
          parentPayload.attributes = attributes;
        }

        // Upsells / Cross-sells on parent
        if (has("upsells")) {
          const upsellIds = await resolveSkusToWooIds(parent.upsell_skus || []);
          if (upsellIds.length > 0) parentPayload.upsell_ids = upsellIds;
        }
        if (has("crosssells")) {
          const crosssellIds = await resolveSkusToWooIds(parent.crosssell_skus || []);
          if (crosssellIds.length > 0) parentPayload.cross_sell_ids = crosssellIds;
        }

        // Remove price from parent (WooCommerce calculates from variations)
        delete parentPayload.regular_price;
        delete parentPayload.sale_price;

        // Create or update parent
        let existingParentWooId = parent.woocommerce_id;
        let parentAction: "created" | "updated" = "created";

        if (!existingParentWooId && parent.sku) {
          const foundId = await findWooProductBySku(parent.sku);
          if (foundId) existingParentWooId = foundId;
        }
        if (existingParentWooId) parentAction = "updated";

        const parentWooData = existingParentWooId
          ? await wooFetch(`/products/${existingParentWooId}`, "PUT", parentPayload)
          : await wooFetch(`/products`, "POST", parentPayload);

        const parentWooId = parentWooData.id;

        await supabase
          .from("products")
          .update({ woocommerce_id: parentWooId, status: "published" as any })
          .eq("id", parent.id);

        results.push({ id: parent.id, status: parentAction, woocommerce_id: parentWooId });

        // Now publish each variation
        for (const child of children) {
          try {
            const variationPayload = await buildBasePayload(child, true);

            // Set the variation attributes (e.g. Color: Red, Size: M)
            const variationAttrs = buildVariationAttributes(child);
            if (variationAttrs.length > 0) {
              variationPayload.attributes = variationAttrs;
            }

            // Create or update variation
            const childAction: "created" | "updated" = child.woocommerce_id ? "updated" : "created";
            const varWooData = child.woocommerce_id
              ? await wooFetch(`/products/${parentWooId}/variations/${child.woocommerce_id}`, "PUT", variationPayload)
              : await wooFetch(`/products/${parentWooId}/variations`, "POST", variationPayload);

            await supabase
              .from("products")
              .update({ woocommerce_id: varWooData.id, status: "published" as any })
              .eq("id", child.id);

            results.push({ id: child.id, status: childAction, woocommerce_id: varWooData.id });
          } catch (e) {
            results.push({ id: child.id, status: "error", error: (e as Error).message });
          }
        }
      } catch (e) {
        results.push({ id: parent.id, status: "error", error: (e as Error).message });
      }
    }

    // ──────────────────────────────────────────────
    // 3) Standalone variations (parent not in selection)
    //    Treat as simple products if parent has no woo ID,
    //    or update as variation if parent has woo ID
    // ──────────────────────────────────────────────
    for (const variation of standaloneVariations) {
      try {
        // Lookup parent's woocommerce_id
        const { data: parentRow } = await supabase
          .from("products")
          .select("woocommerce_id")
          .eq("id", variation.parent_product_id)
          .single();

        const parentWooId = parentRow?.woocommerce_id;

        if (parentWooId) {
          // Publish as variation under parent
          const variationPayload = await buildBasePayload(variation, true);
          const variationAttrs = buildVariationAttributes(variation);
          if (variationAttrs.length > 0) {
            variationPayload.attributes = variationAttrs;
          }

          const varWooData = variation.woocommerce_id
            ? await wooFetch(`/products/${parentWooId}/variations/${variation.woocommerce_id}`, "PUT", variationPayload)
            : await wooFetch(`/products/${parentWooId}/variations`, "POST", variationPayload);

          await supabase
            .from("products")
            .update({ woocommerce_id: varWooData.id, status: "published" as any })
            .eq("id", variation.id);

          results.push({ id: variation.id, status: "published", woocommerce_id: varWooData.id });
        } else {
          // Parent not published yet — skip with warning
          results.push({
            id: variation.id,
            status: "error",
            error: "O produto pai ainda não foi publicado no WooCommerce. Publique o produto variável primeiro.",
          });
        }
      } catch (e) {
        results.push({ id: variation.id, status: "error", error: (e as Error).message });
      }
    }

    // Log publish activity
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const published = results.filter((r: WooResult) => r.status === "published").length;
    const errors = results.filter((r: WooResult) => r.status === "error").length;
    await adminClient.from("activity_log").insert({
      user_id: user.id,
      action: "publish" as any,
      details: {
        total: results.length,
        published,
        errors,
        results: results.map((r: WooResult) => ({
          id: r.id,
          status: r.status,
          woocommerce_id: r.woocommerce_id,
          error: r.error,
        })),
      },
    });

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
