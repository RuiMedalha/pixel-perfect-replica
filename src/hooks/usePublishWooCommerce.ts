import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function usePublishWooCommerce() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (productIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("publish-woocommerce", {
        body: { productIds },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: () => {
      toast.info("A publicar produtos no WooCommerce...");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
      const ok = data.results?.filter((r: any) => r.status === "published").length ?? 0;
      const fail = data.results?.filter((r: any) => r.status === "error").length ?? 0;
      if (fail > 0) {
        toast.warning(`${ok} publicado(s), ${fail} com erro.`);
      } else {
        toast.success(`${ok} produto(s) publicado(s) no WooCommerce!`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
