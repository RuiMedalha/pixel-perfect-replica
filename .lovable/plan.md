

## Problema Identificado

A função `resolveSkusToWooIds` procura os SKUs dos upsells/crosssells na base de dados **local** para obter o `woocommerce_id`. Mas a maioria dos produtos relacionados **não tem `woocommerce_id` preenchido** (são `null`), logo a resolução retorna uma lista vazia e os upsells/crosssells nunca são enviados ao WooCommerce.

Exemplo: o produto `UD2111.577` tem upsells `[UD4001.624, UD4001.620, UD4001.618]` — mas todos esses produtos têm `woocommerce_id: null` na base de dados local.

## Solução

Alterar `resolveSkusToWooIds` para fazer **fallback à API do WooCommerce** quando a resolução local falha:

### Alterações em `supabase/functions/publish-woocommerce/index.ts`

Reescrever `resolveSkusToWooIds`:

1. Primeiro, tentar resolver pela base de dados local (como agora)
2. Para SKUs que **não foram resolvidos** localmente, fazer `GET /products?sku={sku}` ao WooCommerce para cada um
3. Quando encontrar via API, **guardar o `woocommerce_id`** na base de dados local (para evitar lookups futuros)
4. Retornar a lista combinada de IDs resolvidos

```text
resolveSkusToWooIds(skus):
  1. Query local DB → get woocommerce_ids where not null
  2. Unresolved SKUs → for each, call WooCommerce GET /products?sku=X
  3. Found remotely → update local DB with woocommerce_id
  4. Return all resolved IDs
```

Esta abordagem é consistente com o `findWooProductBySku` já implementado para o produto principal.

### Impacto no formato dos SKUs

Os SKUs na base de dados local usam formato com ponto (ex: `UD4001.624`). Se o WooCommerce também usa este formato, o lookup funcionará. Se houver diferença (ex: sem ponto), será necessário normalizar — mas isso será validado automaticamente pelo primeiro teste.

