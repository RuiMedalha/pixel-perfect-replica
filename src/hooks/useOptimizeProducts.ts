import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OptimizationField = 
  | "title" | "description" | "short_description"
  | "meta_title" | "meta_description" | "seo_slug"
  | "tags" | "price" | "faq" | "upsells" | "crosssells"
  | "image_alt" | "category";

export const OPTIMIZATION_FIELDS: { key: OptimizationField; label: string }[] = [
  { key: "title", label: "Título" },
  { key: "description", label: "Descrição" },
  { key: "short_description", label: "Descrição Curta" },
  { key: "meta_title", label: "Meta Title" },
  { key: "meta_description", label: "Meta Description" },
  { key: "seo_slug", label: "SEO Slug" },
  { key: "tags", label: "Tags" },
  { key: "price", label: "Preço" },
  { key: "faq", label: "FAQ" },
  { key: "upsells", label: "Upsells" },
  { key: "crosssells", label: "Cross-sells" },
  { key: "image_alt", label: "Alt Text Imagens" },
  { key: "category", label: "Categoria Sugerida" },
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
  estimatedSecondsLeft: number | null;
  startedAt: number;
}

// Process ONE product at a time to avoid edge function timeouts
async function optimizeSingle(
  productId: string,
  fieldsToOptimize?: OptimizationField[],
  modelOverride?: string,
  workspaceId?: string
) {
  const { data, error } = await supabase.functions.invoke("optimize-product", {
    body: { productIds: [productId], fieldsToOptimize, modelOverride, workspaceId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useOptimizeProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productIds,
      fieldsToOptimize,
      modelOverride,
      workspaceId,
      onProgress,
      productNames,
    }: {
      productIds: string[];
      fieldsToOptimize?: OptimizationField[];
      modelOverride?: string;
      workspaceId?: string;
      onProgress?: (progress: OptimizationProgress) => void;
      productNames?: Record<string, string>;
    }) => {
      const allResults: any[] = [];
      const total = productIds.length;
      const startedAt = Date.now();
      const durations: number[] = [];

      for (let i = 0; i < total; i++) {
        const productId = productIds[i];
        const productName = productNames?.[productId] || `Produto ${i + 1}`;

        // Calculate ETA based on average duration of completed items
        let estimatedSecondsLeft: number | null = null;
        if (durations.length > 0) {
          const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
          estimatedSecondsLeft = Math.round((avgMs * (total - i)) / 1000);
        }

        onProgress?.({
          total,
          done: i,
          currentIndex: i,
          currentProductName: productName,
          estimatedSecondsLeft,
          startedAt,
        });

        const itemStart = Date.now();
        try {
          const data = await optimizeSingle(productId, fieldsToOptimize, modelOverride, workspaceId);
          if (data.results) allResults.push(...data.results);
        } catch (err: any) {
          allResults.push({ productId, status: "error", error: err.message });
        }
        durations.push(Date.now() - itemStart);

        // Invalidate between items so UI updates progressively
        qc.invalidateQueries({ queryKey: ["products"] });
      }

      // Final progress
      onProgress?.({
        total,
        done: total,
        currentIndex: total - 1,
        currentProductName: "",
        estimatedSecondsLeft: 0,
        startedAt,
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
