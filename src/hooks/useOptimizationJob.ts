import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { OptimizationField } from "@/hooks/useOptimizeProducts";

export interface OptimizationJob {
  id: string;
  status: string;
  total_products: number;
  processed_products: number;
  failed_products: number;
  current_product_name: string | null;
  current_phase: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function useOptimizationJob() {
  const [activeJob, setActiveJob] = useState<OptimizationJob | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const wakeupInFlightRef = useRef(false);

  // Subscribe to realtime updates for the active job
  useEffect(() => {
    if (!activeJob || activeJob.status === "completed" || activeJob.status === "cancelled") return;

    const channel = supabase
      .channel(`job-${activeJob.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "optimization_jobs",
          filter: `id=eq.${activeJob.id}`,
        },
        (payload) => {
          const updated = payload.new as OptimizationJob;
          setActiveJob(updated);

          if (updated.status === "completed") {
            const failed = updated.failed_products || 0;
            const ok = updated.processed_products - failed;
            if (failed > 0) {
              toast.warning(`Job concluído: ${ok} otimizado(s), ${failed} com erro.`);
            } else {
              toast.success(`${ok} produto(s) otimizado(s) com sucesso! 🚀`);
            }
          } else if (updated.status === "cancelled") {
            toast.info(`Job cancelado. ${updated.processed_products} de ${updated.total_products} processados.`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeJob?.id, activeJob?.status]);

  // Check for any active jobs on mount
  useEffect(() => {
    const checkActiveJobs = async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data } = await supabase
        .from("optimization_jobs")
        .select("*")
        .eq("user_id", user.user.id)
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setActiveJob(data[0] as unknown as OptimizationJob);
      }
    };
    checkActiveJobs();
  }, []);

  const createJob = useCallback(
    async ({
      productIds,
      selectedPhases,
      fieldsToOptimize,
      modelOverride,
      workspaceId,
      skipKnowledge,
      skipScraping,
      skipReranking,
    }: {
      productIds: string[];
      selectedPhases?: number[];
      fieldsToOptimize?: OptimizationField[];
      modelOverride?: string;
      workspaceId?: string;
      skipKnowledge?: boolean;
      skipScraping?: boolean;
      skipReranking?: boolean;
    }) => {
      setIsCreating(true);
      try {
        const { data, error } = await supabase.functions.invoke("optimize-batch", {
          body: {
            productIds,
            selectedPhases: selectedPhases || [],
            fieldsToOptimize: fieldsToOptimize || [],
            modelOverride,
            workspaceId,
            skipKnowledge,
            skipScraping,
            skipReranking,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        if (data?.jobId) {
          // Fetch the created job
          const { data: jobData } = await supabase
            .from("optimization_jobs")
            .select("*")
            .eq("id", data.jobId)
            .single();

          if (jobData) {
            setActiveJob(jobData as unknown as OptimizationJob);
          }
          toast.success(
            `Job de otimização criado: ${productIds.length} produtos em modo background 🚀`
          );
        }

        return data;
      } catch (err: any) {
        toast.error(`Erro ao criar job: ${err.message}`);
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  const cancelJob = useCallback(async () => {
    if (!activeJob) return;
    const { error } = await supabase
      .from("optimization_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activeJob.id);

    if (error) {
      toast.error("Erro ao cancelar job");
    } else {
      toast.info("Job de otimização a cancelar...");
    }
  }, [activeJob]);

  const dismissJob = useCallback(() => {
    setActiveJob(null);
  }, []);

  return {
    activeJob,
    isCreating,
    createJob,
    cancelJob,
    dismissJob,
  };
}
