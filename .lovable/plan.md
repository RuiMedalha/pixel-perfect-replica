

## Problema

Quando o sistema faz scraping de uma página de fornecedor (ex: Lacor), deteta variações (Diâmetro 20, 24, 28...) e os seus SKUs, mas:
1. **Não cria produtos-filho** (variations) na base de dados com esses SKUs
2. **Não faz scraping individual** de cada variação para obter dados específicos (preço, imagens, specs)
3. Na otimização, o produto pai fica "variable" mas sem variações reais associadas

## Solução: Enriquecimento com Criação Automática de Variações

### Edge Function `enrich-products` --- Novo Fluxo

Após a IA extrair variações com SKUs (ex: `{ name: "Diâmetro (cm)", values: ["20","24","28"], skus: ["54020","54024","54028"] }`):

1. **Scraping individual** de cada variação --- usar o mesmo padrão de URL do fornecedor substituindo o SKU da variação (ex: `lacor.es/buscar/54024`)
2. **Criar produtos-filho** na tabela `products` com:
   - `product_type: "variation"`
   - `parent_product_id: <id do produto pai>`
   - `sku: <sku da variação>`
   - `original_title: "<título pai> - <valor do atributo>"` (ex: "Cacerola Chef-Luxe - D.24")
   - `attributes: [{ name: "Diâmetro (cm)", value: "24" }]` (valor singular, não array)
   - Imagens e specs específicas extraídas do scraping individual
3. **Atualizar produto pai** para `product_type: "variable"` (já faz)
4. **Evitar duplicados** --- verificar se já existe produto com o mesmo SKU no workspace antes de criar

### Passos de Implementação

**1. Modificar `supabase/functions/enrich-products/index.ts`**
- Após a extração AI com variações+SKUs, adicionar lógica de "expand variations":
  - Para cada SKU de variação, verificar se já existe no workspace
  - Se não existir, fazer scrape da página individual usando o mesmo `matchedPrefix.searchUrl`
  - Inserir novo produto como `variation` com `parent_product_id` apontando para o pai
  - Copiar specs/imagens do scraping individual ou herdar do pai

**2. Modificar o prompt da IA** (já existente)
- Reforçar no prompt que deve extrair URLs individuais de cada variação quando disponíveis (links dentro da secção `product-size`)
- Adicionar campo `variation_urls` ao schema da tool function

**3. Nenhuma migração necessária**
- A tabela `products` já tem `parent_product_id` e `product_type` que suportam o modelo pai/filho

### Detalhe Técnico da Expansão

```text
Produto Pai (SKU: 54020)          Após Enriquecimento
┌──────────────────────┐          ┌──────────────────────┐
│ type: simple         │    →     │ type: variable       │
│ attributes: null     │          │ attributes: [{       │
│                      │          │   name: "Diâmetro",  │
│                      │          │   values: [20,24...] │
│                      │          │ }]                   │
└──────────────────────┘          └──────────────────────┘
                                        │
                                  ┌─────┴─────┐
                                  ▼           ▼
                            ┌──────────┐ ┌──────────┐
                            │SKU:54020 │ │SKU:54024 │
                            │type:     │ │type:     │
                            │variation │ │variation │
                            │D: 20cm   │ │D: 24cm   │
                            │parent_id │ │parent_id │
                            │= pai     │ │= pai     │
                            └──────────┘ └──────────┘
```

### Limites e Cuidados
- Limitar scraping individual a no máximo 10 variações por produto (evitar excesso de créditos Firecrawl)
- Se o SKU da variação já existir como produto simples no workspace, converter para `variation` e associar ao pai em vez de criar novo
- Manter o scraping individual opcional (só executa se `skus` forem extraídos pela IA)

