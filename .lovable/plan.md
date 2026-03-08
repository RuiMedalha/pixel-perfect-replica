

## Plano: Importação WooCommerce Inteligente + Upsell/Cross-sell Corrigido + Deduplicação

### Problemas Identificados

1. **Upsell/Cross-sell guardados como `[{sku, title}]`** — WooCommerce espera apenas SKUs separados por vírgula (ex: `"P850501,P850502"`). O formato atual causa problemas na exportação e publicação.

2. **Sem deduplicação de produtos na importação** — ao carregar um 2º ficheiro com produtos que já existem (mesmo SKU), cria duplicados em vez de atualizar ou ignorar.

3. **Sem suporte para `Type`, `Parent SKU`, `Attributes` do WooCommerce** — o ficheiro Pujadas tem estas colunas mas são ignoradas.

4. **Publicação WooCommerce não envia upsell_ids/cross_sell_ids** — o `publish-woocommerce` não mapeia os SKUs para IDs do WooCommerce.

---

### O que vamos implementar

#### 1. Upsell/Cross-sell: formato SKU-only

**`optimize-product/index.ts`**:
- Alterar o schema da IA para retornar `upsell_skus` e `crosssell_skus` como arrays de strings (apenas SKUs), não objetos `{sku, title}`
- Na validação, manter apenas os SKUs reais da BD
- Guardar como `["P850501","P850502"]` em vez de `[{sku:"P850501",title:"..."}]`

**`useExportProducts.ts`**:
- Exportar como string separada por vírgulas: `"P850501,P850502"`

**`publish-woocommerce/index.ts`**:
- Resolver SKUs → `woocommerce_id` na BD e enviar `upsell_ids` e `cross_sell_ids` ao WooCommerce API

**`ProductDetailModal.tsx`**:
- Adaptar a exibição para o novo formato (só SKUs)

#### 2. Deduplicação por SKU na importação

**`parse-catalog/index.ts`**:
- Antes de inserir, consultar SKUs existentes no workspace
- Se o SKU já existe: **ignorar** (não duplicar)
- Reportar quantos foram ignorados vs inseridos
- Isto permite carregar múltiplos ficheiros sem medo de duplicados

#### 3. Importação WooCommerce (Type, Parent SKU, Attributes)

**`parse-catalog/index.ts`** — Modo WooCommerce (auto-detetado):
- **Pass 1**: Inserir todos os produtos, mapeando `Type` → `product_type`, e guardando `Attribute 1 name/value(s)` em `attributes`
- **Pass 2**: Resolver `Parent SKU` → `parent_product_id` (lookup por SKU)
- Mapear `Up-Sells` e `Cross-Sells` do ficheiro diretamente para `upsell_skus` / `crosssell_skus` como arrays de strings

**`useUploadCatalog.ts`** — Expandir `autoMapColumns`:
- Reconhecer headers WooCommerce: `Type`, `Parent`, `Attribute 1 name`, `Attribute 1 value(s)`, `Up-Sells`, `Cross-Sells`, `Sale price`, `Regular price`, `Images`, `Short description`

#### 4. Otimização em grupo para variáveis

**`optimize-product/index.ts`**:
- Quando se otimiza um produto `variable`: otimizar o pai e propagar título/descrição base para as variações, adicionando sufixo do atributo
- Quando se otimiza uma `variation`: buscar o pai e usar como contexto

---

### Ficheiros a editar

| Ficheiro | Alteração |
|---|---|
| `supabase/functions/optimize-product/index.ts` | Upsell/crosssell como array de SKUs; otimização em grupo para variáveis |
| `supabase/functions/parse-catalog/index.ts` | Deduplicação por SKU; modo WooCommerce (2 passagens); mapear Type/Parent/Attributes/Up-Sells/Cross-Sells |
| `supabase/functions/publish-woocommerce/index.ts` | Resolver SKUs → woocommerce_ids para upsell_ids/cross_sell_ids |
| `src/hooks/useUploadCatalog.ts` | Expandir autoMapColumns para headers WooCommerce |
| `src/hooks/useExportProducts.ts` | Exportar upsells como SKUs separados por vírgula |
| `src/components/ProductDetailModal.tsx` | Adaptar display para formato SKU-only |

### Notas

- Não é necessária migração de BD — `upsell_skus` e `crosssell_skus` já são JSONB e aceitam tanto `["SKU1","SKU2"]` como o formato antigo
- A deduplicação funciona por SKU dentro do mesmo workspace — ficheiros diferentes podem ter os mesmos produtos sem criar duplicados
- Os dados de Up-Sells/Cross-Sells do ficheiro WooCommerce (ex: `"P850501,P850502"`) são importados diretamente, evitando ter de re-otimizar a fase 3

