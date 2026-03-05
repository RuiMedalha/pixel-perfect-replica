import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OptimizationField = 
  | "title" | "description" | "short_description"
  | "meta_title" | "meta_description" | "seo_slug"
  | "tags" | "price" | "faq";

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
];

export function useOptimizeProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ productIds, fieldsToOptimize }: { productIds: string[]; fieldsToOptimize?: OptimizationField[] }) => {
      const { data, error } = await supabase.functions.invoke("optimize-product", {
        body: { productIds, fieldsToOptimize },
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
