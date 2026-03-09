

## Problemas Identificados

O enriquecimento via web (`enrich-products`) atualmente:
1. **Não extrai imagens** — apenas guarda markdown como knowledge chunks
2. **Não deteta variáveis** — não analisa se o produto scrapeado tem variações (cores, tamanhos)
3. **Exige prefixos** — se o fornecedor não tiver prefixo configurado, o produto é ignorado
4. **Não atualiza o produto** — os dados ficam só nos knowledge_chunks, sem preencher campos do produto (image_urls, attributes, etc.)

## Plano de Alterações

### 1. Melhorar `enrich-products/index.ts`

- Pedir ao Firecrawl `formats: ['markdown', 'links', 'screenshot']` para capturar imagens
- Extrair URLs de imagens do markdown (regex para `![...](url)`) e do array `links` (filtrar `.jpg`, `.png`, `.webp`)
- Após scrape, **atualizar o produto** diretamente:
  - `image_urls`: adicionar imagens encontradas (sem duplicar existentes)
  - `technical_specs`: extrair specs do markdown se o produto não tiver
- Se prefixo estiver vazio/ausente, usar o SKU completo no URL de pesquisa (sem remover prefixo)
- Detetar variações: se o markdown contiver padrões de cores/tamanhos (ex: "Disponível em:", tabelas com opções), marcar no resultado

### 2. Adicionar prompt de enriquecimento nos `FIELD_PROMPTS`

- Não é necessário — o enriquecimento web não usa prompts de IA. Os prompts existentes já cobrem a otimização. O enriquecimento apenas faz scrape e guarda dados brutos.

### 3. Corrigir lógica de prefixos no botão "Enriquecer Web"

- Se não houver prefixos configurados, permitir enriquecimento na mesma (usar SKU completo como termo de pesquisa)
- O hook `useEnrichProducts.ts` já bloqueia se `supplierPrefixes.length === 0` — remover essa restrição

### Ficheiros a alterar

| Ficheiro | Ação |
|----------|------|
| `supabase/functions/enrich-products/index.ts` | Extrair imagens, atualizar produto, prefixos opcionais |
| `src/hooks/useEnrichProducts.ts` | Remover obrigatoriedade de prefixos |
| `src/pages/ProductsPage.tsx` | Permitir enriquecimento sem prefixos configurados |

### Detalhe técnico

```text
Fluxo Enriquecimento Melhorado:
┌─────────────┐
│ Produto SKU │
└──────┬──────┘
       │
  ┌────▼────┐    Tem prefixo?
  │ Prefixo │─── Sim → remove prefixo, constrói URL
  └────┬────┘─── Não → usa SKU completo no URL
       │
  ┌────▼──────┐
  │ Firecrawl │  formats: markdown + links
  └────┬──────┘
       │
  ┌────▼──────────────┐
  │ Extrair dados:    │
  │ - Imagens (regex) │
  │ - Specs (markdown)│
  │ - Variações       │
  └────┬──────────────┘
       │
  ┌────▼──────────────┐
  │ UPDATE produto:   │
  │ - image_urls      │
  │ - technical_specs │
  │ + Knowledge chunks│
  └───────────────────┘
```

