import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export type Product = Tables<"products">;

export function useProducts() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["products", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const all: any[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let query = supabase
          .from("products")
          .select("id, sku, original_title, optimized_title, original_price, optimized_price, sale_price, optimized_sale_price, status, product_type, parent_product_id, category, category_id, image_urls, technical_specs, attributes, meta_title, meta_description, seo_slug, optimized_description, optimized_short_description, short_description, original_description, tags, faq, focus_keyword, image_alt_texts, seo_score, woocommerce_id, source_file, supplier_ref, workspace_id, user_id, created_at, updated_at, upsell_skus, crosssell_skus")
          .order("updated_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (activeWorkspace) {
          query = query.eq("workspace_id", activeWorkspace.id);
        }
        const { data, error } = await query;
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });
}

export function useUpdateProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: Enums<"product_status"> }) => {
      const { error } = await supabase
        .from("products")
        .update({ status })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      toast.success("Estado atualizado com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useProductStats() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["product-stats", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      const all: { status: string }[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        let query = supabase.from("products").select("status").range(from, from + pageSize - 1);
        if (activeWorkspace) {
          query = query.eq("workspace_id", activeWorkspace.id);
        }
        const { data, error } = await query;
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      const pending = all.filter((p) => p.status === "pending" || p.status === "processing").length;
      const optimized = all.filter((p) => p.status === "optimized").length;
      const published = all.filter((p) => p.status === "published").length;
      return { pending, optimized, published, total: all.length };
    },
  });
}
