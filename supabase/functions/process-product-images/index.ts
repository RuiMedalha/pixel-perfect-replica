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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const sb = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Não autenticado");
    }
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) throw new Error("Não autenticado");

    const { productIds, workspaceId, mode = "optimize" } = await req.json();
    // mode: "optimize" = pad+enhance, "lifestyle" = generate contextual image

    if (!productIds?.length || !workspaceId) {
      throw new Error("productIds e workspaceId são obrigatórios");
    }

    // Check credits
    const { data: credits } = await sb
      .from("image_credits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (credits) {
      // Reset if month passed
      if (new Date(credits.reset_at) < new Date()) {
        await sb.from("image_credits").update({
          used_this_month: 0,
          reset_at: new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            1
          ).toISOString(),
        }).eq("id", credits.id);
      } else if (credits.used_this_month >= credits.monthly_limit) {
        throw new Error(
          `Limite de ${credits.monthly_limit} imagens/mês atingido (${credits.used_this_month} usados)`
        );
      }
    } else {
      // Create credits row
      await sb.from("image_credits").insert({
        workspace_id: workspaceId,
        used_this_month: 0,
      });
    }

    const results: any[] = [];

    for (const productId of productIds) {
      try {
        // Get product
        const { data: product } = await sb
          .from("products")
          .select("id, sku, original_title, image_urls, product_type")
          .eq("id", productId)
          .single();

        if (!product?.image_urls?.length) {
          results.push({ productId, status: "skipped", reason: "Sem imagens" });
          continue;
        }

        const processedUrls: string[] = [];

        for (let i = 0; i < product.image_urls.length; i++) {
          const originalUrl = product.image_urls[i];
          if (!originalUrl) continue;

          try {
            if (mode === "lifestyle" && i === 0 && lovableKey) {
              // Generate lifestyle image using AI
              const productName = product.original_title || product.sku || "produto";
              const prompt = `Place this product in a realistic, professional commercial environment. The product should be the main focus, centered and prominent. The environment should match the product category - for example, kitchen equipment in a modern professional kitchen, furniture in an elegant room. Professional lighting, high quality commercial photography style. Product: ${productName}`;

              const aiResp = await fetch(
                "https://ai.gateway.lovable.dev/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${lovableKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: "google/gemini-3.1-flash-image-preview",
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "text", text: prompt },
                          {
                            type: "image_url",
                            image_url: { url: originalUrl },
                          },
                        ],
                      },
                    ],
                    modalities: ["image", "text"],
                  }),
                }
              );

              const aiData = await aiResp.json();
              const genImage =
                aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

              if (genImage) {
                const base64Data = genImage.replace(
                  /^data:image\/\w+;base64,/,
                  ""
                );
                const bytes = Uint8Array.from(atob(base64Data), (c) =>
                  c.charCodeAt(0)
                );
                const path = `${workspaceId}/${productId}/lifestyle_0.webp`;
                await sb.storage
                  .from("product-images")
                  .upload(path, bytes, {
                    contentType: "image/webp",
                    upsert: true,
                  });

                const { data: urlData } = sb.storage
                  .from("product-images")
                  .getPublicUrl(path);
                processedUrls.push(urlData.publicUrl);

                // Also store optimized version of original
              }
            }

            // Standard optimization: pad to square with white background
            if (lovableKey) {
              const padPrompt = `Take this product image and place it centered on a pure white square background. Maintain the original proportions without any cropping or distortion. Add equal white padding on all sides so the final image is perfectly square. The product should occupy about 80% of the frame. Clean, professional e-commerce style. Do not add any text, watermarks or extra elements.`;

              const aiResp = await fetch(
                "https://ai.gateway.lovable.dev/v1/chat/completions",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${lovableKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: "google/gemini-3.1-flash-image-preview",
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "text", text: padPrompt },
                          {
                            type: "image_url",
                            image_url: { url: originalUrl },
                          },
                        ],
                      },
                    ],
                    modalities: ["image", "text"],
                  }),
                }
              );

              const aiData = await aiResp.json();
              const optimizedImage =
                aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

              if (optimizedImage) {
                const base64Data = optimizedImage.replace(
                  /^data:image\/\w+;base64,/,
                  ""
                );
                // Process in chunks to avoid stack overflow
                const raw = atob(base64Data);
                const chunkSize = 8192;
                const chunks: number[] = [];
                for (let c = 0; c < raw.length; c += chunkSize) {
                  const slice = raw.slice(c, c + chunkSize);
                  for (let j = 0; j < slice.length; j++) {
                    chunks.push(slice.charCodeAt(j));
                  }
                }
                const bytes = new Uint8Array(chunks);

                const path = `${workspaceId}/${productId}/optimized_${i}.webp`;
                await sb.storage
                  .from("product-images")
                  .upload(path, bytes, {
                    contentType: "image/webp",
                    upsert: true,
                  });

                const { data: urlData } = sb.storage
                  .from("product-images")
                  .getPublicUrl(path);
                processedUrls.push(urlData.publicUrl);

                // Update images table
                await sb.from("images").upsert(
                  {
                    product_id: productId,
                    original_url: originalUrl,
                    optimized_url: urlData.publicUrl,
                    s3_key: path,
                    sort_order: i,
                    status: "done",
                  },
                  { onConflict: "product_id,sort_order", ignoreDuplicates: false }
                );
              } else {
                // AI didn't return image, keep original
                processedUrls.push(originalUrl);
              }
            } else {
              // No AI key, just keep originals
              processedUrls.push(originalUrl);
            }
          } catch (imgErr) {
            console.error(`Error processing image ${i} for ${productId}:`, imgErr);
            processedUrls.push(originalUrl); // Keep original on error
          }
        }

        // Keep original image_urls intact — optimized versions are in the images table
        if (processedUrls.length > 0) {
          // Increment credits
          await sb.rpc("increment_image_credits", {
            _workspace_id: workspaceId,
          });
        }

        results.push({
          productId,
          status: "done",
          original: product.image_urls.length,
          processed: processedUrls.length,
        });
      } catch (prodErr) {
        console.error(`Error processing product ${productId}:`, prodErr);
        results.push({
          productId,
          status: "error",
          error: prodErr instanceof Error ? prodErr.message : "Erro",
        });
      }
    }

    return new Response(
      JSON.stringify({
        total: productIds.length,
        processed: results.filter((r) => r.status === "done").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "error").length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-product-images error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Erro interno",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
