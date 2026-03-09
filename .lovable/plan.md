

## Problemas Identificados e Soluções

### 1. Fusão de Workspaces duplica produtos

A lógica atual (`mergeMutation`) apenas move todos os registos do workspace de origem para o destino com `UPDATE workspace_id = targetId`. Não verifica se já existem produtos com o mesmo SKU no destino.

**Solução**: Criar uma Edge Function `merge-workspaces` que:
- Lista produtos do workspace de origem e destino
- Para cada produto de origem com SKU que já existe no destino: aplica a fusão inteligente (mesma lógica `buildMergedProductData` do parse-catalog) e elimina o duplicado
- Para produtos sem correspondência: apenas move para o destino
- Move as restantes tabelas (uploaded_files, knowledge_chunks, etc.)
- Elimina o workspace de origem

**Ficheiros a alterar:**
- `supabase/functions/merge-workspaces/index.ts` — nova Edge Function com lógica de deduplicação por SKU
- `src/hooks/useWorkspaces.tsx` — alterar `mergeMutation` para invocar a Edge Function em vez de fazer updates simples

### 2. Scraping: em massa vs por produto

**Recomendação: Híbrido** — scrape em massa antes da otimização, com fallback por produto.

Razões:
- Em massa é mais eficiente (1 pedido por SKU, dados já prontos quando a otimização começa)
- Evita timeouts durante a otimização (o scrape já está feito)
- Permite revisão dos dados antes de otimizar
- Fallback por produto garante que nada fica sem dados

**Implementação:**
- Adicionar botão "Enriquecer via Web" na página de Produtos que percorre todos os SKUs do workspace
- Usa os prefixos de fornecedor das Definições para construir URLs
- Guarda os dados scrapeados em `knowledge_chunks` associados ao workspace
- Na otimização, verifica primeiro se já há dados em cache antes de fazer scrape

**Ficheiros a alterar:**
- `supabase/functions/enrich-products/index.ts` — nova Edge Function que percorre SKUs em lote e faz scrape via Firecrawl
- `src/hooks/useEnrichProducts.ts` — hook para invocar e monitorizar o enriquecimento
- `src/pages/ProductsPage.tsx` — botão "Enriquecer via Web" na toolbar

### Resumo das alterações

| Ficheiro | Ação |
|----------|------|
| `supabase/functions/merge-workspaces/index.ts` | Novo — fusão com deduplicação por SKU |
| `supabase/functions/enrich-products/index.ts` | Novo — scrape em massa por SKU |
| `src/hooks/useWorkspaces.tsx` | Alterar merge para usar Edge Function |
| `src/hooks/useEnrichProducts.ts` | Novo — hook de enriquecimento |
| `src/pages/ProductsPage.tsx` | Adicionar botão "Enriquecer via Web" |

