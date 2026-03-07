import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_PROCESSING_MS = 110_000; // 110s, leave buffer before edge function timeout
const CONCURRENCY = 5; // Process 5 products in parallel (strategy D)

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
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

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
      // Create new job
      const {
        productIds,
        selectedPhases,
        fieldsToOptimize,
        modelOverride,
        workspaceId,
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
        })
        .select()
        .single();

      if (error) throw error;
      job = data;
      console.log(`🚀 Job ${job.id} created: ${productIds.length} products, concurrency ${CONCURRENCY}`);
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
      const batchResults = await Promise.allSettled(
        batchIds.map(async (productId) => {
          let productOk = false;
          for (const phaseConfig of selectedPhases) {
            try {
              const callBody: any = {
                productIds: [productId],
                workspaceId: job.workspace_id,
                modelOverride: job.model_override,
              };

              if (phaseConfig.phase === 0) {
                // All fields mode
                if (job.fields_to_optimize?.length > 0) {
                  callBody.fieldsToOptimize = job.fields_to_optimize;
                }
              } else {
                // Phase mode
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
