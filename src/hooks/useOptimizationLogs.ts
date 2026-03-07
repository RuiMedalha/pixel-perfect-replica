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
        .select("prompt_tokens, completion_tokens, total_tokens, model, knowledge_sources, had_knowledge, had_supplier, had_catalog, created_at, chunks_used, rag_match_types");
      if (error) throw error;

      const logs = data as unknown as (OptimizationLog & { chunks_used?: number; rag_match_types?: Record<string, number> })[];
      const totalPrompt = logs.reduce((s, l) => s + (l.prompt_tokens || 0), 0);
      const totalCompletion = logs.reduce((s, l) => s + (l.completion_tokens || 0), 0);
      const totalTokens = logs.reduce((s, l) => s + (l.total_tokens || 0), 0);
      const totalOptimizations = logs.length;
      const withKnowledge = logs.filter((l) => l.had_knowledge).length;
      const withSupplier = logs.filter((l) => l.had_supplier).length;
      const withCatalog = logs.filter((l) => l.had_catalog).length;

      // RAG match type aggregation
      const matchTypeTotals: Record<string, number> = {};
      let totalChunksUsed = 0;
      logs.forEach((l: any) => {
        totalChunksUsed += l.chunks_used || 0;
        if (l.rag_match_types && typeof l.rag_match_types === "object") {
          for (const [mt, count] of Object.entries(l.rag_match_types)) {
            matchTypeTotals[mt] = (matchTypeTotals[mt] || 0) + (count as number);
          }
        }
      });

      // Model usage breakdown
      const modelCounts: Record<string, number> = {};
      logs.forEach((l) => {
        const m = l.model || "unknown";
        modelCounts[m] = (modelCounts[m] || 0) + 1;
      });

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
        matchTypeTotals,
        totalChunksUsed,
        avgChunksPerOptimization: totalOptimizations > 0 ? +(totalChunksUsed / totalOptimizations).toFixed(1) : 0,
        modelCounts,
      };
    },
  });
}

export function useQualityMetrics() {
  return useQuery({
    queryKey: ["quality-metrics"],
    queryFn: async () => {
      // Fetch products with status info
      const { data: products, error: pErr } = await supabase
        .from("products")
        .select("id, status, category, optimized_title, original_title, created_at, updated_at");
      if (pErr) throw pErr;

      const total = products?.length || 0;
      const optimized = products?.filter((p: any) => p.status === "optimized" || p.status === "published").length || 0;
      const published = products?.filter((p: any) => p.status === "published").length || 0;
      const pending = products?.filter((p: any) => p.status === "pending").length || 0;
      const errors = products?.filter((p: any) => p.status === "error").length || 0;

      // Acceptance rate: products that went from optimized to published (or stayed optimized = accepted)
      const acceptanceRate = total > 0 ? +((optimized + published) / total * 100).toFixed(1) : 0;
      const publishRate = optimized + published > 0 ? +(published / (optimized + published) * 100).toFixed(1) : 0;
      const errorRate = total > 0 ? +(errors / total * 100).toFixed(1) : 0;

      // Category distribution
      const categoryMap: Record<string, number> = {};
      (products || []).forEach((p: any) => {
        const cat = p.category || "Sem categoria";
        categoryMap[cat] = (categoryMap[cat] || 0) + 1;
      });
      const topCategories = Object.entries(categoryMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));

      // Optimization logs by model
      const { data: logs } = await supabase
        .from("optimization_logs")
        .select("model, total_tokens, created_at, had_knowledge, chunks_used");

      const modelStats: Record<string, { count: number; tokens: number; withKnowledge: number; avgChunks: number }> = {};
      (logs || []).forEach((l: any) => {
        const m = (l.model || "unknown").replace("google/", "").replace("openai/", "");
        if (!modelStats[m]) modelStats[m] = { count: 0, tokens: 0, withKnowledge: 0, avgChunks: 0 };
        modelStats[m].count++;
        modelStats[m].tokens += l.total_tokens || 0;
        if (l.had_knowledge) modelStats[m].withKnowledge++;
        modelStats[m].avgChunks += l.chunks_used || 0;
      });
      // Calculate averages
      for (const m of Object.keys(modelStats)) {
        modelStats[m].avgChunks = modelStats[m].count > 0
          ? +(modelStats[m].avgChunks / modelStats[m].count).toFixed(1) : 0;
      }

      return {
        total,
        optimized,
        published,
        pending,
        errors,
        acceptanceRate,
        publishRate,
        errorRate,
        topCategories,
        modelStats,
      };
    },
  });
}
