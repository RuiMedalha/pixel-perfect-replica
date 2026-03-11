import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Category {
  id: string;
  user_id: string;
  workspace_id: string | null;
  parent_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  meta_title: string | null;
  meta_description: string | null;
  image_url: string | null;
  sort_order: number | null;
  woocommerce_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryTree extends Category {
  children: CategoryTree[];
  depth: number;
  productCount?: number;
}

function buildTree(categories: Category[], parentId: string | null = null, depth = 0): CategoryTree[] {
  return categories
    .filter(c => c.parent_id === parentId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(c => ({
      ...c,
      depth,
      children: buildTree(categories, c.id, depth + 1),
    }));
}

// Categories are now GLOBAL (per user), not workspace-scoped
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Category[];
    },
  });
}

export function useCategoryTree() {
  const { data: categories, ...rest } = useCategories();
  const tree = categories ? buildTree(categories) : [];
  return { data: tree, flat: categories ?? [], ...rest };
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cat: { name: string; parent_id?: string | null; slug?: string; description?: string; meta_title?: string; meta_description?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("categories").insert({
        ...cat,
        user_id: user.id,
        workspace_id: null, // Global — shared across all workspaces
        parent_id: cat.parent_id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoria criada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from("categories").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoria atualizada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoria eliminada!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSyncWooCategories() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-woo-categories", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { total: number; created: number; updated: number };
    },
    onMutate: () => {
      toast.info("A sincronizar categorias do WooCommerce...");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(`${data.total} categorias sincronizadas (${data.created} novas, ${data.updated} atualizadas)`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
