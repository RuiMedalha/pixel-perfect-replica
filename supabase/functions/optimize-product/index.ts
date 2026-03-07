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
      "upsells", "crosssells", "image_alt", "category"
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

    // Fetch per-field custom prompts
    const fieldPromptKeys = [
      "prompt_field_title", "prompt_field_description", "prompt_field_short_description",
      "prompt_field_meta_title", "prompt_field_meta_description", "prompt_field_seo_slug",
      "prompt_field_tags", "prompt_field_price", "prompt_field_faq",
      "prompt_field_upsells", "prompt_field_crosssells", "prompt_field_image_alt",
      "prompt_field_category",
    ];
    const { data: fieldPromptSettings } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", fieldPromptKeys);
    
    const fieldPrompts: Record<string, string> = {};
    (fieldPromptSettings || []).forEach((s: any) => {
      if (s.value) fieldPrompts[s.key] = s.value;
    });

    // Fetch existing categories for AI context
    let existingCategories: string[] = [];
    if (fields.includes("category")) {
      const { data: catData } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null);
      const cats = new Set<string>();
      (catData || []).forEach((p: any) => { if (p.category) cats.add(p.category); });
      existingCategories = Array.from(cats).sort();
    }

    // Mark as processing
    await supabase
      .from("products")
      .update({ status: "processing" })
      .in("id", productIds);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch user's chosen AI model from settings
    const MODEL_MAP: Record<string, string> = {
      "gemini-3-flash": "google/gemini-3-flash-preview",
      "gemini-3-pro": "google/gemini-3-pro-preview",
      "gemini-2.5-pro": "google/gemini-2.5-pro",
      "gemini-2.5-flash": "google/gemini-2.5-flash",
      "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
      "gpt-5.2": "openai/gpt-5.2",
      "gpt-5": "openai/gpt-5",
      "gpt-5-mini": "openai/gpt-5-mini",
      "gpt-5-nano": "openai/gpt-5-nano",
    };
    const { data: modelSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "default_model")
      .maybeSingle();
    // Use override if provided, otherwise fall back to settings
    const chosenModel = modelOverride 
      ? (MODEL_MAP[modelOverride] || MODEL_MAP["gemini-3-flash"])
      : (MODEL_MAP[modelSetting?.value || "gemini-3-flash"] || "google/gemini-3-flash-preview");
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

    // === COMPATIBILITY ENGINE for upsell/cross-sell ===
    interface ProductAttrs {
      sku: string;
      title: string;
      category: string;
      price: number;
      line: string | null;       // "700", "900", etc.
      energy: string | null;     // "gas", "eletrico", "misto"
      capacity: number | null;   // liters, baskets size, etc.
      dimensions: string | null; // "40x40", "60x40", etc.
      type: string | null;       // "fritadeira", "fogao", etc.
      brand: string | null;
      raw: any;
    }

    function extractAttrs(p: any): ProductAttrs {
      const title = (p.optimized_title || p.original_title || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const combined = `${title} ${cat}`;

      // Extract line/series
      const lineMatch = combined.match(/linha\s*(\d+)/i) || combined.match(/line\s*(\d+)/i) || combined.match(/s[eé]rie\s*(\d+)/i);
      const line = lineMatch ? lineMatch[1] : null;

      // Extract energy type
      let energy: string | null = null;
      if (/\bg[aá]s\b/i.test(combined)) energy = "gas";
      else if (/\bel[eé]tric/i.test(combined)) energy = "eletrico";
      else if (/\bmist[oa]\b/i.test(combined)) energy = "misto";

      // Extract capacity (liters, baskets, burners)
      let capacity: number | null = null;
      const litersMatch = combined.match(/(\d+)\s*(?:litros?|l\b)/i);
      const cestoMatch = combined.match(/cesto\s*(\d+)/i);
      const bicosMatch = combined.match(/(\d+)\s*(?:bicos?|queimadores?)/i);
      if (litersMatch) capacity = parseInt(litersMatch[1]);
      else if (cestoMatch) capacity = parseInt(cestoMatch[1]);
      else if (bicosMatch) capacity = parseInt(bicosMatch[1]);

      // Extract dimensions
      const dimMatch = combined.match(/(\d+)\s*x\s*(\d+)/i);
      const dimensions = dimMatch ? `${dimMatch[1]}x${dimMatch[2]}` : null;

      // Extract product type (first meaningful word from category or title)
      const typePatterns = [
        "fritadeira", "fogao", "fogão", "forno", "bancada", "mesa", "armario", "armário",
        "maquina", "máquina", "lava", "frigorifico", "frigorífico", "vitrine", "exaustor",
        "grelhador", "chapa", "basculante", "marmita", "batedeira", "cortador", "ralador",
        "microondas", "tostadeira", "torradeira", "salamandra", "abatedor", "ultracongelador",
        "dispensador", "doseador", "cesto", "tabuleiro", "prateleira", "escorredor",
      ];
      let type: string | null = null;
      for (const t of typePatterns) {
        if (combined.includes(t)) { type = t; break; }
      }

      return {
        sku: p.sku || "",
        title: p.optimized_title || p.original_title || "Sem título",
        category: p.category || "",
        price: parseFloat(p.original_price) || 0,
        line, energy, capacity, dimensions, type, brand: null, raw: p,
      };
    }

    function computeCompatibility(current: ProductAttrs, candidate: ProductAttrs, mode: "upsell" | "crosssell"): { score: number; reasons: string[] } {
      if (candidate.sku === current.sku) return { score: -1, reasons: [] };
      let score = 0;
      const reasons: string[] = [];

      if (mode === "upsell") {
        // Upsell: same type, same or higher line, bigger/better
        if (current.type && candidate.type === current.type) { score += 30; reasons.push("mesmo tipo"); }
        if (current.line && candidate.line) {
          if (candidate.line === current.line) { score += 15; reasons.push("mesma linha"); }
          else if (parseInt(candidate.line) > parseInt(current.line)) { score += 25; reasons.push(`linha superior (${candidate.line})`); }
        }
        if (current.energy && candidate.energy === current.energy) { score += 10; reasons.push("mesma energia"); }
        if (current.capacity && candidate.capacity && candidate.capacity > current.capacity) {
          score += 20; reasons.push(`maior capacidade (${candidate.capacity})`);
        }
        if (candidate.price > current.price && candidate.price <= current.price * 2.5) {
          score += 10; reasons.push("preço superior");
        }
        // Same category boost
        if (current.category && candidate.category && 
            candidate.category.split(">")[0]?.trim() === current.category.split(">")[0]?.trim()) {
          score += 10; reasons.push("mesma categoria");
        }
      } else {
        // Cross-sell: complementary products (different type, same line/family)
        if (current.type && candidate.type && candidate.type !== current.type) {
          score += 20; reasons.push("tipo complementar");
        }
        if (current.type && candidate.type === current.type) {
          score -= 15; // penalize same type for cross-sell
        }
        if (current.line && candidate.line === current.line) {
          score += 25; reasons.push("mesma linha");
        }
        if (current.energy && candidate.energy === current.energy) {
          score += 5; reasons.push("mesma energia");
        }
        // Accessory patterns
        const accessoryPairs: Record<string, string[]> = {
          "fritadeira": ["cesto", "doseador", "bancada", "escorredor"],
          "fogao": ["forno", "bancada", "exaustor", "prateleira"],
          "fogão": ["forno", "bancada", "exaustor", "prateleira"],
          "forno": ["tabuleiro", "prateleira", "bancada", "exaustor"],
          "maquina": ["cesto", "doseador", "mesa", "prateleira"],
          "máquina": ["cesto", "doseador", "mesa", "prateleira"],
          "lava": ["cesto", "doseador", "mesa", "escorredor"],
          "grelhador": ["bancada", "exaustor", "chapa"],
          "chapa": ["bancada", "exaustor", "grelhador"],
        };
        if (current.type && candidate.type) {
          const accessories = accessoryPairs[current.type];
          if (accessories && accessories.includes(candidate.type)) {
            score += 30; reasons.push(`acessório compatível (${candidate.type})`);
          }
        }
        // Same dimensions boost (fits same workspace)
        if (current.dimensions && candidate.dimensions === current.dimensions) {
          score += 10; reasons.push("mesmas dimensões");
        }
      }

      return { score, reasons };
    }

    let catalogContext = "";
    let allProductAttrs: ProductAttrs[] = [];
    if (fields.includes("upsells") || fields.includes("crosssells")) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("sku, original_title, optimized_title, category, original_price")
        .order("created_at", { ascending: false })
        .limit(500);

      if (allProducts && allProducts.length > 1) {
        allProductAttrs = allProducts.filter((p: any) => p.sku).map(extractAttrs);
      }
    }

    const results: any[] = [];

    // Process products in parallel batches of 5 for speed
    const CONCURRENCY = 5;
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

        // 1. HYBRID RAG: keyword + trigram + family search with reranking
        let knowledgeContext = "";
        const allChunks: any[] = [];

        // Extract product family/line keywords for targeted search
        const titleRaw = product.original_title || "";
        const cleanTitle = titleRaw
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // Detect product family patterns (e.g., "Linha 700", "Cesto 40", "Serie 900")
        const familyPatterns = [
          /linha\s*\d+/i, /line\s*\d+/i, /serie\s*\d+/i, /series\s*\d+/i,
          /cesto\s*\d+/i, /basket\s*\d+/i,
          /\d+\s*litros?/i, /\d+\s*l\b/i,
          /\d+x\d+/i, // dimensions like 40x40
          /\d+\s*bicos?/i, /\d+\s*queimadores?/i,
          /gn\s*\d+\/\d+/i, // gastronorm sizes
          /monof[aá]sic[oa]/i, /trif[aá]sic[oa]/i,
          /g[aá]s/i, /el[eé]tric[oa]/i,
        ];
        const familyMatches: string[] = [];
        for (const pattern of familyPatterns) {
          const match = titleRaw.match(pattern);
          if (match) familyMatches.push(match[0]);
        }
        // Also check category
        const categoryRaw = product.category || "";
        for (const pattern of familyPatterns) {
          const match = categoryRaw.match(pattern);
          if (match && !familyMatches.includes(match[0])) familyMatches.push(match[0]);
        }
        const familyKeywords = familyMatches.length > 0 
          ? familyMatches.join(" ") + " " + cleanTitle.split(" ").filter((w: string) => w.length >= 4).slice(0, 3).join(" ")
          : null;

        // Extract meaningful title words for FTS
        const titleWords = cleanTitle.split(" ").filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
        const titleQuery = titleWords.slice(0, 6).join(" ");

        // Category query
        const categoryQuery = categoryRaw
          .replace(/>/g, " ")
          .replace(/[+\-\/\\()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // SKU query  
        const skuQuery = product.sku || product.supplier_ref || "";

        // Build multiple search queries
        const searchQueries = [
          { query: titleQuery, family: familyKeywords },
          { query: categoryQuery, family: familyKeywords },
          { query: skuQuery, family: null },
        ].filter((q) => q.query.length > 2);

        // Also add a family-only search if we have family keywords
        if (familyKeywords && familyKeywords.length > 3) {
          searchQueries.push({ query: familyKeywords, family: familyKeywords });
        }

        // Run all hybrid searches in parallel
        const searchPromises = searchQueries.map(async ({ query, family }) => {
          try {
            const { data: chunks } = await supabase.rpc("search_knowledge_hybrid", {
              _query: query,
              _workspace_id: workspaceId || null,
              _family_keywords: family,
              _limit: 10,
            });
            return chunks || [];
          } catch (e) {
            // Fallback to old search if hybrid fails
            console.warn(`Hybrid search failed for "${query.substring(0, 30)}", falling back:`, e);
            try {
              const searchArgs: any = { _query: query, _limit: 8 };
              if (workspaceId) searchArgs._workspace_id = workspaceId;
              const { data: chunks } = await supabase.rpc("search_knowledge", searchArgs);
              return (chunks || []).map((c: any) => ({ ...c, match_type: "fts_fallback" }));
            } catch { return []; }
          }
        });
        const searchResults = await Promise.all(searchPromises);
        
        // Deduplicate and merge results
        const seenIds = new Set<string>();
        for (const chunks of searchResults) {
          for (const c of chunks) {
            if (!seenIds.has(c.id)) {
              seenIds.add(c.id);
              allChunks.push(c);
            }
          }
        }

        // Sort by rank and take top results
        allChunks.sort((a: any, b: any) => (b.rank || 0) - (a.rank || 0));

        // AI Reranking: if we have many chunks, use AI to pick the most relevant
        let topChunks = allChunks.slice(0, 12);
        if (topChunks.length > 5) {
          try {
            const rerankPrompt = `Tens ${topChunks.length} excertos de conhecimento e precisas escolher os 6 mais relevantes para otimizar este produto:
Produto: ${product.original_title || "N/A"} | Categoria: ${product.category || "N/A"} | SKU: ${product.sku || "N/A"}
${familyKeywords ? `Família técnica: ${familyKeywords}` : ""}

Excertos:
${topChunks.map((c: any, i: number) => `[${i}] (${c.source_name || "?"}, match: ${c.match_type || "?"}): ${c.content.substring(0, 200)}`).join("\n")}

Devolve os índices dos 6 excertos mais relevantes, priorizando:
1. Informação técnica específica deste produto
2. Informação da mesma família/linha técnica
3. Fichas técnicas e tabelas de preços
4. Informação genérica sobre a categoria`;

            const rerankResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  { role: "system", content: "Responde APENAS com a tool call. Seleciona os excertos mais relevantes." },
                  { role: "user", content: rerankPrompt },
                ],
                tools: [{
                  type: "function",
                  function: {
                    name: "select_chunks",
                    description: "Seleciona os índices dos chunks mais relevantes",
                    parameters: {
                      type: "object",
                      properties: {
                        selected_indices: {
                          type: "array",
                          items: { type: "integer" },
                          description: "Índices dos chunks selecionados (0-based)",
                        },
                        reasoning: { type: "string", description: "Breve justificação" },
                      },
                      required: ["selected_indices"],
                      additionalProperties: false,
                    },
                  },
                }],
                tool_choice: { type: "function", function: { name: "select_chunks" } },
              }),
            });

            if (rerankResponse.ok) {
              const rerankData = await rerankResponse.json();
              const rerankCall = rerankData.choices?.[0]?.message?.tool_calls?.[0];
              if (rerankCall) {
                const { selected_indices, reasoning } = JSON.parse(rerankCall.function.arguments);
                if (Array.isArray(selected_indices) && selected_indices.length > 0) {
                  const reranked = selected_indices
                    .filter((i: number) => i >= 0 && i < topChunks.length)
                    .map((i: number) => topChunks[i]);
                  if (reranked.length >= 3) {
                    topChunks = reranked;
                    console.log(`🧠 AI Reranking: selected ${reranked.length} chunks. Reason: ${reasoning || "N/A"}`);
                  }
                }
              }
            }
          } catch (rerankErr) {
            console.warn("AI reranking failed (non-fatal), using rank-sorted chunks:", rerankErr);
          }
        }

        // Cap at 8 after reranking
        topChunks = topChunks.slice(0, 8);

        if (topChunks.length > 0) {
          const matchTypes = topChunks.map((c: any) => c.match_type || "unknown");
          const matchSummary = [...new Set(matchTypes)].join("+");
          console.log(`✅ Hybrid RAG: ${topChunks.length} chunks (${matchSummary}) from: ${[...new Set(topChunks.map((c: any) => c.source_name))].join(", ")}${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
          const parts = topChunks.map((c: any) => `[${c.source_name}] ${c.content}`).join("\n\n");
          knowledgeContext = `\n\nINFORMAÇÃO DE REFERÊNCIA (conhecimento relevante — hybrid RAG: keywords + fuzzy + família técnica):\n${parts.substring(0, 14000)}`;
        } else {
          console.log(`⚠️ No knowledge found via hybrid search for: "${titleQuery.substring(0, 30)}" (workspace: ${workspaceId || "all"})${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
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
                  waitFor: 2000,
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

        // Build field-specific instructions using per-field prompts
        const getFieldPrompt = (key: string, fallback: string) => {
          return fieldPrompts[`prompt_field_${key}`] || fallback;
        };

        const fieldInstructions: string[] = [];
        if (fields.includes("title")) fieldInstructions.push(`TÍTULO:\n${getFieldPrompt("title", "Um título otimizado (máx 70 chars, com keyword principal)")}`);
        if (fields.includes("description")) fieldInstructions.push(`DESCRIÇÃO COMPLETA:\n${getFieldPrompt("description", "Uma descrição otimizada com: parágrafo comercial + tabela HTML de specs + secção FAQ HTML")}`);
        if (fields.includes("short_description")) fieldInstructions.push(`DESCRIÇÃO CURTA:\n${getFieldPrompt("short_description", "Descrição curta concisa para listagens, máx 160 chars")}`);
        if (fields.includes("meta_title")) fieldInstructions.push(`META TITLE:\n${getFieldPrompt("meta_title", "Meta title SEO (máx 60 chars)")}`);
        if (fields.includes("meta_description")) fieldInstructions.push(`META DESCRIPTION:\n${getFieldPrompt("meta_description", "Meta description SEO (máx 155 chars, com call-to-action)")}`);
        if (fields.includes("seo_slug")) fieldInstructions.push(`SEO SLUG:\n${getFieldPrompt("seo_slug", "SEO slug (url-friendly, lowercase, hífens, sem acentos)")}`);
        if (fields.includes("tags")) fieldInstructions.push(`TAGS:\n${getFieldPrompt("tags", "Tags relevantes (3-6 palavras-chave)")}`);
        if (fields.includes("price")) fieldInstructions.push(`PREÇO:\n${getFieldPrompt("price", "Preço sugerido")}`);
        if (fields.includes("faq")) fieldInstructions.push(`FAQ:\n${getFieldPrompt("faq", "FAQ com 3-5 perguntas e respostas frequentes")}`);
        if (fields.includes("upsells")) fieldInstructions.push(`UPSELLS:\n${getFieldPrompt("upsells", "Sugere 2-4 produtos SUPERIORES do catálogo com SKUs REAIS")}`);
        if (fields.includes("crosssells")) fieldInstructions.push(`CROSS-SELLS:\n${getFieldPrompt("crosssells", "Sugere 2-4 produtos COMPLEMENTARES do catálogo com SKUs REAIS")}`);
        if (fields.includes("image_alt") && product.image_urls && product.image_urls.length > 0) {
          fieldInstructions.push(`ALT TEXT IMAGENS (${product.image_urls.length} imagens):\n${getFieldPrompt("image_alt", "Alt text descritivo e SEO para cada imagem (máx 125 chars)")}`);
        }
        if (fields.includes("category")) {
          const catList = existingCategories.length > 0
            ? `\nCATEGORIAS EXISTENTES: ${existingCategories.join(", ")}`
            : "";
          fieldInstructions.push(`CATEGORIA SUGERIDA:\n${getFieldPrompt("category", "Sugere a melhor categoria no formato 'Categoria > Subcategoria'")}${catList}`);
        }

        const defaultPrompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

${productInfo}${knowledgeContext}${supplierContext}${catalogContext}

INSTRUÇÕES POR CAMPO:
${fieldInstructions.join("\n\n---\n\n")}

REGRAS GLOBAIS:
- Mantém specs técnicas na tabela, texto comercial nos parágrafos
- Se existir informação de referência ou do fornecedor, usa-a
- Para upsells/cross-sells, usa APENAS SKUs do catálogo. NÃO inventes.
- Traduz tudo para português europeu.`;

        const finalPrompt = customPrompt
          ? `${customPrompt}\n\n${productInfo}${knowledgeContext}${supplierContext}${catalogContext}\n\nINSTRUÇÕES POR CAMPO:\n${fieldInstructions.join("\n\n---\n\n")}`
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
        if (fields.includes("image_alt") && product.image_urls && product.image_urls.length > 0) {
          toolProperties.image_alt_texts = {
            type: "array",
            description: "Alt text SEO para cada imagem do produto, na mesma ordem",
            items: {
              type: "object",
              properties: { url: { type: "string" }, alt_text: { type: "string" } },
              required: ["url", "alt_text"],
            },
          };
          requiredFields.push("image_alt_texts");
        }
        if (fields.includes("category")) {
          toolProperties.suggested_category = { type: "string", description: "Categoria sugerida no formato 'Categoria > Subcategoria'" };
          requiredFields.push("suggested_category");
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
            throw new Error("Limite de pedidos excedido. Tente novamente mais tarde.");
          }
          if (status === 402) {
            await supabase.from("products").update({ status: "pending" }).in("id", productIds);
            throw new Error("Créditos insuficientes. Adicione créditos ao workspace.");
          }
          const errText = await aiResponse.text();
          console.error("AI error:", status, errText);
          await supabase.from("products").update({ status: "error" }).eq("id", product.id);
          return { id: product.id, status: "error" as const, error: errText };
        }

        const aiData = await aiResponse.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
          await supabase.from("products").update({ status: "error" }).eq("id", product.id);
          return { id: product.id, status: "error" as const, error: "No tool call in response" };
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
        if (optimized.image_alt_texts) updateData.image_alt_texts = optimized.image_alt_texts;
        if (optimized.suggested_category) updateData.category = optimized.suggested_category;

        const { error: updateError } = await supabase
          .from("products")
          .update(updateData)
          .eq("id", product.id);

        if (updateError) {
          console.error("Update error:", updateError);
          return { id: product.id, status: "error" as const, error: updateError.message };
        }

        // Will return success after logging below

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

        return { id: product.id, status: "optimized" as const };
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
