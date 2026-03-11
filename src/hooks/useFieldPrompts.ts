import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface FieldPromptConfig {
  key: string;
  label: string;
  settingKey: string;
  defaultPrompt: string;
}

export const FIELD_PROMPTS: FieldPromptConfig[] = [
  {
    key: "title",
    label: "Título",
    settingKey: "prompt_field_title",
    defaultPrompt: `Gera um título otimizado para SEO (máx 70 chars).
CONTEXTO: Estes são equipamentos PROFISSIONAIS para hotelaria, restauração, cozinhas industriais e bares.
REGRAS OBRIGATÓRIAS:
- Inclui a keyword principal no início
- NÃO incluas o nome da marca no título (ex: NÃO "Zanussi Fritadeira", SIM "Fritadeira a Gás Linha 700")
- Inclui linha/série se aplicável (ex: "Linha 700", "Linha 900")
- Inclui capacidade/dimensão se relevante (ex: "40x40", "4 Bicos", "8 Litros")
- Mantém o tipo de energia se aplicável (Gás, Elétrico, etc.)
- Nunca uses palavras genéricas como "Profissional" sem contexto técnico`,
  },
  {
    key: "description",
    label: "Descrição Completa",
    settingKey: "prompt_field_description",
    defaultPrompt: `Gera uma descrição otimizada com ESTRUTURA OBRIGATÓRIA:
1. PARÁGRAFO COMERCIAL (150-250 chars): Benefícios, aplicações, diferenciais. Sem dados técnicos.
2. TABELA HTML de specs: <table> com TODAS as características técnicas (dimensões, peso, material, potência, voltagem, etc.)
3. FAQ HTML: 3-5 perguntas frequentes em <details><summary>Pergunta</summary><p>Resposta</p></details>

REGRAS OBRIGATÓRIAS:
- NÃO mistures dados técnicos no texto comercial
- Menciona aplicações práticas (restaurante, hotel, pastelaria, etc.)
- Inclui benefícios de eficiência energética se aplicável
- Menciona conformidade com normas (CE, HACCP) se relevante`,
  },
  {
    key: "short_description",
    label: "Descrição Curta",
    settingKey: "prompt_field_short_description",
    defaultPrompt: `Gera uma descrição curta (máx 160 chars) para listagens.
REGRAS OBRIGATÓRIAS:
- Resumo conciso focado no benefício principal
- Inclui 1-2 specs chave (dimensão ou capacidade)
- Inclui tipo de energia se aplicável
- Tom profissional e direto`,
  },
  {
    key: "meta_title",
    label: "Meta Title (SEO)",
    settingKey: "prompt_field_meta_title",
    defaultPrompt: `Gera meta title SEO (máx 60 chars).
REGRAS OBRIGATÓRIAS:
- Keyword principal no início
- Inclui "Comprar" ou "Preço" para intenção comercial
- Inclui marca/linha se couber
- Termina com separador e nome da loja se couber`,
  },
  {
    key: "meta_description",
    label: "Meta Description (SEO)",
    settingKey: "prompt_field_meta_description",
    defaultPrompt: `Gera meta description SEO (máx 155 chars).
REGRAS OBRIGATÓRIAS:
- Inclui call-to-action (ex: "Encomende já", "Entrega rápida")
- Menciona 1-2 benefícios chave
- Inclui preço ou "Melhor preço" se aplicável
- Usa linguagem que gere cliques`,
  },
  {
    key: "seo_slug",
    label: "SEO Slug",
    settingKey: "prompt_field_seo_slug",
    defaultPrompt: `Gera um slug SEO-friendly.
REGRAS OBRIGATÓRIAS:
- Lowercase, sem acentos, com hífens
- Inclui keyword principal + tipo + linha/marca
- Máx 5-7 palavras
- Exemplo: fritadeira-gas-linha-700-8-litros`,
  },
  {
    key: "tags",
    label: "Tags",
    settingKey: "prompt_field_tags",
    defaultPrompt: `Gera 4-8 tags relevantes.
REGRAS OBRIGATÓRIAS:
- Inclui categoria principal (ex: "fritadeira")
- Inclui tipo de energia (ex: "gás", "elétrico")
- Inclui linha/série (ex: "linha 700")
- Inclui aplicação (ex: "restaurante", "hotelaria")
- Inclui marca se conhecida
- Inclui sinónimos de pesquisa comuns`,
  },
  {
    key: "price",
    label: "Preço",
    settingKey: "prompt_field_price",
    defaultPrompt: `Sugere um preço otimizado.
REGRAS:
- Mantém o preço original se parecer correto para o mercado
- Ajusta ligeiramente se for claramente abaixo ou acima do mercado
- Considera o posicionamento do produto (entrada, médio, premium)`,
  },
  {
    key: "faq",
    label: "FAQ",
    settingKey: "prompt_field_faq",
    defaultPrompt: `Gera 3-5 FAQs sobre o produto.
REGRAS OBRIGATÓRIAS:
- Pergunta sobre dimensões/espaço necessário
- Pergunta sobre instalação/requisitos (gás, electricidade, água)
- Pergunta sobre manutenção/limpeza
- Pergunta sobre garantia/assistência se aplicável
- Pergunta sobre acessórios incluídos/compatíveis
- Respostas detalhadas e úteis (não genéricas)`,
  },
  {
    key: "upsells",
    label: "Upsells",
    settingKey: "prompt_field_upsells",
    defaultPrompt: `Sugere 2-4 produtos SUPERIORES do catálogo como upsell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: mesmo tipo mas maior capacidade, mesma linha mas modelo superior, versão com mais funcionalidades
- Exemplo: Se é fritadeira 8L linha 700, sugere fritadeira 10L linha 700 ou fritadeira 8L linha 900
- Exemplo: Se é máquina lavar cesto 40, sugere cesto 50 ou modelo com bomba de enxaguamento
- NÃO sugiras produtos de categorias completamente diferentes
- NÃO incluas o próprio produto`,
  },
  {
    key: "crosssells",
    label: "Cross-sells",
    settingKey: "prompt_field_crosssells",
    defaultPrompt: `Sugere 2-4 produtos COMPLEMENTARES do catálogo como cross-sell.
REGRAS OBRIGATÓRIAS:
- Usa APENAS SKUs reais do catálogo fornecido
- Prioriza: acessórios, produtos da mesma linha/família, consumíveis
- Exemplo: Se é fritadeira, sugere cestos extra, doseadores de óleo, bancadas inox
- Exemplo: Se é fogão 4 bicos, sugere forno, bancada, exaustor
- Exemplo: Se é máquina de lavar, sugere doseadores, cestos extra, mesa de saída
- Procura produtos que formem uma "estação de trabalho" completa
- NÃO sugiras produtos redundantes (ex: outro fogão igual)`,
  },
  {
    key: "image_alt",
    label: "Alt Text Imagens",
    settingKey: "prompt_field_image_alt",
    defaultPrompt: `Gera alt text SEO para cada imagem do produto (máx 125 chars cada).
REGRAS OBRIGATÓRIAS:
- Descritivo e relevante para o produto
- Inclui keyword principal + marca/linha
- Inclui ângulo/perspetiva se possível (ex: "vista frontal", "detalhe do painel")
- Não comeces com "Imagem de" — sê direto`,
  },
  {
    key: "category",
    label: "Categoria Sugerida",
    settingKey: "prompt_field_category",
    defaultPrompt: `Analisa o produto e sugere a melhor categoria e subcategoria.
REGRAS OBRIGATÓRIAS:
- Usa o formato "Categoria > Subcategoria" (ex: "Cozinha > Fritadeiras")
- Se a categoria atual parecer incorreta, sugere uma melhor
- Prioriza categorias que já existam no catálogo
- Podes propor nova categoria/subcategoria se nenhuma existente for adequada`,
  },
];

export function useFieldPrompts() {
  return useQuery({
    queryKey: ["field-prompts"],
    queryFn: async () => {
      const keys = FIELD_PROMPTS.map((f) => f.settingKey);
      const { data, error } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", keys);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((s) => {
        if (s.value) map[s.key] = s.value;
      });
      return map;
    },
  });
}

export function useSaveFieldPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("settings")
        .upsert({ user_id: user.id, key, value }, { onConflict: "user_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field-prompts"] });
      toast.success("Prompt guardado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useProductCategories() {
  return useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null);
      if (error) throw error;
      const cats = new Set<string>();
      (data || []).forEach((p) => {
        if (p.category) cats.add(p.category);
      });
      return Array.from(cats).sort();
    },
  });
}
