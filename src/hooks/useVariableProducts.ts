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

export interface AddToExistingGroup {
  existing_parent_id: string;
  existing_parent_title: string;
  attribute_name: string;
  products_to_add: Array<{
    product_id: string;
    attribute_value: string;
  }>;
  reason?: string;
}

interface DetectInput {
  workspaceId: string;
  products: Array<{
    id: string;
    sku: string | null;
    original_title: string | null;
    optimized_title: string | null;
    category: string | null;
    original_price: number | null;
    original_description: string | null;
    short_description: string | null;
    product_type: string;
    attributes: any;
    crosssell_skus?: any;
    upsell_skus?: any;
  }>;
  existingGroups?: Array<{
    parent_id: string;
    parent_title: string;
    attribute_name: string;
    existing_variations: Array<{ sku: string | null; attribute_value: string }>;
  }>;
  knowledgeContext?: string;
}

interface DetectResult {
  groups: VariationGroup[];
  addToExisting: AddToExistingGroup[];
  total_products: number;
}

export function useDetectVariations() {
  return useMutation({
    mutationFn: async (input: DetectInput): Promise<DetectResult> => {
      const { data, error } = await supabase.functions.invoke("detect-variations", {
        body: {
          workspaceId: input.workspaceId,
          products: input.products,
          existingGroups: input.existingGroups,
          knowledgeContext: input.knowledgeContext,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return {
        groups: data.groups || [],
        addToExisting: data.addToExisting || [],
        total_products: data.total_products || 0,
      };
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useApplyVariations() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ groups, addToExisting }: { groups: VariationGroup[]; addToExisting?: AddToExistingGroup[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const results = [];

      // Apply new groups
      for (const group of groups) {
        if (group.variations.length < 2) continue;

        const parentVariation = group.variations[0];
        const parentId = parentVariation.product_id;

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

        results.push({ group: group.parent_title, status: "applied", children: group.variations.length - 1 });
      }

      // Apply additions to existing groups
      if (addToExisting && addToExisting.length > 0) {
        for (const addition of addToExisting) {
          // First get current parent attributes to update values list
          const { data: parent } = await supabase
            .from("products")
            .select("attributes")
            .eq("id", addition.existing_parent_id)
            .single();

          const currentAttrs = Array.isArray(parent?.attributes) ? parent.attributes as any[] : [];
          const attrIdx = currentAttrs.findIndex((a: any) => a.name === addition.attribute_name);

          for (const product of addition.products_to_add) {
            await supabase
              .from("products")
              .update({
                product_type: "variation",
                parent_product_id: addition.existing_parent_id,
                attributes: [{
                  name: addition.attribute_name,
                  value: product.attribute_value,
                }],
              })
              .eq("id", product.product_id);

            // Add new value to parent's attribute values
            if (attrIdx >= 0) {
              const values = currentAttrs[attrIdx].values || [];
              if (!values.includes(product.attribute_value)) {
                values.push(product.attribute_value);
                currentAttrs[attrIdx].values = values;
              }
            }
          }

          // Update parent attributes
          if (attrIdx >= 0) {
            await supabase
              .from("products")
              .update({ attributes: currentAttrs })
              .eq("id", addition.existing_parent_id);
          }

          results.push({
            group: addition.existing_parent_title,
            status: "added",
            children: addition.products_to_add.length,
          });
        }
      }

      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      const applied = results.filter((r) => r.status === "applied").length;
      const added = results.filter((r) => r.status === "added").length;
      const parts = [];
      if (applied > 0) parts.push(`${applied} novo(s) grupo(s)`);
      if (added > 0) parts.push(`${added} adição(ões) a existentes`);
      toast.success(`Variações aplicadas: ${parts.join(", ")}!`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
