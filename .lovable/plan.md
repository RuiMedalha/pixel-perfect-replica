
Objetivo: corrigir o bug em que o botão **“Publicar WC”** fica bloqueado e não volta a permitir nova publicação.

Diagnóstico (feito no código atual):
- Em `src/hooks/usePublishJob.ts`, `createPublishJob()` faz `setIsCreating(true)` no início, mas **não faz reset em sucesso**.
- Só existe `setIsCreating(false)` no caminho de erro final.
- Em `src/pages/ProductsPage.tsx`, o botão “Publicar WC” usa `disabled={isCreatingPublish}`.
- Resultado: após uma publicação iniciada com sucesso, `isCreatingPublish` pode ficar `true` e o botão permanece desativado.

Plano de implementação:
1) Corrigir estado de loading no hook de publicação  
- Ficheiro: `src/hooks/usePublishJob.ts`  
- Refatorar `createPublishJob()` para usar `try/catch/finally` (como já acontece em `useOptimizationJob`).  
- Garantir `setIsCreating(false)` em `finally`, independentemente de sucesso/erro/retries.

2) Corrigir fluxo do modal para não fechar prematuramente em erro  
- Ficheiro: `src/pages/ProductsPage.tsx`  
- Tornar `onConfirm` do `WooPublishModal` assíncrono com `await createPublishJob(...)`.  
- Só executar `setSelected(new Set())` e `setShowPublishModal(false)` **após sucesso real**.  
- Em erro, manter modal aberto (feedback via toast já existe), para o utilizador tentar novamente sem perder seleção.

3) Proteger contra dupla submissão (sem alterar UX atual)  
- Manter `disabled={isCreatingPublish}` no botão e no confirm do modal, mas agora apenas durante a chamada ativa real.

Validação (end-to-end):
- Selecionar 1+ produtos e abrir modal de publicação.
- Confirmar publicação e verificar:
  - botão fica desativado apenas durante criação do job;
  - após criação, volta a ficar ativo.
- Forçar um erro (ex.: falha de função) e confirmar:
  - modal não fecha automaticamente;
  - seleção não é limpa;
  - botão volta a estado clicável após o erro.
- Repetir segunda publicação seguida para confirmar que não “prende” novamente.

Impacto esperado:
- Remove o bloqueio permanente do botão “Publicar WC”.
- Evita perda de contexto do utilizador quando a criação do job falha.
- Mantém o comportamento atual de publicação em background com feedback de progresso.
