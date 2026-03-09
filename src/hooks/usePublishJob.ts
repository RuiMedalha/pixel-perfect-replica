import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PricingOptions, SkuPrefixOptions } from "@/components/WooPublishModal";

export interface PublishJob {
  id: string;
  status: string;
  total_products: number;
  processed_products: number;
  failed_products: number;
  current_product_name: string | null;
  results: any[];
  scheduled_for: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function usePublishJob() {
  const [activePublishJob, setActivePublishJob] = useState<PublishJob | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const wakeupInFlightRef = useRef(false);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!activePublishJob || activePublishJob.status === "completed" || activePublishJob.status === "cancelled" || activePublishJob.status === "failed") return;

    const channel = supabase
      .channel(`publish-job-${activePublishJob.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "publish_jobs",
          filter: `id=eq.${activePublishJob.id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setActivePublishJob(updated);

          if (updated.status === "completed") {
            const results = updated.results || [];
            const created = results.filter((r: any) => r.status === "created").length;
            const updatedCount = results.filter((r: any) => r.status === "updated").length;
            const errors = results.filter((r: any) => r.status === "error").length;
            const parts: string[] = [];
            if (created > 0) parts.push(`${created} criado(s)`);
            if (updatedCount > 0) parts.push(`${updatedCount} atualizado(s)`);
            if (errors > 0) {
              parts.push(`${errors} com erro`);
              toast.warning(`Publicação concluída: ${parts.join(", ")}`);
            } else {
              toast.success(`${parts.join(", ")} no WooCommerce! 🚀`);
            }
          } else if (updated.status === "cancelled") {
            toast.info(`Publicação cancelada. ${updated.processed_products} de ${updated.total_products} processados.`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activePublishJob?.id, activePublishJob?.status]);

  // Check for active jobs on mount
  useEffect(() => {
    const checkActiveJobs = async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data } = await supabase
        .from("publish_jobs")
        .select("*")
        .eq("user_id", user.user.id)
        .in("status", ["queued", "processing", "scheduled"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const job = data[0] as any;
        setActivePublishJob(job);

        // Auto-trigger queued jobs that haven't started (e.g. from scheduled)
        if (job.status === "queued" && !job.started_at) {
          supabase.functions.invoke("publish-woocommerce", {
            body: { jobId: job.id, startIndex: 0 },
          }).catch(console.error);
        }
      }
    };
    checkActiveJobs();
  }, []);

  // Watchdog: re-invoke stalled jobs
  useEffect(() => {
    if (!activePublishJob || (activePublishJob.status !== "processing" && activePublishJob.status !== "queued")) return;
    if (activePublishJob.processed_products >= activePublishJob.total_products) return;

    const interval = setInterval(async () => {
      if (!activePublishJob || wakeupInFlightRef.current) return;

      const ageMs = Date.now() - new Date(activePublishJob.updated_at).getTime();
      if (ageMs <= 120_000) return;

      wakeupInFlightRef.current = true;
      try {
        const { error } = await supabase.functions.invoke("publish-woocommerce", {
          body: {
            jobId: activePublishJob.id,
            startIndex: activePublishJob.processed_products,
          },
        });
        if (error) throw error;
        toast.info("Publicação retomada automaticamente.");
      } catch (err: any) {
        console.warn("Wakeup publish falhou:", err?.message || err);
      } finally {
        wakeupInFlightRef.current = false;
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, [activePublishJob]);

  const createPublishJob = useCallback(
    async ({
      productIds,
      publishFields,
      pricing,
      scheduledFor,
      workspaceId,
    }: {
      productIds: string[];
      publishFields?: string[];
      pricing?: PricingOptions;
      scheduledFor?: string;
      workspaceId?: string;
    }) => {
      setIsCreating(true);
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;

      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const { data, error } = await supabase.functions.invoke("publish-woocommerce", {
              body: {
                productIds,
                publishFields,
                pricing,
                scheduledFor,
                workspaceId,
              },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            if (data?.jobId) {
              const { data: jobData } = await supabase
                .from("publish_jobs")
                .select("*")
                .eq("id", data.jobId)
                .single();

              if (jobData) {
                setActivePublishJob(jobData as any);
              }

              if (scheduledFor) {
                toast.success(`Publicação agendada para ${new Date(scheduledFor).toLocaleString("pt-PT")} ⏰`);
              } else {
                toast.success(`Publicação iniciada: ${productIds.length} produtos em background 🚀`);
              }
            }

            return data;
          } catch (err: any) {
            lastError = err;
            if (attempt < MAX_RETRIES) {
              const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);
              console.warn(`createPublishJob attempt ${attempt} failed, retrying in ${delay}ms...`, err?.message);
              await new Promise((r) => setTimeout(r, delay));
            }
          }
        }

        toast.error(`Erro ao criar publicação: ${lastError?.message}`);
        throw lastError;
      } finally {
        setIsCreating(false);
      }
    },
    []
  );

  const cancelPublishJob = useCallback(async () => {
    if (!activePublishJob) return;
    const { error } = await supabase
      .from("publish_jobs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activePublishJob.id);

    if (error) {
      toast.error("Erro ao cancelar publicação");
    } else {
      toast.info("Publicação a cancelar...");
    }
  }, [activePublishJob]);

  const dismissPublishJob = useCallback(() => {
    setActivePublishJob(null);
  }, []);

  return {
    activePublishJob,
    isCreating,
    createPublishJob,
    cancelPublishJob,
    dismissPublishJob,
  };
}
