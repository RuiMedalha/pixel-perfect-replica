import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description: string;
  image: { src: string } | null;
  count: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { workspaceId } = await req.json();
    if (!workspaceId) {
      return new Response(JSON.stringify({ error: "workspaceId obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get WooCommerce credentials
    const { data: settings } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["woocommerce_url", "woocommerce_consumer_key", "woocommerce_consumer_secret"]);

    const settingsMap: Record<string, string> = {};
    settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

    const wooUrl = settingsMap["woocommerce_url"];
    const wooKey = settingsMap["woocommerce_consumer_key"];
    const wooSecret = settingsMap["woocommerce_consumer_secret"];

    if (!wooUrl || !wooKey || !wooSecret) {
      return new Response(
        JSON.stringify({ error: "Credenciais WooCommerce não configuradas." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = wooUrl.replace(/\/+$/, "");
    const auth = btoa(`${wooKey}:${wooSecret}`);

    // Fetch ALL categories from WooCommerce (paginated, max 100 per page)
    const allWooCategories: WooCategory[] = [];
    let page = 1;
    while (true) {
      const resp = await fetch(
        `${baseUrl}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`,
        { headers: { Authorization: `Basic ${auth}` } }
      );
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`WooCommerce ${resp.status}: ${errBody.substring(0, 200)}`);
      }
      const cats: WooCategory[] = await resp.json();
      if (cats.length === 0) break;
      allWooCategories.push(...cats);
      page++;
      if (cats.length < 100) break;
    }

    // Get existing categories for this workspace
    const { data: existingCats } = await supabase
      .from("categories")
      .select("id, woocommerce_id, name")
      .eq("workspace_id", workspaceId);

    const existingByWooId = new Map<number, string>();
    (existingCats || []).forEach((c: any) => {
      if (c.woocommerce_id) existingByWooId.set(c.woocommerce_id, c.id);
    });

    // Build a map from WooCommerce parent ID → our internal parent ID
    // Process in order: parents first (parent === 0), then children
    const wooIdToInternalId = new Map<number, string>();

    // Copy existing mappings
    existingByWooId.forEach((internalId, wooId) => {
      wooIdToInternalId.set(wooId, internalId);
    });

    // Sort: top-level first, then nested
    const sorted = [...allWooCategories].sort((a, b) => {
      if (a.parent === 0 && b.parent !== 0) return -1;
      if (a.parent !== 0 && b.parent === 0) return 1;
      return a.id - b.id;
    });

    let created = 0;
    let updated = 0;

    for (const wooCat of sorted) {
      const parentInternalId = wooCat.parent === 0 ? null : (wooIdToInternalId.get(wooCat.parent) || null);

      if (existingByWooId.has(wooCat.id)) {
        // Update existing
        const internalId = existingByWooId.get(wooCat.id)!;
        await supabase.from("categories").update({
          name: wooCat.name,
          slug: wooCat.slug,
          description: wooCat.description || null,
          parent_id: parentInternalId,
          image_url: wooCat.image?.src || null,
        }).eq("id", internalId);
        updated++;
      } else {
        // Create new
        const { data: newCat, error: insertErr } = await supabase.from("categories").insert({
          user_id: user.id,
          workspace_id: workspaceId,
          woocommerce_id: wooCat.id,
          name: wooCat.name,
          slug: wooCat.slug,
          description: wooCat.description || null,
          parent_id: parentInternalId,
          image_url: wooCat.image?.src || null,
        }).select("id").single();

        if (insertErr) {
          console.error(`Failed to insert category "${wooCat.name}":`, insertErr.message);
          continue;
        }
        wooIdToInternalId.set(wooCat.id, newCat.id);
        created++;
      }
    }

    // Second pass: fix parent_id for categories whose parent was created after them
    for (const wooCat of sorted) {
      if (wooCat.parent !== 0) {
        const internalId = wooIdToInternalId.get(wooCat.id);
        const parentInternalId = wooIdToInternalId.get(wooCat.parent);
        if (internalId && parentInternalId) {
          await supabase.from("categories").update({ parent_id: parentInternalId }).eq("id", internalId);
        }
      }
    }

    return new Response(JSON.stringify({
      total: allWooCategories.length,
      created,
      updated,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
