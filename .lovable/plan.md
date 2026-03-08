

## Plano: Indicador visual de publicação WooCommerce

### Problema
Não há indicação clara de quais produtos foram publicados no WooCommerce. O campo `status` pode ser "published" mas também existe o `woocommerce_id` que confirma se o produto existe realmente no WooCommerce.

### Solução
Adicionar um pequeno ícone/badge na coluna de status da tabela de produtos que indica se o produto tem um `woocommerce_id` (ou seja, foi sincronizado com WooCommerce).

### Mudanças

**`src/pages/ProductsPage.tsx`**
- Na coluna de status (linhas ~523-534), adicionar um indicador visual (ícone `Send` ou `Globe` com cor verde) quando `product.woocommerce_id` existe
- O badge aparecerá ao lado do status existente com tooltip "Publicado no WooCommerce (ID: X)"
- Adicionar filtro "Publicado no WC" / "Não publicado" nos filtros avançados para facilitar triagem

### Visual
- Produto COM `woocommerce_id`: badge verde com ícone `Send` + "WC #ID"
- Produto SEM `woocommerce_id`: nada extra (mantém comportamento atual)

### Filtro adicional
- Novo filtro nos filtros avançados: "WooCommerce" com opções "Todos", "Publicados no WC", "Não publicados"

