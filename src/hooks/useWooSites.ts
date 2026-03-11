import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface WooSite {
  id: string;
  name: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  isProduction: boolean;
}

const SETTING_KEY = "woo_sites";
const ACTIVE_SITE_KEY = "active_woo_site";
const MASK = "••••••••";

export function useWooSites() {
  return useQuery({
    queryKey: ["woo-sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value")
        .in("key", [SETTING_KEY, ACTIVE_SITE_KEY]);
      if (error) throw error;

      const map: Record<string, string> = {};
      data.forEach((s) => { if (s.value) map[s.key] = s.value; });

      let sites: WooSite[] = [];
      try {
        const parsed = JSON.parse(map[SETTING_KEY] || "[]");
        if (Array.isArray(parsed)) {
          sites = parsed.map((s: any) => ({
            ...s,
            consumerKey: s.consumerKey ? MASK : "",
            consumerSecret: s.consumerSecret ? MASK : "",
          }));
        }
      } catch { /* empty */ }

      const activeSiteId = map[ACTIVE_SITE_KEY] || (sites.length > 0 ? sites[0].id : null);

      return { sites, activeSiteId };
    },
  });
}

export function useSaveWooSites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sites, activeSiteId }: { sites: WooSite[]; activeSiteId?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      // For sites with masked keys, we need to preserve the existing values
      const { data: existingData } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .eq("user_id", user.id)
        .maybeSingle();

      let existingSites: WooSite[] = [];
      try {
        existingSites = JSON.parse(existingData?.value || "[]");
      } catch { /* empty */ }

      const existingMap = new Map(existingSites.map(s => [s.id, s]));

      // Merge: keep old secrets if new value is mask
      const merged = sites.map(s => ({
        ...s,
        consumerKey: s.consumerKey === MASK ? (existingMap.get(s.id)?.consumerKey || "") : s.consumerKey,
        consumerSecret: s.consumerSecret === MASK ? (existingMap.get(s.id)?.consumerSecret || "") : s.consumerSecret,
      }));

      // Also migrate legacy single-site settings if they exist
      if (merged.length === 0) {
        const { data: legacySettings } = await supabase
          .from("settings")
          .select("key, value")
          .eq("user_id", user.id)
          .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);
        
        const legacy: Record<string, string> = {};
        legacySettings?.forEach((s: any) => { if (s.value) legacy[s.key] = s.value; });
        
        if (legacy["woocommerce_url"]) {
          merged.push({
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
            name: "Site Principal",
            url: legacy["woocommerce_url"],
            consumerKey: legacy["woocommerce_consumer_key"] || "",
            consumerSecret: legacy["woocommerce_consumer_secret"] || "",
            isProduction: true,
          });
        }
      }

      await supabase.from("settings").upsert(
        { user_id: user.id, key: SETTING_KEY, value: JSON.stringify(merged) },
        { onConflict: "user_id,key" }
      );

      if (activeSiteId) {
        await supabase.from("settings").upsert(
          { user_id: user.id, key: ACTIVE_SITE_KEY, value: activeSiteId },
          { onConflict: "user_id,key" }
        );
      }

      // Also sync legacy keys for backward compat with existing edge functions
      const activeSite = merged.find(s => s.id === activeSiteId) || merged[0];
      if (activeSite) {
        for (const [key, val] of [
          ["woocommerce_url", activeSite.url],
          ["woocommerce_consumer_key", activeSite.consumerKey],
          ["woocommerce_consumer_secret", activeSite.consumerSecret],
        ] as const) {
          if (val) {
            await supabase.from("settings").upsert(
              { user_id: user.id, key, value: val },
              { onConflict: "user_id,key" }
            );
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["woo-sites"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Sites WooCommerce guardados!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetActiveWooSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (siteId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      await supabase.from("settings").upsert(
        { user_id: user.id, key: ACTIVE_SITE_KEY, value: siteId },
        { onConflict: "user_id,key" }
      );

      // Also sync legacy keys
      const { data: sitesData } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .eq("user_id", user.id)
        .maybeSingle();

      let sites: WooSite[] = [];
      try { sites = JSON.parse(sitesData?.value || "[]"); } catch {}
      const site = sites.find(s => s.id === siteId);
      if (site) {
        for (const [key, val] of [
          ["woocommerce_url", site.url],
          ["woocommerce_consumer_key", site.consumerKey],
          ["woocommerce_consumer_secret", site.consumerSecret],
        ] as const) {
          if (val) {
            await supabase.from("settings").upsert(
              { user_id: user.id, key, value: val },
              { onConflict: "user_id,key" }
            );
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["woo-sites"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Site ativo atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
