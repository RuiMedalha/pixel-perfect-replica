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

    const { workspaceId, products: clientProducts } = await req.json();
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use products sent from client (avoids long URL queries)
    let products = clientProducts;
    if (!products || !Array.isArray(products) || products.length === 0) {
      // Fallback: fetch from DB (limited to 500)
      const { data, error: fetchError } = await supabase
        .from("products")
        .select("id, sku, original_title, optimized_title, category, original_price, original_description, short_description, product_type, attributes")
        .eq("workspace_id", workspaceId)
        .eq("product_type", "simple")
        .order("original_title")
        .limit(500);
      if (fetchError) throw fetchError;
      products = data;
    }

    if (!products || products.length < 2) {
      return new Response(
        JSON.stringify({ groups: [], message: "Insuficientes produtos simples para detetar variações." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const productList = products.map((p: any) => ({
      id: p.id,
      sku: p.sku,
      title: p.optimized_title || p.original_title,
      category: p.category,
      price: p.original_price,
      description: (p.original_description || "").substring(0, 200),
    }));

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `És um especialista em catálogos de produtos para e-commerce. Analisa a lista de produtos e identifica quais são variações do mesmo produto base.

Critérios de agrupamento:
- Mesmo produto mas com diferentes tamanhos, dimensões, capacidades, voltagens, cores ou configurações
- SKUs com base similar mas sufixos diferentes
- Títulos muito semelhantes diferindo apenas num atributo (ex: "Mesa Inox 1200mm" e "Mesa Inox 1500mm")
- Mesmo modelo/referência em diferentes versões

Para cada grupo, identifica:
- O nome do produto pai (genérico)
- Os atributos que variam (nome do atributo e valor para cada variação)
- Quais produtos pertencem ao grupo (por ID)

NÃO agrupa produtos que são genuinamente diferentes. Só agrupa quando claramente são variações do mesmo produto base.
Responde APENAS com a tool call.`,
          },
          {
            role: "user",
            content: `Analisa estes ${productList.length} produtos e identifica grupos de variações:\n\n${JSON.stringify(productList, null, 1).substring(0, 30000)}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "detect_variations",
              description: "Devolve os grupos de produtos variáveis detetados",
              parameters: {
                type: "object",
                properties: {
                  groups: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        parent_title: { type: "string", description: "Título genérico do produto pai" },
                        attribute_name: { type: "string", description: "Nome do atributo que varia (ex: Tamanho, Voltagem, Capacidade)" },
                        variations: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              product_id: { type: "string" },
                              attribute_value: { type: "string", description: "Valor do atributo para esta variação" },
                            },
                            required: ["product_id", "attribute_value"],
                          },
                        },
                      },
                      required: ["parent_title", "attribute_name", "variations"],
                    },
                  },
                },
                required: ["groups"],
                additionalProperties: false,
              },
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
        JSON.stringify({ groups: [], message: "IA não detetou variações." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const groups = parsed.groups || [];

    // Validate that all product IDs exist in the sent products
    const allProductIds = new Set(products.map((p: any) => p.id));
    const validGroups = groups
      .map((g: any) => ({
        ...g,
        variations: (g.variations || []).filter((v: any) => allProductIds.has(v.product_id)),
      }))
      .filter((g: any) => g.variations.length >= 2);

    return new Response(
      JSON.stringify({ groups: validGroups, total_products: products.length }),
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
