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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspaceId, products: clientProducts, existingGroups, knowledgeContext } = await req.json();
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use products sent from client
    let products = clientProducts;
    if (!products || !Array.isArray(products) || products.length === 0) {
      const { data, error: fetchError } = await supabase
        .from("products")
        .select("id, sku, original_title, optimized_title, category, original_price, original_description, short_description, product_type, attributes, crosssell_skus, upsell_skus")
        .eq("workspace_id", workspaceId)
        .eq("product_type", "simple")
        .order("original_title")
        .limit(500);
      if (fetchError) throw fetchError;
      products = data;
    }

    if (!products || products.length < 1) {
      return new Response(
        JSON.stringify({ groups: [], addToExisting: [], message: "Sem produtos simples para analisar." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Build compact product list with crosssell/upsell hints
    const productList = products.map((p: any) => {
      const item: any = {
        id: p.id,
        sku: p.sku,
        title: p.optimized_title || p.original_title,
        category: p.category,
        price: p.original_price,
        desc: (p.original_description || "").substring(0, 150),
      };
      // Add cross/upsell SKU hints (they often indicate related products)
      const crossSkus = Array.isArray(p.crosssell_skus) ? p.crosssell_skus : [];
      const upSkus = Array.isArray(p.upsell_skus) ? p.upsell_skus : [];
      if (crossSkus.length > 0) item.cross = crossSkus.slice(0, 5);
      if (upSkus.length > 0) item.up = upSkus.slice(0, 5);
      return item;
    });

    // Build existing groups context
    let existingGroupsContext = "";
    if (existingGroups && Array.isArray(existingGroups) && existingGroups.length > 0) {
      existingGroupsContext = `\n\n=== GRUPOS VARIÁVEIS JÁ EXISTENTES ===
Estes produtos variáveis já existem no catálogo. Verifica se algum produto simples deveria ser adicionado a estes grupos como nova variação.
${JSON.stringify(existingGroups.map((g: any) => ({
        parent_id: g.parent_id,
        parent_title: g.parent_title,
        attribute_name: g.attribute_name,
        existing_variations: g.existing_variations?.map((v: any) => v.sku + ": " + v.attribute_value).join(", "),
      })), null, 1).substring(0, 8000)}`;
    }

    // Build knowledge context from PDF catalog
    let knowledgeSection = "";
    if (knowledgeContext && typeof knowledgeContext === "string" && knowledgeContext.length > 0) {
      knowledgeSection = `\n\n=== CONTEXTO DO CATÁLOGO PDF ===
Informação extraída do catálogo do fornecedor que pode ajudar a identificar famílias/grupos de produtos:
${knowledgeContext.substring(0, 6000)}`;
    }

    const hasExistingGroups = existingGroups && existingGroups.length > 0;

    const systemPrompt = `És um especialista em catálogos de produtos para e-commerce (equipamentos profissionais, hotelaria, restauração). Analisa a lista de produtos e:

1. **Identifica NOVOS grupos** de produtos simples que são variações do mesmo produto base
2. ${hasExistingGroups ? "**Identifica produtos simples que devem ser ADICIONADOS a grupos variáveis já existentes**" : ""}

Critérios de agrupamento:
- Mesmo produto mas com diferentes tamanhos, dimensões, capacidades, voltagens, cores ou configurações
- SKUs com base similar mas sufixos diferentes (ex: P-123-60, P-123-80 são variações)
- Títulos muito semelhantes diferindo apenas num atributo
- Mesmo modelo/referência em diferentes versões
- Produtos que partilham crosssell/upsell SKUs frequentemente pertencem à mesma família
- Informação do catálogo PDF indica que são variantes do mesmo produto

NÃO agrupa:
- Produtos genuinamente diferentes (uma panela e um forno não são variações)
- Acessórios com o equipamento principal (isso é crosssell, não variação)
- Produtos da mesma categoria mas de séries/modelos completamente diferentes

Responde APENAS com a tool call.`;

    const userContent = `Analisa estes ${productList.length} produtos simples e identifica variações:

${JSON.stringify(productList, null, 1).substring(0, 25000)}${existingGroupsContext}${knowledgeSection}`;

    const toolParameters: any = {
      type: "object",
      properties: {
        new_groups: {
          type: "array",
          description: "Novos grupos de variações detetados entre produtos simples",
          items: {
            type: "object",
            properties: {
              parent_title: { type: "string", description: "Título genérico do produto pai" },
              attribute_name: { type: "string", description: "Nome do atributo que varia" },
              variations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    product_id: { type: "string" },
                    attribute_value: { type: "string" },
                  },
                  required: ["product_id", "attribute_value"],
                },
              },
            },
            required: ["parent_title", "attribute_name", "variations"],
          },
        },
        add_to_existing: {
          type: "array",
          description: "Produtos simples que devem ser adicionados a grupos variáveis já existentes",
          items: {
            type: "object",
            properties: {
              existing_parent_id: { type: "string", description: "ID do produto variável existente" },
              existing_parent_title: { type: "string", description: "Título do produto variável existente" },
              attribute_name: { type: "string" },
              products_to_add: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    product_id: { type: "string" },
                    attribute_value: { type: "string" },
                  },
                  required: ["product_id", "attribute_value"],
                },
              },
              reason: { type: "string", description: "Justificação breve de porque este produto pertence a este grupo" },
            },
            required: ["existing_parent_id", "existing_parent_title", "attribute_name", "products_to_add"],
          },
        },
      },
      required: ["new_groups", "add_to_existing"],
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
              description: "Devolve os grupos de variações detetados e sugestões de adição a grupos existentes",
              parameters: toolParameters,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "detect_variations" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error("AI error: " + aiResponse.status + " " + errText);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({ groups: [], addToExisting: [], message: "IA não detetou variações." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const newGroups = parsed.new_groups || [];
    const addToExisting = parsed.add_to_existing || [];

    // Validate product IDs
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
