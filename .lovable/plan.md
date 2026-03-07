

## Otimização por Fases

### Problema
Atualmente, uma única chamada IA processa todos os 13 campos de uma vez. Isto gera prompts enormes (mais tokens, mais custo, mais tempo) e maior probabilidade de timeouts ou respostas truncadas.

### Solução
Dividir a otimização em **3 fases automáticas**, processadas sequencialmente por produto:

```text
Fase 1 — Conteúdo Base (~60% do trabalho)
  ├── title, short_description, description
  ├── tags, category, focus_keywords
  └── Usa: RAG + Supplier scrape

Fase 2 — SEO (~25%)
  ├── meta_title, meta_description, seo_slug
  ├── faq, image_alt
  └── Usa: resultado da Fase 1 como contexto

Fase 3 — Comercial (~15%)
  ├── price, upsells, crosssells
  └── Usa: Compatibility Engine + catálogo
```

### Implementação

**Edge Function (`optimize-product`):**
- Novo parâmetro `phase?: 1 | 2 | 3` (se não enviado, faz tudo como hoje — retrocompatível)
- Cada fase só inclui os campos e contexto necessários (prompt menor, resposta mais rápida)
- Fase 2 recebe o título/descrição otimizados da Fase 1 para gerar SEO coerente
- Fase 3 só carrega o catálogo se realmente precisa de upsells/crosssells

**Frontend (`useOptimizeProducts.ts`):**
- O loop por produto passa a fazer 3 chamadas sequenciais (fase 1→2→3) em vez de 1 grande
- A barra de progresso mostra a fase atual: "Produto 3/50 — Fase 2: SEO"
- Invalidação de queries entre fases para atualizar a UI progressivamente
- O cancelamento funciona entre fases (verificação do token entre cada chamada)

**UI (`ProductsPage.tsx`):**
- No diálogo de otimização, opção para escolher quais fases executar (ex: só re-fazer SEO sem tocar no conteúdo)
- Checkboxes agrupadas por fase em vez de campo individual

### Benefícios
- Prompts 50-70% menores por chamada → respostas mais rápidas e precisas
- Menos tokens gastos (cada fase só pede o contexto que precisa)
- Possibilidade de re-fazer só uma fase (ex: SEO) sem repetir tudo
- Menor risco de timeout da edge function

### Ficheiros a alterar
- `supabase/functions/optimize-product/index.ts` — lógica de fases, contexto condicional
- `src/hooks/useOptimizeProducts.ts` — loop 3 fases por produto, progresso detalhado
- `src/pages/ProductsPage.tsx` — UI de seleção de fases, progresso com indicação de fase

