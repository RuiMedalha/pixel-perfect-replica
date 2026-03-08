import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface VariationGroup {
  parent_title: string;
  attribute_names: string[];
  variations: Array<{
    product_id: string;
    attribute_values: Record<string, string>;
  }>;
  // Legacy single-attribute compat
  attribute_name?: string;
}

export interface AddToExistingGroup {
  existing_parent_id: string;
  existing_parent_title: string;
  attribute_names: string[];
  products_to_add: Array<{
    product_id: string;
    attribute_values: Record<string, string>;
  }>;
  reason?: string;
  // Legacy
  attribute_name?: string;
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
    attribute_names: string[];
    existing_variations: Array<{ sku: string | null; attribute_values: Record<string, string> }>;
  }>;
  knowledgeContext?: string;
}

interface DetectResult {
  groups: VariationGroup[];
  addToExisting: AddToExistingGroup[];
  total_products: number;
}

/** Normalize legacy single-attribute format to multi-attribute */
function normalizeGroup(g: any): VariationGroup {
  const attrNames = g.attribute_names || (g.attribute_name ? [g.attribute_name] : ["Variação"]);
  return {
    parent_title: g.parent_title,
    attribute_names: attrNames,
    variations: (g.variations || []).map((v: any) => ({
      product_id: v.product_id,
      attribute_values: v.attribute_values || (v.attribute_value ? { [attrNames[0]]: v.attribute_value } : {}),
    })),
  };
}

function normalizeAddition(a: any): AddToExistingGroup {
  const attrNames = a.attribute_names || (a.attribute_name ? [a.attribute_name] : ["Variação"]);
  return {
    existing_parent_id: a.existing_parent_id,
    existing_parent_title: a.existing_parent_title,
    attribute_names: attrNames,
    products_to_add: (a.products_to_add || []).map((v: any) => ({
      product_id: v.product_id,
      attribute_values: v.attribute_values || (v.attribute_value ? { [attrNames[0]]: v.attribute_value } : {}),
    })),
    reason: a.reason,
  };
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
        groups: (data.groups || []).map(normalizeGroup),
        addToExisting: (data.addToExisting || []).map(normalizeAddition),
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

        // Build parent attributes array: [{name, values: [...]}]
        const parentAttrs = group.attribute_names.map(name => ({
          name,
          values: [...new Set(group.variations.map(v => v.attribute_values[name]).filter(Boolean))],
        }));

        const { error: parentError } = await supabase
          .from("products")
          .update({
            product_type: "variable",
            optimized_title: group.parent_title,
            attributes: parentAttrs,
          })
          .eq("id", parentId);

        if (parentError) {
          results.push({ group: group.parent_title, status: "error", error: parentError.message });
          continue;
        }

        for (const variation of group.variations.slice(1)) {
          // Build child attributes: [{name, value}]
          const childAttrs = group.attribute_names.map(name => ({
            name,
            value: variation.attribute_values[name] || "",
          }));

          await supabase
            .from("products")
            .update({
              product_type: "variation",
              parent_product_id: parentId,
              attributes: childAttrs,
            })
            .eq("id", variation.product_id);
        }

        results.push({ group: group.parent_title, status: "applied", children: group.variations.length - 1 });
      }

      // Apply additions to existing groups
      if (addToExisting && addToExisting.length > 0) {
        for (const addition of addToExisting) {
          const { data: parent } = await supabase
            .from("products")
            .select("attributes")
            .eq("id", addition.existing_parent_id)
            .single();

          const currentAttrs = Array.isArray(parent?.attributes) ? parent.attributes as any[] : [];

          for (const product of addition.products_to_add) {
            const childAttrs = addition.attribute_names.map(name => ({
              name,
              value: product.attribute_values[name] || "",
            }));

            await supabase
              .from("products")
              .update({
                product_type: "variation",
                parent_product_id: addition.existing_parent_id,
                attributes: childAttrs,
              })
              .eq("id", product.product_id);

            // Update parent attribute values
            for (const name of addition.attribute_names) {
              const attrIdx = currentAttrs.findIndex((a: any) => a.name === name);
              const val = product.attribute_values[name];
              if (val && attrIdx >= 0) {
                const values = currentAttrs[attrIdx].values || [];
                if (!values.includes(val)) {
                  values.push(val);
                  currentAttrs[attrIdx].values = values;
                }
              } else if (val && attrIdx < 0) {
                currentAttrs.push({ name, values: [val] });
              }
            }
          }

          await supabase
            .from("products")
            .update({ attributes: currentAttrs })
            .eq("id", addition.existing_parent_id);

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
