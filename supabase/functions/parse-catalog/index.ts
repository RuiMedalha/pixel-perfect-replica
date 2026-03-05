import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
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

    const { filePath, fileName, columnMapping, sheetName, parseKnowledge } = await req.json();
    if (!filePath || !fileName) {
      return new Response(JSON.stringify({ error: "filePath e fileName são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("catalogs")
      .download(filePath);

    if (downloadError || !fileData) {
      return new Response(JSON.stringify({ error: "Erro ao descarregar ficheiro: " + (downloadError?.message || "unknown") }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ext = fileName.toLowerCase().split(".").pop();

    // Knowledge file parsing - extract text content for context
    if (parseKnowledge) {
      let extractedText = "";
      
      if (ext === "pdf") {
        extractedText = await extractPdfText(fileData, fileName);
      } else if (ext === "xlsx" || ext === "xls") {
        extractedText = await extractExcelText(fileData);
      }

      // Chunk the extracted text and store for full-text search
      if (extractedText) {
        const chunks = chunkText(extractedText, 1500);
        // First get or create the uploaded_file record to get its ID
        const { data: fileRecord } = await supabase
          .from("uploaded_files")
          .select("id")
          .eq("file_name", fileName)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fileRecord) {
          const chunkRows = chunks.map((content, idx) => ({
            file_id: fileRecord.id,
            user_id: userId,
            chunk_index: idx,
            content,
            source_name: fileName,
          }));

          // Delete old chunks for this file first
          await supabase
            .from("knowledge_chunks")
            .delete()
            .eq("file_id", fileRecord.id);

          // Insert in batches of 50
          for (let i = 0; i < chunkRows.length; i += 50) {
            await supabase
              .from("knowledge_chunks")
              .insert(chunkRows.slice(i, i + 50) as any);
          }
          console.log(`Stored ${chunkRows.length} knowledge chunks for ${fileName}`);
        }
      }

      return new Response(
        JSON.stringify({ extractedText, count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Product parsing
    let products: Array<Record<string, unknown>> = [];

    if (ext === "xlsx" || ext === "xls") {
      products = await parseExcel(fileData, columnMapping, sheetName);
    } else if (ext === "pdf") {
      products = await parsePdfWithAI(fileData, fileName);
    } else {
      return new Response(JSON.stringify({ error: "Formato não suportado: " + ext }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (products.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum produto encontrado no ficheiro", count: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert products in batches of 50
    const batchSize = 50;
    let inserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize).map((p) => ({
        user_id: userId,
        original_title: toStr(p.title, 500),
        original_description: toStr(p.description, 5000),
        short_description: toStr(p.short_description, 1000),
        technical_specs: toStr(p.technical_specs, 5000),
        original_price: parsePrice(p.price),
        sku: toStr(p.sku, 100),
        category: toStr(p.category, 200),
        supplier_ref: toStr(p.supplier_ref, 200),
        image_urls: p.image_urls ? (Array.isArray(p.image_urls) ? p.image_urls : [String(p.image_urls)]) : null,
        source_file: fileName,
        status: "pending" as const,
      }));

      const { error: insertError, data: insertedData } = await supabase
        .from("products")
        .insert(batch)
        .select("id");

      if (insertError) {
        errors.push(`Batch ${i / batchSize + 1}: ${insertError.message}`);
      } else {
        inserted += insertedData?.length || 0;
      }
    }

    // Log activity
    await supabase.from("activity_log").insert({
      user_id: userId,
      action: "upload",
      details: { file: fileName, products_count: inserted },
    });

    return new Response(
      JSON.stringify({ count: inserted, total: products.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-catalog error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function toStr(value: unknown, maxLen: number): string | null {
  if (value == null || value === "") return null;
  return String(value).substring(0, maxLen) || null;
}

function parsePrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const str = String(value).replace(/[€$\s]/g, "").replace(",", ".");
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

async function extractExcelText(fileData: Blob): Promise<string> {
  const buffer = await fileData.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const text = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`--- Folha: ${sheetName} ---\n${text}`);
  }
  return parts.join("\n\n").substring(0, 50000);
}

async function extractPdfText(fileData: Blob, fileName: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const buffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const base64 = btoa(binary);

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `És um extrator de conteúdo de documentos. Extrai TODO o texto relevante do PDF, incluindo especificações técnicas, tabelas de preços, características de produtos, descrições, dimensões, pesos, e qualquer informação técnica. Mantém a estrutura organizada. Responde APENAS com o texto extraído, sem comentários.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extrai todo o conteúdo relevante deste documento: "${fileName}".` },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("AI PDF extract error:", aiResponse.status, errText);
    throw new Error("Erro ao extrair texto do PDF: " + aiResponse.status);
  }

  const aiData = await aiResponse.json();
  const content = aiData.choices?.[0]?.message?.content || "";
  return content.substring(0, 50000);
}

async function parseExcel(
  fileData: Blob,
  columnMapping?: Record<string, string>,
  targetSheet?: string
): Promise<Array<Record<string, unknown>>> {
  const buffer = await fileData.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetName = targetSheet && workbook.SheetNames.includes(targetSheet)
    ? targetSheet
    : workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (columnMapping && Object.keys(columnMapping).length > 0) {
    return rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [productField, excelColumn] of Object.entries(columnMapping)) {
        if (excelColumn && row[excelColumn] !== undefined) {
          mapped[productField] = row[excelColumn];
}

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
      }
      return mapped;
    });
  }

  const autoMap: Record<string, RegExp> = {
    title: /^(title|titulo|título|nome|produto|name|product|designa[cç][aã]o)$/i,
    description: /^(description|descri[cç][aã]o|desc|detalhe|details)$/i,
    price: /^(price|pre[cç]o|valor|pvp|custo|cost|unit_price)$/i,
    sku: /^(sku|ref|refer[eê]ncia|codigo|código|code|ean|barcode)$/i,
    category: /^(category|categoria|cat|tipo|type|grupo|group|fam[ií]lia)$/i,
    supplier_ref: /^(supplier_ref|ref_fornecedor|fornecedor|supplier|marca|brand)$/i,
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const detectedMapping: Record<string, string> = {};
  for (const [field, regex] of Object.entries(autoMap)) {
    const found = headers.find((h) => regex.test(h.trim()));
    if (found) detectedMapping[field] = found;
  }

  return rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [productField, excelColumn] of Object.entries(detectedMapping)) {
      mapped[productField] = row[excelColumn];
    }
    return mapped;
  });
}

async function parsePdfWithAI(fileData: Blob, fileName: string): Promise<Array<Record<string, unknown>>> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const buffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const base64 = btoa(binary);

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `És um extrator de dados de catálogos de produtos. Analisa o PDF e extrai TODOS os produtos encontrados.
Para cada produto, extrai: title, description, price, sku, category, supplier_ref.
Responde APENAS com a tool call, sem texto adicional. Se não encontrares produtos, devolve um array vazio.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extrai todos os produtos deste catálogo PDF: "${fileName}". Devolve-os como array estruturado.` },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_products",
            description: "Devolve os produtos extraídos do catálogo",
            parameters: {
              type: "object",
              properties: {
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      description: { type: "string" },
                      price: { type: "string" },
                      sku: { type: "string" },
                      category: { type: "string" },
                      supplier_ref: { type: "string" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["products"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_products" } },
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("AI PDF parse error:", aiResponse.status, errText);
    throw new Error("Erro ao processar PDF com IA: " + aiResponse.status);
  }

  const aiData = await aiResponse.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return [];

  const parsed = JSON.parse(toolCall.function.arguments);
  return parsed.products || [];
}
