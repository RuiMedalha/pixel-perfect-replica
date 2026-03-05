import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useOptimizeProducts() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (productIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("optimize-product", {
        body: { productIds },
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
