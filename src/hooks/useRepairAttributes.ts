import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Silently repairs variation children that have null/empty attributes
 * by matching attribute values from the parent's attributes against the child's title.
 * Runs once per workspace session.
 */
export function useRepairAttributes() {
  const { activeWorkspace } = useWorkspaceContext();
  const repairedRef = useRef<Set<string>>(new Set());
  const qc = useQueryClient();

  useEffect(() => {
    if (!activeWorkspace) return;
    if (repairedRef.current.has(activeWorkspace.id)) return;

    const run = async () => {
      try {
        // Find children with missing attributes in this workspace
        const { data: brokenChildren, error: err1 } = await supabase
          .from("products")
          .select("id, parent_product_id, original_title, optimized_title, attributes")
          .eq("workspace_id", activeWorkspace.id)
          .not("parent_product_id", "is", null);

        if (err1 || !brokenChildren || brokenChildren.length === 0) {
          repairedRef.current.add(activeWorkspace.id);
          return;
        }

        // Filter to only those with empty/null attributes
        const needsRepair = brokenChildren.filter((c) => {
          const attrs = c.attributes;
          if (!attrs) return true;
          if (Array.isArray(attrs) && attrs.length === 0) return true;
          // Check if all values are empty
          if (Array.isArray(attrs) && attrs.every((a: any) => !a.value && !a.values)) return true;
          return false;
        });

        if (needsRepair.length === 0) {
          repairedRef.current.add(activeWorkspace.id);
          return;
        }

        // Get unique parent IDs
        const parentIds = [...new Set(needsRepair.map((c) => c.parent_product_id!))];

        // Fetch parents with their attributes
        const { data: parents } = await supabase
          .from("products")
          .select("id, attributes, original_title, optimized_title")
          .in("id", parentIds);

        if (!parents || parents.length === 0) {
          repairedRef.current.add(activeWorkspace.id);
          return;
        }

        const parentMap = new Map(parents.map((p) => [p.id, p]));
        let repaired = 0;

        for (const child of needsRepair) {
          const parent = parentMap.get(child.parent_product_id!);
          if (!parent) continue;

          const parentAttrs = parent.attributes as any[];
          if (!Array.isArray(parentAttrs) || parentAttrs.length === 0) continue;

          const childTitle = (child.optimized_title || child.original_title || "").toLowerCase();
          if (!childTitle) continue;

          // For each attribute, find which value from the parent's options appears in the child title
          const childAttrs: Array<{ name: string; value: string }> = [];

          for (const attr of parentAttrs) {
            const name = attr.name;
            const values: string[] = attr.values || [];
            let matched = "";

            // Sort by length descending to prefer longer/more specific matches
            const sorted = [...values].sort((a, b) => b.length - a.length);
            for (const val of sorted) {
              if (childTitle.includes(val.toLowerCase())) {
                matched = val;
                break;
              }
            }

            childAttrs.push({ name, value: matched });
          }

          // Only update if we matched at least one value
          if (childAttrs.some((a) => a.value)) {
            await supabase
              .from("products")
              .update({ attributes: childAttrs })
              .eq("id", child.id);
            repaired++;
          }
        }

        if (repaired > 0) {
          console.log(`[RepairAttributes] Repaired ${repaired} variations in workspace ${activeWorkspace.id}`);
          qc.invalidateQueries({ queryKey: ["products"] });
        }

        repairedRef.current.add(activeWorkspace.id);
      } catch (e) {
        console.error("[RepairAttributes] Error:", e);
        repairedRef.current.add(activeWorkspace.id);
      }
    };

    run();
  }, [activeWorkspace?.id, qc]);
}
