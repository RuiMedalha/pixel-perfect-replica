import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OptimizationField = 
  | "title" | "description" | "short_description"
  | "meta_title" | "meta_description" | "seo_slug"
  | "tags" | "price" | "faq" | "upsells" | "crosssells"
  | "image_alt";

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
];

export const AI_MODELS = [
  { key: "gemini-flash", label: "Gemini 3 Flash (Rápido)" },
  { key: "gemini-pro", label: "Gemini 2.5 Pro (Avançado)" },
  { key: "gpt5", label: "GPT-5 (Precisão)" },
  { key: "gpt5-mini", label: "GPT-5 Mini (Equilibrado)" },
];

export function useOptimizeProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ productIds, fieldsToOptimize, modelOverride, workspaceId }: { productIds: string[]; fieldsToOptimize?: OptimizationField[]; modelOverride?: string; workspaceId?: string }) => {
      const { data, error } = await supabase.functions.invoke("optimize-product", {
        body: { productIds, fieldsToOptimize, modelOverride, workspaceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: () => {
      toast.info("A otimizar produtos com IA...");
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
