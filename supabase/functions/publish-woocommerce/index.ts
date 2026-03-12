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
      const fields = job.publish_fields && Array.isArray(job.publish_fields) && job.publish_fields.length > 0 ? new Set(job.publish_fields) : null;
      const has = (key: string) => !fields || fields.has(key);
      const pricing = job.pricing || {};
      const markupPercent = pricing?.markupPercent ?? 0;
      const discountPercent = pricing?.discountPercent ?? 0;

      const productIds = job.product_ids as string[];
      const BATCH_SIZE = 3;
      const endIndex = Math.min(startIndex + BATCH_SIZE, productIds.length);
      const batchIds = productIds.slice(startIndex, endIndex);

      // Fetch products for this batch (keep original order from product_ids)
      const { data: batchProducts } = await supabase
        .from("products")
        .select("*")
        .in("id", batchIds);

      const batchById = new Map<string, any>((batchProducts || []).map((p: any) => [p.id, p]));
      const orderedBatchProducts = batchIds.map((id) => batchById.get(id)).filter(Boolean);

      if (!orderedBatchProducts || orderedBatchProducts.length === 0) {
        // Skip this batch
        if (endIndex >= productIds.length) {
          await finalizeJob(adminClient, jobId, job, user.id);
          return new Response(JSON.stringify({ status: "completed" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const existingResults = (job.results || []) as WooResult[];
      resetImageCache(); // Clear image resolution cache for each batch invocation

      // Process each product in the batch
      for (const product of orderedBatchProducts) {
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

    // Expand: variable parents → include children, variations → include parent + siblings
    const { data: selectedProducts } = await supabase
      .from("products")
      .select("id, product_type, parent_product_id")
      .in("id", productIds);

    const variableParentIds = (selectedProducts || [])
      .filter((p: any) => p.product_type === "variable")
      .map((p: any) => p.id);

    // Variations selected → find their parents
    const variationParentIds = (selectedProducts || [])
      .filter((p: any) => p.product_type === "variation" && p.parent_product_id)
      .map((p: any) => p.parent_product_id);

    const allFamilyParentIds = [...new Set([...variableParentIds, ...variationParentIds])];

    let allIds = [...productIds];
    if (allFamilyParentIds.length > 0) {
      // Include parents themselves + all their children
      const { data: children } = await supabase
        .from("products")
        .select("id")
        .in("parent_product_id", allFamilyParentIds);
      const childIds = (children || []).map((c: any) => c.id);
      allIds = [...new Set([...allIds, ...allFamilyParentIds, ...childIds])];
    }

    // Ensure parents are processed before variations to avoid "pai não publicado" errors
    const { data: allRows } = await supabase
      .from("products")
      .select("id, parent_product_id, product_type")
      .in("id", allIds);

    const rowById = new Map<string, any>((allRows || []).map((r: any) => [r.id, r]));
    const rank = (id: string) => {
      const r = rowById.get(id);
      if (!r) return 3;
      if (!r.parent_product_id && r.product_type === "variable") return 0; // variable parent
      if (!r.parent_product_id) return 1; // simple/parentless
      return 2; // variation
    };

    allIds = [...allIds].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

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

class WooNotFoundError extends Error {
  constructor(endpoint: string) {
    super(`WooCommerce 404: resource not found at ${endpoint}`);
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
    // Detect 404 (stale woocommerce_id)
    if (resp.status === 404) {
      throw new WooNotFoundError(endpoint);
    }
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
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`Falha a eliminar produto ${productId} no WooCommerce: ${resp.status} ${body.substring(0, 200)}`);
    }
    return resp.ok;
  } catch (e) {
    console.warn(`Exceção ao eliminar produto ${productId} no WooCommerce:`, e);
    return false;
  }
}

async function deleteWooVariation(baseUrl: string, auth: string, parentWooId: number, variationWooId: number): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations/${variationWooId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(
        `Falha a eliminar variação ${variationWooId} (pai ${parentWooId}) no WooCommerce: ${resp.status} ${body.substring(0, 200)}`
      );
    }
    return resp.ok;
  } catch (e) {
    console.warn(`Exceção ao eliminar variação ${variationWooId} (pai ${parentWooId}) no WooCommerce:`, e);
    return false;
  }
}

async function getWooResource(baseUrl: string, auth: string, resourceId: number): Promise<any | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${resourceId}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function getWooVariation(baseUrl: string, auth: string, parentWooId: number, variationWooId: number): Promise<any | null> {
  try {
    const resp = await fetch(`${baseUrl}/wp-json/wc/v3/products/${parentWooId}/variations/${variationWooId}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function handleVariationSkuConflict(
  baseUrl: string,
  auth: string,
  parentWooId: number,
  childId: string,
  sku: string,
  variationPayload: Record<string, unknown>,
  skuErr: WooSkuConflictError,
  supabase: any
): Promise<any> {
  // Step 1: if the variation already exists under the correct parent, update it
  const realVarId = await findWooVariationBySku(baseUrl, auth, parentWooId, sku);
  if (realVarId) {
    console.log(`Found existing variation ${realVarId} under parent ${parentWooId} for child ${childId}`);
    const varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations/${realVarId}`, "PUT", variationPayload);
    await supabase.from("products").update({ woocommerce_id: realVarId }).eq("id", childId);
    return varWooData;
  }

  // Step 1b: sometimes Woo gives us the variation ID directly in resource_id
  const directVar = await getWooVariation(baseUrl, auth, parentWooId, skuErr.resourceId);
  if (directVar?.id) {
    console.log(`SKU conflict resource_id ${skuErr.resourceId} já é variação do pai ${parentWooId}; a atualizar.`);
    const varWooData = await wooFetch(
      baseUrl,
      auth,
      `/products/${parentWooId}/variations/${skuErr.resourceId}`,
      "PUT",
      variationPayload
    );
    await supabase.from("products").update({ woocommerce_id: skuErr.resourceId }).eq("id", childId);
    return varWooData;
  }

  // Step 2: try to understand what resource_id is (product vs variation under another parent)
  const resource = await getWooResource(baseUrl, auth, skuErr.resourceId);

  if (resource?.type === "variation" && resource?.parent_id) {
    const otherParentId = Number(resource.parent_id);
    if (otherParentId === parentWooId) {
      const varWooData = await wooFetch(
        baseUrl,
        auth,
        `/products/${parentWooId}/variations/${skuErr.resourceId}`,
        "PUT",
        variationPayload
      );
      await supabase.from("products").update({ woocommerce_id: skuErr.resourceId }).eq("id", childId);
      return varWooData;
    }

    console.log(
      `SKU conflict: resource_id ${skuErr.resourceId} é variação do produto ${otherParentId}; a tentar eliminar e recriar sob ${parentWooId}.`
    );
    const deleted = await deleteWooVariation(baseUrl, auth, otherParentId, skuErr.resourceId);
    if (!deleted) {
      throw new Error(
        `SKU conflict: o SKU já existe na variação #${skuErr.resourceId} (pai #${otherParentId}) e não foi possível remover automaticamente. Resolva apagando/alterando esse SKU no WooCommerce e tente novamente.`
      );
    }
  } else {
    console.log(
      `SKU conflict resource_id ${skuErr.resourceId} não é variação do pai ${parentWooId}. A tentar eliminar produto standalone e criar como variação.`
    );
    const deleted = await deleteWooProduct(baseUrl, auth, skuErr.resourceId);
    if (!deleted) {
      throw new Error(
        `SKU conflict: o SKU já existe no produto #${skuErr.resourceId} e não foi possível remover automaticamente. Resolva apagando/alterando esse SKU no WooCommerce e tente novamente.`
      );
    }
  }

  // Step 3: create the variation again
  try {
    return await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
  } catch (e) {
    if (e instanceof WooSkuConflictError) {
      throw new Error(
        `SKU conflict persistente: o SKU continua a existir no WooCommerce (ID #${e.resourceId}). Altere o SKU no Excel/app ou elimine o item com esse SKU no WooCommerce e volte a publicar.`
      );
    }
    throw e;
  }
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

// ── Enrich product images from `images` table ──
// Replaces original URLs with optimized versions and adds any extra processed images
async function enrichProductImages(product: any, supabase: any): Promise<any> {
  const { data: imageRows } = await supabase
    .from("images")
    .select("original_url, optimized_url, sort_order")
    .eq("product_id", product.id)
    .eq("status", "done")
    .not("optimized_url", "is", null)
    .order("sort_order", { ascending: true });

  if (!imageRows || imageRows.length === 0) return product;

  const urls: string[] = Array.isArray(product.image_urls) ? [...product.image_urls] : [];

  // Map: original -> optimized (for substitution)
  const optimizedMap = new Map<string, string>();
  for (const row of imageRows) {
    if (row.original_url && row.optimized_url) {
      optimizedMap.set(row.original_url, row.optimized_url);
    }
  }

  // Replace originals with optimized versions
  const enriched = urls.map((url: string) => optimizedMap.get(url) || url);

  // Add any optimized URLs not already in the list
  for (const row of imageRows) {
    if (row.optimized_url && !enriched.includes(row.optimized_url)) {
      enriched.push(row.optimized_url);
    }
  }

  console.log(`[enrichProductImages] Product ${product.id}: ${urls.length} original → ${enriched.length} enriched (${imageRows.length} optimized rows)`);
  return { ...product, image_urls: enriched };
}

// ── Image reference resolution ──
const IMAGE_EXTENSIONS = /\.(webp|jpeg|jpg|png|gif|svg|bmp|avif|tiff|tif)$/i;
const imageCache = new Map<string, Record<string, unknown>>();

function resetImageCache() {
  imageCache.clear();
}

async function searchWPMediaByFilename(baseUrl: string, auth: string, filename: string): Promise<number | null> {
  // Strip extension for search (WP media search works on title which usually omits extension)
  const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
  if (!nameWithoutExt) return null;

  try {
    const resp = await fetch(
      `${baseUrl}/wp-json/wp/v2/media?search=${encodeURIComponent(nameWithoutExt)}&per_page=20`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (!resp.ok) {
      console.warn(`WP Media search failed: ${resp.status}`);
      return null;
    }
    const items = await resp.json();
    if (!Array.isArray(items) || items.length === 0) return null;

    // Try exact match on source_url filename first
    const filenameLower = filename.toLowerCase();
    for (const item of items) {
      const srcUrl = String(item.source_url || "");
      const srcFilename = srcUrl.split("/").pop()?.toLowerCase() || "";
      if (srcFilename === filenameLower) return item.id;
    }

    // Try match without extension (slug-based)
    const nameWithoutExtLower = nameWithoutExt.toLowerCase();
    for (const item of items) {
      const slug = String(item.slug || "").toLowerCase();
      if (slug === nameWithoutExtLower) return item.id;
      // Also check title
      const title = String(item.title?.rendered || "").toLowerCase().replace(/<[^>]*>/g, "").trim();
      if (title === nameWithoutExtLower) return item.id;
    }

    // Fallback: first result if search term matches closely
    if (items.length === 1) return items[0].id;

    return null;
  } catch (e) {
    console.warn(`WP Media search exception for "${filename}":`, e);
    return null;
  }
}

const SUPABASE_STORAGE_PATTERN = /supabase\.co\/storage\/v1\/object\/public\//;

/**
 * Upload an image from a URL directly to WP Media Library.
 * Returns the WP media ID or null on failure.
 */
async function uploadImageToWPMedia(
  sourceUrl: string,
  baseUrl: string,
  auth: string,
  filename?: string
): Promise<number | null> {
  try {
    // Download the image
    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      console.warn(`Failed to download image from ${sourceUrl}: ${resp.status}`);
      return null;
    }
    const blob = await resp.blob();
    const contentType = resp.headers.get("content-type") || "image/webp";

    // Derive filename from URL
    const fname = filename || sourceUrl.split("/").pop() || `image_${Date.now()}.webp`;

    // Upload to WP Media Library
    const formData = new FormData();
    formData.append("file", new File([blob], fname, { type: contentType }));

    const uploadResp = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: formData,
    });

    if (!uploadResp.ok) {
      const errText = await uploadResp.text().catch(() => "");
      console.warn(`Failed to upload image to WP Media: ${uploadResp.status} ${errText.substring(0, 200)}`);
      return null;
    }

    const mediaData = await uploadResp.json();
    console.log(`✅ Uploaded image to WP Media: ID ${mediaData.id}, filename ${fname}`);
    return mediaData.id;
  } catch (e) {
    console.warn(`Exception uploading image to WP Media:`, e);
    return null;
  }
}

async function resolveImageRef(
  ref: string,
  position: number,
  baseUrl: string,
  auth: string,
  altText?: string,
  hasAlt?: boolean
): Promise<Record<string, unknown> | null> {
  const trimmed = String(ref || "").trim();
  if (!trimmed) return null;

  const img: Record<string, unknown> = { position };

  // 1. Purely numeric → WooCommerce media ID
  if (/^\d+$/.test(trimmed)) {
    img.id = parseInt(trimmed, 10);
    if (hasAlt && altText) img.alt = altText;
    return img;
  }

  // 2. Full URL
  if (trimmed.startsWith("http")) {
    // 2a. Supabase Storage URL → upload directly to WP Media Library for reliability
    if (SUPABASE_STORAGE_PATTERN.test(trimmed)) {
      const cached = imageCache.get(trimmed);
      if (cached) {
        const result = { ...cached, position };
        if (hasAlt && altText) result.alt = altText;
        return result;
      }

      const mediaId = await uploadImageToWPMedia(trimmed, baseUrl, auth);
      if (mediaId) {
        const entry: Record<string, unknown> = { id: mediaId };
        imageCache.set(trimmed, entry);
        img.id = mediaId;
        if (hasAlt && altText) img.alt = altText;
        console.log(`✅ Supabase image uploaded to WP Media: ${trimmed} → ID ${mediaId}`);
        return img;
      }
      // Fallback: send as src if upload fails
      console.warn(`⚠️ Failed to upload Supabase image to WP, falling back to src: ${trimmed}`);
    }

    img.src = trimmed;
    if (hasAlt && altText) img.alt = altText;
    return img;
  }

  // 3. Filename with image extension → search WP Media Library
  if (IMAGE_EXTENSIONS.test(trimmed)) {
    // Check cache first
    const cached = imageCache.get(trimmed);
    if (cached) {
      const result = { ...cached, position };
      if (hasAlt && altText) result.alt = altText;
      return result;
    }

    const mediaId = await searchWPMediaByFilename(baseUrl, auth, trimmed);
    if (mediaId) {
      const entry: Record<string, unknown> = { id: mediaId };
      imageCache.set(trimmed, entry);
      img.id = mediaId;
      if (hasAlt && altText) img.alt = altText;
      console.log(`✅ Resolved image "${trimmed}" → WP Media ID ${mediaId}`);
      return img;
    }

    // Fallback: construct probable URL
    const fallbackUrl = `${baseUrl}/wp-content/uploads/${trimmed}`;
    const entry: Record<string, unknown> = { src: fallbackUrl };
    imageCache.set(trimmed, entry);
    img.src = fallbackUrl;
    if (hasAlt && altText) img.alt = altText;
    console.warn(`⚠️ Image "${trimmed}" not found in Media Library, using fallback: ${fallbackUrl}`);
    return img;
  }

  // 4. Unknown format → send as-is (src)
  img.src = trimmed;
  if (hasAlt && altText) img.alt = altText;
  return img;
}

// Sync fallback for backward compat (used nowhere now, kept for safety)
function buildImageEntry(ref: string, position: number, altText?: string, hasAlt?: boolean): Record<string, unknown> {
  const trimmed = String(ref || "").trim();
  const img: Record<string, unknown> = { position };
  if (/^\d+$/.test(trimmed)) {
    img.id = parseInt(trimmed, 10);
  } else {
    img.src = trimmed;
  }
  if (hasAlt && altText) img.alt = altText;
  return img;
}

async function buildBasePayload(
  product: any,
  supabase: any,
  baseUrl: string,
  auth: string,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number
): Promise<Record<string, unknown>> {
  const wooProduct: Record<string, unknown> = {};

  if (has("title")) {
    wooProduct.name = product.optimized_title || product.original_title || "Sem título";
  }

  if (has("description")) {
    wooProduct.description = product.optimized_description || product.original_description || "";
  }

  if (has("short_description")) {
    wooProduct.short_description = product.optimized_short_description || product.short_description || "";
  }

  if (has("price")) {
    let basePrice = parseFloat(product.optimized_price || product.original_price || "0") || 0;
    if (markupPercent > 0) basePrice = basePrice * (1 + markupPercent / 100);
    wooProduct.regular_price = basePrice.toFixed(2);

    if (has("sale_price") && discountPercent > 0) {
      wooProduct.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }

  if (has("sale_price") && !wooProduct.sale_price) {
    const sp = product.optimized_sale_price ?? product.sale_price;
    if (sp != null) wooProduct.sale_price = String(sp);
  }

  if (has("sku")) {
    wooProduct.sku = product.sku || undefined;
  }

  if (has("slug")) {
    wooProduct.slug = product.seo_slug || undefined;
  }

  if (has("images")) {
    if (product.image_urls && product.image_urls.length > 0) {
      const altTexts = product.image_alt_texts || [];
      const imagePromises = product.image_urls.map((ref: string, i: number) => {
        const altRaw = altTexts[i];
        const altStr = typeof altRaw === "string" ? altRaw : (altRaw as any)?.alt || "";
        return resolveImageRef(ref, i, baseUrl, auth, altStr, has("image_alt_text") && !!altRaw);
      });
      const resolved = await Promise.all(imagePromises);
      wooProduct.images = resolved.filter(Boolean);
    }
  }

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
          if (parentCat?.woocommerce_id) catIds.push({ id: parentCat.woocommerce_id });
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
        } catch {
          /* skip */
        }
        return null;
      };

      const resolvedCatIds: Array<{ id: number }> = [];
      for (const part of parts) {
        const wcId = await resolveCatName(part);
        if (wcId) resolvedCatIds.push({ id: wcId });
      }
      if (resolvedCatIds.length > 0) wooProduct.categories = resolvedCatIds;
    }
  }

  if (has("tags")) {
    wooProduct.tags = (product.tags || []).map((t: string) => ({ name: t }));
  }

  if (has("meta_title") || has("meta_description")) {
    const meta_data: Array<{ key: string; value: string }> = [];
    if (has("meta_title")) meta_data.push({ key: "_yoast_wpseo_title", value: product.meta_title || "" });
    if (has("meta_description")) meta_data.push({ key: "_yoast_wpseo_metadesc", value: product.meta_description || "" });
    wooProduct.meta_data = meta_data;
  }

  // ── Attributes (EAN, Marca, Modelo, etc.) for non-variation products ──
  // For simple products we send ALL attributes as visible, non-variation attributes.
  // For variable products this is handled separately in publishVariableProduct.
  if (product.product_type !== "variable" && !product.parent_product_id) {
    const productAttrs = Array.isArray(product.attributes) ? product.attributes : [];
    if (productAttrs.length > 0) {
      const attrPayload: Array<{ name: string; options: string[]; visible: boolean; variation: boolean }> = [];
      for (const attr of productAttrs) {
        const n = String(attr?.name || "").trim();
        if (!n) continue;
        const values: string[] = [];
        if (attr?.value) values.push(String(attr.value));
        if (Array.isArray(attr?.values)) for (const v of attr.values) values.push(String(v));
        if (Array.isArray(attr?.options)) for (const v of attr.options) values.push(String(v));
        if (values.length === 0) continue;
        attrPayload.push({
          name: n,
          options: [...new Set(values)],
          visible: true,
          variation: false,
        });
      }
      if (attrPayload.length > 0) {
        wooProduct.attributes = attrPayload;
      }
    }
  }

  return wooProduct;
}

