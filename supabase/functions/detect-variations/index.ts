import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Attempt to recover truncated JSON (e.g. from LLM token limit) */
function parseWithRecovery(raw: string): any {
  const openBraces = (raw.match(/{/g) || []).length;
  const closeBraces = (raw.match(/}/g) || []).length;
  const openBrackets = (raw.match(/\[/g) || []).length;
  const closeBrackets = (raw.match(/\]/g) || []).length;

  let trimmed = raw;
  const lastBrace = raw.lastIndexOf("}");
  const lastBracket = raw.lastIndexOf("]");
  const lastComplete = Math.max(lastBrace, lastBracket);
  if (lastComplete > 0) {
    trimmed = raw.substring(0, lastComplete + 1);
  }

  const missingBrackets = openBrackets - (trimmed.match(/\]/g) || []).length;
  const missingBraces = openBraces - (trimmed.match(/}/g) || []).length;
  trimmed = trimmed.replace(/,\s*$/, "");
  trimmed += "]".repeat(Math.max(0, missingBrackets)) + "}".repeat(Math.max(0, missingBraces));

  try {
    const result = JSON.parse(trimmed);
    console.warn("Recovered truncated JSON successfully");
    return result;
  } catch (_e) {
    console.error("JSON recovery failed, returning empty result");
    return { new_groups: [], add_to_existing: [], reclassify: [] };
  }
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspaceId, products: clientProducts, existingGroups, knowledgeContext, mode } = await req.json();
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let products = clientProducts;
    if (!products || !Array.isArray(products) || products.length === 0) {
      const { data, error: fetchError } = await supabase
        .from("products")
        .select("id, sku, original_title, optimized_title, category, original_price, original_description, short_description, product_type, attributes, crosssell_skus, upsell_skus, parent_product_id")
        .eq("workspace_id", workspaceId)
        .order("original_title")
        .limit(500);
      if (fetchError) throw fetchError;
      products = data;
    }

    if (!products || products.length < 1) {
      return new Response(
        JSON.stringify({ groups: [], addToExisting: [], reclassify: [], message: "Sem produtos para analisar." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build compact product list with type and parent info
    const productList = products.map((p: any) => {
      const item: any = {
        id: p.id,
        sku: p.sku,
        title: p.optimized_title || p.original_title,
        type: p.product_type,
        category: p.category,
        price: p.original_price,
        desc: (p.original_description || "").substring(0, 120),
      };
      if (p.parent_product_id) item.parent_id = p.parent_product_id;
      if (p.attributes && Array.isArray(p.attributes) && p.attributes.length > 0) {
        item.attrs = p.attributes;
      }
      const crossSkus = Array.isArray(p.crosssell_skus) ? p.crosssell_skus : [];
      const upSkus = Array.isArray(p.upsell_skus) ? p.upsell_skus : [];
      if (crossSkus.length > 0) item.cross = crossSkus.slice(0, 5);
      if (upSkus.length > 0) item.up = upSkus.slice(0, 5);
      return item;
    });

    // Separate by type for context
    const simpleProducts = productList.filter((p: any) => p.type === "simple");
    const variableProducts = productList.filter((p: any) => p.type === "variable");
    const variationProducts = productList.filter((p: any) => p.type === "variation");

    let existingGroupsContext = "";
    if (existingGroups && Array.isArray(existingGroups) && existingGroups.length > 0) {
      existingGroupsContext = `\n\n=== GRUPOS VARIÁVEIS JÁ EXISTENTES (para verificação e expansão) ===
${JSON.stringify(existingGroups.map((g: any) => ({
        parent_id: g.parent_id,
        parent_title: g.parent_title,
        attribute_names: g.attribute_names,
        existing_variations: g.existing_variations?.slice(0, 15).map((v: any) => 
          v.sku + ": " + JSON.stringify(v.attribute_values)
        ).join(", "),
      })), null, 1).substring(0, 8000)}`;
    }

    let knowledgeSection = "";
    if (knowledgeContext && typeof knowledgeContext === "string" && knowledgeContext.length > 0) {
      knowledgeSection = `\n\n=== CONTEXTO DO CATÁLOGO PDF / WEBSITE FORNECEDOR ===
${knowledgeContext.substring(0, 6000)}`;
    }

    const isFullMode = mode === "full";

    const systemPrompt = `És um especialista em catálogos de produtos para e-commerce (equipamentos profissionais, hotelaria, restauração). 

TAREFAS:
1. **NOVOS GRUPOS**: Identifica produtos simples que devem ser agrupados como variações do mesmo produto base
2. **ADICIONAR A EXISTENTES**: Identifica produtos simples que devem entrar em grupos variáveis já existentes
${isFullMode ? `3. **VERIFICAR GRUPOS EXISTENTES**: Revê os grupos variáveis atuais e sugere correções:
   - Variações que estão no grupo errado
   - Grupos que deviam ser fundidos (mesmo produto base)
   - Variações órfãs ou grupos vazios` : ""}

REGRAS CRÍTICAS PARA attribute_names e attribute_values:
- **SÓ ATRIBUTOS QUE VARIAM**: Um atributo só deve aparecer em attribute_names se o seu valor É DIFERENTE entre pelo menos 2 variações do grupo.
- Se TODAS as variações têm o mesmo diâmetro (ex: "16 cm"), NÃO incluas "Diâmetro" como atributo — inclui-o no parent_title.
  * ERRADO: attribute_names: ["Diâmetro", "Cor"] quando todas têm Diâmetro="16 cm" → valores ficam "—"
  * CERTO: parent_title: "Caçarola com Cabo Reto Cool 16 cm", attribute_names: ["Cor"] com valores reais
- **OBRIGATÓRIO**: Cada variação DEVE ter valores concretos para TODOS os atributos listados. Se um atributo fica vazio ou "—", é porque NÃO devia ser atributo.
- Exemplos de extração correcta:
  * "Caçarola Cabo Reto Cool 16 cm Amar" + "...16 cm Naran" → parent: "Caçarola com Cabo Reto Cool 16 cm", attrs: ["Cor"], valores: "Amarelo", "Laranja"
  * "Bandeja 35 Preto" + "Bandeja 40 Preto" + "Bandeja 35 Castanho" → attrs: ["Tamanho", "Cor"] (ambos variam)
  * "Bandeja 35 Preto" + "Bandeja 35 Castanho" → attrs: ["Cor"] apenas, "35" no parent_title
- Corrige abreviações: "Amar" → "Amarelo", "Naran"/"Nara" → "Laranja", "Roj" → "Vermelho", "Neg" → "Preto", "Blan" → "Branco", "Castaño" → "Castanho"

MÚLTIPLOS ATRIBUTOS:
- Um grupo pode ter MAIS QUE UM atributo APENAS se ambos realmente variam.
- Se todas têm 35cm mas cores diferentes → attribute_names: ["Cor"] apenas.

TRADUÇÃO / CONSISTÊNCIA:
- Normaliza sempre para Português de Portugal.
- O parent_title deve incluir atributos FIXOS (que não variam) e excluir os que variam.

Critérios de agrupamento:
- Mesmo produto com diferentes tamanhos, dimensões, capacidades, voltagens, cores, materiais
- SKUs com base similar mas sufixos diferentes
- Títulos muito semelhantes diferindo em 1+ atributos

NÃO agrupa:
- Produtos genuinamente diferentes
- Acessórios com equipamento principal
- Produtos de séries/modelos completamente diferentes

Responde APENAS com a tool call.`;

    const productsSummary = [];
    if (simpleProducts.length > 0) productsSummary.push(`${simpleProducts.length} simples`);
    if (variableProducts.length > 0) productsSummary.push(`${variableProducts.length} variáveis`);
    if (variationProducts.length > 0) productsSummary.push(`${variationProducts.length} variações`);

    const userContent = `Analisa estes ${productList.length} produtos (${productsSummary.join(", ")}).
${isFullMode ? "MODO COMPLETO: Verifica TODOS os produtos incluindo os já classificados como variable/variation. Sugere correções se necessário." : "Foca nos produtos simples para novos agrupamentos."}
Lembra-te: OBRIGATÓRIO preencher attribute_values com valores concretos extraídos dos títulos!

${JSON.stringify(productList, null, 1).substring(0, 25000)}${existingGroupsContext}${knowledgeSection}`;

    const variationItemSchema = {
      type: "object",
      properties: {
        product_id: { type: "string" },
        attribute_values: {
          type: "object",
          description: "Mapa atributo→valor CONCRETO extraído do título. Ex: {\"Cor\": \"Preto\", \"Tamanho\": \"35cm\"}. NUNCA vazio.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["product_id", "attribute_values"],
    };

    const toolProperties: any = {
      new_groups: {
        type: "array",
        description: "Novos grupos de variações detetados entre produtos simples",
        items: {
          type: "object",
          properties: {
            parent_title: { type: "string", description: "Título genérico em PT-PT (sem atributos específicos)" },
            attribute_names: {
              type: "array",
              items: { type: "string" },
              description: "Nomes dos atributos. Ex: [\"Cor\", \"Tamanho\"]",
            },
            variations: { type: "array", items: variationItemSchema },
          },
          required: ["parent_title", "attribute_names", "variations"],
        },
      },
      add_to_existing: {
        type: "array",
        description: "Produtos simples para adicionar a grupos variáveis existentes",
        items: {
          type: "object",
          properties: {
            existing_parent_id: { type: "string" },
            existing_parent_title: { type: "string" },
            attribute_names: { type: "array", items: { type: "string" } },
            products_to_add: { type: "array", items: variationItemSchema },
            reason: { type: "string" },
          },
          required: ["existing_parent_id", "existing_parent_title", "attribute_names", "products_to_add"],
        },
      },
    };

    const requiredFields = ["new_groups", "add_to_existing"];

    // In full mode, add reclassify suggestions
    if (isFullMode) {
      toolProperties.reclassify = {
        type: "array",
        description: "Sugestões de correção para grupos existentes: mover variações, fundir grupos, etc.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["move_variation", "merge_groups", "split_group", "fix_parent_title"] },
            description: { type: "string", description: "Descrição da correção sugerida" },
            product_ids: { type: "array", items: { type: "string" }, description: "IDs dos produtos afetados" },
            target_parent_id: { type: "string", description: "ID do parent de destino (para move/merge)" },
            suggested_title: { type: "string", description: "Título corrigido (para fix_parent_title)" },
          },
          required: ["action", "description"],
        },
      };
      requiredFields.push("reclassify");
    }

    const toolParameters = {
      type: "object",
      properties: toolProperties,
      required: requiredFields,
      additionalProperties: false,
    };

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "detect_variations",
              description: "Devolve grupos de variações com atributos concretos, sugestões de adição e correções",
              parameters: toolParameters,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "detect_variations" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit excedido. Tenta novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos insuficientes. Adiciona créditos em Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI error: " + aiResponse.status + " " + errText);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ groups: [], addToExisting: [], reclassify: [], message: "IA não detetou variações." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (_parseErr) {
      // Attempt to recover truncated JSON from tool_calls arguments
      const raw = toolCall.function.arguments || "";
      console.warn("JSON parse failed, attempting recovery on", raw.length, "chars");
      parsed = parseWithRecovery(raw);
    }
    const newGroups = parsed.new_groups || [];
    const addToExisting = parsed.add_to_existing || [];
    const reclassify = parsed.reclassify || [];

    const allProductIds = new Set(products.map((p: any) => p.id));
    const validNewGroups = newGroups
      .map((g: any) => ({
        ...g,
        variations: (g.variations || []).filter((v: any) => allProductIds.has(v.product_id)),
      }))
      .filter((g: any) => g.variations.length >= 2);

    const existingParentIds = new Set((existingGroups || []).map((g: any) => g.parent_id));
    const validAddToExisting = addToExisting
      .map((g: any) => ({
        ...g,
        products_to_add: (g.products_to_add || []).filter((v: any) => allProductIds.has(v.product_id)),
      }))
      .filter((g: any) => g.products_to_add.length >= 1 && existingParentIds.has(g.existing_parent_id));

    return new Response(
      JSON.stringify({
        groups: validNewGroups,
        addToExisting: validAddToExisting,
        reclassify,
        total_products: products.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("detect-variations error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
