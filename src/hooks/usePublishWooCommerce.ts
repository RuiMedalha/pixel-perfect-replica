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
  jobId?: string;
  results?: PublishResult[];
}

export function usePublishWooCommerce() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ productIds, publishFields, pricing, scheduledFor, workspaceId }: { productIds: string[]; publishFields?: string[]; pricing?: PricingOptions; scheduledFor?: string; workspaceId?: string }): Promise<PublishResponse> => {
      const { data, error } = await supabase.functions.invoke("publish-woocommerce", {
        body: { productIds, publishFields, pricing, scheduledFor, workspaceId },
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
