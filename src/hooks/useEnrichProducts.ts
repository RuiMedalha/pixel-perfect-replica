import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SupplierPrefix {
  name: string;
  prefix: string;
  searchUrl: string;
}

interface MissingVariation {
  parentSku: string;
  sku: string;
  value: string;
  url?: string;
}

interface EnrichResult {
  total: number;
  enriched: number;
  failed: number;
  skipped: number;
  missingVariations: MissingVariation[];
}

export function useEnrichProducts() {
  const [isEnriching, setIsEnriching] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [missingVariations, setMissingVariations] = useState<MissingVariation[]>([]);
  const qc = useQueryClient();

  const enrich = async ({
    workspaceId,
    supplierPrefixes = [],
    productIds,
  }: {
    workspaceId: string;
    supplierPrefixes?: SupplierPrefix[];
    productIds?: string[];
  }) => {

    setIsEnriching(true);
    setResult(null);
    setMissingVariations([]);

    try {
      const { data, error } = await supabase.functions.invoke("enrich-products", {
        body: { workspaceId, supplierPrefixes, productIds },
      });

      if (error) throw error;

      // Collect missing variations from all results
      const allMissing: MissingVariation[] = [];
      for (const r of (data.results || [])) {
        if (r.missingVariations && r.missingVariations.length > 0) {
          for (const mv of r.missingVariations) {
            allMissing.push({ parentSku: r.sku, ...mv });
          }
        }
      }

      const variationsCreated = (data.results || []).reduce((sum: number, r: any) => sum + (r.variationsCreated || 0), 0);

      const res: EnrichResult = {
        total: data.total,
        enriched: data.enriched,
        failed: data.failed,
        skipped: data.skipped,
        missingVariations: allMissing,
      };

      setResult(res);
      setMissingVariations(allMissing);

      if (res.enriched > 0) {
        qc.invalidateQueries({ queryKey: ["products"] });
        const varMsg = variationsCreated > 0 ? ` | ${variationsCreated} variações ligadas` : '';
        toast.success(`${res.enriched} produto(s) enriquecidos via web!${varMsg}${res.skipped > 0 ? ` (${res.skipped} já tinham dados)` : ""}`);
      } else if (res.skipped > 0) {
        toast.info(`Todos os ${res.skipped} produtos já tinham dados de enriquecimento.`);
      } else {
        toast.warning("Nenhum produto foi enriquecido. Verifique os prefixos de fornecedor.");
      }

      // Show warning for missing variations
      if (allMissing.length > 0) {
        const skuList = allMissing.map(m => m.sku).join(', ');
        toast.warning(
          `⚠️ ${allMissing.length} variação(ões) não encontrada(s) na lista: ${skuList}`,
          { duration: 15000 }
        );
      }

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enriquecer";
      toast.error(msg);
      return null;
    } finally {
      setIsEnriching(false);
    }
  };

  const createMissingVariations = async (workspaceId: string, variations: MissingVariation[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      let created = 0;
      for (const mv of variations) {
        // Get parent product data
        const { data: parent } = await supabase.from("products")
          .select("id, original_title, image_urls, technical_specs, source_file, supplier_ref, attributes")
          .eq("sku", mv.parentSku)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (!parent) continue;

        const attrName = (parent.attributes as any)?.[0]?.name || 'Variação';

        await supabase.from("products").insert({
          user_id: user.id,
          workspace_id: workspaceId,
          sku: mv.sku,
          original_title: `${parent.original_title || ''} - ${mv.value}`.trim(),
          product_type: 'variation',
          parent_product_id: parent.id,
          attributes: [{ name: attrName, value: mv.value }],
          status: 'pending',
          source_file: parent.source_file || null,
          supplier_ref: parent.supplier_ref || null,
          image_urls: parent.image_urls || null,
          technical_specs: parent.technical_specs || null,
        } as any);
        created++;
      }

      qc.invalidateQueries({ queryKey: ["products"] });
      setMissingVariations([]);
      toast.success(`${created} variação(ões) criada(s) com sucesso!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar variações");
    }
  };

  return { enrich, isEnriching, result, missingVariations, createMissingVariations };
}
