import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type Product = Tables<"products">;

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
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
  return useQuery({
    queryKey: ["product-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("status");
      if (error) throw error;
      const pending = data.filter((p) => p.status === "pending" || p.status === "processing").length;
      const optimized = data.filter((p) => p.status === "optimized").length;
      const published = data.filter((p) => p.status === "published").length;
      return { pending, optimized, published, total: data.length };
    },
  });
}
