import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OptimizationField = 
  | "title" | "description" | "short_description"
  | "meta_title" | "meta_description" | "seo_slug"
  | "tags" | "faq" | "upsells" | "crosssells"
  | "image_alt" | "category";

export const OPTIMIZATION_PHASES = [
  {
    phase: 1 as const,
    label: "Conteúdo Base",
    description: "Título, descrição, tags, categoria e keywords",
    fields: ["title", "description", "short_description", "tags", "category"] as OptimizationField[],
  },
  {
    phase: 2 as const,
    label: "SEO",
    description: "Meta title, meta description, slug, FAQ e alt text",
    fields: ["meta_title", "meta_description", "seo_slug", "faq", "image_alt"] as OptimizationField[],
  },
  {
    phase: 3 as const,
    label: "Comercial",
    description: "Upsells e cross-sells",
    fields: ["upsells", "crosssells"] as OptimizationField[],
  },
];

export const OPTIMIZATION_FIELDS: { key: OptimizationField; label: string; phase: number }[] = [
  { key: "title", label: "Título", phase: 1 },
  { key: "description", label: "Descrição", phase: 1 },
  { key: "short_description", label: "Descrição Curta", phase: 1 },
  { key: "tags", label: "Tags", phase: 1 },
  { key: "category", label: "Categoria Sugerida", phase: 1 },
  { key: "meta_title", label: "Meta Title", phase: 2 },
  { key: "meta_description", label: "Meta Description", phase: 2 },
  { key: "seo_slug", label: "SEO Slug", phase: 2 },
  { key: "faq", label: "FAQ", phase: 2 },
  { key: "image_alt", label: "Alt Text Imagens", phase: 2 },
  
  { key: "upsells", label: "Upsells", phase: 3 },
  { key: "crosssells", label: "Cross-sells", phase: 3 },
];

