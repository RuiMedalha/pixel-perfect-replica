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

    const { productIds, fieldsToOptimize, modelOverride, workspaceId } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fields = fieldsToOptimize || [
      "title", "description", "short_description",
      "meta_title", "meta_description", "seo_slug", "tags", "price", "faq",
      "upsells", "crosssells"
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

    // Mark as processing
    await supabase
      .from("products")
      .update({ status: "processing" })
      .in("id", productIds);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch user's chosen AI model from settings
    const MODEL_MAP: Record<string, string> = {
      "gemini-flash": "google/gemini-3-flash-preview",
      "gemini-pro": "google/gemini-2.5-pro",
      "gpt5": "openai/gpt-5",
      "gpt5-mini": "openai/gpt-5-mini",
    };
    const { data: modelSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "default_model")
      .maybeSingle();
    // Use override if provided, otherwise fall back to settings
    const chosenModel = modelOverride 
      ? (MODEL_MAP[modelOverride] || MODEL_MAP["gemini-flash"])
      : (MODEL_MAP[modelSetting?.value || "gemini-flash"] || "google/gemini-3-flash-preview");
    console.log(`Using AI model: ${chosenModel} (override: ${modelOverride || "none"}, setting: ${modelSetting?.value || "default"})`);

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    // Fetch supplier mappings from settings
    let supplierMappings: Array<{ prefix: string; url: string; name?: string }> = [];
    const { data: suppliersConfig } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "suppliers_json")
      .maybeSingle();

    if (suppliersConfig?.value) {
      try {
        const parsed = JSON.parse(suppliersConfig.value);
        if (Array.isArray(parsed)) {
          supplierMappings = parsed.filter((s: any) => s.prefix && s.url);
          const allParsed = parsed.length;
          const withUrl = supplierMappings.length;
          if (allParsed > 0 && withUrl === 0) {
            console.warn(`⚠️ ${allParsed} fornecedores configurados mas NENHUM tem URL preenchido! Preencha o URL nas Configurações.`);
          } else {
            console.log(`📦 ${withUrl} fornecedores com URL activo: ${supplierMappings.map(s => `${s.prefix}→${s.url.substring(0, 40)}`).join(", ")}`);
          }
        }
      } catch { /* ignore parse errors */ }
    } else {
      console.log("⚠️ Nenhum fornecedor configurado (suppliers_json não encontrado)");
    }

    // Fetch ALL user products for upsell/cross-sell suggestions
    let catalogContext = "";
    if (fields.includes("upsells") || fields.includes("crosssells")) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("sku, original_title, optimized_title, category, original_price")
        .order("created_at", { ascending: false })
        .limit(500);

      if (allProducts && allProducts.length > 1) {
        const catalogList = allProducts
          .filter((p: any) => p.sku)
          .map((p: any) => `SKU: ${p.sku} | ${p.optimized_title || p.original_title || "Sem título"} | Cat: ${p.category || "N/A"} | ${p.original_price || "N/A"}€`)
          .join("\n");
        catalogContext = `\n\nCATÁLOGO COMPLETO DE PRODUTOS (usa para sugerir upsells e cross-sells):\n${catalogList.substring(0, 10000)}`;
      }
    }

    const results: any[] = [];

    // Process products in parallel batches of 3 for speed
    const CONCURRENCY = 3;
    for (let batchStart = 0; batchStart < products.length; batchStart += CONCURRENCY) {
      const batch = products.slice(batchStart, batchStart + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (product) => {
      try {
        // === SAVE VERSION BEFORE OPTIMIZING (keep max 3) ===
        if (product.optimized_title || product.optimized_description) {
          // Get current version count
          const { data: existingVersions } = await supabase
            .from("product_versions")
            .select("id, version_number")
            .eq("product_id", product.id)
            .order("version_number", { ascending: false });

          const nextVersion = (existingVersions?.[0]?.version_number ?? 0) + 1;

          // Save current state as version
          await supabase.from("product_versions").insert({
            product_id: product.id,
            user_id: userId,
            version_number: nextVersion,
            optimized_title: product.optimized_title,
            optimized_description: product.optimized_description,
            optimized_short_description: product.optimized_short_description,
            meta_title: product.meta_title,
            meta_description: product.meta_description,
            seo_slug: product.seo_slug,
            tags: product.tags,
            optimized_price: product.optimized_price,
            faq: product.faq,
          });

          // Delete oldest versions if more than 3
          if (existingVersions && existingVersions.length >= 3) {
            const toDelete = existingVersions.slice(2).map((v: any) => v.id);
            if (toDelete.length > 0) {
              await supabase.from("product_versions").delete().in("id", toDelete);
            }
          }
        }

        // 1. Search relevant knowledge chunks with multiple search strategies
        let knowledgeContext = "";
        const allChunks: any[] = [];

        // Strategy 1: Search by product title (cleaned - remove codes/special chars)
        const cleanTitle = (product.original_title || "")
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        // Extract meaningful words (3+ chars, no codes)
        const titleWords = cleanTitle.split(" ").filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
        const titleQuery = titleWords.slice(0, 5).join(" ");

        // Strategy 2: Search by category keywords
        const categoryQuery = (product.category || "")
          .replace(/>/g, " ")
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // Strategy 3: Search by SKU/ref
        const skuQuery = product.sku || product.supplier_ref || "";

        const searchQueries = [titleQuery, categoryQuery, skuQuery].filter((q) => q.length > 2);
        
        for (const query of searchQueries) {
          const searchArgs: any = { _query: query, _limit: 5 };
          if (workspaceId) searchArgs._workspace_id = workspaceId;
          
          try {
            const { data: chunks } = await supabase.rpc("search_knowledge", searchArgs);
            if (chunks && chunks.length > 0) {
              for (const c of chunks) {
                if (!allChunks.find((existing: any) => existing.id === c.id)) {
                  allChunks.push(c);
                }
              }
            }
          } catch (e) {
            console.warn(`Knowledge search error for "${query.substring(0, 40)}":`, e);
          }
        }

        // Sort by rank and take top results
        allChunks.sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));
        const topChunks = allChunks.slice(0, 8);

        if (topChunks.length > 0) {
          console.log(`✅ Knowledge found: ${topChunks.length} chunks from: ${[...new Set(topChunks.map((c: any) => c.source_name))].join(", ")}`);
          const parts = topChunks.map((c: any) => `[${c.source_name}] ${c.content}`).join("\n\n");
          knowledgeContext = `\n\nINFORMAÇÃO DE REFERÊNCIA (conhecimento relevante encontrado nos PDFs e ficheiros):\n${parts.substring(0, 12000)}`;
        } else {
          console.log(`⚠️ No knowledge found for queries: ${searchQueries.map(q => `"${q.substring(0, 30)}"`).join(", ")} (workspace: ${workspaceId || "all"})`);
        }

        // 2. Auto-scrape supplier page by SKU
        let supplierContext = "";
        if (FIRECRAWL_API_KEY && product.sku && product.sku.length > 2) {
          const skuUpper = product.sku.toUpperCase();
          const matchedSupplier = supplierMappings.find((s) => 
            skuUpper.startsWith(s.prefix.toUpperCase())
          );

          if (matchedSupplier) {
            try {
              const prefixLen = matchedSupplier.prefix.length;
              const cleanSku = product.sku.substring(prefixLen);
              const supplierUrl = matchedSupplier.url.endsWith("=") || matchedSupplier.url.endsWith("/")
                ? `${matchedSupplier.url}${encodeURIComponent(cleanSku)}`
                : `${matchedSupplier.url}/${encodeURIComponent(cleanSku)}`;
              console.log(`Auto-scraping supplier [${matchedSupplier.prefix}] for SKU ${product.sku}: ${supplierUrl}`);

              const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  url: supplierUrl,
                  formats: ["markdown"],
                  onlyMainContent: true,
                  waitFor: 3000,
                }),
              });

              if (scrapeResponse.ok) {
                const scrapeData = await scrapeResponse.json();
                const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
                if (markdown.length > 100) {
                  supplierContext = `\n\nINFORMAÇÃO DO FORNECEDOR "${matchedSupplier.name || matchedSupplier.prefix}" (página do produto):\n${markdown.substring(0, 8000)}`;
                  console.log(`Got ${markdown.length} chars from supplier page`);
                }
              } else {
                console.warn(`Supplier scrape failed: ${scrapeResponse.status}`);
              }
            } catch (scrapeErr) {
              console.warn("Auto-scrape error (non-fatal):", scrapeErr);
            }
          } else {
            console.log(`No supplier mapping found for SKU prefix of: ${product.sku}`);
          }
        }

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
        if (fields.includes("description")) fieldInstructions.push(`2. Uma descrição otimizada com a seguinte ESTRUTURA OBRIGATÓRIA:
   - PRIMEIRO: Um parágrafo comercial persuasivo (150-250 chars) com benefícios e keywords
   - SEGUNDO: Uma tabela HTML de características técnicas (<table>) com TODAS as specs do produto (dimensões, peso, material, potência, etc.)
   - TERCEIRO: Uma secção FAQ com 3-5 perguntas e respostas frequentes em formato HTML (<h3>Perguntas Frequentes</h3> seguido de <details><summary>Pergunta</summary><p>Resposta</p></details>)
   IMPORTANTE: NÃO mistures dados técnicos no texto comercial. As specs devem estar APENAS na tabela.`);
        if (fields.includes("short_description")) fieldInstructions.push("3. Uma descrição curta otimizada (máx 160 chars, resumo conciso para listagens)");
        if (fields.includes("meta_title")) fieldInstructions.push("4. Meta title SEO (máx 60 chars)");
        if (fields.includes("meta_description")) fieldInstructions.push("5. Meta description SEO (máx 155 chars, com call-to-action)");
        if (fields.includes("seo_slug")) fieldInstructions.push("6. SEO slug (url-friendly, lowercase, hífens, sem acentos)");
        if (fields.includes("tags")) fieldInstructions.push("7. Tags relevantes (3-6 palavras-chave)");
        if (fields.includes("price")) fieldInstructions.push("8. Preço sugerido (pode manter o original ou ajustar ligeiramente)");
        if (fields.includes("faq")) fieldInstructions.push("9. FAQ com 3-5 perguntas e respostas frequentes sobre o produto (em formato array de objetos {question, answer}). Estas FAQs devem ser DIFERENTES e complementares às que estão na descrição.");
        if (fields.includes("upsells")) fieldInstructions.push("10. Upsells: Sugere 2-4 produtos SUPERIORES do catálogo (mais caros, melhor qualidade, versão premium) que o cliente pode preferir. Devolve array de objetos {sku, title} com SKUs REAIS do catálogo.");
        if (fields.includes("crosssells")) fieldInstructions.push("11. Cross-sells: Sugere 2-4 produtos COMPLEMENTARES do catálogo (acessórios, produtos relacionados que combinam) que o cliente também pode querer. Devolve array de objetos {sku, title} com SKUs REAIS do catálogo.");

        const defaultPrompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

