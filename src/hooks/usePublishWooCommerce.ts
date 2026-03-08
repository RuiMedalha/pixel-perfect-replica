import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PricingOptions } from "@/components/WooPublishModal";

export interface PublishResult {
  id: string;
  status: string;
  woocommerce_id?: number;
  error?: string;
}

export interface PublishResponse {
  results: PublishResult[];
}

export function usePublishWooCommerce() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ productIds, publishFields, pricing }: { productIds: string[]; publishFields?: string[]; pricing?: PricingOptions }): Promise<PublishResponse> => {
      const { data, error } = await supabase.functions.invoke("publish-woocommerce", {
        body: { productIds, publishFields, pricing },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as PublishResponse;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
