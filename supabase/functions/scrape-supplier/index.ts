const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { url, action } = await req.json();

    if (action === "scrape" && url) {
      const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (!apiKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl não está configurado. Contacte o administrador.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let formattedUrl = url.trim();
      if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = `https://${formattedUrl}`;
      }

      console.log('Scraping supplier URL:', formattedUrl);

      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formattedUrl,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Firecrawl API error:', data);
        return new Response(
          JSON.stringify({ success: false, error: data.error || `Erro ${response.status}` }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const markdown = data.data?.markdown || data.markdown || '';
      const title = data.data?.metadata?.title || data.metadata?.title || formattedUrl;

      // Truncate to reasonable size
      const extractedText = markdown.substring(0, 50000);

      // Save as knowledge file
      const { data: fileRecord } = await supabase.from("uploaded_files").insert({
        user_id: userId,
        file_name: `🌐 ${title}`,
        file_size: extractedText.length,
        file_type: "knowledge",
        status: "processed",
        products_count: 0,
        extracted_text: extractedText,
        metadata: { type: "web_scrape", source_url: formattedUrl },
      } as any).select("id").single();

      // Chunk and store for full-text search
      if (fileRecord) {
        const chunks = chunkText(extractedText, 1500);
        const chunkRows = chunks.map((content: string, idx: number) => ({
          file_id: fileRecord.id,
          user_id: userId,
          chunk_index: idx,
          content,
          source_name: `🌐 ${title}`,
        }));
        for (let i = 0; i < chunkRows.length; i += 50) {
          await supabase.from("knowledge_chunks").insert(chunkRows.slice(i, i + 50) as any);
        }
        console.log(`Stored ${chunkRows.length} knowledge chunks from web scrape`);
      }

      // Log activity
      await supabase.from("activity_log").insert({
        user_id: userId,
        action: "upload",
        details: { type: "web_scrape", url: formattedUrl, chars: extractedText.length },
      });

      console.log('Scrape successful, saved', extractedText.length, 'chars');

      return new Response(
        JSON.stringify({ 
          success: true, 
          title,
          chars: extractedText.length,
          preview: extractedText.substring(0, 500),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === "crawl" && url) {
      const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (!apiKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl não está configurado.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let formattedUrl = url.trim();
      if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
        formattedUrl = `https://${formattedUrl}`;
      }

      console.log('Crawling supplier URL:', formattedUrl);

      // First map the site to find product pages
      const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formattedUrl,
          limit: 50,
          includeSubdomains: false,
        }),
      });

      const mapData = await mapResponse.json();
      if (!mapResponse.ok) {
        return new Response(
          JSON.stringify({ success: false, error: mapData.error || `Erro ${mapResponse.status}` }),
          { status: mapResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const links = mapData.links || [];

      return new Response(
        JSON.stringify({ success: true, links, count: links.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Ação inválida. Use 'scrape' ou 'crawl'." }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > chunkSize && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
