

## Problema

O produto "Triturador T402" já existia no WooCommerce com o ID **12837** (publicado em 2024), mas o sistema criou um **novo** produto com o ID **227211** em vez de atualizar o existente.

A causa está na linha 312-314 da edge function: o sistema apenas verifica se `product.woocommerce_id` existe na base de dados local. Como o produto foi importado do Excel sem esse campo preenchido, o sistema assumiu que era novo e fez `POST` em vez de `PUT`.

## Solução

Antes de criar um produto novo, pesquisar no WooCommerce por SKU. Se encontrar um produto existente, usar `PUT` para atualizar em vez de `POST`.

### Alterações

**`supabase/functions/publish-woocommerce/index.ts`**

Adicionar uma função `findWooProductBySku(sku)` que faz `GET /products?sku={sku}` à API do WooCommerce. Alterar a lógica de publicação para:

1. Se `product.woocommerce_id` existe → `PUT` (atualizar) como antes
2. Se não existe → chamar `findWooProductBySku(product.sku)`
   - Se encontrar resultado → `PUT` com o ID encontrado
   - Se não encontrar → `POST` (criar novo)
3. Em ambos os casos, guardar o `woocommerce_id` na base de dados local

Também alterar o resultado retornado para distinguir "created" vs "updated" no status, para o painel de progresso mostrar a ação correta.

**`src/pages/ProductsPage.tsx`**

Atualizar o painel de progresso para mostrar "Atualizado" (badge azul) quando `status === "updated"` e "Criado" (badge verde) quando `status === "created"`, em vez de sempre mostrar "Publicado".

