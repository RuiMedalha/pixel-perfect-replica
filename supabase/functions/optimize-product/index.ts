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
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { productIds, fieldsToOptimize, modelOverride, workspaceId, phase, skipKnowledge, skipScraping, skipReranking } = await req.json();
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return new Response(JSON.stringify({ error: "productIds é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase-based field mapping
    const PHASE_FIELDS: Record<number, string[]> = {
      1: ["title", "description", "short_description", "tags", "category"],
      2: ["meta_title", "meta_description", "seo_slug", "faq", "image_alt"],
      3: ["price", "upsells", "crosssells"],
    };

    let fields: string[];
    if (phase && PHASE_FIELDS[phase]) {
      // Phase mode: use phase fields, intersected with fieldsToOptimize if provided
      const phaseFields = PHASE_FIELDS[phase];
      fields = fieldsToOptimize
        ? phaseFields.filter((f: string) => fieldsToOptimize.includes(f))
        : phaseFields;
      console.log(`🔄 Phase ${phase}: optimizing fields [${fields.join(", ")}]`);
    } else {
      fields = fieldsToOptimize || [
        "title", "description", "short_description",
        "meta_title", "meta_description", "seo_slug", "tags", "price", "faq",
        "upsells", "crosssells", "image_alt", "category"
      ];
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

    // Fetch user's optimization prompt from settings
    const { data: promptSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "optimization_prompt")
      .maybeSingle();

    const customPrompt = promptSetting?.value || null;

    // Fetch per-field custom prompts + description template
    const fieldPromptKeys = [
      "prompt_field_title", "prompt_field_description", "prompt_field_short_description",
      "prompt_field_meta_title", "prompt_field_meta_description", "prompt_field_seo_slug",
      "prompt_field_tags", "prompt_field_price", "prompt_field_faq",
      "prompt_field_upsells", "prompt_field_crosssells", "prompt_field_image_alt",
      "prompt_field_category", "description_template",
    ];
    const { data: fieldPromptSettings } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", fieldPromptKeys);
    
    const fieldPrompts: Record<string, string> = {};
    let descriptionTemplate: string | null = null;
    (fieldPromptSettings || []).forEach((s: any) => {
      if (s.key === "description_template" && s.value) {
        descriptionTemplate = s.value;
      } else if (s.value) {
        fieldPrompts[s.key] = s.value;
      }
    });

    // Fetch existing categories for AI context
    // === SEMANTIC SYNONYM MAP for category matching ===
    const CATEGORY_SYNONYMS: Record<string, string[]> = {
      "gyros": ["kebab", "döner", "doner", "shawarma", "churrasco vertical"],
      "kebab": ["gyros", "döner", "doner", "shawarma", "churrasco vertical"],
      "fritadeira": ["fryer", "deep fryer", "frigideira industrial"],
      "forno": ["oven", "forno convetor", "forno combinado", "combi"],
      "fogão": ["fogao", "cooker", "placa", "cooking range"],
      "grelhador": ["grill", "char grill", "chapa", "plancha", "griddle"],
      "chapa": ["plancha", "griddle", "grelhador", "grill"],
      "vitrine": ["expositor", "display", "montra", "showcase"],
      "frigorifico": ["frigorífico", "refrigerador", "fridge", "refrigeration", "armário refrigerado"],
      "congelador": ["freezer", "ultracongelador", "abatedor", "blast chiller"],
      "lava-louça": ["lava louça", "máquina de lavar", "dishwasher", "lavagem"],
      "microondas": ["micro-ondas", "microwave"],
      "salamandra": ["salamander", "gratinador"],
      "banho-maria": ["banho maria", "bain marie", "aquecedor"],
      "cortador": ["slicer", "fatiador", "cortadora"],
      "batedeira": ["mixer", "misturadora", "amassadeira"],
      "tostadeira": ["torradeira", "toaster", "tostador"],
      "máquina de gelo": ["ice maker", "fabricador de gelo", "produtora de gelo"],
      "máquina de café": ["coffee machine", "cafeteira", "espresso"],
      "pizza": ["forno de pizza", "pizza oven"],
      "wok": ["wok range", "fogão wok"],
      "pasta": ["cozedor de massa", "pasta cooker"],
      "arroz": ["rice cooker", "cozedor de arroz"],
    };

    function normalizeForCategoryMatch(text: string): string {
      return text.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function findSemanticCategory(productTitle: string, productCategory: string, existingCats: string[]): string[] {
      const normalized = normalizeForCategoryMatch(`${productTitle} ${productCategory}`);
      const words = normalized.split(" ").filter(w => w.length >= 3);
      
      // Find matching categories using synonyms
      const matchedCats: { cat: string; score: number }[] = [];
      
      for (const cat of existingCats) {
        const normalizedCat = normalizeForCategoryMatch(cat);
        let score = 0;
        
        // Direct word match
        for (const word of words) {
          if (normalizedCat.includes(word)) score += 10;
        }
        
        // Synonym match
        for (const word of words) {
          const synonyms = CATEGORY_SYNONYMS[word] || [];
          for (const [key, syns] of Object.entries(CATEGORY_SYNONYMS)) {
            if (syns.includes(word) || key === word) {
              const allTerms = [key, ...syns];
              for (const term of allTerms) {
                if (normalizedCat.includes(normalizeForCategoryMatch(term))) {
                  score += 8;
                }
              }
            }
          }
        }

        // Bonus for hierarchical categories (more specific = better)
        if (cat.includes(">") && score > 0) score += 5;
        
        // Bonus for subcategory parts matching product words
        if (cat.includes(">")) {
          const parts = cat.split(">").map(p => normalizeForCategoryMatch(p.trim()));
          const lastPart = parts[parts.length - 1]; // most specific part
          for (const word of words) {
            if (lastPart.includes(word)) score += 6; // subcategory match is valuable
          }
        }
        
        if (score > 0) matchedCats.push({ cat, score });
      }
      
      return matchedCats
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(m => m.cat);
    }

    let existingCategories: string[] = [];
    if (fields.includes("category")) {
      // 1. Fetch from categories table (proper taxonomy with hierarchy)
      const { data: catTableData } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .order("sort_order", { ascending: true });

      if (catTableData && catTableData.length > 0) {
        // Build hierarchy: "Parent > Child" format
        const catById = new Map<string, any>(catTableData.map((c: any) => [c.id, c]));
        const buildPath = (cat: any): string => {
          const parts: string[] = [cat.name];
          let current = cat;
          while (current.parent_id) {
            const parent = catById.get(current.parent_id);
            if (!parent) break;
            parts.unshift(parent.name);
            current = parent;
          }
          return parts.join(" > ");
        };

        const catPaths = new Set<string>();
        for (const cat of catTableData) {
          catPaths.add(buildPath(cat));
          // Also add individual names for fuzzy matching
          catPaths.add(cat.name);
        }
        existingCategories = Array.from(catPaths).sort();
      }

      // 2. Also include unique categories from products (for backward compat)
      const { data: catData } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null);
      (catData || []).forEach((p: any) => { 
        if (p.category && !existingCategories.includes(p.category)) {
          existingCategories.push(p.category);
        }
      });
      existingCategories.sort();
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
      models: string[];          // compatible models mentioned: "ht", "lp", "gn 1/1", etc.
      brand: string | null;
      raw: any;
    }

    function extractAttrs(p: any): ProductAttrs {
      const title = (p.optimized_title || p.original_title || "").toLowerCase();
      const desc = (p.original_description || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      const combined = `${title} ${cat} ${desc}`;

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

      // Extract compatible models/series (HT, LP, GN 1/1, etc.)
      const models: string[] = [];
      const modelPatterns = [
        /\b(ht)\b/gi, /\b(lp)\b/gi, /\b(hp)\b/gi, /\b(hr)\b/gi,
        /\b(gn\s*\d+\/\d+)\b/gi, /\b(gn\d+\/\d+)\b/gi,
        /\bp\/?\s*mod(?:elo)?s?\s*\.?\s*([a-z0-9\-]+(?:\s*[-\/,]\s*[a-z0-9\-]+)*)/gi,
        /\bmod(?:elo)?s?\s*\.?\s*([a-z0-9\-]+(?:\s*[-\/,]\s*[a-z0-9\-]+)*)/gi,
      ];
      for (const pat of modelPatterns) {
        let m;
        while ((m = pat.exec(combined)) !== null) {
          const vals = (m[1] || m[0]).split(/[\s,\/\-]+/).filter(v => v.length >= 2);
          for (const v of vals) {
            const norm = v.trim().toLowerCase().replace(/\s+/g, "");
            if (norm && !models.includes(norm)) models.push(norm);
          }
        }
      }

      // Extract product type
      const typePatterns = [
        "depurador", "descalcificador", "amaciador", "abrilhantador", "detergente", "bomba",
        "fritadeira", "fogao", "fogão", "forno", "bancada", "mesa", "armario", "armário",
        "maquina de lavar", "máquina de lavar", "lava-louça", "lava louça",
        "maquina", "máquina", "lava",
        "frigorifico", "frigorífico", "vitrine", "exaustor",
        "grelhador", "chapa", "basculante", "marmita", "batedeira", "cortador", "ralador",
        "microondas", "tostadeira", "torradeira", "salamandra", "abatedor", "ultracongelador",
        "dispensador", "doseador", "cesto", "tabuleiro", "prateleira", "escorredor",
        "cuba", "torneira", "pia", "suporte", "carro",
      ];
      let type: string | null = null;
      for (const t of typePatterns) {
        if (combined.includes(t)) { type = t; break; }
      }
      // Normalize compound types
      if (type === "maquina de lavar" || type === "máquina de lavar" || type === "lava-louça" || type === "lava louça") {
        type = "lava";
      }

      return {
        sku: p.sku || "",
        title: p.optimized_title || p.original_title || "Sem título",
        category: p.category || "",
        price: parseFloat(p.original_price) || 0,
        line, energy, capacity, dimensions, type, models, brand: null, raw: p,
      };
    }

    function computeCompatibility(current: ProductAttrs, candidate: ProductAttrs, mode: "upsell" | "crosssell"): { score: number; reasons: string[] } {
      if (candidate.sku === current.sku) return { score: -1, reasons: [] };
      let score = 0;
      const reasons: string[] = [];

      // === MODEL COMPATIBILITY: if product mentions models, boost candidates that ARE those models or mention same models ===
      const sharedModels = current.models.filter(m => candidate.models.includes(m));
      if (sharedModels.length > 0) {
        score += 20; reasons.push(`modelo compatível (${sharedModels.join(", ")})`);
      }
      // If current mentions a model and candidate title/type matches that model name
      for (const model of current.models) {
        if (candidate.title.toLowerCase().includes(model)) {
          score += 25; reasons.push(`produto modelo ${model.toUpperCase()}`);
        }
      }
      // If candidate mentions a model and current title matches it
      for (const model of candidate.models) {
        if (current.title.toLowerCase().includes(model)) {
          score += 15; reasons.push(`compatível com ${model.toUpperCase()}`);
        }
      }

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
        // For accessories: upsell the machine they work with
        const accessoryToMachine: Record<string, string[]> = {
          "depurador": ["lava", "maquina", "máquina"],
          "descalcificador": ["lava", "maquina", "máquina"],
          "abrilhantador": ["lava", "maquina", "máquina"],
          "detergente": ["lava", "maquina", "máquina"],
          "bomba": ["lava", "maquina", "máquina"],
          "cesto": ["lava", "maquina", "máquina", "fritadeira"],
          "doseador": ["lava", "maquina", "máquina"],
          "tabuleiro": ["forno"],
          "prateleira": ["forno", "frigorifico", "frigorífico", "armario", "armário"],
          "escorredor": ["lava", "fritadeira"],
        };
        if (current.type && candidate.type) {
          const machines = accessoryToMachine[current.type];
          if (machines && machines.includes(candidate.type)) {
            score += 35; reasons.push(`máquina compatível (${candidate.type})`);
          }
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
        // Accessory patterns - expanded with dishwasher ecosystem
        const accessoryPairs: Record<string, string[]> = {
          "fritadeira": ["cesto", "doseador", "bancada", "escorredor", "prateleira"],
          "fogao": ["forno", "bancada", "exaustor", "prateleira", "salamandra"],
          "fogão": ["forno", "bancada", "exaustor", "prateleira", "salamandra"],
          "forno": ["tabuleiro", "prateleira", "bancada", "exaustor", "carro"],
          "maquina": ["cesto", "doseador", "mesa", "prateleira", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "escorredor"],
          "máquina": ["cesto", "doseador", "mesa", "prateleira", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "escorredor"],
          "lava": ["cesto", "doseador", "mesa", "escorredor", "depurador", "descalcificador", "abrilhantador", "detergente", "bomba", "suporte", "prateleira"],
          "grelhador": ["bancada", "exaustor", "chapa"],
          "chapa": ["bancada", "exaustor", "grelhador"],
          // Accessories should cross-sell with the machines AND with other accessories
          "depurador": ["lava", "maquina", "máquina", "cesto", "abrilhantador", "detergente", "bomba", "doseador", "escorredor"],
          "descalcificador": ["lava", "maquina", "máquina", "cesto", "abrilhantador", "detergente", "bomba"],
          "abrilhantador": ["lava", "maquina", "máquina", "depurador", "detergente", "bomba", "doseador"],
          "detergente": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "bomba", "doseador"],
          "bomba": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "detergente", "doseador"],
          "cesto": ["lava", "maquina", "máquina", "escorredor", "suporte", "prateleira"],
          "doseador": ["lava", "maquina", "máquina", "depurador", "abrilhantador", "detergente"],
          "tabuleiro": ["forno", "carro", "prateleira"],
          "escorredor": ["lava", "maquina", "máquina", "cesto"],
          "carro": ["forno", "tabuleiro"],
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
        // Text-based model match in title: if current says "para modelos HT" and candidate has "HT" in title
        const titleLower = candidate.title.toLowerCase();
        for (const model of current.models) {
          if (titleLower.includes(model) && current.type !== candidate.type) {
            score += 20; reasons.push(`nome contém modelo ${model.toUpperCase()}`);
          }
        }
      }

      return { score, reasons };
    }

    let catalogContext = "";
    let allProductAttrs: ProductAttrs[] = [];
    if (fields.includes("upsells") || fields.includes("crosssells")) {
      const { data: allProducts } = await supabase
        .from("products")
        .select("sku, original_title, optimized_title, original_description, category, original_price")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (allProducts && allProducts.length > 1) {
        allProductAttrs = allProducts.filter((p: any) => p.sku).map(extractAttrs);
      }
    }

    const results: any[] = [];

    // Process products in parallel batches of 2 (reduced to avoid WORKER_LIMIT)
    const CONCURRENCY = 2;
    for (let batchStart = 0; batchStart < products.length; batchStart += CONCURRENCY) {
      const batch = products.slice(batchStart, batchStart + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(async (product) => {
      try {
        // === SAVE VERSION BEFORE OPTIMIZING (keep max 3) — only in phase 1 or no-phase mode ===
        if (!phase || phase === 1) if (product.optimized_title || product.optimized_description) {
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
        // OPTIMIZATION: Skip RAG/scraping in phases 2 and 3 — context already available from phase 1
        const isLaterPhase = phase && phase > 1;
        let knowledgeContext = "";
        const allChunks: any[] = [];
        let topChunks: any[] = [];
        let ragMatchTypeCounts: Record<string, number> = {};

        if (isLaterPhase) {
          console.log(`⏭️ Phase ${phase}: skipping RAG (context from phase 1 already in product data)`);
        } else if (skipKnowledge) {
          console.log("⏭️ Knowledge base skipped (skipKnowledge=true)");
        } else {

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
        topChunks = allChunks.slice(0, 12);
        if (topChunks.length > 5 && !skipReranking) {
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
        } else if (topChunks.length > 5 && skipReranking) {
          console.log("⏭️ AI Reranking skipped (skipReranking=true), using top 6 by rank");
          topChunks = topChunks.slice(0, 6);
        }

        // Cap at 8 after reranking
        topChunks = topChunks.slice(0, 8);

        // Count match types for RAG metrics
        ragMatchTypeCounts = {};
        if (topChunks.length > 0) {
          topChunks.forEach((c: any) => {
            const mt = c.match_type || "unknown";
            ragMatchTypeCounts[mt] = (ragMatchTypeCounts[mt] || 0) + 1;
          });
          const matchSummary = Object.entries(ragMatchTypeCounts).map(([k, v]) => `${k}:${v}`).join("+");
          console.log(`✅ Hybrid RAG: ${topChunks.length} chunks (${matchSummary}) from: ${[...new Set(topChunks.map((c: any) => c.source_name))].join(", ")}${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
          const parts = topChunks.map((c: any) => `[${c.source_name}] ${c.content}`).join("\n\n");
          knowledgeContext = `\n\nINFORMAÇÃO DE REFERÊNCIA (conhecimento relevante — hybrid RAG: keywords + fuzzy + família técnica):\n${parts.substring(0, 14000)}`;
        } else {
          console.log(`⚠️ No knowledge found via hybrid search for: "${titleQuery.substring(0, 30)}" (workspace: ${workspaceId || "all"})${familyKeywords ? ` | Family: ${familyKeywords}` : ""}`);
        }
        } // end of skipKnowledge else block

        // 2. Auto-scrape supplier page by SKU
        let supplierContext = "";
        if (isLaterPhase) {
          console.log(`⏭️ Phase ${phase}: skipping supplier scraping (already done in phase 1)`);
        } else if (skipScraping) {
          console.log("⏭️ Supplier scraping skipped (skipScraping=true)");
        } else if (FIRECRAWL_API_KEY && product.sku && product.sku.length > 2) {
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

        // Fetch parent product context for variations
        let parentContext = "";
        let parentProduct: any = null;
        if (product.product_type === "variation" && product.parent_product_id) {
          const { data: parent } = await supabase
            .from("products")
            .select("*")
            .eq("id", product.parent_product_id)
            .maybeSingle();
          if (parent) {
            parentProduct = parent;
            parentContext = `\n\nPRODUTO PAI (variable):
- Título: ${parent.optimized_title || parent.original_title || "N/A"}
- Descrição: ${(parent.optimized_description || parent.original_description || "").substring(0, 1000) || "N/A"}
- Descrição Curta: ${parent.optimized_short_description || parent.short_description || "N/A"}
- Categoria: ${parent.category || "N/A"}
- Atributos do pai: ${JSON.stringify(parent.attributes || [])}
IMPORTANTE: Esta é uma VARIAÇÃO. Mantém consistência com o produto pai. Adapta o título e descrição com o sufixo do atributo específico desta variação.`;
          }
        }

        // For variable products, add info about variations
        let variationsContext = "";
        if (product.product_type === "variable") {
          const { data: variations } = await supabase
            .from("products")
            .select("sku, original_title, attributes")
            .eq("parent_product_id", product.id)
            .limit(50);
          if (variations && variations.length > 0) {
            variationsContext = `\n\nEste é um produto VARIÁVEL com ${variations.length} variações:
${variations.map((v: any) => `- SKU: ${v.sku} | ${v.original_title} | Attrs: ${JSON.stringify(v.attributes || [])}`).join("\n")}
IMPORTANTE: Otimiza o conteúdo BASE que será propagado para todas as variações. Não incluas atributos específicos (cor, tamanho) no título/descrição do pai.`;
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
- Ref. Fornecedor: ${product.supplier_ref || "N/A"}
- Tipo: ${product.product_type || "simple"}
- Atributos: ${JSON.stringify(product.attributes || [])}${parentContext}${variationsContext}${
  (phase === 2 || phase === 3) ? `\n\nDADOS JÁ OTIMIZADOS (Fase anterior):
- Título Otimizado: ${product.optimized_title || "N/A"}
- Descrição Otimizada: ${(product.optimized_description || "").substring(0, 500) || "N/A"}
- Descrição Curta Otimizada: ${product.optimized_short_description || "N/A"}
- Tags: ${(product.tags || []).join(", ") || "N/A"}
- Focus Keywords: ${(product.focus_keyword || []).join(", ") || "N/A"}` : ""}`;

        // === COMPATIBILITY ENGINE: score products for upsell/cross-sell ===
        let productCatalogContext = "";
        if (allProductAttrs.length > 0 && (fields.includes("upsells") || fields.includes("crosssells"))) {
          const currentAttrs = extractAttrs(product);
          
          // Score all candidates
          const upsellCandidates: { attrs: ProductAttrs; score: number; reasons: string[] }[] = [];
          const crosssellCandidates: { attrs: ProductAttrs; score: number; reasons: string[] }[] = [];
          
          for (const candidate of allProductAttrs) {
            if (candidate.sku === currentAttrs.sku) continue;
            
            if (fields.includes("upsells")) {
              const { score, reasons } = computeCompatibility(currentAttrs, candidate, "upsell");
              if (score > 10) upsellCandidates.push({ attrs: candidate, score, reasons });
            }
            if (fields.includes("crosssells")) {
              const { score, reasons } = computeCompatibility(currentAttrs, candidate, "crosssell");
              if (score > 10) crosssellCandidates.push({ attrs: candidate, score, reasons });
            }
          }
          
          // Sort by score and take top
          upsellCandidates.sort((a, b) => b.score - a.score);
          crosssellCandidates.sort((a, b) => b.score - a.score);
          
          const topUpsells = upsellCandidates.slice(0, 10);
          const topCrosssells = crosssellCandidates.slice(0, 10);
          
          const parts: string[] = [];
          if (topUpsells.length > 0) {
            parts.push(`\nPRODUTOS CANDIDATOS A UPSELL (pré-filtrados por compatibilidade técnica — score de confiança):`);
            for (const u of topUpsells) {
              parts.push(`  SKU: ${u.attrs.sku} | ${u.attrs.title} | ${u.attrs.price}€ | Score: ${u.score}/100 | ${u.reasons.join(", ")}`);
            }
          }
          if (topCrosssells.length > 0) {
            parts.push(`\nPRODUTOS CANDIDATOS A CROSS-SELL (pré-filtrados por compatibilidade técnica — score de confiança):`);
            for (const c of topCrosssells) {
              parts.push(`  SKU: ${c.attrs.sku} | ${c.attrs.title} | ${c.attrs.price}€ | Score: ${c.score}/100 | ${c.reasons.join(", ")}`);
            }
          }
          
          if (parts.length > 0) {
            productCatalogContext = `\n${parts.join("\n")}`;
            console.log(`🎯 Compatibility: ${topUpsells.length} upsell candidates (top: ${topUpsells[0]?.score || 0}), ${topCrosssells.length} cross-sell candidates (top: ${topCrosssells[0]?.score || 0})`);
            // Also keep detected attributes for logging
            console.log(`📋 Product attrs: type=${currentAttrs.type}, line=${currentAttrs.line}, energy=${currentAttrs.energy}, capacity=${currentAttrs.capacity}, dims=${currentAttrs.dimensions}`);
          }
        }
        
        // Use compatibility-filtered catalog instead of raw dump
        catalogContext = productCatalogContext;

        // Build field-specific instructions using per-field prompts
        // Default prompts match the frontend defaults in useFieldPrompts.ts
        const DEFAULT_FIELD_PROMPTS: Record<string, string> = {
          title: `Gera um título otimizado para SEO (máx 70 chars).
CONTEXTO: Estes são equipamentos PROFISSIONAIS para hotelaria, restauração, cozinhas industriais e bares.
REGRAS OBRIGATÓRIAS:
- Inclui a keyword principal no início
- NÃO incluas o nome da marca no título (ex: NÃO "Zanussi Fritadeira", NÃO "Lizotel Caixa", SIM "Fritadeira a Gás Linha 700")
- NÃO incluas códigos EAN, códigos de barras, referências numéricas de fornecedor ou SKUs no título
- NÃO incluas quantidades de embalagem no título (ex: NÃO "Pack 6 unidades")
- Inclui linha/série se aplicável (ex: "Linha 700", "Linha 900")
- Inclui capacidade/dimensão se relevante (ex: "40x40", "4 Bicos", "8 Litros")
- Mantém o tipo de energia se aplicável (Gás, Elétrico, etc.)
- Nunca uses palavras genéricas como "Profissional" sem contexto técnico`,
          description: `Gera uma descrição otimizada com ESTRUTURA OBRIGATÓRIA:
CONTEXTO: Estes são equipamentos PROFISSIONAIS para hotelaria, restauração, cozinhas industriais e bares.
1. PARÁGRAFO COMERCIAL (150-250 chars): Benefícios, aplicações, diferenciais. Sem dados técnicos. NÃO menciones a marca.
2. TABELA HTML de specs: <table> com TODAS as características técnicas (dimensões, peso, material, potência, voltagem, etc.)
3. FAQ HTML: 3-5 perguntas frequentes em <details><summary>Pergunta</summary><p>Resposta</p></details>

REGRAS OBRIGATÓRIAS:
- NÃO incluas o nome da marca no texto comercial — foca no equipamento e nas suas capacidades
- NÃO incluas códigos EAN, códigos de barras ou referências no texto comercial
- NÃO mistures dados técnicos no texto comercial
- Menciona aplicações práticas (restaurante, hotel, pastelaria, bar, etc.)
- Inclui benefícios de eficiência energética se aplicável
- Menciona conformidade com normas (CE, HACCP) se relevante`,
          short_description: `Gera uma descrição curta (máx 160 chars) para listagens.
CONTEXTO: Equipamento profissional para hotelaria, restauração, cozinhas industriais e bares.
REGRAS OBRIGATÓRIAS:
- Resumo conciso focado no benefício principal
- NÃO incluas o nome da marca
- NÃO incluas códigos EAN ou referências
- Inclui 1-2 specs chave (dimensão ou capacidade)
- Inclui tipo de energia se aplicável
- Tom profissional e direto`,
          meta_title: `Gera meta title SEO (máx 60 chars).
CONTEXTO: Equipamento profissional para hotelaria, restauração e bares.
REGRAS OBRIGATÓRIAS:
- Keyword principal no início
- Inclui "Comprar" ou "Preço" para intenção comercial
- NÃO incluas o nome da marca — foca na linha/série e tipo de equipamento
- NÃO incluas códigos EAN ou referências
- Termina com separador e nome da loja se couber`,
          meta_description: `Gera meta description SEO (máx 155 chars).
REGRAS OBRIGATÓRIAS:
- Inclui call-to-action (ex: "Encomende já", "Entrega rápida")
- Menciona 1-2 benefícios chave
- Inclui preço ou "Melhor preço" se aplicável
- NÃO incluas o nome da marca
- Usa linguagem que gere cliques`,
          seo_slug: `Gera um slug SEO-friendly.
REGRAS OBRIGATÓRIAS:
- Lowercase, sem acentos, com hífens
- Inclui keyword principal + tipo + linha
- NÃO incluas marca no slug
- NÃO incluas códigos EAN ou referências no slug
- Máx 5-7 palavras
- Exemplo: fritadeira-gas-linha-700-8-litros`,
          tags: `Gera 4-8 tags relevantes.
REGRAS OBRIGATÓRIAS:
- Inclui categoria principal (ex: "fritadeira")
- Inclui tipo de energia (ex: "gás", "elétrico")
- Inclui linha/série (ex: "linha 700")
- Inclui aplicação (ex: "restaurante", "hotelaria")
- NÃO incluas códigos EAN ou referências como tags
- Inclui sinónimos de pesquisa comuns`,
          price: `Sugere um preço otimizado.
REGRAS:
- Mantém o preço original se parecer correto para o mercado
- Ajusta ligeiramente se for claramente abaixo ou acima do mercado
- Considera o posicionamento do produto (entrada, médio, premium)`,
          faq: `Gera 3-5 FAQs sobre o produto.
REGRAS OBRIGATÓRIAS:
- Pergunta sobre dimensões/espaço necessário
- Pergunta sobre instalação/requisitos (gás, electricidade, água)
- Pergunta sobre manutenção/limpeza
- Pergunta sobre garantia/assistência se aplicável
- Pergunta sobre acessórios incluídos/compatíveis
- Respostas detalhadas e úteis (não genéricas)`,
          upsells: `Sugere 2-4 produtos SUPERIORES do catálogo como upsell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: mesmo tipo mas maior capacidade, mesma linha mas modelo superior
- NÃO sugiras produtos de categorias completamente diferentes
- NÃO incluas o próprio produto`,
          crosssells: `Sugere 2-4 produtos COMPLEMENTARES do catálogo como cross-sell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: acessórios, produtos da mesma linha/família, consumíveis
- Procura produtos que formem uma "estação de trabalho" completa
- NÃO sugiras produtos redundantes`,
          image_alt: `Gera alt text SEO para cada imagem do produto (máx 125 chars cada).
REGRAS OBRIGATÓRIAS:
- Descritivo e relevante para o produto
- Inclui keyword principal + linha
- NÃO incluas a marca no alt text
- Inclui ângulo/perspetiva se possível
- Não comeces com "Imagem de" — sê direto`,
          category: `Analisa o produto e sugere a melhor categoria e subcategoria.
REGRAS OBRIGATÓRIAS:
- Usa o formato "Categoria > Subcategoria" (ex: "Cozinha > Fritadeiras")
- Se a categoria atual parecer incorreta, sugere uma melhor
- Prioriza categorias que já existam no catálogo
- NÃO cries categorias novas`,
        };

        const getFieldPrompt = (key: string, fallback: string) => {
          return fieldPrompts[`prompt_field_${key}`] || DEFAULT_FIELD_PROMPTS[key] || fallback;
        };

        const fieldInstructions: string[] = [];
        if (fields.includes("title")) fieldInstructions.push(`TÍTULO:\n${getFieldPrompt("title", "Um título otimizado")}`);
        if (fields.includes("description")) {
          let descPrompt = getFieldPrompt("description", "Uma descrição otimizada");
          if (descriptionTemplate) {
            descPrompt += `\n\nTEMPLATE DE ESTRUTURA OBRIGATÓRIO — segue EXATAMENTE esta estrutura, substituindo as variáveis {{...}} pelo conteúdo gerado:\n${descriptionTemplate}`;
          }
          fieldInstructions.push(`DESCRIÇÃO COMPLETA:\n${descPrompt}`);
        }
        if (fields.includes("short_description")) fieldInstructions.push(`DESCRIÇÃO CURTA:\n${getFieldPrompt("short_description", "Descrição curta concisa")}`);
        if (fields.includes("meta_title")) fieldInstructions.push(`META TITLE:\n${getFieldPrompt("meta_title", "Meta title SEO")}`);
        if (fields.includes("meta_description")) fieldInstructions.push(`META DESCRIPTION:\n${getFieldPrompt("meta_description", "Meta description SEO")}`);
        if (fields.includes("seo_slug")) fieldInstructions.push(`SEO SLUG:\n${getFieldPrompt("seo_slug", "SEO slug")}`);
        if (fields.includes("tags")) fieldInstructions.push(`TAGS:\n${getFieldPrompt("tags", "Tags relevantes")}`);
        
        if (fields.includes("faq")) fieldInstructions.push(`FAQ:\n${getFieldPrompt("faq", "FAQ com 3-5 perguntas")}`);
        if (fields.includes("upsells")) fieldInstructions.push(`UPSELLS (escolhe dos candidatos pré-filtrados acima):\n${getFieldPrompt("upsells", "Sugere upsells com SKUs REAIS")}`);
        if (fields.includes("crosssells")) fieldInstructions.push(`CROSS-SELLS (escolhe dos candidatos pré-filtrados acima):\n${getFieldPrompt("crosssells", "Sugere cross-sells com SKUs REAIS")}`);
        if (fields.includes("image_alt") && product.image_urls && product.image_urls.length > 0) {
          fieldInstructions.push(`ALT TEXT IMAGENS (${product.image_urls.length} imagens):\n${getFieldPrompt("image_alt", "Alt text descritivo")}`);
        }
        if (fields.includes("category")) {
          // Use semantic matching to find best candidate categories
          const semanticMatches = findSemanticCategory(
            product.original_title || "",
            product.category || product.original_description || "",
            existingCategories
          );
          // Prefer hierarchical categories (with ">") for better context
          const hierarchicalCats = existingCategories.filter(c => c.includes(">"));
          const catList = existingCategories.length > 0
            ? `\nCATEGORIAS DISPONÍVEIS (usa APENAS uma destas, NÃO inventes novas):\n${(hierarchicalCats.length > 0 ? hierarchicalCats : existingCategories).join("\n")}`
            : "";
          const semanticHint = semanticMatches.length > 0
            ? `\nCATEGORIAS MAIS RELEVANTES (por análise semântica): ${semanticMatches.join(", ")}`
            : "";
          const noCatHint = !product.category 
            ? "\nATENÇÃO: Este produto NÃO tem categoria atribuída. Analisa o título, descrição e especificações técnicas para sugerir a categoria mais adequada da lista."
            : "";
          fieldInstructions.push(`CATEGORIA SUGERIDA:\n${getFieldPrompt("category", "Analisa o produto e sugere a melhor categoria EXISTENTE.")}${catList}${semanticHint}${noCatHint}`);
        }

        const defaultPrompt = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

${productInfo}${knowledgeContext}${supplierContext}${catalogContext}

INSTRUÇÕES POR CAMPO:
${fieldInstructions.join("\n\n---\n\n")}

REGRAS GLOBAIS (MÁXIMA PRIORIDADE — violações resultam em rejeição):
- NUNCA incluas o nome da marca/fabricante (ex: LIZOTEL, Zanussi, Sammic, Fagor, Electrolux, etc.) em NENHUM campo de texto (título, descrição, meta title, meta description, slug, tags, alt text). A marca é tratada separadamente como atributo técnico.
- NUNCA incluas códigos EAN, GTIN, códigos de barras, referências numéricas de fornecedor ou SKUs no título ou na descrição curta.
- NUNCA incluas quantidades de embalagem (ex: "Pack 6", "caixa de 12") no título.
- Mantém specs técnicas na tabela, texto comercial nos parágrafos
- Se existir informação de referência ou do fornecedor, usa-a
- Para upsells/cross-sells, usa APENAS SKUs do catálogo. NÃO inventes.
- Traduz tudo para português europeu.
- Gera SEMPRE 1 a 3 focus keywords SEO principais (a primeira é a principal). Devem ser keywords de pesquisa reais que um comprador usaria no Google.`;

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
            description: "SKUs reais de produtos superiores sugeridos como upsell (apenas os SKUs, sem títulos)",
            items: { type: "string" },
          };
          requiredFields.push("upsell_skus");
        }
        if (fields.includes("crosssells")) {
          toolProperties.crosssell_skus = {
            type: "array",
            description: "SKUs reais de produtos complementares sugeridos como cross-sell (apenas os SKUs, sem títulos)",
            items: { type: "string" },
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
          toolProperties.suggested_category = { type: "string", description: "Categoria sugerida no formato 'Categoria > Subcategoria'. DEVE ser uma das categorias existentes fornecidas na lista. Se a melhor correspondência for uma subcategoria, usa o caminho completo (ex: 'Equipamento > Fornos'). Se o produto não tiver categoria, analisa o título e descrição para sugerir a mais adequada." };
          requiredFields.push("suggested_category");
        }
        // Only generate focus keywords in phase 1 (or when no phase is set)
        if (!phase || phase === 1) {
          toolProperties.focus_keywords = {
            type: "array",
            description: "1 a 3 focus keywords SEO principais para este produto, ordenadas por relevância. A primeira é a principal.",
            items: { type: "string" },
          };
          requiredFields.push("focus_keywords");
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

        // === VALIDATE upsell/crosssell SKUs against real DB (SKU-only format) ===
        if (optimized.upsell_skus && Array.isArray(optimized.upsell_skus) && optimized.upsell_skus.length > 0) {
          // Normalize: handle both string[] and {sku}[] formats for backward compat
          const rawSkus = optimized.upsell_skus.map((u: any) => typeof u === "string" ? u : u.sku).filter(Boolean);
          if (rawSkus.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku")
              .in("sku", rawSkus);
            const validSet = new Set((validProducts || []).map((p: any) => p.sku));
            const before = rawSkus.length;
            optimized.upsell_skus = rawSkus.filter((s: string) => validSet.has(s) && s !== product.sku);
            console.log(`Upsells validated: ${optimized.upsell_skus.length}/${before} SKUs are real`);
          }
        }
        if (optimized.crosssell_skus && Array.isArray(optimized.crosssell_skus) && optimized.crosssell_skus.length > 0) {
          const rawSkus = optimized.crosssell_skus.map((u: any) => typeof u === "string" ? u : u.sku).filter(Boolean);
          if (rawSkus.length > 0) {
            const { data: validProducts } = await supabase
              .from("products")
              .select("sku")
              .in("sku", rawSkus);
            const validSet = new Set((validProducts || []).map((p: any) => p.sku));
            const before = rawSkus.length;
            optimized.crosssell_skus = rawSkus.filter((s: string) => validSet.has(s) && s !== product.sku);
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
        
        if (optimized.faq) updateData.faq = optimized.faq;
        if (optimized.upsell_skus) updateData.upsell_skus = optimized.upsell_skus;
        if (optimized.crosssell_skus) updateData.crosssell_skus = optimized.crosssell_skus;
        if (optimized.image_alt_texts) updateData.image_alt_texts = optimized.image_alt_texts;
        if (optimized.suggested_category) updateData.suggested_category = optimized.suggested_category;
        if (optimized.focus_keywords && Array.isArray(optimized.focus_keywords) && optimized.focus_keywords.length > 0) {
          updateData.focus_keyword = optimized.focus_keywords.slice(0, 5);
        }

        const { error: updateError } = await supabase
          .from("products")
          .update(updateData)
          .eq("id", product.id);

        if (updateError) {
          console.error("Update error:", updateError);
          return { id: product.id, status: "error" as const, error: updateError.message };
        }

        // === PROPAGATE TO VARIATIONS if this is a variable product ===
        if (product.product_type === "variable") {
          const { data: variations } = await supabase
            .from("products")
            .select("id, sku, attributes, original_title, category")
            .eq("parent_product_id", product.id);

          if (variations && variations.length > 0) {
            // === CATEGORY CONCORDANCE ANALYSIS ===
            // Check if variations have a more concordant category than the parent
            const parentCategory = updateData.suggested_category || product.category || "";
            const variationCategories = variations
              .map((v: any) => v.category)
              .filter((c: string | null) => c && c.trim() !== "");
            
            let finalCategory = parentCategory;
            let categoryChanged = false;
            
            if (variationCategories.length > 0) {
              // Count category occurrences among variations
              const catCounts: Record<string, number> = {};
              for (const cat of variationCategories) {
                catCounts[cat!] = (catCounts[cat!] || 0) + 1;
              }
              
              // Find the most common category among variations
              const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
              const mostCommonCat = sortedCats[0][0];
              const mostCommonCount = sortedCats[0][1];
              
              // If majority of variations agree on a different category, adopt it
              if (mostCommonCat && mostCommonCat !== parentCategory && mostCommonCount > variationCategories.length / 2) {
                // Verify the category exists in the system
                if (existingCategories.includes(mostCommonCat)) {
                  console.log(`🔄 Category concordance: variations prefer "${mostCommonCat}" (${mostCommonCount}/${variationCategories.length}) over parent "${parentCategory}" → updating parent`);
                  finalCategory = mostCommonCat;
                  categoryChanged = true;
                  
                  // Update the parent product category
                  await supabase.from("products").update({ 
                    category: mostCommonCat,
                    suggested_category: parentCategory !== mostCommonCat ? parentCategory : null
                  }).eq("id", product.id);
                }
              }
            }

            const TECH_ATTR_NAMES = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model","referência","reference","código","code"]);
            const isEanLike = (v: string) => /^\d{8,14}$/.test(v.replace(/\s/g, ""));

            let propagated = 0;
            for (const variation of variations) {
              // Build attribute suffix ONLY from variation=true attrs, excluding tech values
              const attrParts: string[] = [];
              if (Array.isArray(variation.attributes)) {
                for (const attr of variation.attributes as any[]) {
                  // Skip non-variation and technical attributes
                  if (attr.variation === false) continue;
                  const attrName = (attr.name || "").toLowerCase().trim();
                  if (TECH_ATTR_NAMES.has(attrName)) continue;
                  const vals = Array.isArray(attr.values) ? attr.values.join("/") : (attr.value || "");
                  // Skip EAN-like values (pure numbers 8+ digits)
                  if (!vals || isEanLike(vals)) continue;
                  attrParts.push(vals);
                }
              }
              const suffix = attrParts.length > 0 ? ` - ${attrParts.join(", ")}` : "";

              const variationUpdate: Record<string, any> = {
                status: "optimized",
                category: finalCategory,
                suggested_category: updateData.suggested_category || null,
              };

              // Propagate title with attribute suffix
              if (updateData.optimized_title) {
                variationUpdate.optimized_title = `${updateData.optimized_title}${suffix}`;
              }
              // Propagate description (same base for all variations)
              if (updateData.optimized_description) {
                variationUpdate.optimized_description = updateData.optimized_description;
              }
              if (updateData.optimized_short_description) {
                variationUpdate.optimized_short_description = updateData.optimized_short_description;
              }
              // Propagate SEO with variation suffix
              if (updateData.meta_title) {
                variationUpdate.meta_title = `${updateData.meta_title}${suffix}`.substring(0, 60);
              }
              if (updateData.meta_description) {
                variationUpdate.meta_description = updateData.meta_description;
              }
              if (updateData.seo_slug) {
                const slugSuffix = attrParts.join("-").toLowerCase()
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
                variationUpdate.seo_slug = slugSuffix ? `${updateData.seo_slug}-${slugSuffix}` : updateData.seo_slug;
              }
              if (updateData.tags) variationUpdate.tags = updateData.tags;
              if (updateData.faq) variationUpdate.faq = updateData.faq;
              if (updateData.focus_keyword) variationUpdate.focus_keyword = updateData.focus_keyword;

              await supabase.from("products").update(variationUpdate).eq("id", variation.id);
              propagated++;
            }
            console.log(`📦 Propagated optimization to ${propagated} variations of variable product ${product.sku}`);

            // === PROPAGATE LIFESTYLE IMAGES to all family members ===
            try {
              // Collect all lifestyle images from parent + all variations
              const allFamilyIds = [product.id, ...variations.map((v: any) => v.id)];
              const { data: allLifestyleImages } = await supabase
                .from("images")
                .select("product_id, optimized_url, original_url")
                .in("product_id", allFamilyIds)
                .like("s3_key", "%lifestyle%")
                .eq("status", "done");

              if (allLifestyleImages && allLifestyleImages.length > 0) {
                // Unique lifestyle URLs
                const lifestyleUrls = [...new Set(allLifestyleImages.map((img: any) => img.optimized_url).filter(Boolean))];
                
                if (lifestyleUrls.length > 0) {
                  console.log(`🖼️ Found ${lifestyleUrls.length} lifestyle images to propagate across ${allFamilyIds.length} family members`);
                  
                  for (const fid of allFamilyIds) {
                    const { data: famProduct } = await supabase
                      .from("products")
                      .select("id, image_urls")
                      .eq("id", fid)
                      .single();
                    
                    if (!famProduct) continue;
                    const existing = Array.isArray(famProduct.image_urls) ? famProduct.image_urls : [];
                    const merged = [...existing];
                    let added = 0;
                    for (const url of lifestyleUrls) {
                      if (!merged.includes(url)) { merged.push(url); added++; }
                    }
                    
                    if (added > 0) {
                      await supabase.from("products").update({ image_urls: merged }).eq("id", fid);
                      
                      // Also ensure image records exist for this family member
                      const { data: existingImgRecords } = await supabase
                        .from("images")
                        .select("optimized_url")
                        .eq("product_id", fid)
                        .like("s3_key", "%lifestyle%");
                      const existingOptUrls = new Set((existingImgRecords || []).map((r: any) => r.optimized_url));
                      
                      for (const url of lifestyleUrls) {
                        if (!existingOptUrls.has(url)) {
                          await supabase.from("images").insert({
                            product_id: fid,
                            original_url: existing[0] || null,
                            optimized_url: url,
                            s3_key: `lifestyle_shared_from_family`,
                            sort_order: merged.indexOf(url),
                            status: "done",
                          });
                        }
                      }
                      console.log(`  ✅ Added ${added} lifestyle images to ${fid}`);
                    }
                  }
                }
              }
            } catch (lifestyleErr) {
              console.warn("Lifestyle propagation error (non-fatal):", lifestyleErr);
            }

            // ── AI attribute extraction for variable products ──
            // Check if children lack proper variation attributes
            const childrenNeedAttrs = variations.filter((v: any) => {
              const attrs = Array.isArray(v.attributes) ? v.attributes : [];
              const TECH = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model"]);
              const varAttrs = attrs.filter((a: any) => a.variation !== false && !TECH.has((a.name || "").toLowerCase().trim()));
              return varAttrs.length === 0;
            });

            if (childrenNeedAttrs.length > 0) {
              console.log(`🤖 Attempting AI attribute extraction for ${childrenNeedAttrs.length} variations...`);
              const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
              if (LOVABLE_API_KEY) {
                try {
                  const parentTitleForAI = updateData.optimized_title || product.optimized_title || product.original_title || "";
                  const childTitles: Record<string, string> = {};
                  for (const v of childrenNeedAttrs) {
                    // Re-fetch updated title after propagation
                    const { data: freshChild } = await supabase.from("products").select("optimized_title, original_title").eq("id", v.id).single();
                    childTitles[v.id] = freshChild?.optimized_title || freshChild?.original_title || v.original_title || "";
                  }

                  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${LOVABLE_API_KEY}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      model: "google/gemini-2.5-flash-lite",
                      messages: [
                        {
                          role: "system",
                          content: "You extract variation attributes from product titles. Compare the parent title with each child title to identify the differentiating attribute (e.g. Color, Size, Material). Return structured data via the tool."
                        },
                        {
                          role: "user",
                          content: `Parent product title: "${parentTitleForAI}"\n\nChild variation titles:\n${Object.entries(childTitles).map(([id, t]) => `- ID ${id}: "${t}"`).join("\n")}\n\nExtract the variation attribute name and value for each child.`
                        }
                      ],
                      tools: [{
                        type: "function",
                        function: {
                          name: "extract_variation_attributes",
                          description: "Extract the variation attribute name and per-child values from title differences",
                          parameters: {
                            type: "object",
                            properties: {
                              attribute_name: { type: "string", description: "Name of the variation attribute in Portuguese (e.g. Cor, Tamanho, Material, Capacidade)" },
                              confident: { type: "boolean", description: "true if the extraction is clear and unambiguous" },
                              variations: {
                                type: "array",
                                items: {
                                  type: "object",
                                  properties: {
                                    child_id: { type: "string" },
                                    value: { type: "string", description: "The attribute value for this variation" }
                                  },
                                  required: ["child_id", "value"],
                                  additionalProperties: false
                                }
                              }
                            },
                            required: ["attribute_name", "confident", "variations"],
                            additionalProperties: false
                          }
                        }
                      }],
                      tool_choice: { type: "function", function: { name: "extract_variation_attributes" } }
                    }),
                  });

                  if (aiResponse.ok) {
                    const aiData = await aiResponse.json();
                    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
                    if (toolCall?.function?.arguments) {
                      const extracted = JSON.parse(toolCall.function.arguments);
                      console.log(`🤖 AI extracted: attr="${extracted.attribute_name}", confident=${extracted.confident}, ${extracted.variations?.length} values`);

                      if (extracted.variations && Array.isArray(extracted.variations)) {
                        const TECH = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model"]);
                        const baseTitle = updateData.optimized_title || product.optimized_title || product.original_title || "";
                        const baseSlug = updateData.seo_slug || "";
                        const baseMetaTitle = updateData.meta_title || "";

                        for (const v of extracted.variations) {
                          if (!v.child_id || !v.value) continue;
                          const child = variations.find((c: any) => c.id === v.child_id);
                          if (!child) continue;
                          const existingAttrs = Array.isArray(child.attributes) ? [...child.attributes as any[]] : [];
                          const techOnly = existingAttrs.filter((a: any) => a.variation === false || TECH.has((a.name || "").toLowerCase().trim()));
                          const newAttrs = [
                            ...techOnly,
                            { name: extracted.attribute_name, value: v.value, variation: true }
                          ];

                          // Build title with attribute suffix — this is the key fix:
                          // re-apply after AI extraction so the title is correct
                          const childUpdate: Record<string, any> = { attributes: newAttrs };

                          if (baseTitle) {
                            childUpdate.optimized_title = `${baseTitle} - ${v.value}`;
                          }

                          if (baseMetaTitle) {
                            childUpdate.meta_title = `${baseMetaTitle} - ${v.value}`.substring(0, 60);
                          }

                          if (baseSlug) {
                            const slugSuffix = v.value.toLowerCase()
                              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                              .replace(/[^a-z0-9\-]/g, "-").replace(/-+/g, "-");
                            childUpdate.seo_slug = slugSuffix ? `${baseSlug}-${slugSuffix}` : baseSlug;
                          }

                          console.log(`📝 Variation ${v.child_id}: title="${childUpdate.optimized_title}", attr=${extracted.attribute_name}=${v.value}`);
                          await supabase.from("products").update(childUpdate).eq("id", v.child_id);
                        }
                      }

                      // Set parent status based on confidence
                      if (extracted.confident) {
                        await supabase.from("products").update({ status: "optimized" }).eq("id", product.id);
                        console.log(`✅ Variable product ${product.sku}: AI confident → status=optimized`);
                      } else {
                        await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                        console.log(`⚠️ Variable product ${product.sku}: AI not confident → status=needs_review`);
                      }
                    }
                  } else {
                    console.error(`AI attribute extraction failed: ${aiResponse.status}`);
                    await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                  }
                } catch (aiErr) {
                  console.error("AI attribute extraction error:", aiErr);
                  await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
                }
              } else {
                console.warn("LOVABLE_API_KEY not set, skipping AI attribute extraction");
                await supabase.from("products").update({ status: "needs_review" }).eq("id", product.id);
              }
            }
          }
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
          chunks_used: topChunks.length,
          rag_match_types: ragMatchTypeCounts,
        } as any);

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
