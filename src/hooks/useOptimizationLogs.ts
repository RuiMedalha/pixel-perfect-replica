import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OptimizationLog {
  id: string;
  product_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  knowledge_sources: Array<{ source: string; chunks: number }>;
  supplier_name: string | null;
  supplier_url: string | null;
  had_knowledge: boolean;
  had_supplier: boolean;
  had_catalog: boolean;
  fields_optimized: string[];
  prompt_length: number;
  created_at: string;
}

export function useProductOptimizationLogs(productId: string | null) {
  return useQuery({
    queryKey: ["optimization-logs", productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimization_logs")
        .select("*")
        .eq("product_id", productId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as unknown as OptimizationLog[];
    },
  });
}

export function useTokenUsageSummary() {
  return useQuery({
    queryKey: ["token-usage-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimization_logs")
        .select("prompt_tokens, completion_tokens, total_tokens, model, knowledge_sources, had_knowledge, had_supplier, had_catalog, created_at");
      if (error) throw error;

      const logs = data as unknown as OptimizationLog[];
      const totalPrompt = logs.reduce((s, l) => s + (l.prompt_tokens || 0), 0);
      const totalCompletion = logs.reduce((s, l) => s + (l.completion_tokens || 0), 0);
      const totalTokens = logs.reduce((s, l) => s + (l.total_tokens || 0), 0);
      const totalOptimizations = logs.length;
      const withKnowledge = logs.filter((l) => l.had_knowledge).length;
      const withSupplier = logs.filter((l) => l.had_supplier).length;
      const withCatalog = logs.filter((l) => l.had_catalog).length;

      // Top knowledge sources
      const sourceCount = new Map<string, number>();
      logs.forEach((l) => {
        if (Array.isArray(l.knowledge_sources)) {
          l.knowledge_sources.forEach((s: any) => {
            const name = s.source || "Desconhecido";
            sourceCount.set(name, (sourceCount.get(name) || 0) + (s.chunks || 1));
          });
        }
      });
      const topSources = Array.from(sourceCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      return {
        totalPrompt,
        totalCompletion,
        totalTokens,
        totalOptimizations,
        withKnowledge,
        withSupplier,
        withCatalog,
        topSources,
      };
    },
  });
}
