import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { productIds } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch products
    const { data: products, error: fetchError } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (fetchError) throw fetchError;
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as processing
    await supabase
      .from("products")
      .update({ status: "processing" })
      .in("id", productIds);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const results = [];

    for (const product of products) {
      const prompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

Produto original:
- Título: ${product.original_title || "N/A"}
- Descrição: ${product.original_description || "N/A"}
- Categoria: ${product.category || "N/A"}
- Preço: ${product.original_price || "N/A"}€
- SKU: ${product.sku || "N/A"}

Gera:
1. Um título otimizado (máx 70 chars, com keyword principal)
2. Uma descrição otimizada (200-400 chars, persuasiva, com benefícios e keywords)
3. Meta title SEO (máx 60 chars)
4. Meta description SEO (máx 155 chars, com call-to-action)
5. SEO slug (url-friendly, lowercase, hífens)
6. Tags relevantes (3-6 palavras-chave)
7. Preço sugerido (pode manter o original ou ajustar ligeiramente)`;

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional.",
            },
            { role: "user", content: prompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "optimize_product",
                description: "Devolve os campos otimizados do produto",
                parameters: {
                  type: "object",
                  properties: {
                    optimized_title: { type: "string" },
                    optimized_description: { type: "string" },
                    meta_title: { type: "string" },
                    meta_description: { type: "string" },
                    seo_slug: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    optimized_price: { type: "number" },
                  },
                  required: [
                    "optimized_title",
                    "optimized_description",
                    "meta_title",
                    "meta_description",
                    "seo_slug",
                    "tags",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "optimize_product" } },
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) {
          // Mark remaining as pending again
          await supabase.from("products").update({ status: "pending" }).in("id", productIds);
          return new Response(JSON.stringify({ error: "Limite de pedidos excedido. Tente novamente mais tarde." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          await supabase.from("products").update({ status: "pending" }).in("id", productIds);
          return new Response(JSON.stringify({ error: "Créditos insuficientes. Adicione créditos ao workspace." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const errText = await aiResponse.text();
        console.error("AI error:", status, errText);
        await supabase.from("products").update({ status: "error" }).eq("id", product.id);
        results.push({ id: product.id, status: "error", error: errText });
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        await supabase.from("products").update({ status: "error" }).eq("id", product.id);
        results.push({ id: product.id, status: "error", error: "No tool call in response" });
        continue;
      }

      const optimized = JSON.parse(toolCall.function.arguments);

      const { error: updateError } = await supabase
        .from("products")
        .update({
          optimized_title: optimized.optimized_title,
          optimized_description: optimized.optimized_description,
          meta_title: optimized.meta_title,
          meta_description: optimized.meta_description,
          seo_slug: optimized.seo_slug,
          tags: optimized.tags,
          optimized_price: optimized.optimized_price ?? product.original_price,
          status: "optimized",
        })
        .eq("id", product.id);

      if (updateError) {
        console.error("Update error:", updateError);
        results.push({ id: product.id, status: "error", error: updateError.message });
      } else {
        results.push({ id: product.id, status: "optimized" });
      }

      // Log activity
      await supabase.from("activity_log").insert({
        user_id: userId,
        action: "optimize",
        details: { product_id: product.id, sku: product.sku },
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("optimize-product error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
