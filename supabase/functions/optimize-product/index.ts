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

    const { productIds, fieldsToOptimize } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default fields to optimize if not specified
    const fields = fieldsToOptimize || [
      "title", "description", "short_description",
      "meta_title", "meta_description", "seo_slug", "tags", "price", "faq"
    ];

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

    // Fetch user's optimization prompt from settings
    const { data: promptSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "optimization_prompt")
      .maybeSingle();

    const customPrompt = promptSetting?.value || null;

    // Fetch knowledge context from uploaded knowledge files
    let knowledgeContext = "";
    const { data: knowledgeFiles } = await supabase
      .from("uploaded_files")
      .select("file_name, extracted_text")
      .eq("file_type", "knowledge")
      .not("extracted_text", "is", null);

    if (knowledgeFiles && knowledgeFiles.length > 0) {
      const parts = knowledgeFiles
        .filter((f: any) => f.extracted_text)
        .map((f: any) => `--- ${f.file_name} ---\n${f.extracted_text}`)
        .join("\n\n");
      if (parts) {
        knowledgeContext = `\n\nINFORMAÇÃO DE REFERÊNCIA (fichas técnicas, catálogos do fornecedor):\n${parts.substring(0, 15000)}`;
      }
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
      const productInfo = `Produto original:
- Título: ${product.original_title || "N/A"}
- Descrição: ${product.original_description || "N/A"}
- Descrição Curta: ${product.short_description || "N/A"}
- Características Técnicas: ${product.technical_specs || "N/A"}
- Categoria: ${product.category || "N/A"}
- Preço: ${product.original_price || "N/A"}€
- SKU: ${product.sku || "N/A"}
- Ref. Fornecedor: ${product.supplier_ref || "N/A"}`;

      // Build field-specific instructions
      const fieldInstructions: string[] = [];
      if (fields.includes("title")) fieldInstructions.push("1. Um título otimizado (máx 70 chars, com keyword principal)");
      if (fields.includes("description")) fieldInstructions.push("2. Uma descrição otimizada (200-400 chars, persuasiva, com benefícios e keywords)");
      if (fields.includes("short_description")) fieldInstructions.push("3. Uma descrição curta otimizada (máx 160 chars, resumo conciso)");
      if (fields.includes("meta_title")) fieldInstructions.push("4. Meta title SEO (máx 60 chars)");
      if (fields.includes("meta_description")) fieldInstructions.push("5. Meta description SEO (máx 155 chars, com call-to-action)");
      if (fields.includes("seo_slug")) fieldInstructions.push("6. SEO slug (url-friendly, lowercase, hífens)");
      if (fields.includes("tags")) fieldInstructions.push("7. Tags relevantes (3-6 palavras-chave)");
      if (fields.includes("price")) fieldInstructions.push("8. Preço sugerido (pode manter o original ou ajustar ligeiramente)");
      if (fields.includes("faq")) fieldInstructions.push("9. FAQ com 3-5 perguntas e respostas frequentes sobre o produto (em formato array de objetos {question, answer}). As perguntas devem ser naturais, como um cliente perguntaria, e as respostas informativas.");

      const defaultPrompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

${productInfo}${knowledgeContext}

Gera:
${fieldInstructions.join("\n")}

IMPORTANTE: Mantém e melhora as características técnicas do produto (dimensões, peso, potência, etc.) na descrição otimizada. Não percas informação técnica. Se existir informação de referência acima, usa-a para enriquecer o produto. Traduz para português europeu se necessário.`;

      const finalPrompt = customPrompt
        ? `${customPrompt}\n\n${productInfo}${knowledgeContext}`
        : defaultPrompt;

      // Build tool properties dynamically based on selected fields
      const toolProperties: Record<string, any> = {};
      const requiredFields: string[] = [];

      if (fields.includes("title")) { toolProperties.optimized_title = { type: "string" }; requiredFields.push("optimized_title"); }
      if (fields.includes("description")) { toolProperties.optimized_description = { type: "string" }; requiredFields.push("optimized_description"); }
      if (fields.includes("short_description")) { toolProperties.optimized_short_description = { type: "string" }; requiredFields.push("optimized_short_description"); }
      if (fields.includes("meta_title")) { toolProperties.meta_title = { type: "string" }; requiredFields.push("meta_title"); }
      if (fields.includes("meta_description")) { toolProperties.meta_description = { type: "string" }; requiredFields.push("meta_description"); }
      if (fields.includes("seo_slug")) { toolProperties.seo_slug = { type: "string" }; requiredFields.push("seo_slug"); }
      if (fields.includes("tags")) { toolProperties.tags = { type: "array", items: { type: "string" } }; requiredFields.push("tags"); }
      if (fields.includes("price")) { toolProperties.optimized_price = { type: "number" }; }
      if (fields.includes("faq")) {
        toolProperties.faq = {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
            required: ["question", "answer"],
          },
        };
        requiredFields.push("faq");
      }

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
              content: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto. Traduz tudo para português europeu.",
            },
            { role: "user", content: finalPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "optimize_product",
                description: "Devolve os campos otimizados do produto",
                parameters: {
                  type: "object",
                  properties: toolProperties,
                  required: requiredFields,
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

      // Build update object with only the fields that were optimized
      const updateData: Record<string, any> = { status: "optimized" };
      if (optimized.optimized_title) updateData.optimized_title = optimized.optimized_title;
      if (optimized.optimized_description) updateData.optimized_description = optimized.optimized_description;
      if (optimized.optimized_short_description !== undefined) updateData.optimized_short_description = optimized.optimized_short_description || null;
      if (optimized.meta_title) updateData.meta_title = optimized.meta_title;
      if (optimized.meta_description) updateData.meta_description = optimized.meta_description;
      if (optimized.seo_slug) updateData.seo_slug = optimized.seo_slug;
      if (optimized.tags) updateData.tags = optimized.tags;
      if (optimized.optimized_price !== undefined) updateData.optimized_price = optimized.optimized_price ?? product.original_price;
      if (optimized.faq) updateData.faq = optimized.faq;

      const { error: updateError } = await supabase
        .from("products")
        .update(updateData)
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
        details: { product_id: product.id, sku: product.sku, fields },
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
