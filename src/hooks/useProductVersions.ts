import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ProductVersion {
  id: string;
  product_id: string;
  user_id: string;
  version_number: number;
  optimized_title: string | null;
  optimized_description: string | null;
  optimized_short_description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  seo_slug: string | null;
  tags: string[] | null;
  optimized_price: number | null;
  faq: any;
  created_at: string;
}

export function useProductVersions(productId: string | null) {
  return useQuery({
    queryKey: ["product-versions", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_versions")
        .select("*")
        .eq("product_id", productId!)
        .order("version_number", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data as ProductVersion[];
    },
  });
}

export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, version }: { productId: string; version: ProductVersion }) => {
      const { error } = await supabase
        .from("products")
        .update({
          optimized_title: version.optimized_title,
          optimized_description: version.optimized_description,
          optimized_short_description: version.optimized_short_description,
          meta_title: version.meta_title,
          meta_description: version.meta_description,
          seo_slug: version.seo_slug,
          tags: version.tags,
          optimized_price: version.optimized_price,
          faq: version.faq,
          status: "optimized" as const,
        })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-versions"] });
      toast.success("Versão restaurada com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
