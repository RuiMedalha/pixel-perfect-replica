import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SELF_INVOKE_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function selfInvokeWithRetry(authHeader: string, jobId: string, startIndex: number) {
  const payload = JSON.stringify({ jobId, startIndex });
  for (let attempt = 1; attempt <= SELF_INVOKE_RETRIES; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-woocommerce`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: payload,
      });
      if (response.ok) return true;
      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable) {
        const body = await response.text();
        console.error(`Self-invoke non-retryable error: ${response.status} ${body}`);
        return false;
      }
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`);
      await sleep(delayMs);
    } catch (err) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      console.warn(`Self-invoke exception retry ${attempt}/${SELF_INVOKE_RETRIES} in ${delayMs}ms`, err);
      await sleep(delayMs);
    }
  }
  console.error("Self-invoke failed after all retries");
  return false;
}

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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // ── MODE: Continue an existing job ──
    if (body.jobId && body.startIndex !== undefined) {
      const { jobId, startIndex } = body;

      const { data: job, error: jobErr } = await adminClient
        .from("publish_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      if (jobErr || !job) {
        return new Response(JSON.stringify({ error: "Job não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (job.status === "cancelled") {
        return new Response(JSON.stringify({ status: "cancelled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get WooCommerce settings (use user's supabase client for RLS)
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${authHeader?.replace("Bearer ", "")}` } } }
      );

      const wooConfig = await getWooConfig(supabase);
      if (!wooConfig) {
        await adminClient.from("publish_jobs").update({
          status: "failed",
          error_message: "Credenciais WooCommerce não configuradas.",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        return new Response(JSON.stringify({ error: "Credenciais WooCommerce não configuradas." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { baseUrl, auth } = wooConfig;
      const fields = job.publish_fields && Array.isArray(job.publish_fields) ? new Set(job.publish_fields) : null;
      const has = (key: string) => !fields || fields.has(key);
      const pricing = job.pricing || {};
      const markupPercent = pricing?.markupPercent ?? 0;
      const discountPercent = pricing?.discountPercent ?? 0;

      const productIds = job.product_ids as string[];
      const BATCH_SIZE = 3;
      const endIndex = Math.min(startIndex + BATCH_SIZE, productIds.length);
      const batchIds = productIds.slice(startIndex, endIndex);

      // Fetch products for this batch
      const { data: batchProducts } = await supabase
        .from("products")
        .select("*")
        .in("id", batchIds);

      if (!batchProducts || batchProducts.length === 0) {
        // Skip this batch
        if (endIndex >= productIds.length) {
          await finalizeJob(adminClient, jobId, job, user.id);
          return new Response(JSON.stringify({ status: "completed" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const existingResults = (job.results || []) as WooResult[];

      // Process each product in the batch
      for (const product of (batchProducts || [])) {
        // Re-check cancellation
        const { data: freshJob } = await adminClient
          .from("publish_jobs")
          .select("status")
          .eq("id", jobId)
          .single();
        if (freshJob?.status === "cancelled") break;

        const productName = product.optimized_title || product.original_title || product.sku || product.id.slice(0, 8);

        await adminClient.from("publish_jobs").update({
          current_product_name: productName,
          status: "processing",
          started_at: job.started_at || new Date().toISOString(),
        }).eq("id", jobId);

        try {
          const result = await publishSingleProduct(
            product, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent
          );
          existingResults.push(result);

          const failed = result.status === "error" ? 1 : 0;
          await adminClient.from("publish_jobs").update({
            processed_products: startIndex + existingResults.length - (job.results as any[])?.length + (job.processed_products || 0),
            failed_products: (job.failed_products || 0) + failed,
            results: existingResults,
          }).eq("id", jobId);
        } catch (e) {
          existingResults.push({
            id: product.id,
            status: "error",
            error: (e as Error).message,
          });
          await adminClient.from("publish_jobs").update({
            processed_products: startIndex + existingResults.length - (job.results as any[])?.length + (job.processed_products || 0),
            failed_products: (job.failed_products || 0) + 1,
            results: existingResults,
          }).eq("id", jobId);
        }
      }

      // Update total processed
      const totalProcessedNow = endIndex;
      await adminClient.from("publish_jobs").update({
        processed_products: totalProcessedNow,
        results: existingResults,
      }).eq("id", jobId);

      // If more products to process, self-invoke with retry
      if (endIndex < productIds.length) {
        const { data: checkJob } = await adminClient
          .from("publish_jobs")
          .select("status")
          .eq("id", jobId)
          .single();
        if (checkJob?.status !== "cancelled") {
          await selfInvokeWithRetry(authHeader!, jobId, endIndex);
        }
      } else {
        // Job complete
        await finalizeJob(adminClient, jobId, { ...job, results: existingResults }, user.id);
      }

      return new Response(JSON.stringify({ status: "processing", jobId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE: Create a new job ──
    const { productIds, publishFields, pricing, scheduledFor, workspaceId } = body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto selecionado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Expand variable products to include children
    const { data: selectedProducts } = await supabase
      .from("products")
      .select("id, product_type")
      .in("id", productIds);

    const variableParentIds = (selectedProducts || [])
      .filter((p: any) => p.product_type === "variable")
      .map((p: any) => p.id);

    let allIds = [...productIds];
    if (variableParentIds.length > 0) {
      const { data: children } = await supabase
        .from("products")
        .select("id")
        .in("parent_product_id", variableParentIds);
      const childIds = (children || []).map((c: any) => c.id);
      allIds = [...new Set([...allIds, ...childIds])];
    }

    const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
    const status = isScheduled ? "scheduled" : "queued";

    const { data: newJob, error: insertErr } = await adminClient
      .from("publish_jobs")
      .insert({
        user_id: user.id,
        workspace_id: workspaceId || null,
        status,
        total_products: allIds.length,
        product_ids: allIds,
        publish_fields: publishFields || [],
        pricing: pricing || null,
        scheduled_for: scheduledFor || null,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // If not scheduled, start processing immediately via self-invoke with retry
    if (!isScheduled) {
      await selfInvokeWithRetry(authHeader!, newJob.id, 0);
    }

    return new Response(JSON.stringify({ jobId: newJob.id }), {
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

// ─── Helpers ───

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

class WooSkuConflictError extends Error {
  resourceId: number;
  constructor(resourceId: number, message: string) {
    super(message);
    this.resourceId = resourceId;
  }
}

async function wooFetch(baseUrl: string, auth: string, endpoint: string, method: string, body?: Record<string, unknown>) {
  const resp = await fetch(`${baseUrl}/wp-json/wc/v3${endpoint}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    // Detect SKU conflict and extract existing resource_id for retry
    try {
      const parsed = JSON.parse(errBody);
      if (parsed.code === "product_invalid_sku" && parsed.data?.resource_id) {
        throw new WooSkuConflictError(parsed.data.resource_id, `SKU conflict: existing ID ${parsed.data.resource_id}`);
      }
    } catch (e) {
      if (e instanceof WooSkuConflictError) throw e;
    }
    throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 300)}`);
  }
  return resp.json();
}

async function findWooProductBySku(baseUrl: string, auth: string, sku: string | null): Promise<number | null> {
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
  } catch { /* skip */ }
  return null;
}

async function findWooVariationBySku(baseUrl: string, auth: string, parentWooId: number, sku: string): Promise<number | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations?sku=${encodeURIComponent(sku)}&per_page=1`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0 && data[0].id) {
      return data[0].id;
    }
  } catch { /* skip */ }
  return null;
}

async function deleteWooProduct(baseUrl: string, auth: string, productId: number): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${productId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    return resp.ok;
  } catch { return false; }
}

async function handleVariationSkuConflict(
  baseUrl: string, auth: string, parentWooId: number, childId: string, sku: string,
  variationPayload: Record<string, unknown>, skuErr: WooSkuConflictError, supabase: any
): Promise<any> {
  // The resource_id from SKU conflict might be a standalone product, NOT a variation under this parent.
  // Step 1: Try to find the variation by SKU under the correct parent
  const realVarId = await findWooVariationBySku(baseUrl, auth, parentWooId, sku);
  if (realVarId) {
    console.log(`Found existing variation ${realVarId} under parent ${parentWooId} for child ${childId}`);
    const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${realVarId}`, "PUT", variationPayload);
    await supabase.from("products").update({ woocommerce_id: realVarId }).eq("id", childId);
    return varWooData;
  }

  // Step 2: The conflicting SKU is a standalone product — delete it and create as variation
  console.log(`SKU conflict resource_id ${skuErr.resourceId} is not a variation under parent ${parentWooId}. Deleting standalone and creating variation.`);
  await deleteWooProduct(baseUrl, auth, skuErr.resourceId);

  // Now create the variation fresh
  const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
  return varWooData;
}

async function resolveSkusToWooIds(supabase: any, adminClient: any, baseUrl: string, auth: string, skus: any[]): Promise<number[]> {
  if (!skus || skus.length === 0) return [];
  const skuList = skus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
  if (skuList.length === 0) return [];

  const { data: found } = await supabase
    .from("products")
    .select("sku, woocommerce_id")
    .in("sku", skuList)
    .not("woocommerce_id", "is", null);

  const resolvedIds: number[] = [];
  const resolvedSkus = new Set<string>();

  for (const p of (found || [])) {
    if (p.woocommerce_id) {
      resolvedIds.push(p.woocommerce_id);
      resolvedSkus.add(p.sku);
    }
  }

  const unresolvedSkus = skuList.filter((s: string) => !resolvedSkus.has(s));
  for (const sku of unresolvedSkus) {
    const wooId = await findWooProductBySku(baseUrl, auth, sku);
    if (wooId) {
      resolvedIds.push(wooId);
      await supabase
        .from("products")
        .update({ woocommerce_id: wooId })
        .eq("sku", sku)
        .is("woocommerce_id", null);
    }
  }

  return resolvedIds;
}

async function buildBasePayload(
  product: any, supabase: any, baseUrl: string, auth: string,
  has: (k: string) => boolean, markupPercent: number, discountPercent: number, isVariation = false
): Promise<Record<string, unknown>> {
  const wooProduct: Record<string, unknown> = {};

  if (has("title")) {
    wooProduct.name = product.optimized_title || product.original_title || "Sem título";
  }
  if (has("description")) {
    wooProduct.description = product.optimized_description || product.original_description || "";
  }
  if (has("short_description") && !isVariation) {
    wooProduct.short_description = product.optimized_short_description || product.short_description || "";
  }

  if (has("price")) {
    let basePrice = parseFloat(product.optimized_price || product.original_price || "0") || 0;
    if (markupPercent > 0) {
      basePrice = basePrice * (1 + markupPercent / 100);
    }
    wooProduct.regular_price = basePrice.toFixed(2);

    if (has("sale_price") && discountPercent > 0) {
      wooProduct.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }
  if (has("sale_price") && !wooProduct.sale_price) {
    const sp = product.optimized_sale_price ?? product.sale_price;
    if (sp != null) {
      wooProduct.sale_price = String(sp);
    }
  }

  if (has("sku")) {
    wooProduct.sku = product.sku || undefined;
  }

  if (has("slug") && !isVariation) {
    wooProduct.slug = product.seo_slug || undefined;
  }

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

  if (!isVariation) {
    if (has("categories")) {
      if (product.category_id) {
        const { data: catRow } = await supabase
          .from("categories")
          .select("woocommerce_id, name, parent_id")
          .eq("id", product.category_id)
          .single();
        if (catRow?.woocommerce_id) {
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
        const parts = product.category.split(/>/).map((s: string) => s.trim()).filter(Boolean);
        const resolveCatName = async (name: string): Promise<number | null> => {
          const { data: localCats } = await supabase
            .from("categories")
            .select("woocommerce_id")
            .ilike("name", name)
            .not("woocommerce_id", "is", null)
            .limit(1);
          if (localCats && localCats.length > 0 && localCats[0].woocommerce_id) {
            return localCats[0].woocommerce_id;
          }
          try {
            const searchResp = await fetch(
              `${baseUrl}/wp-json/wc/v3/products/categories?search=${encodeURIComponent(name)}&per_page=10`,
              { headers: { Authorization: `Basic ${auth}` } }
            );
            if (searchResp.ok) {
              const wooCats = await searchResp.json();
              const exactMatch = wooCats.find((c: any) => c.name.toLowerCase() === name.toLowerCase());
              if (exactMatch) return exactMatch.id;
            }
          } catch { /* skip */ }
          return null;
        };

        const resolvedCatIds: Array<{ id: number }> = [];
        for (const part of parts) {
          const wcId = await resolveCatName(part);
          if (wcId) resolvedCatIds.push({ id: wcId });
        }
        if (resolvedCatIds.length > 0) {
          wooProduct.categories = resolvedCatIds;
        }
      }
    }
    if (has("tags")) {
      wooProduct.tags = (product.tags || []).map((t: string) => ({ name: t }));
    }

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
}

// Extract the unique suffix from a child title compared to the parent title
function extractTitleSuffix(parentTitle: string, childTitle: string): string {
  const p = parentTitle.toLowerCase().trim();
  const c = childTitle.toLowerCase().trim();
  let i = 0;
  while (i < p.length && i < c.length && p[i] === c[i]) i++;
  const suffix = childTitle.trim().substring(i).trim();
  return suffix || childTitle.trim();
}

function buildAttributesForParent(parent: any, variations: any[]): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> {
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

  if (attrMap.size === 0) {
    const parentAttrs = parent.attributes || [];
    if (Array.isArray(parentAttrs)) {
      for (const attr of parentAttrs) {
        if (attr.name && Array.isArray(attr.values) && attr.values.length > 0) {
          if (!attrMap.has(attr.name)) attrMap.set(attr.name, new Set());
          for (const val of attr.values) { if (val) attrMap.get(attr.name)!.add(val); }
        }
        if (attr.name && Array.isArray(attr.options) && attr.options.length > 0) {
          if (!attrMap.has(attr.name)) attrMap.set(attr.name, new Set());
          for (const val of attr.options) { if (val) attrMap.get(attr.name)!.add(val); }
        }
      }
    }
  }

  // Ultimate fallback: extract attribute values from title differences
  if (attrMap.size === 0 && variations.length > 0) {
    const knownAttrNames = new Set<string>();
    for (const v of variations) {
      const attrs = v.attributes || [];
      if (Array.isArray(attrs)) {
        for (const attr of attrs) { if (attr.name) knownAttrNames.add(attr.name); }
      }
    }
    const parentTitle = parent.optimized_title || parent.original_title || "";
    const suffixes: string[] = [];
    for (const v of variations) {
      const childTitle = v.optimized_title || v.original_title || "";
      const suffix = extractTitleSuffix(parentTitle, childTitle);
      if (suffix) suffixes.push(suffix);
    }
    if (suffixes.length > 0) {
      const attrName = knownAttrNames.size > 0 ? Array.from(knownAttrNames)[0] : "Variação";
      attrMap.set(attrName, new Set(suffixes));
      console.log(`Built attributes from title diffs: ${attrName} => [${suffixes.join(", ")}]`);
    }
  }

  return Array.from(attrMap.entries()).map(([name, values]) => ({
    name,
    options: Array.from(values),
    variation: true,
    visible: true,
  }));
}

function buildVariationAttributes(product: any, parent?: any): Array<{ name: string; option: string }> {
  const attrs = product.attributes || [];
  if (Array.isArray(attrs)) {
    const mapped = attrs.filter((a: any) => a.name && a.value).map((a: any) => ({ name: a.name, option: a.value }));
    if (mapped.length > 0) return mapped;
  }

  if (parent) {
    const parentAttrs = parent.attributes || [];
    if (Array.isArray(parentAttrs) && parentAttrs.length > 0) {
      const childTitle = (product.optimized_title || product.original_title || "").toLowerCase();
      if (childTitle) {
        const result: Array<{ name: string; option: string }> = [];
        for (const attr of parentAttrs) {
          const values: string[] = attr.values || attr.options || [];
          const sorted = [...values].sort((a, b) => b.length - a.length);
          for (const val of sorted) {
            if (val && childTitle.includes(val.toLowerCase())) {
              result.push({ name: attr.name, option: val });
              break;
            }
          }
        }
        if (result.length > 0) return result;
      }
    }
  }

  // Ultimate fallback: use title difference as attribute value
  if (parent) {
    const parentTitle = parent.optimized_title || parent.original_title || "";
    const childTitle = product.optimized_title || product.original_title || "";
    const suffix = extractTitleSuffix(parentTitle, childTitle);
    if (suffix) {
      const childAttrs = product.attributes || [];
      const attrName = (Array.isArray(childAttrs) && childAttrs.length > 0 && childAttrs[0].name)
        ? childAttrs[0].name
        : "Variação";
      console.log(`Variation ${product.id}: inferred ${attrName}=${suffix} from title diff`);
      return [{ name: attrName, option: suffix }];
    }
  }

  return [];
}

async function publishSingleProduct(
  product: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<WooResult> {
  // Handle variable products
  if (product.product_type === "variable") {
    return await publishVariableProduct(product, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent);
  }

  // Handle standalone variations
  if (product.parent_product_id) {
    return await publishVariation(product, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent);
  }

  // Simple product
  const wooProduct = await buildBasePayload(product, supabase, baseUrl, auth, has, markupPercent, discountPercent);

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, product.upsell_skus || []);
    if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, product.crosssell_skus || []);
    if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;
  }

  if (Object.keys(wooProduct).length === 0) {
    return { id: product.id, status: "skipped" };
  }

  wooProduct.type = "simple";

  let existingWooId = product.woocommerce_id;
  if (!existingWooId && product.sku) {
    existingWooId = await findWooProductBySku(baseUrl, auth, product.sku);
  }

  let action: "created" | "updated" = existingWooId ? "updated" : "created";
  let wooData;
  try {
    wooData = existingWooId
      ? await wooFetch(baseUrl, auth, `/products/${existingWooId}`, "PUT", wooProduct)
      : await wooFetch(baseUrl, auth, `/products`, "POST", wooProduct);
  } catch (skuErr) {
    if (skuErr instanceof WooSkuConflictError) {
      console.log(`SKU conflict for product ${product.id}, retrying PUT with resource_id ${skuErr.resourceId}`);
      wooData = await wooFetch(baseUrl, auth, `/products/${skuErr.resourceId}`, "PUT", wooProduct);
      action = "updated";
    } else {
      throw skuErr;
    }
  }

  await supabase
    .from("products")
    .update({ woocommerce_id: wooData.id, status: "published" as any })
    .eq("id", product.id);

  return { id: product.id, status: action, woocommerce_id: wooData.id };
}

async function publishVariableProduct(
  parent: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<WooResult> {
  // Fetch children
  const { data: children } = await supabase
    .from("products")
    .select("*")
    .eq("parent_product_id", parent.id);

  const parentPayload = await buildBasePayload(parent, supabase, baseUrl, auth, has, markupPercent, discountPercent);
  parentPayload.type = "variable";

  const attributes = buildAttributesForParent(parent, children || []);
  if (attributes.length > 0) parentPayload.attributes = attributes;

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.upsell_skus || []);
    if (upsellIds.length > 0) parentPayload.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.crosssell_skus || []);
    if (crosssellIds.length > 0) parentPayload.cross_sell_ids = crosssellIds;
  }

  delete parentPayload.regular_price;
  delete parentPayload.sale_price;

  let existingParentWooId = parent.woocommerce_id;
  if (!existingParentWooId && parent.sku) {
    existingParentWooId = await findWooProductBySku(baseUrl, auth, parent.sku);
  }

  const parentAction: "created" | "updated" = existingParentWooId ? "updated" : "created";
  const parentWooData = existingParentWooId
    ? await wooFetch(baseUrl, auth, `/products/${existingParentWooId}`, "PUT", parentPayload)
    : await wooFetch(baseUrl, auth, `/products`, "POST", parentPayload);

  const parentWooId = parentWooData.id;

  await supabase
    .from("products")
    .update({ woocommerce_id: parentWooId, status: "published" as any })
    .eq("id", parent.id);

  // Publish children
  for (const child of (children || [])) {
    try {
      const variationPayload = await buildBasePayload(child, supabase, baseUrl, auth, has, markupPercent, discountPercent, true);
      const variationAttrs = buildVariationAttributes(child, parent);
      if (variationAttrs.length > 0) variationPayload.attributes = variationAttrs;

      let existingVarWooId = child.woocommerce_id;
      // If no local woocommerce_id, try to find existing variation by SKU
      if (!existingVarWooId && child.sku) {
        existingVarWooId = await findWooVariationBySku(baseUrl, auth, parentWooId, child.sku);
        if (existingVarWooId) {
          // Persist the discovered woocommerce_id
          await supabase
            .from("products")
            .update({ woocommerce_id: existingVarWooId })
            .eq("id", child.id);
        }
      }

      let varWooData;
      try {
        varWooData = existingVarWooId
          ? await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${existingVarWooId}`, "PUT", variationPayload)
          : await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
      } catch (skuErr) {
        if (skuErr instanceof WooSkuConflictError) {
          console.log(`SKU conflict for variation ${child.id}, handling properly`);
          varWooData = await handleVariationSkuConflict(baseUrl, auth, parentWooId, child.id, child.sku || "", variationPayload, skuErr, supabase);
        } else {
          throw skuErr;
        }
      }

      await supabase
        .from("products")
        .update({ woocommerce_id: varWooData.id, status: "published" as any })
        .eq("id", child.id);
    } catch (e) {
      console.error(`Error publishing variation ${child.id}:`, (e as Error).message);
    }
  }

  return { id: parent.id, status: parentAction, woocommerce_id: parentWooId };
}

