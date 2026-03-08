

## Plano: Publicação WooCommerce em Background com Progresso em Tempo Real

### Problema
A publicação atual é síncrona numa única chamada à Edge Function. Se demorar mais de 110s (muitos produtos), a função faz timeout e o utilizador perde o feedback. A barra de loading desaparece sem indicar sucesso ou falha. Não é possível fechar o browser e retomar.

### Solução
Replicar o padrão já usado na otimização (`optimization_jobs` + Realtime): criar uma tabela `publish_jobs` que persiste o estado, processar produto a produto na Edge Function com auto-invocação, e mostrar progresso em tempo real no frontend.

### Arquitetura

```text
[Frontend]                    [Edge Function]              [DB: publish_jobs]
    |                              |                              |
    |-- criar job (1 req) -------->|-- insere job "queued" ------>|
    |<---- jobId ------------------|                              |
    |                              |-- processa 1 produto ------->|
    |<-- Realtime update ---------|-- update progress ---------->|
    |                              |-- auto-invoke (próximo) ---->|
    |<-- Realtime update ---------|-- update progress ---------->|
    |          ...                 |          ...                  |
    |<-- Realtime "completed" ----|-- update final -------------->|
```

### Mudanças

#### 1. Nova tabela `publish_jobs` (migração SQL)
- `id`, `user_id`, `workspace_id`, `status` (queued/processing/completed/cancelled/failed)
- `total_products`, `processed_products`, `failed_products`
- `current_product_name`, `product_ids` (array), `publish_fields` (array), `pricing` (jsonb)
- `results` (jsonb array com resultado por produto)
- `scheduled_for` (timestamp, nullable -- para agendamento futuro)
- `created_at`, `started_at`, `completed_at`, `updated_at`
- RLS: utilizador gere os seus jobs
- Realtime habilitado

#### 2. Edge Function `publish-woocommerce` refatorada
- **Modo criação**: recebe `productIds`, `publishFields`, `pricing`, `scheduledFor` (opcional). Cria um registo em `publish_jobs` com status "queued" e retorna `{ jobId }`. Se `scheduledFor` está no futuro, fica em "scheduled".
- **Modo continuação**: recebe `{ jobId, startIndex }`. Processa produtos um a um (ou em lotes pequenos de ~5), atualiza `processed_products`, `current_product_name` e `results` a cada produto.
- **Auto-invocação**: após cada lote, invoca-se a si própria com `startIndex` incrementado (mesmo padrão do `optimize-batch`).
- Respeita status "cancelled" para parar.

#### 3. Novo hook `usePublishJob.ts`
- Padrão idêntico ao `useOptimizationJob.ts`:
  - Estado `activePublishJob`
  - Subscrição Realtime para updates
  - Check de jobs ativos no mount
  - Watchdog para re-invocar se stalled (>120s sem update)
  - Funções: `createPublishJob`, `cancelPublishJob`, `dismissPublishJob`

#### 4. UI de progresso no `ProductsPage.tsx`
- Barra de progresso persistente (igual à de otimização) mostrando:
  - "Publicando X/Y no WooCommerce..."
  - Nome do produto atual
  - Contadores: sucesso / erro
  - Botão cancelar
- Quando completo: resumo com resultados (criados, atualizados, erros)
- O progresso sobrevive a refresh da página (job é recuperado da DB)

#### 5. Agendamento (scheduled_for)
- No `WooPublishModal`, adicionar opção de agendar: date/time picker
- Se agendado, o job fica com status "scheduled" e `scheduled_for` preenchido
- Um cron job (pg_cron) verifica a cada minuto se há jobs scheduled cujo timestamp já passou e invoca a Edge Function

### Ficheiros afetados
- `supabase/functions/publish-woocommerce/index.ts` — refatorar para job-based
- `src/hooks/usePublishJob.ts` — novo (baseado em useOptimizationJob)
- `src/hooks/usePublishWooCommerce.ts` — simplificar para criar job
- `src/components/WooPublishModal.tsx` — adicionar opção de agendamento
- `src/pages/ProductsPage.tsx` — barra de progresso de publicação + integrar novo hook
- Migração SQL — tabela `publish_jobs` + Realtime

