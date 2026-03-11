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

export interface EnrichProgress {
  total: number;
  done: number;
  currentSku: string;
  estimatedSecondsLeft: number | null;
  startedAt: number;
}

export function useEnrichProducts() {
  const [isEnriching, setIsEnriching] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [missingVariations, setMissingVariations] = useState<MissingVariation[]>([]);
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  const qc = useQueryClient();

  const enrich = async ({
    workspaceId,
    supplierPrefixes = [],
    productIds,
    onProgress,
  }: {
    workspaceId: string;
    supplierPrefixes?: SupplierPrefix[];
    productIds?: string[];
    onProgress?: (p: EnrichProgress) => void;
  }) => {

    setIsEnriching(true);
    setResult(null);
    setMissingVariations([]);
    setProgress(null);

    try {
      // If we have specific productIds and more than 5, batch them for progress reporting
      if (productIds && productIds.length > 5) {
        const batchSize = 3;
        const startedAt = Date.now();
        const durations: number[] = [];
        let totalEnriched = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        const allMissing: MissingVariation[] = [];
        const total = productIds.length;

        for (let i = 0; i < productIds.length; i += batchSize) {
          const batch = productIds.slice(i, i + batchSize);
          
          // Update progress
          const done = i;
          let estimatedSecondsLeft: number | null = null;
          if (durations.length > 0) {
            const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
            const remaining = Math.ceil((total - done) / batchSize);
            estimatedSecondsLeft = Math.round((avgMs * remaining) / 1000);
          }
          const p: EnrichProgress = { total, done, currentSku: `Lote ${Math.floor(i / batchSize) + 1}`, estimatedSecondsLeft, startedAt };
          setProgress(p);
          onProgress?.(p);

          const batchStart = Date.now();
          const { data, error } = await supabase.functions.invoke("enrich-products", {
            body: { workspaceId, supplierPrefixes, productIds: batch },
          });
          durations.push(Date.now() - batchStart);

          if (error) {
            totalFailed += batch.length;
            continue;
          }

          totalEnriched += data.enriched || 0;
          totalFailed += data.failed || 0;
          totalSkipped += data.skipped || 0;

          for (const r of (data.results || [])) {
            if (r.missingVariations && r.missingVariations.length > 0) {
              for (const mv of r.missingVariations) {
                allMissing.push({ parentSku: r.sku, ...mv });
              }
            }
          }

          // Invalidate between batches for progressive UI updates
          qc.invalidateQueries({ queryKey: ["products"] });
        }

        const res: EnrichResult = {
          total,
          enriched: totalEnriched,
          failed: totalFailed,
          skipped: totalSkipped,
          missingVariations: allMissing,
        };
        setResult(res);
        setMissingVariations(allMissing);
        setProgress({ total, done: total, currentSku: "", estimatedSecondsLeft: 0, startedAt });

        if (totalEnriched > 0) {
          qc.invalidateQueries({ queryKey: ["products"] });
          toast.success(`${totalEnriched} produto(s) enriquecidos via web!${totalSkipped > 0 ? ` (${totalSkipped} já tinham dados)` : ""}`);
        } else if (totalSkipped > 0) {
          toast.info(`Todos os ${totalSkipped} produtos já tinham dados de enriquecimento.`);
        } else {
          toast.warning("Nenhum produto foi enriquecido.");
        }

        if (allMissing.length > 0) {
          toast.warning(`⚠️ ${allMissing.length} variação(ões) não encontrada(s) na lista.`, { duration: 15000 });
        }

        setTimeout(() => setProgress(null), 3000);
        return res;
      }

      // Original single-call for small batches or full workspace
      const { data, error } = await supabase.functions.invoke("enrich-products", {
        body: { workspaceId, supplierPrefixes, productIds },
      });

      if (error) throw error;

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

  return { enrich, isEnriching, result, missingVariations, createMissingVariations, progress };
}