async function publishVariation(
  variation: any,
  supabase: any,
  adminClient: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<WooResult> {
  const { data: parentRow } = await supabase
    .from("products")
    .select("woocommerce_id, attributes")
    .eq("id", variation.parent_product_id)
    .single();

  const parentWooId = parentRow?.woocommerce_id;

  if (parentWooId) {
    const variationPayload = await buildBasePayload(variation, supabase, baseUrl, auth, has, markupPercent, discountPercent, true);
    const variationAttrs = buildVariationAttributes(variation, parentRow);
    if (variationAttrs.length > 0) variationPayload.attributes = variationAttrs;

    let existingVarWooId = variation.woocommerce_id;
    if (!existingVarWooId && variation.sku) {
      existingVarWooId = await findWooVariationBySku(baseUrl, auth, parentWooId, variation.sku);
      if (existingVarWooId) {
        await supabase
          .from("products")
          .update({ woocommerce_id: existingVarWooId })
          .eq("id", variation.id);
      }
    }

    let action: "created" | "updated" = existingVarWooId ? "updated" : "created";
    let varWooData;
    try {
      varWooData = existingVarWooId
        ? await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${existingVarWooId}`, "PUT", variationPayload)
        : await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
    } catch (skuErr) {
      if (skuErr instanceof WooSkuConflictError) {
        console.log(`SKU conflict for standalone variation ${variation.id}, handling properly`);
        varWooData = await handleVariationSkuConflict(baseUrl, auth, parentWooId, variation.id, variation.sku || "", variationPayload, skuErr, supabase);
        action = "updated";
      } else {
        throw skuErr;
      }
    }

    await supabase
      .from("products")
      .update({ woocommerce_id: varWooData.id, status: "published" as any })
      .eq("id", variation.id);

    return { id: variation.id, status: action, woocommerce_id: varWooData.id };
  } else {
    return {
      id: variation.id,
      status: "error",
      error: "O produto pai ainda não foi publicado no WooCommerce.",
    };
  }
}

async function finalizeJob(adminClient: any, jobId: string, job: any, userId: string) {
  const results = (job.results || []) as WooResult[];
  const published = results.filter((r: WooResult) => r.status === "created" || r.status === "updated").length;
  const errors = results.filter((r: WooResult) => r.status === "error").length;

  await adminClient.from("publish_jobs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    current_product_name: null,
  }).eq("id", jobId);

  // Log activity
  await adminClient.from("activity_log").insert({
    user_id: userId,
    action: "publish" as any,
    details: {
      total: results.length,
      published,
      errors,
      job_id: jobId,
    },
  });
}