export const AI_MODELS = [
  { key: "gemini-3-flash", label: "Gemini 3 Flash (Rápido)" },
  { key: "gemini-3-pro", label: "Gemini 3 Pro (Avançado)" },
  { key: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Raciocínio)" },
  { key: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Equilibrado)" },
  { key: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (Económico)" },
  { key: "gpt-5.2", label: "GPT-5.2 (Último modelo)" },
  { key: "gpt-5", label: "GPT-5 (Precisão)" },
  { key: "gpt-5-mini", label: "GPT-5 Mini (Custo-benefício)" },
  { key: "gpt-5-nano", label: "GPT-5 Nano (Ultra rápido)" },
];

export interface OptimizationProgress {
  total: number;
  done: number;
  currentIndex: number;
  currentProductName: string;
  currentPhase: number | null;
  currentPhaseLabel: string;
  estimatedSecondsLeft: number | null;
  startedAt: number;
  cancelled?: boolean;
}

/** Simple cancellation token shared between caller and mutation loop */
export class CancellationToken {
  private _cancelled = false;
  cancel() { this._cancelled = true; }
  get isCancelled() { return this._cancelled; }
}

// Retry helper with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelayMs = 2000): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || '';
      // Only retry on network/timeout/429 errors
      if (attempt < maxRetries && (msg.includes('429') || msg.includes('timeout') || msg.includes('FunctionsFetchError') || msg.includes('Failed to fetch'))) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms for: ${msg}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Process ONE product, ONE phase at a time
async function optimizeSingle(
  productId: string,
  fieldsToOptimize?: OptimizationField[],
  modelOverride?: string,
  workspaceId?: string,
  phase?: number,
  speedFlags?: { skipKnowledge?: boolean; skipScraping?: boolean; skipReranking?: boolean },
) {
  return withRetry(async () => {
    const { data, error } = await supabase.functions.invoke("optimize-product", {
      body: { productIds: [productId], fieldsToOptimize, modelOverride, workspaceId, phase, ...speedFlags },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  });
}

export function useOptimizeProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productIds,
      fieldsToOptimize,
      selectedPhases,
      modelOverride,
      workspaceId,
      onProgress,
      productNames,
      cancellationToken,
      skipKnowledge,
      skipScraping,
      skipReranking,
    }: {
      productIds: string[];
      fieldsToOptimize?: OptimizationField[];
      selectedPhases?: number[];
      modelOverride?: string;
      workspaceId?: string;
      onProgress?: (progress: OptimizationProgress) => void;
      productNames?: Record<string, string>;
      cancellationToken?: CancellationToken;
      skipKnowledge?: boolean;
      skipScraping?: boolean;
      skipReranking?: boolean;
    }) => {
      const allResults: any[] = [];
      const total = productIds.length;
      const startedAt = Date.now();
      const durations: number[] = [];

      // Determine which phases to run
      const phases = selectedPhases && selectedPhases.length > 0
        ? OPTIMIZATION_PHASES.filter(p => selectedPhases.includes(p.phase))
        : [{ phase: 0, label: "Completa", description: "", fields: [] as OptimizationField[] }]; // phase 0 = legacy all-at-once

      const totalSteps = total * phases.length;
      let stepsDone = 0;

      for (let i = 0; i < total; i++) {
        if (cancellationToken?.isCancelled) {
          onProgress?.({
            total, done: i, currentIndex: i,
            currentProductName: "", currentPhase: null,
            currentPhaseLabel: "",
            estimatedSecondsLeft: 0, startedAt, cancelled: true,
          });
          toast.info(`Otimização cancelada. ${i} de ${total} produtos processados.`);
          break;
        }

        const productId = productIds[i];
        const productName = productNames?.[productId] || `Produto ${i + 1}`;

        for (const phaseInfo of phases) {
          if (cancellationToken?.isCancelled) break;

          // Calculate ETA
          let estimatedSecondsLeft: number | null = null;
          if (durations.length > 0) {
            const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
            const remainingSteps = totalSteps - stepsDone;
            estimatedSecondsLeft = Math.round((avgMs * remainingSteps) / 1000);
          }

          const phaseLabel = phaseInfo.phase === 0
            ? "Completa"
            : `Fase ${phaseInfo.phase}: ${phaseInfo.label}`;

          onProgress?.({
            total, done: i, currentIndex: i,
            currentProductName: productName,
            currentPhase: phaseInfo.phase || null,
            currentPhaseLabel: phaseLabel,
            estimatedSecondsLeft, startedAt,
          });

          const itemStart = Date.now();
          try {
            const data = await optimizeSingle(
              productId,
              phaseInfo.phase === 0 ? fieldsToOptimize : phaseInfo.fields,
              modelOverride,
              workspaceId,
              phaseInfo.phase === 0 ? undefined : phaseInfo.phase,
              { skipKnowledge, skipScraping, skipReranking },
            );
            if (data.results) allResults.push(...data.results);
          } catch (err: any) {
            allResults.push({ productId, status: "error", error: err.message });
          }
          durations.push(Date.now() - itemStart);
          stepsDone++;
        }

        // Invalidate between products so UI updates progressively
        qc.invalidateQueries({ queryKey: ["products"] });
      }

      // Final progress
      onProgress?.({
        total, done: total, currentIndex: total - 1,
        currentProductName: "", currentPhase: null,
        currentPhaseLabel: "",
        estimatedSecondsLeft: 0, startedAt,
      });

      return { results: allResults };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
      qc.invalidateQueries({ queryKey: ["token-usage-summary"] });
      const ok = data.results?.filter((r: any) => r.status === "optimized").length ?? 0;
      const fail = data.results?.filter((r: any) => r.status === "error").length ?? 0;
      if (fail > 0) {
        toast.warning(`${ok} otimizado(s), ${fail} com erro.`);
      } else {
        toast.success(`${ok} produto(s) otimizado(s) com sucesso!`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
