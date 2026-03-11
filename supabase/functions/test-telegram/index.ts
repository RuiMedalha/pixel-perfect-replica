import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TELEGRAM_GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get telegram_chat_id from settings
    const { data: chatIdSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram_chat_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const rawChatId = chatIdSetting?.value ?? "";
    const chatId = rawChatId.trim();

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "telegram_chat_id não configurado nas Definições" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^-?\d+$/.test(chatId)) {
      return new Response(
        JSON.stringify({
          error:
            "Telegram Chat ID inválido. Usa um ID numérico (ex: 123456789 ou -1001234567890), não @username nem link t.me.",
          received: rawChatId,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!TELEGRAM_API_KEY) {
      return new Response(
        JSON.stringify({ error: "TELEGRAM_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const message = `🧪 <b>Teste de Notificação</b>\n\n✅ Telegram configurado corretamente!\n📅 ${new Date().toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" })}`;

    const response = await fetch(`${TELEGRAM_GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": TELEGRAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    const data = await response.json().catch(() => ({ ok: false, description: "Invalid response" }));

    if (!response.ok || data?.ok === false) {
      const description = data?.description ?? "Erro desconhecido do Telegram";

      if (typeof description === "string" && description.toLowerCase().includes("chat not found")) {
        return new Response(
          JSON.stringify({
            error:
              "Chat não encontrado. Envia /start ao teu bot no Telegram e usa o teu Chat ID numérico (não @username).",
            details: data,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (typeof description === "string" && description.toLowerCase().includes("bots can't send messages to bots")) {
        return new Response(
          JSON.stringify({
            error:
              "O Chat ID que introduziste pertence a outro bot. Bots não podem enviar mensagens entre si. Usa o teu Chat ID pessoal — envia /start ao @userinfobot no Telegram para o obteres.",
            details: data,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Telegram API failed [${response.status}]`, details: data }),
        { status: response.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message_id: data.result?.message_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