const TECHNICAL_ATTR_NAMES = new Set([
  "marca",
  "brand",
  "ean",
  "ean13",
  "gtin",
  "barcode",
  "modelo",
  "model",
]);

const isTechnicalAttrName = (name: string) => TECHNICAL_ATTR_NAMES.has(String(name || "").toLowerCase().trim());

/** Detects if a value looks like an EAN/barcode (8-14 digits) */
const isEanLikeValue = (val: string): boolean => /^\d{8,14}$/.test(String(val || "").trim());

// ── Smart attribute name inference ──
const SIZE_PATTERN = /\b(\d+[\.,]?\d*)\s*(cm|mm|m|ml|cl|l|lt|kg|g|oz|"|''|pol)\b/i;
const SIZE_WORDS = new Set(["pequeno","medio","médio","grande","extra","xs","s","m","l","xl","xxl","xxxl","2xl","3xl","4xl","pp","p","g","gg","xg","xxg"]);
const COLOR_WORDS = new Set([
  "preto","branco","azul","vermelho","verde","amarelo","laranja","roxo","rosa",
  "cinza","cinzento","castanho","dourado","prateado","violeta","bege","coral",
  "turquesa","creme","bordeaux","borgonha","fucsia","magenta","caqui","salmon",
  "salmão","marfim","champanhe","nude","terracota","índigo","indigo","lima",
  "black","white","blue","red","green","yellow","orange","purple","pink",
  "gray","grey","brown","gold","silver","beige","navy","teal","olive",
  "inox","aço","cromado","natural","transparente","multicolor"
]);

function inferAttrNameFromOption(option: string): string {
  const lower = option.toLowerCase().trim();
  
  // Check for size patterns first (more specific)
  if (SIZE_PATTERN.test(lower)) return "Tamanho";
  
  // Check if it's a pure size word
  const words = lower.split(/[\s\-\/]+/).map(w => w.trim()).filter(Boolean);
  if (words.length <= 2 && words.some(w => SIZE_WORDS.has(w))) return "Tamanho";
  
  // Check for color words
  if (words.some(w => COLOR_WORDS.has(w))) return "Cor";
  
  // If it looks like a dimension (just numbers), it's probably a size
  if (/^\d+[\.,]?\d*$/.test(lower)) return "Tamanho";
  
  // Default fallback
  return "Opção";
}

function tokenizeTitle(s: string): string[] {
  return String(s || "")
    .replace(/[()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[^\p{L}\p{N}\-\.]+/gu, ""))
    .filter(Boolean);
}

function inferVariationOptionFromTitle(parentTitle: string, childTitle: string): string | null {
  const rawChild = String(childTitle || "").trim();
  const rawParent = String(parentTitle || "").trim();
  if (!rawChild) return null;

  // Method 1: If child title starts with parent title, extract the suffix
  const suffix = extractTitleSuffix(rawParent, rawChild);
  if (suffix && suffix !== rawChild && suffix.length <= 80 && suffix.length > 0) {
    // Clean up leading separators
    const cleaned = suffix.replace(/^[-–—:,\s]+/, "").trim();
    if (cleaned && cleaned.length <= 80) return cleaned;
  }

  // Method 2: Token-based diff - remove parent tokens from child
  const pTokens = new Set(tokenizeTitle(rawParent).map((t) => t.toLowerCase()));
  const remaining = tokenizeTitle(rawChild).filter((t) => !pTokens.has(t.toLowerCase()));
  const candidate = remaining.join(" ").trim();
  if (candidate && candidate.length <= 80) return candidate;

  return null;
}

function mergeWooAttributes(existing: any[], incoming: any[]): any[] {
  const byName = new Map<string, any>();
  const norm = (n: string) => String(n || "").toLowerCase().trim();

  for (const a of (existing || [])) {
    if (!a?.name) continue;
    const key = norm(a.name);
    if (!key) continue;
    byName.set(key, { ...a, options: Array.isArray(a.options) ? a.options : [] });
  }

  for (const a of (incoming || [])) {
    if (!a?.name) continue;
    const key = norm(a.name);
    if (!key) continue;

    const inOptions = Array.isArray(a.options) ? a.options : [];

    const current = byName.get(key);
    if (!current) {
      byName.set(key, { ...a, options: inOptions });
      continue;
    }

    const set = new Set<string>([...(current.options || []), ...inOptions].map((v) => String(v)));
    current.options = Array.from(set);

    // Keep existing id/position; prefer incoming flags when present
    if (typeof a.visible === "boolean") current.visible = a.visible;
    if (typeof a.variation === "boolean") current.variation = a.variation;
  }

  return Array.from(byName.values());
}

async function buildVariationPayload(
  variation: any,
  parent: any,
  has: (k: string) => boolean,
  markupPercent: number,
  discountPercent: number,
  baseUrl: string,
  auth: string
): Promise<Record<string, unknown>> {
  // WooCommerce variations do NOT support many product fields (name, categories, tags, upsells/cross-sells, images[])
  const payload: Record<string, unknown> = {};

  // Evita a “descrição duplicada” no storefront (Woo mostra a descrição da variação separadamente quando existe)
  payload.description = "";

  if (has("price")) {
    let basePrice = parseFloat(variation.optimized_price || variation.original_price || "0") || 0;
    if (markupPercent > 0) basePrice = basePrice * (1 + markupPercent / 100);
    payload.regular_price = basePrice.toFixed(2);

    if (has("sale_price") && discountPercent > 0) {
      payload.sale_price = (basePrice * (1 - discountPercent / 100)).toFixed(2);
    }
  }

  if (has("sale_price") && !payload.sale_price) {
    const sp = variation.optimized_sale_price ?? variation.sale_price;
    if (sp != null) payload.sale_price = String(sp);
  }

  if (has("sku")) {
    payload.sku = variation.sku || undefined;
  }

  if (has("images")) {
    const urls: string[] = Array.isArray(variation.image_urls) ? variation.image_urls : [];
    if (urls.length > 0) {
      // Variation supports only ONE image; use resolveImageRef for ID/URL/filename detection
      const resolved = await resolveImageRef(urls[0], 0, baseUrl, auth);
      if (resolved) payload.image = resolved;
    }
  }

  // Only variation-defining attributes go on the variation payload.
  let variationAttrs = buildVariationAttributes(variation, parent);

  // If nothing came from structured attrs, infer a safe default (typically Cor)
  if (variationAttrs.length === 0) {
    const parentTitle = parent?.optimized_title || parent?.original_title || "";
    const childTitle = variation.optimized_title || variation.original_title || "";
    const option = inferVariationOptionFromTitle(parentTitle, childTitle);
    if (option) variationAttrs = [{ name: inferAttrNameFromOption(option), option }];
  }

  if (variationAttrs.length > 0) payload.attributes = variationAttrs;

  return payload;
}

// Extract the unique suffix from a child title compared to the parent title
function extractTitleSuffix(parentTitle: string, childTitle: string): string {
  const p = String(parentTitle || "").toLowerCase().trim();
  const c = String(childTitle || "").toLowerCase().trim();
  let i = 0;
  while (i < p.length && i < c.length && p[i] === c[i]) i++;
  const suffix = String(childTitle || "").trim().substring(i).trim();
  return suffix || String(childTitle || "").trim();
}

function buildAttributesForParent(
  parent: any,
  variations: any[]
): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> {
  // Variation-defining attributes (Cor, Tamanho, etc.) for the *parent* product.
  const attrMap = new Map<string, Set<string>>();

  const parentTitle = parent?.optimized_title || parent?.original_title || "";

  // Collect candidate attribute names from the dataset
  const nameCandidates = new Set<string>();
  for (const v of variations) {
    const attrs = v?.attributes;
    if (!Array.isArray(attrs)) continue;
    for (const attr of attrs) {
      const n = String(attr?.name || "").trim();
      if (!n) continue;
      if (attr?.variation === false) continue;
      if (isTechnicalAttrName(n)) continue;
      nameCandidates.add(n);
    }
  }

  // If no structured attrs found, infer the attr name from first variation's title diff
  let defaultAttrName = "Opção";
  if (nameCandidates.size === 0 && variations.length > 0) {
    const firstChild = variations[0];
    const firstChildTitle = firstChild?.optimized_title || firstChild?.original_title || "";
    const firstOption = inferVariationOptionFromTitle(parentTitle, firstChildTitle);
    if (firstOption) defaultAttrName = inferAttrNameFromOption(firstOption);
  }
  const names = nameCandidates.size > 0 ? Array.from(nameCandidates) : (variations.length > 0 ? [defaultAttrName] : []);

  const add = (name: string, value: string) => {
    const n = String(name || "").trim();
    const v = String(value || "").trim();
    if (!n || !v) return;
    if (isTechnicalAttrName(n)) return;
    // Skip EAN/barcode-like values (8-14 digits) from variation attributes
    if (isEanLikeValue(v)) return;
    if (!attrMap.has(n)) attrMap.set(n, new Set());
    attrMap.get(n)!.add(v);
  };

  for (const v of variations) {
    const childTitle = v?.optimized_title || v?.original_title || "";
    const attrs = Array.isArray(v?.attributes) ? v.attributes : [];

    for (const name of names) {
      // Find structured attribute value if present
      const found = attrs.find((a: any) => String(a?.name || "").toLowerCase().trim() === String(name).toLowerCase().trim());
      const raw = String(found?.value || "").trim();
      // If the structured value looks like an EAN, skip it and infer from title instead
      const option = (raw && !isEanLikeValue(raw)) ? raw : inferVariationOptionFromTitle(parentTitle, childTitle);
      if (option) {
        // If the inferred option changes the logical attribute name (e.g. was "Cor" but value is a size), use the correct name
        const effectiveName = (!raw || isEanLikeValue(raw)) ? inferAttrNameFromOption(option) : name;
        add(effectiveName, option);
      }
    }
  }

  return Array.from(attrMap.entries())
    .filter(([_, values]) => values.size > 0) // Remove attrs where all values were filtered (e.g. all EANs)
    .map(([name, values]) => ({
      name,
      options: Array.from(values),
      variation: true,
      visible: true,
    }));
}

function buildStaticAttributesForParent(
  parent: any,
  variations: any[]
): Array<{ name: string; options: string[]; variation: boolean; visible: boolean }> {
  // Technical/non-variation attributes (Marca/EAN/etc.) for the *parent* product.
  const map = new Map<string, Set<string>>();

  const add = (name: string, value: string) => {
    const n = String(name || "").trim();
    const v = String(value || "").trim();
    if (!n || !v) return;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n)!.add(v);
  };

  const collect = (attrs: any[]) => {
    if (!Array.isArray(attrs)) return;
    for (const attr of attrs) {
      const n = String(attr?.name || "").trim();
      if (!n) continue;
      const isTechnical = attr?.variation === false || isTechnicalAttrName(n);
      if (!isTechnical) continue;

      if (attr?.value) add(n, attr.value);
      if (Array.isArray(attr.values)) for (const v of attr.values) add(n, v);
      if (Array.isArray(attr.options)) for (const v of attr.options) add(n, v);
    }
  };

  collect(parent.attributes || []);
  for (const v of variations) collect(v.attributes || []);

  return Array.from(map.entries()).map(([name, values]) => ({
    name,
    options: Array.from(values),
    variation: false,
    visible: true,
  }));
}

