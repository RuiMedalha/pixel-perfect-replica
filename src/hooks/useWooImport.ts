import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface WooCategory {
  id: number;
  name: string;
  parent: number;
  count: number;
}

export interface WooAttribute {
  id: number;
  name: string;
  terms: { id: number; name: string; count: number }[];
}

export interface WooImportFilters {
  type?: string;
  status?: string;
  category?: string;
  stock_status?: string;
  search?: string;
  attribute?: string;
  attribute_term?: string;
}

export interface WooImportResult {
  imported: number;
  variations: number;
  skipped: number;
  total: number;
}

export function useWooCategories(enabled: boolean) {
  return useQuery({
    queryKey: ["woo-categories"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("import-woocommerce", {
        body: { action: "list_categories" },
      });
      if (error) throw error;
      return (data.categories || []) as WooCategory[];
    },
  });
}

export function useWooAttributes(enabled: boolean) {
  return useQuery({
    queryKey: ["woo-attributes"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("import-woocommerce", {
        body: { action: "list_attributes" },
      });
      if (error) throw error;
      return (data.attributes || []) as WooAttribute[];
    },
  });
}

export function useWooImport() {
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<WooImportResult | null>(null);
  const qc = useQueryClient();

  const importProducts = async (workspaceId: string, filters: WooImportFilters) => {
    setIsImporting(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("import-woocommerce", {
        body: { action: "import", workspaceId, filters },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const res: WooImportResult = {
        imported: data.imported,
        variations: data.variations,
        skipped: data.skipped,
        total: data.total,
      };

      setResult(res);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });

      if (res.imported > 0) {
        const varMsg = res.variations > 0 ? ` + ${res.variations} variações` : '';
        toast.success(`${res.imported} produtos importados do WooCommerce!${varMsg}${res.skipped > 0 ? ` (${res.skipped} duplicados ignorados)` : ''}`);
      } else if (res.skipped > 0) {
        toast.info(`Todos os ${res.skipped} produtos já existem no workspace.`);
      } else {
        toast.warning("Nenhum produto encontrado com os filtros selecionados.");
      }

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao importar";
      toast.error(msg);
      return null;
    } finally {
      setIsImporting(false);
    }
  };

  return { importProducts, isImporting, result };
}
