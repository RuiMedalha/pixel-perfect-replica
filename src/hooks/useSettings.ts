import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*");
      if (error) throw error;
      const map: Record<string, string> = {};
      data.forEach((s) => { if (s.value) map[s.key] = s.value; });
      return map;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Record<string, string>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Utilizador não autenticado");

      const entries = Object.entries(settings).filter(([, v]) => v.trim() !== "");
      
      for (const [key, value] of entries) {
        const { error } = await supabase
          .from("settings")
          .upsert(
            { user_id: user.id, key, value },
            { onConflict: "user_id,key" }
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Configurações guardadas com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