${productInfo}${knowledgeContext}${supplierContext}${catalogContext}

Gera:
${fieldInstructions.join("\n")}

IMPORTANTE: 
- Mantém e melhora as características técnicas do produto (dimensões, peso, potência, etc.) na TABELA de specs, NÃO no texto comercial.
- O texto comercial deve ser persuasivo e focado nos benefícios, sem dados técnicos misturados.
- As FAQs na descrição devem ser práticas e úteis para o cliente.
- Se existir informação de referência ou do fornecedor acima, usa-a para enriquecer o produto com dados reais.
- Para upsells e cross-sells, usa APENAS SKUs que existam no catálogo fornecido. NÃO inventes SKUs.
- Traduz tudo para português europeu.`;

        const finalPrompt = customPrompt
          ? `${customPrompt}\n\n${productInfo}${knowledgeContext}${supplierContext}`
          : defaultPrompt;

        // Build tool properties dynamically
        const toolProperties: Record<string, any> = {};
        const requiredFields: string[] = [];

        if (fields.includes("title")) { toolProperties.optimized_title = { type: "string" }; requiredFields.push("optimized_title"); }
        if (fields.includes("description")) { toolProperties.optimized_description = { type: "string", description: "Descrição completa com: parágrafo comercial + tabela HTML de specs + secção FAQ em HTML" }; requiredFields.push("optimized_description"); }
        if (fields.includes("short_description")) { toolProperties.optimized_short_description = { type: "string", description: "Descrição curta concisa para listagens, máx 160 chars" }; requiredFields.push("optimized_short_description"); }
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
              properties: { question: { type: "string" }, answer: { type: "string" } },
              required: ["question", "answer"],
            },
          };
          requiredFields.push("faq");
        }
        if (fields.includes("upsells")) {
          toolProperties.upsell_skus = {
            type: "array",
            description: "Produtos superiores sugeridos como upsell, com SKU e título reais do catálogo",
            items: {
              type: "object",
              properties: { sku: { type: "string" }, title: { type: "string" } },
              required: ["sku", "title"],
            },
          };
          requiredFields.push("upsell_skus");
        }
        if (fields.includes("crosssells")) {
          toolProperties.crosssell_skus = {
            type: "array",
            description: "Produtos complementares sugeridos como cross-sell, com SKU e título reais do catálogo",
            items: {
              type: "object",
              properties: { sku: { type: "string" }, title: { type: "string" } },
              required: ["sku", "title"],
            },
          };
          requiredFields.push("crosssell_skus");
        }

        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: chosenModel,
            messages: [
              {
                role: "system",
                content: "És um especialista em e-commerce e SEO. Responde APENAS com a tool call pedida, sem texto adicional. Mantém sempre as características técnicas do produto NUMA TABELA HTML separada do texto comercial. Traduz tudo para português europeu.",
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

        // Capture token usage from AI response
        const usage = aiData.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

        const optimized = JSON.parse(toolCall.function.arguments);

        // === VALIDATE upsell/crosssell SKUs against real DB ===
        if (optimized.upsell_skus && Array.isArray(optimized.upsell_skus) && optimized.upsell_skus.length > 0) {
          const skusToCheck = optimized.upsell_skus.map((u: any) => u.sku).filter(Boolean);
          if (skusToCheck.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku, optimized_title, original_title")
              .in("sku", skusToCheck);
            const validMap = new Map((validProducts || []).map((p: any) => [p.sku, p]));
            const before = optimized.upsell_skus.length;
            optimized.upsell_skus = optimized.upsell_skus
              .filter((u: any) => validMap.has(u.sku) && u.sku !== product.sku)
              .map((u: any) => {
                const real = validMap.get(u.sku);
                return { sku: u.sku, title: real?.optimized_title || real?.original_title || u.title };
              });
            console.log(`Upsells validated: ${optimized.upsell_skus.length}/${before} SKUs are real`);
          }
        }
        if (optimized.crosssell_skus && Array.isArray(optimized.crosssell_skus) && optimized.crosssell_skus.length > 0) {
          const skusToCheck = optimized.crosssell_skus.map((u: any) => u.sku).filter(Boolean);
          if (skusToCheck.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku, optimized_title, original_title")
              .in("sku", skusToCheck);
            const validMap = new Map((validProducts || []).map((p: any) => [p.sku, p]));
            const before = optimized.crosssell_skus.length;
            optimized.crosssell_skus = optimized.crosssell_skus
              .filter((u: any) => validMap.has(u.sku) && u.sku !== product.sku)
              .map((u: any) => {
                const real = validMap.get(u.sku);
                return { sku: u.sku, title: real?.optimized_title || real?.original_title || u.title };
              });
            console.log(`Cross-sells validated: ${optimized.crosssell_skus.length}/${before} SKUs are real`);
          }
        }

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
        if (optimized.upsell_skus) updateData.upsell_skus = optimized.upsell_skus;
        if (optimized.crosssell_skus) updateData.crosssell_skus = optimized.crosssell_skus;

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
        const matchedForLog = supplierMappings.find((s) => 
          product.sku?.toUpperCase().startsWith(s.prefix.toUpperCase())
        );
        await supabase.from("activity_log").insert({
          user_id: userId,
          action: "optimize",
          details: { 
            product_id: product.id, 
            sku: product.sku, 
            fields, 
            supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
            had_supplier_context: !!supplierContext, 
            had_knowledge_context: !!knowledgeContext,
          },
        });

        // Log optimization details (tokens, sources, etc.)
        // Build knowledge sources from already-fetched chunks
        let knowledgeSources: Array<{ source: string; chunks: number }> = [];
        if (topChunks.length > 0) {
          const sourceMap = new Map<string, number>();
          topChunks.forEach((c: any) => {
            const name = c.source_name || "Desconhecido";
            sourceMap.set(name, (sourceMap.get(name) || 0) + 1);
          });
          knowledgeSources = Array.from(sourceMap.entries()).map(([source, chunks]) => ({ source, chunks }));
        }

        const matchedSupplierForLog = supplierMappings.find((s) => 
          product.sku?.toUpperCase().startsWith(s.prefix.toUpperCase())
        );
        let logSupplierUrl: string | null = null;
        if (matchedSupplierForLog && product.sku) {
          const prefixLen = matchedSupplierForLog.prefix.length;
          const cleanSku = product.sku.substring(prefixLen);
          logSupplierUrl = matchedSupplierForLog.url.endsWith("=") || matchedSupplierForLog.url.endsWith("/")
            ? `${matchedSupplierForLog.url}${encodeURIComponent(cleanSku)}`
            : `${matchedSupplierForLog.url}/${encodeURIComponent(cleanSku)}`;
        }

        await supabase.from("optimization_logs").insert({
          product_id: product.id,
          user_id: userId,
          model: chosenModel,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          knowledge_sources: knowledgeSources,
          supplier_name: matchedForLog?.name || matchedForLog?.prefix || null,
          supplier_url: logSupplierUrl,
          had_knowledge: !!knowledgeContext,
          had_supplier: !!supplierContext,
          had_catalog: !!catalogContext,
          fields_optimized: fields,
          prompt_length: finalPrompt.length,
        });
      } catch (productError) {
        console.error(`Error optimizing product ${product.id}:`, productError);
        await supabase.from("products").update({ status: "error" }).eq("id", product.id);
        return { id: product.id, status: "error" as const, error: productError instanceof Error ? productError.message : "Unknown" };
      }
      }));

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ id: "unknown", status: "error", error: String(result.reason) });
        }
      }
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
