

## Problema Identificado

Atualmente, o feedback das operações WooCommerce é muito limitado:
- Um toast "A publicar..." no início
- Um toast final com contagem de sucesso/erro
- Nenhuma visibilidade produto a produto durante o processo
- Nenhum log de publicação no `activity_log`
- A edge function `publish-woocommerce` tem um **erro de sintaxe** (boot failure na linha 184) que impede qualquer publicação

Além disso, a sincronização de categorias tem o mesmo problema de falta de visibilidade.

## Plano

### 1. Corrigir o erro de sintaxe na edge function
O erro está na linha 184 do `publish-woocommerce/index.ts` — `await` dentro de `.map()` (não-async). Corrigir para usar um loop `for...of` ou tornar o callback async corretamente.

### 2. Adicionar log de publicação no `activity_log`
Após cada produto publicado/falhado, inserir um registo no `activity_log` com:
- `action: "publish"` (já existe no enum? verificar, senão adicionar)
- `details` com o resultado (woocommerce_id ou mensagem de erro)

### 3. Criar um painel de progresso em tempo real no frontend
Substituir o simples toast por um **painel de progresso persistente** na `ProductsPage`:

- Quando a publicação inicia, mostrar um card fixo no topo com:
  - Barra de progresso (X de Y produtos)
  - Lista scrollable dos resultados produto a produto (sucesso/erro com detalhes)
  - Estado: "A publicar...", "Concluído", "Concluído com erros"
- O mesmo padrão para a sincronização de categorias

### 4. Retornar resultados detalhados da edge function
A edge function já retorna `results[]` com status por produto. O frontend precisa de os mostrar de forma granular no painel de progresso, incluindo:
- Nome/SKU do produto
- Status (publicado/erro)
- WooCommerce ID atribuído
- Mensagem de erro se aplicável

### Ficheiros a alterar
- `supabase/functions/publish-woocommerce/index.ts` — fix syntax error + adicionar activity_log inserts
- `src/hooks/usePublishWooCommerce.ts` — retornar dados detalhados para o UI
- `src/pages/ProductsPage.tsx` — adicionar painel de progresso com resultados detalhados
- Possível migração SQL — adicionar `'publish'` ao enum `activity_action` se não existir

