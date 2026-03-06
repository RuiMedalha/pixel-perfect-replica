import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SECRET_KEYS = [
  "openai_api_key",
  "anthropic_api_key",
  "gemini_api_key",
  "mistral_api_key",
  "woocommerce_consumer_key",
  "woocommerce_consumer_secret",
  "s3_access_key_id",
  "s3_secret_access_key",
];

const MASK = "••••••••";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*");
      if (error) throw error;
      const map: Record<string, string> = {};
      data.forEach((s) => {
        if (s.value) {
          // Mask secret values — only show that a value exists
          map[s.key] = SECRET_KEYS.includes(s.key) ? MASK : s.value;
        }
      });
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

      // Only save entries that have actual values and are not the mask placeholder
      const entries = Object.entries(settings).filter(
        ([, v]) => v.trim() !== "" && v !== MASK
      );
      
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
