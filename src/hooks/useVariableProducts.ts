import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface VariationGroup {
  parent_title: string;
  attribute_name: string;
  variations: Array<{
    product_id: string;
    attribute_value: string;
  }>;
}

export function useDetectVariations() {
  return useMutation({
    mutationFn: async ({ workspaceId, products }: { workspaceId: string; products: Array<{ id: string; sku: string | null; original_title: string | null; optimized_title: string | null; category: string | null; original_price: number | null; original_description: string | null; short_description: string | null; product_type: string; attributes: any }> }) => {
      const { data, error } = await supabase.functions.invoke("detect-variations", {
        body: { workspaceId, products },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { groups: VariationGroup[]; total_products: number };
    },
    onMutate: () => {
      toast.info("A detetar variações de produtos com IA...");
    },
    onSuccess: (data) => {
      if (data.groups.length === 0) {
        toast.info("Nenhuma variação detetada nos produtos.");
      } else {
        const totalVariations = data.groups.reduce((s, g) => s + g.variations.length, 0);
        toast.success(`${data.groups.length} grupo(s) detetado(s) com ${totalVariations} variações!`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useApplyVariations() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ groups }: { groups: VariationGroup[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const results = [];

      for (const group of groups) {
        if (group.variations.length < 2) continue;

        // Pick the first variation as the parent
        const parentVariation = group.variations[0];
        const parentId = parentVariation.product_id;

        // Update parent product
        const { error: parentError } = await supabase
          .from("products")
          .update({
            product_type: "variable",
            optimized_title: group.parent_title,
            attributes: [{
              name: group.attribute_name,
              values: group.variations.map((v) => v.attribute_value),
            }],
          })
          .eq("id", parentId);

        if (parentError) {
          results.push({ group: group.parent_title, status: "error", error: parentError.message });
          continue;
        }

        // Update children (all except the parent)
        for (const variation of group.variations.slice(1)) {
          await supabase
            .from("products")
            .update({
              product_type: "variation",
              parent_product_id: parentId,
              attributes: [{
                name: group.attribute_name,
                value: variation.attribute_value,
              }],
            })
            .eq("id", variation.product_id);
        }

        // Also set the parent's own attribute value
        await supabase
          .from("products")
          .update({
            attributes: [{
              name: group.attribute_name,
              values: group.variations.map((v) => v.attribute_value),
            }],
          })
          .eq("id", parentId);

        results.push({ group: group.parent_title, status: "applied", children: group.variations.length - 1 });
      }

      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      const applied = results.filter((r) => r.status === "applied").length;
      toast.success(`${applied} grupo(s) de variações aplicado(s)!`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