function buildVariationAttributes(product: any, parent?: any): Array<{ name: string; option: string }> {
  const attrs = Array.isArray(product?.attributes) ? product.attributes : [];
  const parentTitle = parent?.optimized_title || parent?.original_title || "";
  const childTitle = product?.optimized_title || product?.original_title || "";

  const out: Array<{ name: string; option: string }> = [];

  // Prefer structured attrs from the catalog
  for (const attr of attrs) {
    const n = String(attr?.name || "").trim();
    if (!n) continue;
    if (attr?.variation === false) continue;
    if (isTechnicalAttrName(n)) continue;

    const raw = String(attr?.value || "").trim();
    // Skip EAN/barcode-like values masquerading as variation options
    if (isEanLikeValue(raw)) continue;
    const option = raw || inferVariationOptionFromTitle(parentTitle, childTitle);
    if (option && !isEanLikeValue(option)) out.push({ name: n, option });
  }

  if (out.length > 0) return out;

  // If we have parent attributes (rare in DB), try matching options in title
  if (parent && Array.isArray(parent.attributes) && parent.attributes.length > 0) {
    const childLower = String(childTitle || "").toLowerCase();
    for (const attr of parent.attributes) {
      const n = String(attr?.name || "").trim();
      if (!n) continue;
      if (attr?.variation === false) continue;
      if (isTechnicalAttrName(n)) continue;

      const values: string[] = (attr.values || attr.options || []).map((v: any) => String(v));
      const sorted = [...values].sort((a, b) => b.length - a.length);
      for (const val of sorted) {
        if (val && childLower.includes(val.toLowerCase())) {
          return [{ name: n, option: val }];
        }
      }
    }
  }

  const option = inferVariationOptionFromTitle(parentTitle, childTitle);
  if (option) return [{ name: inferAttrNameFromOption(option), option }];
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
  // Enrich images from images table (optimized/lifestyle)
  const enrichedProduct = has("images") ? await enrichProductImages(product, supabase) : product;

  // Handle variable products
  if (enrichedProduct.product_type === "variable") {
    return await publishVariableProduct(enrichedProduct, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent);
  }

  // Handle standalone variations
  if (enrichedProduct.parent_product_id) {
    return await publishVariation(enrichedProduct, supabase, adminClient, baseUrl, auth, has, markupPercent, discountPercent);
  }

  // Simple product
  const wooProduct = await buildBasePayload(enrichedProduct, supabase, baseUrl, auth, has, markupPercent, discountPercent);

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, enrichedProduct.upsell_skus || []);
    if (upsellIds.length > 0) wooProduct.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, enrichedProduct.crosssell_skus || []);
    if (crosssellIds.length > 0) wooProduct.cross_sell_ids = crosssellIds;
  }

  if (Object.keys(wooProduct).length === 0) {
    return { id: enrichedProduct.id, status: "skipped" };
  }

  wooProduct.type = "simple";

  let existingWooId = enrichedProduct.woocommerce_id;
  if (!existingWooId && enrichedProduct.sku) {
    existingWooId = await findWooProductBySku(baseUrl, auth, enrichedProduct.sku);
  }

  let action: "created" | "updated" = existingWooId ? "updated" : "created";
  let wooData;
  try {
    wooData = existingWooId
      ? await wooFetch(baseUrl, auth, `/products/${existingWooId}`, "PUT", wooProduct)
      : await wooFetch(baseUrl, auth, `/products`, "POST", wooProduct);
  } catch (err) {
    if (err instanceof WooNotFoundError && existingWooId) {
      console.warn(`Product ${enrichedProduct.id} WC#${existingWooId} not found (deleted?), creating new.`);
      await supabase.from("products").update({ woocommerce_id: null }).eq("id", enrichedProduct.id);
      wooData = await wooFetch(baseUrl, auth, `/products`, "POST", wooProduct);
      action = "created";
    } else if (err instanceof WooSkuConflictError) {
      console.log(`SKU conflict for product ${enrichedProduct.id}, retrying PUT with resource_id ${err.resourceId}`);
      wooData = await wooFetch(baseUrl, auth, `/products/${err.resourceId}`, "PUT", wooProduct);
      action = "updated";
    } else {
      throw err;
    }
  }

  await supabase
    .from("products")
    .update({ woocommerce_id: wooData.id, status: "published" as any })
    .eq("id", enrichedProduct.id);

  return { id: enrichedProduct.id, status: action, woocommerce_id: wooData.id };
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
  const { data: rawChildren } = await supabase
    .from("products")
    .select("*")
    .eq("parent_product_id", parent.id);

  // Enrich children images from images table
  const children: any[] = [];
  if (rawChildren && rawChildren.length > 0 && has("images")) {
    for (const child of rawChildren) {
      children.push(await enrichProductImages(child, supabase));
    }
  } else {
    children.push(...(rawChildren || []));
  }

  console.log(`[publish-variable] Parent ${parent.id} has ${children.length} children, image_urls=${JSON.stringify(parent.image_urls)}, title=${parent.optimized_title}`);

  const parentPayload = await buildBasePayload(parent, supabase, baseUrl, auth, has, markupPercent, discountPercent);
  parentPayload.type = "variable";

  // If the parent has no images, aggregate unique images from children for the gallery
  if (has("images") && (!parent.image_urls || parent.image_urls.length === 0) && children.length > 0) {
    const childImagePromises: Array<Promise<Record<string, unknown> | null>> = [];
    const seenRefs = new Set<string>();
    for (const child of children) {
      const refs: string[] = Array.isArray(child.image_urls) ? child.image_urls : [];
      const altTexts = child.image_alt_texts || [];
      for (let i = 0; i < refs.length; i++) {
        const ref = String(refs[i] || "").trim();
        if (ref && !seenRefs.has(ref)) {
          seenRefs.add(ref);
          const pos = childImagePromises.length;
          const altRaw = altTexts[i];
          const altStr = typeof altRaw === "string" ? altRaw : (altRaw as any)?.alt || "";
          childImagePromises.push(resolveImageRef(ref, pos, baseUrl, auth, altStr, has("image_alt_text") && !!altRaw));
        }
      }
    }
    const childImages = (await Promise.all(childImagePromises)).filter(Boolean);
    if (childImages.length > 0) {
      parentPayload.images = childImages;
      console.log(`[publish-variable] Aggregated ${childImages.length} images from children for parent`);
    }
  }

  const variationAttributes = buildAttributesForParent(parent, children || []);
  const staticAttributes = buildStaticAttributesForParent(parent, children || []);

  if (variationAttributes.length > 0 || staticAttributes.length > 0) {
    const merged: any[] = [...variationAttributes];
    const byName = new Map<string, any>(merged.map((a) => [a.name, a]));

    for (const s of staticAttributes) {
      const existing = byName.get(s.name);
      if (!existing) {
        merged.push(s);
        byName.set(s.name, s);
      } else {
        const set = new Set<string>([...(existing.options || []), ...(s.options || [])]);
        existing.options = Array.from(set);
      }
    }

    parentPayload.attributes = merged;
  }

  console.log(`[publish-variable] Payload keys: ${Object.keys(parentPayload).join(", ")}, name=${parentPayload.name}, images=${Array.isArray(parentPayload.images) ? (parentPayload.images as any[]).length : 0}, attrs=${JSON.stringify(parentPayload.attributes)}`);

  if (has("upsells")) {
    const upsellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.upsell_skus || []);
    if (upsellIds.length > 0) parentPayload.upsell_ids = upsellIds;
  }
  if (has("crosssells")) {
    const crosssellIds = await resolveSkusToWooIds(supabase, adminClient, baseUrl, auth, parent.crosssell_skus || []);
    if (crosssellIds.length > 0) parentPayload.cross_sell_ids = crosssellIds;
  }

  // Variable parents must not have prices; prices live on variations
  delete parentPayload.regular_price;
  delete parentPayload.sale_price;

  let existingParentWooId = parent.woocommerce_id;
  if (!existingParentWooId && parent.sku) {
    existingParentWooId = await findWooProductBySku(baseUrl, auth, parent.sku);
  }

  let parentAction: "created" | "updated" = existingParentWooId ? "updated" : "created";

  // Ao atualizar, preserva atributos já existentes no WooCommerce (ex.: Marca/Modelo/EAN) para não os "apagar".
  if (existingParentWooId && Array.isArray((parentPayload as any).attributes)) {
    try {
      const existingWoo = await wooFetch(baseUrl, auth, `/products/${existingParentWooId}`, "GET");
      if (Array.isArray(existingWoo?.attributes)) {
        (parentPayload as any).attributes = mergeWooAttributes(existingWoo.attributes, (parentPayload as any).attributes);
      }
    } catch (e) {
      if (e instanceof WooNotFoundError) {
        // Stale woocommerce_id → clear and create fresh
        console.warn(`Variable parent ${parent.id} WC#${existingParentWooId} not found, will create new.`);
        await supabase.from("products").update({ woocommerce_id: null }).eq("id", parent.id);
        existingParentWooId = null;
        parentAction = "created";
      } else {
        console.warn("Não foi possível ler atributos existentes do WooCommerce; a continuar.", e);
      }
    }
  }

  console.log(`[publish-variable] Sending ${parentAction} to WC#${existingParentWooId || 'new'}, final payload: ${JSON.stringify(parentPayload).substring(0, 1500)}`);

  let parentWooData;
  try {
    parentWooData = existingParentWooId
      ? await wooFetch(baseUrl, auth, `/products/${existingParentWooId}`, "PUT", parentPayload)
      : await wooFetch(baseUrl, auth, `/products`, "POST", parentPayload);
  } catch (err) {
    if (err instanceof WooNotFoundError && existingParentWooId) {
      console.warn(`Variable parent ${parent.id} WC#${existingParentWooId} not found on PUT, creating new.`);
      await supabase.from("products").update({ woocommerce_id: null }).eq("id", parent.id);
      parentWooData = await wooFetch(baseUrl, auth, `/products`, "POST", parentPayload);
      parentAction = "created";
    } else {
      throw err;
    }
  }

  const parentWooId = parentWooData.id;
  console.log(`[publish-variable] WC response: id=${parentWooId}, name=${parentWooData.name}, images=${parentWooData.images?.length || 0}, attrs=${parentWooData.attributes?.length || 0}`);

  await supabase
    .from("products")
    .update({ woocommerce_id: parentWooId, status: "published" as any })
    .eq("id", parent.id);

  // Variations are processed separately (they are added to the job queue), to avoid duplicate creation and SKU conflicts.
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
    .select("woocommerce_id, attributes, optimized_title, original_title")
    .eq("id", variation.parent_product_id)
    .single();

  const parentWooId = parentRow?.woocommerce_id;

  if (parentWooId) {
    const variationPayload = await buildVariationPayload(variation, parentRow, has, markupPercent, discountPercent, baseUrl, auth);
    console.log(`[publish-variation] Variation ${variation.id} (sku=${variation.sku}), title=${variation.optimized_title}, image_urls=${JSON.stringify(variation.image_urls)}, attrs=${JSON.stringify(variation.attributes)}`);
    console.log(`[publish-variation] Payload: ${JSON.stringify(variationPayload).substring(0, 1000)}`);

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
    } catch (err) {
      if (err instanceof WooNotFoundError && existingVarWooId) {
        // Stale variation woocommerce_id → clear and create fresh
        console.warn(`Variation ${variation.id} WC#${existingVarWooId} not found, creating new.`);
        await supabase.from("products").update({ woocommerce_id: null }).eq("id", variation.id);
        varWooData = await wooFetch(baseUrl, auth, `/products/${parentWooId}/variations`, "POST", variationPayload);
        action = "created";
      } else if (err instanceof WooSkuConflictError) {
        console.log(`SKU conflict for standalone variation ${variation.id}, handling properly`);
        varWooData = await handleVariationSkuConflict(
          baseUrl,
          auth,
          parentWooId,
          variation.id,
          variation.sku || "",
          variationPayload,
          err,
          supabase
        );
        action = "updated";
      } else {
        throw err;
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

  // ── Second pass: resolve upsell/crosssell now that all products are published ──
  try {
    await resolveUpsellCrosssellPass(adminClient, job, userId);
  } catch (e) {
    console.warn("Upsell/crosssell second pass failed:", e);
  }

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

async function resolveUpsellCrosssellPass(adminClient: any, job: any, userId: string) {
  const productIds = job.product_ids as string[];
  if (!productIds || productIds.length === 0) return;

  // Get WooCommerce config
  const { data: settings } = await adminClient
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

  const settingsMap: Record<string, string> = {};
  settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });
  const wooUrl = settingsMap["woocommerce_url"];
  const wooKey = settingsMap["woocommerce_consumer_key"];
  const wooSecret = settingsMap["woocommerce_consumer_secret"];
  if (!wooUrl || !wooKey || !wooSecret) return;

  const baseUrl = wooUrl.replace(/\/+$/, "");
  const auth = btoa(`${wooKey}:${wooSecret}`);

  // Fetch all products with upsell/crosssell skus that have a woocommerce_id
  const { data: products } = await adminClient
    .from("products")
    .select("id, sku, woocommerce_id, upsell_skus, crosssell_skus, parent_product_id, product_type")
    .in("id", productIds)
    .not("woocommerce_id", "is", null);

  if (!products || products.length === 0) return;

  for (const product of products) {
    const upsellSkus = product.upsell_skus || [];
    const crosssellSkus = product.crosssell_skus || [];
    if (upsellSkus.length === 0 && crosssellSkus.length === 0) continue;
    // Only update parent/simple products (variations don't support upsell/crosssell in WooCommerce)
    if (product.parent_product_id) continue;

    const updates: Record<string, unknown> = {};

    if (upsellSkus.length > 0) {
      const skuList = upsellSkus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
      const { data: found } = await adminClient
        .from("products")
        .select("woocommerce_id")
        .in("sku", skuList)
        .not("woocommerce_id", "is", null);
      const ids = (found || []).map((f: any) => f.woocommerce_id).filter(Boolean);
      if (ids.length > 0) updates.upsell_ids = ids;
    }

    if (crosssellSkus.length > 0) {
      const skuList = crosssellSkus.map((s: any) => typeof s === "string" ? s : s.sku).filter(Boolean);
      const { data: found } = await adminClient
        .from("products")
        .select("woocommerce_id")
        .in("sku", skuList)
        .not("woocommerce_id", "is", null);
      const ids = (found || []).map((f: any) => f.woocommerce_id).filter(Boolean);
      if (ids.length > 0) updates.cross_sell_ids = ids;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await wooFetch(baseUrl, auth, `/products/${product.woocommerce_id}`, "PUT", updates);
        console.log(`✅ Updated upsell/crosssell for WC#${product.woocommerce_id}`);
      } catch (e) {
        console.warn(`Failed to update upsell/crosssell for WC#${product.woocommerce_id}:`, e);
      }
    }
  }
}
