import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SupplierPrefix {
  name: string;
  prefix: string;
  searchUrl: string;
}

interface EnrichResult {
  total: number;
  enriched: number;
  failed: number;
  skipped: number;
}

export function useEnrichProducts() {
  const [isEnriching, setIsEnriching] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
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

    try {
      const { data, error } = await supabase.functions.invoke("enrich-products", {
        body: { workspaceId, supplierPrefixes, productIds },
      });

      if (error) throw error;

      const res: EnrichResult = {
        total: data.total,
        enriched: data.enriched,
        failed: data.failed,
        skipped: data.skipped,
      };

      setResult(res);

      if (res.enriched > 0) {
        toast.success(`${res.enriched} produto(s) enriquecidos via web!${res.skipped > 0 ? ` (${res.skipped} já tinham dados)` : ""}`);
      } else if (res.skipped > 0) {
        toast.info(`Todos os ${res.skipped} produtos já tinham dados de enriquecimento.`);
      } else {
        toast.warning("Nenhum produto foi enriquecido. Verifique os prefixos de fornecedor.");
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

  return { enrich, isEnriching, result };
}
