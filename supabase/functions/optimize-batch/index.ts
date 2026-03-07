import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_PROCESSING_MS = 95_000; // keep safe headroom before timeout
const CONCURRENCY = 2; // lower concurrency to reduce function rate limiting
const SELF_INVOKE_RETRIES = 5;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function selfInvokeWithRetry(authHeader: string, jobId: string, startIndex: number) {
  const payload = JSON.stringify({ jobId, startIndex });

  for (let attempt = 1; attempt <= SELF_INVOKE_RETRIES; attempt++) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/optimize-batch`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
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

  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { jobId, startIndex = 0 } = body;

    let job: any;

    if (jobId) {
      // Resume existing job
      const { data, error } = await supabase
        .from("optimization_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      job = data;
      if (job.status === "cancelled") {
        return new Response(JSON.stringify({ status: "cancelled", jobId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Create new job and return immediately (background kickoff)
      const {
        productIds,
        selectedPhases,
        fieldsToOptimize,
        modelOverride,
        workspaceId,
        skipKnowledge,
        skipScraping,
        skipReranking,
      } = body;

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await supabase
        .from("optimization_jobs")
        .insert({
          user_id: userId,
          workspace_id: workspaceId || null,
          product_ids: productIds,
          total_products: productIds.length,
          status: "processing",
          selected_phases: selectedPhases || [],
          fields_to_optimize: fieldsToOptimize || [],
          model_override: modelOverride || null,
          started_at: new Date().toISOString(),
          results: JSON.parse(JSON.stringify({ skipKnowledge, skipScraping, skipReranking })),
        })
        .select("id")
        .single();

      if (error || !data?.id) throw error || new Error("Failed to create job");

      console.log(`🚀 Job ${data.id} created: ${productIds.length} products, concurrency ${CONCURRENCY}`);

      // Fire-and-forget worker invocation (same function in resume mode)
      fetch(`${SUPABASE_URL}/functions/v1/optimize-batch`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId: data.id, startIndex: 0 }),
      }).catch((err) => console.error("Initial worker invoke failed:", err));

      return new Response(
        JSON.stringify({
          status: "queued",
          jobId: data.id,
          totalProducts: productIds.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === STRATEGY B: Pre-cache common data ONCE ===
    // Fetch product names for progress updates
    const { data: productData } = await supabase
      .from("products")
      .select("id, original_title, optimized_title, sku")
      .in("id", job.product_ids);

    const productNameMap: Record<string, string> = {};
    (productData || []).forEach((p: any) => {
      productNameMap[p.id] = p.optimized_title || p.original_title || p.sku || p.id.slice(0, 8);
    });

    // Determine phases to process
    const PHASE_CONFIGS = [
      { phase: 1, fields: ["title", "description", "short_description", "tags", "category"] },
      { phase: 2, fields: ["meta_title", "meta_description", "seo_slug", "faq", "image_alt"] },
      { phase: 3, fields: ["price", "upsells", "crosssells"] },
    ];

    const selectedPhases = job.selected_phases?.length > 0
      ? PHASE_CONFIGS.filter((p) => job.selected_phases.includes(p.phase))
      : [{ phase: 0, fields: [] }]; // phase 0 = all fields

    const allProductIds: string[] = job.product_ids;
    const startTime = Date.now();
    let currentIndex = startIndex;
    let totalProcessed = job.processed_products || 0;
    let totalFailed = job.failed_products || 0;

    console.log(`📦 Processing from index ${currentIndex}, ${allProductIds.length - currentIndex} remaining`);

    // === STRATEGY D: Process products in parallel batches of CONCURRENCY ===
    while (currentIndex < allProductIds.length) {
      // Check timeout — strategy A: self-invoke to continue
      if (Date.now() - startTime > MAX_PROCESSING_MS) {
        console.log(`⏱️ Timeout approaching at index ${currentIndex}, self-invoking to continue...`);

        // Self-invoke to continue processing
        const continueBody = JSON.stringify({ jobId: job.id, startIndex: currentIndex });
        fetch(`${SUPABASE_URL}/functions/v1/optimize-batch`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: continueBody,
        }).catch((err) => console.error("Self-invoke failed:", err));

        return new Response(
          JSON.stringify({
            status: "continuing",
            jobId: job.id,
            processedSoFar: totalProcessed,
            nextIndex: currentIndex,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if job was cancelled
      const { data: jobCheck } = await supabase
        .from("optimization_jobs")
        .select("status")
        .eq("id", job.id)
        .single();

      if (jobCheck?.status === "cancelled") {
        console.log(`❌ Job ${job.id} cancelled at index ${currentIndex}`);
        break;
      }

      // Get batch of products
      const batchIds = allProductIds.slice(currentIndex, currentIndex + CONCURRENCY);
      const batchName = productNameMap[batchIds[0]] || `Produto ${currentIndex + 1}`;

      // Update job progress (realtime will push this to frontend)
      await supabase
        .from("optimization_jobs")
        .update({
          current_product_name: batchName,
          processed_products: totalProcessed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      // Process batch in parallel — each call to optimize-product handles one product
      // For each product, process all selected phases sequentially
      // Extract speed flags from job results (stored at creation)
      const jobFlags = (typeof job.results === 'object' && !Array.isArray(job.results)) ? job.results as any : {};
      const speedFlags = {
        skipKnowledge: jobFlags.skipKnowledge || false,
        skipScraping: jobFlags.skipScraping || false,
        skipReranking: jobFlags.skipReranking || false,
      };

      const batchResults = await Promise.allSettled(
        batchIds.map(async (productId) => {
          let productOk = false;
          for (const phaseConfig of selectedPhases) {
            try {
              const callBody: any = {
                productIds: [productId],
                workspaceId: job.workspace_id,
                modelOverride: job.model_override,
                ...speedFlags,
              };

              if (phaseConfig.phase === 0) {
                if (job.fields_to_optimize?.length > 0) {
                  callBody.fieldsToOptimize = job.fields_to_optimize;
                }
              } else {
                callBody.phase = phaseConfig.phase;
                if (job.fields_to_optimize?.length > 0) {
                  callBody.fieldsToOptimize = phaseConfig.fields.filter(
                    (f: string) => job.fields_to_optimize.includes(f)
                  );
                } else {
                  callBody.fieldsToOptimize = phaseConfig.fields;
                }
              }

              const response = await fetch(
                `${SUPABASE_URL}/functions/v1/optimize-product`,
                {
                  method: "POST",
                  headers: {
                    Authorization: authHeader,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(callBody),
                }
              );

              if (!response.ok) {
                const errText = await response.text();
                console.error(`Product ${productId} phase ${phaseConfig.phase} failed: ${response.status} ${errText}`);
                return { productId, status: "error", error: errText };
              }

              const data = await response.json();
              if (data.error) {
                return { productId, status: "error", error: data.error };
              }
              productOk = true;
            } catch (err: any) {
              console.error(`Product ${productId} phase ${phaseConfig.phase} error:`, err.message);
              return { productId, status: "error", error: err.message };
            }
          }
          return { productId, status: productOk ? "optimized" : "error" };
        })
      );

      // Count results
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value.status === "optimized") {
          totalProcessed++;
        } else {
          totalFailed++;
          totalProcessed++;
        }
      }

      currentIndex += batchIds.length;

      // Update progress after each batch
      await supabase
        .from("optimization_jobs")
        .update({
          processed_products: totalProcessed,
          failed_products: totalFailed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      console.log(`✅ Batch done: ${totalProcessed}/${allProductIds.length} (${totalFailed} failed)`);
    }

    // Check final status
    const { data: finalJobCheck } = await supabase
      .from("optimization_jobs")
      .select("status")
      .eq("id", job.id)
      .single();

    const finalStatus = finalJobCheck?.status === "cancelled" ? "cancelled" : "completed";
    await supabase
      .from("optimization_jobs")
      .update({
        status: finalStatus,
        processed_products: totalProcessed,
        failed_products: totalFailed,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    console.log(`🏁 Job ${job.id} ${finalStatus}: ${totalProcessed} processed, ${totalFailed} failed`);

    // === WhatsApp Notification ===
    try {
      const { data: whatsappSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "whatsapp_webhook_url")
        .eq("user_id", userId)
        .maybeSingle();

      if (whatsappSetting?.value) {
        const ok = totalProcessed - totalFailed;
        const message = finalStatus === "completed"
          ? `✅ *Otimização concluída!*\n\n📦 ${ok} produto(s) otimizado(s)\n❌ ${totalFailed} erro(s)\n⏱️ Tempo: ${Math.round((Date.now() - startTime) / 1000)}s`
          : `⚠️ *Job cancelado*\n\n${totalProcessed} de ${job.total_products} processados`;

        await fetch(whatsappSetting.value, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            jobId: job.id,
            status: finalStatus,
            processed: totalProcessed,
            failed: totalFailed,
            timestamp: new Date().toISOString(),
          }),
        });
        console.log("📱 WhatsApp notification sent");
      }
    } catch (whatsErr) {
      console.warn("WhatsApp notification failed (non-fatal):", whatsErr);
    }

    return new Response(
      JSON.stringify({
        status: finalStatus,
        jobId: job.id,
        processed: totalProcessed,
        failed: totalFailed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("optimize-batch error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
