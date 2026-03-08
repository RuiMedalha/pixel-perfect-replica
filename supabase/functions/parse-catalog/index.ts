import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const { filePath, fileName, columnMapping, sheetName, parseKnowledge, workspaceId, fileId, _backgroundJobId } = body;

    // ─── Background continuation mode ───
    if (_backgroundJobId) {
      console.log(`🔄 Background continuation for file record ${_backgroundJobId}`);
      await processInBackground(body, userId, authHeader);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!filePath || !fileName) {
      return new Response(JSON.stringify({ error: "filePath e fileName são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Knowledge file: process inline (lightweight) ───
    if (parseKnowledge) {
      // Use EdgeRuntime.waitUntil for knowledge parsing too
      const promise = processKnowledge(supabase, userId, filePath, fileName, workspaceId, fileId);
      (globalThis as any).EdgeRuntime?.waitUntil?.(promise.catch((e: any) => console.error("Knowledge bg error:", e)));
      return new Response(
        JSON.stringify({ extractedText: "", count: 0, background: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Product parsing: return immediately, process in background ───
    // Create a tracking record in uploaded_files to track progress
    // We'll use a special metadata field to track parse job status
    const jobMeta = { parseStatus: "processing", parseProgress: 0 };

    // Start background processing via self-invocation (avoids CPU limit)
    const bgBody = { ...body, _backgroundJobId: fileId || "inline", _authHeader: authHeader };
    
    // Use EdgeRuntime.waitUntil + self-invoke for resilience
    const bgPromise = selfInvoke(authHeader, bgBody);
    (globalThis as any).EdgeRuntime?.waitUntil?.(bgPromise.catch((e: any) => {
      console.error("Self-invoke failed, trying inline:", e);
    }));

    return new Response(
      JSON.stringify({ background: true, message: "Processamento iniciado em segundo plano" }),
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

async function selfInvoke(authHeader: string, body: Record<string, unknown>) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/parse-catalog`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (resp.ok) return;
      const txt = await resp.text();
      console.warn(`Self-invoke attempt ${attempt} failed: ${resp.status} ${txt}`);
    } catch (err: any) {
      console.warn(`Self-invoke attempt ${attempt} network error:`, err?.message);
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }
  console.error("All self-invoke attempts failed");
}

async function processKnowledge(
  supabase: any, userId: string, filePath: string, fileName: string,
  workspaceId?: string, fileId?: string
) {
  const { data: fileData, error: downloadError } = await supabase.storage.from("catalogs").download(filePath);
  if (downloadError || !fileData) {
    console.error("Download error:", downloadError?.message);
    return;
  }

  const ext = fileName.toLowerCase().split(".").pop();
  let extractedText = "";

  if (ext === "pdf") {
    extractedText = await extractPdfText(fileData, fileName);
  } else if (ext === "xlsx" || ext === "xls") {
    extractedText = await extractExcelText(fileData);
  }

  if (!extractedText) {
    console.warn(`⚠️ No text extracted from "${fileName}"`);
    return;
  }

  let resolvedFileId = fileId;
  if (!resolvedFileId) {
    const { data: fileRecord } = await supabase
      .from("uploaded_files").select("id")
      .eq("file_name", fileName).eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    resolvedFileId = fileRecord?.id;
  }

  if (!resolvedFileId) {
    console.error(`❌ Could not find uploaded_files record for "${fileName}"`);
    return;
  }

  const chunks = chunkText(extractedText, 1500);
  const chunkRows = chunks.map((content, idx) => ({
    file_id: resolvedFileId, user_id: userId,
    workspace_id: workspaceId || null, chunk_index: idx,
    content, source_name: fileName,
  }));

  await supabase.from("knowledge_chunks").delete().eq("file_id", resolvedFileId);

  for (let i = 0; i < chunkRows.length; i += 50) {
    const { error: chunkError } = await supabase
      .from("knowledge_chunks").insert(chunkRows.slice(i, i + 50) as any);
    if (chunkError) console.error(`Chunk insert error batch ${i}:`, chunkError.message);
  }

  const previewText = extractedText.substring(0, 50000);
  await supabase.from("uploaded_files")
    .update({ extracted_text: previewText, status: "processed" } as any)
    .eq("id", resolvedFileId);

  console.log(`✅ Stored ${chunkRows.length} knowledge chunks for "${fileName}"`);
}

async function processInBackground(body: Record<string, unknown>, userId: string, authHeader: string) {
  const { filePath, fileName, columnMapping, sheetName, workspaceId } = body as any;
  
  // Use service role for DB operations in background
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: fileData, error: downloadError } = await supabase.storage.from("catalogs").download(filePath);
  if (downloadError || !fileData) {
    console.error("Background download error:", downloadError?.message);
    return;
  }

  const ext = fileName.toLowerCase().split(".").pop();
  let products: Array<Record<string, unknown>> = [];

  if (ext === "xlsx" || ext === "xls") {
    products = await parseExcel(fileData, columnMapping, sheetName);
  } else if (ext === "pdf") {
    products = await parsePdfWithAI(fileData, fileName);
  } else {
    console.error("Unsupported format:", ext);
    return;
  }

  if (products.length === 0) {
    console.log(`No products found in "${fileName}"`);
    // Update uploaded_files metadata to signal completion
    await updateParseStatus(supabase, userId, fileName, workspaceId, { count: 0, updated: 0, total: 0, skipped: 0, errors: [], done: true });
    return;
  }

  // SKU lookup
  const productSkus = products.map((p) => toStr(p.sku, 100)).filter((s): s is string => !!s);
  const existingSkuMap = new Map<string, string>();
  if (productSkus.length > 0) {
    for (let i = 0; i < productSkus.length; i += 200) {
      const batch = productSkus.slice(i, i + 200);
      const query = supabase.from("products").select("id, sku").in("sku", batch);
      if (workspaceId) query.eq("workspace_id", workspaceId);
      const { data: existingProducts } = await query;
      (existingProducts || []).forEach((p: any) => {
        if (p.sku) existingSkuMap.set(p.sku, p.id);
      });
    }
    if (existingSkuMap.size > 0) {
      console.log(`🔍 Found ${existingSkuMap.size} existing SKUs`);
    }
  }

  const mappedFieldKeys = new Set<string>(columnMapping ? Object.keys(columnMapping) : []);
  const hasMapping = mappedFieldKeys.size > 0;

  function buildProductData(p: Record<string, unknown>, onlyMapped: boolean) {
    const data: Record<string, unknown> = {};
    const attributes: any[] = [];
    for (let a = 1; a <= 3; a++) {
      const name = p[`attribute_${a}_name`];
      const vals = p[`attribute_${a}_values`];
      if (name && vals) {
        attributes.push({
          name: String(name),
          values: String(vals).split(",").map((v: string) => v.trim()).filter(Boolean),
        });
      }
    }

    const upsellSkus = p.upsell_skus ? String(p.upsell_skus).split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    const crosssellSkus = p.crosssell_skus ? String(p.crosssell_skus).split(",").map((s: string) => s.trim()).filter(Boolean) : [];

    let imageUrls: string[] = [];
    if (p.image_urls) {
      if (Array.isArray(p.image_urls)) imageUrls = p.image_urls;
      else imageUrls = String(p.image_urls).split(/[,|]/).map((s: string) => s.trim()).filter(Boolean);
    }

    let techSpecs = toStr(p.technical_specs, 5000);
    const specParts: string[] = [];
    if (p.weight) specParts.push(`Peso: ${p.weight}kg`);
    if (p.length) specParts.push(`Comprimento: ${p.length}cm`);
    if (p.width) specParts.push(`Largura: ${p.width}cm`);
    if (p.height) specParts.push(`Altura: ${p.height}cm`);
    if (specParts.length > 0) {
      techSpecs = techSpecs ? `${techSpecs}\n${specParts.join(" | ")}` : specParts.join(" | ");
    }

    const fieldMap: Record<string, () => void> = {
      title: () => { data.original_title = toStr(p.title, 500); },
      description: () => { data.original_description = toStr(p.description, 5000); },
      short_description: () => { data.short_description = toStr(p.short_description, 1000); },
      technical_specs: () => { data.technical_specs = techSpecs; },
      price: () => { data.original_price = parsePrice(p.price); },
      sale_price: () => { data.sale_price = parsePrice(p.sale_price); },
      sku: () => { data.sku = toStr(p.sku, 100); },
      category: () => { data.category = toStr(p.category, 200); },
      supplier_ref: () => { data.supplier_ref = toStr(p.supplier_ref, 200); },
      image_urls: () => { data.image_urls = imageUrls.length > 0 ? imageUrls : null; },
      product_type: () => { data.product_type = toStr(p.product_type, 50) || "simple"; },
      upsell_skus: () => { data.upsell_skus = upsellSkus.length > 0 ? upsellSkus : []; },
      crosssell_skus: () => { data.crosssell_skus = crosssellSkus.length > 0 ? crosssellSkus : []; },
      meta_title: () => { data.meta_title = toStr(p.meta_title, 200); },
      meta_description: () => { data.meta_description = toStr(p.meta_description, 500); },
      focus_keyword: () => {
        data.focus_keyword = p.focus_keyword
          ? String(p.focus_keyword).split(",").map((s: string) => s.trim()).filter(Boolean)
          : null;
      },
      seo_slug: () => { data.seo_slug = toStr(p.seo_slug, 200); },
      weight: () => { /* handled in technical_specs */ },
      woocommerce_id: () => { data.woocommerce_id = p.woocommerce_id ? parseInt(String(p.woocommerce_id), 10) || null : null; },
    };

    if (onlyMapped && hasMapping) {
      for (const key of mappedFieldKeys) {
        if (fieldMap[key]) fieldMap[key]();
      }
      for (const k of Object.keys(data)) {
        if (data[k] === null || data[k] === "" || data[k] === undefined) delete data[k];
      }
    } else {
      for (const fn of Object.values(fieldMap)) fn();
    }

    if (attributes.length > 0) data.attributes = attributes;
    return data;
  }

  const isWooMode = products.some((p) => p.product_type || p.parent_sku);
  if (isWooMode) console.log("🛒 WooCommerce mode detected");

  const batchSize = 50;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const parentSkuMap: Array<{ productId: string; parentSku: string }> = [];

  for (let i = 0; i < products.length; i += batchSize) {
    const batchProducts = products.slice(i, i + batchSize);
    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; data: Record<string, unknown>; product: Record<string, unknown> }> = [];

    for (const p of batchProducts) {
      const sku = toStr(p.sku, 100);
      const existingId = sku ? existingSkuMap.get(sku) : null;

      if (existingId) {
        const updateData = buildProductData(p, true);
        if (Object.keys(updateData).length > 0) {
          toUpdate.push({ id: existingId, data: updateData, product: p });
        } else {
          skipped++;
        }
      } else {
        const productData = buildProductData(p, false);
        productData.user_id = userId;
        productData.workspace_id = workspaceId || null;
        productData.source_file = fileName;
        productData.status = "pending";
        if (!productData.sku) productData.sku = toStr(p.sku, 100);
        if (!productData.product_type) productData.product_type = "simple";
        if (!productData.original_title) productData.original_title = toStr(p.title, 500);
        toInsert.push(productData);
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError, data: insertedData } = await supabase
        .from("products").insert(toInsert).select("id, sku");
      if (insertError) {
        errors.push(`Insert batch ${i / batchSize + 1}: ${insertError.message}`);
      } else {
        inserted += insertedData?.length || 0;
        if (isWooMode) {
          batchProducts.forEach((p) => {
            if (p.parent_sku) {
              const matched = insertedData?.find((d: any) => d.sku === toStr(p.sku, 100));
              if (matched) parentSkuMap.push({ productId: matched.id, parentSku: String(p.parent_sku) });
            }
          });
        }
      }
    }

    for (const { id, data: updateData, product: p } of toUpdate) {
      const { error: updateError } = await supabase.from("products").update(updateData).eq("id", id);
      if (updateError) {
        errors.push(`Update SKU ${toStr(p.sku, 100)}: ${updateError.message}`);
      } else {
        updated++;
        if (isWooMode && p.parent_sku) parentSkuMap.push({ productId: id, parentSku: String(p.parent_sku) });
      }
    }
  }

  // Pass 2: Resolve parent SKUs
  if (parentSkuMap.length > 0) {
    const parentSkus = [...new Set(parentSkuMap.map((m) => m.parentSku))];
    const { data: parentProducts } = await supabase.from("products").select("id, sku").in("sku", parentSkus);
    const skuToId = new Map<string, string>();
    (parentProducts || []).forEach((p: any) => { if (p.sku) skuToId.set(p.sku, p.id); });
    for (const { productId, parentSku } of parentSkuMap) {
      const parentId = skuToId.get(parentSku);
      if (parentId) await supabase.from("products").update({ parent_product_id: parentId }).eq("id", productId);
    }
  }

  // Log activity
  await supabase.from("activity_log").insert({
    user_id: userId,
    action: "upload",
    details: { file: fileName, products_count: inserted, updated, skipped, woo_mode: isWooMode },
  });

  console.log(`✅ Parse complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errors.length} errors`);

  // Store result in uploaded_files metadata for frontend polling
  await updateParseStatus(supabase, userId, fileName, workspaceId, {
    count: inserted, updated, total: products.length, skipped, errors, done: true,
  });
}

async function updateParseStatus(supabase: any, userId: string, fileName: string, workspaceId: string | undefined, result: any) {
  // Find the uploaded_file record and update its metadata with parse results
  const query = supabase.from("uploaded_files").select("id, metadata")
    .eq("user_id", userId).eq("file_name", fileName)
    .order("created_at", { ascending: false }).limit(1);
  if (workspaceId) query.eq("workspace_id", workspaceId);
  
  const { data } = await query.maybeSingle();
  if (data) {
    const meta = (data.metadata || {}) as Record<string, unknown>;
    meta.parseResult = result;
    await supabase.from("uploaded_files")
      .update({ metadata: meta, status: "processed", products_count: (result.count || 0) + (result.updated || 0) } as any)
      .eq("id", data.id);
  }
}

// ─── Utility functions ───

function toStr(value: unknown, maxLen: number): string | null {
  if (value == null) return null;
  const normalized = String(value).replace(/\u00A0/g, " ").trim();
  if (!normalized) return null;
  return normalized.substring(0, maxLen) || null;
}

function parsePrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const str = String(value).replace(/[€$\s]/g, "").replace(",", ".");
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
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

  const fileSizeKB = fileData.size / 1024;
  const MAX_PDF_SIZE_KB = 12000;

  if (fileSizeKB > MAX_PDF_SIZE_KB) {
    console.warn(`⚠️ PDF "${fileName}" too large. Using fallback.`);
    return await extractPdfTextViaUrl(fileName, fileData.size);
  }

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
          content: `És um extrator de conteúdo de documentos técnicos e catálogos de produtos. Extrai TODO o texto relevante do PDF, incluindo nomes de produtos, especificações técnicas, tabelas de preços, descrições e códigos de referência. Mantém a estrutura organizada. Responde APENAS com o texto extraído.`,
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
  return (aiData.choices?.[0]?.message?.content || "").substring(0, 50000);
}

async function extractPdfTextViaUrl(fileName: string, fileSize: number): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
          content: `O utilizador carregou um catálogo técnico demasiado grande. Gera informação útil sobre a marca/categoria baseado no nome do ficheiro.`,
        },
        {
          role: "user",
          content: `O ficheiro "${fileName}" (${(fileSize / 1024 / 1024).toFixed(1)}MB) é demasiado grande. Gera contexto útil.`,
        },
      ],
    }),
  });

  if (!aiResponse.ok) {
    await aiResponse.text();
    return `Catálogo: ${fileName} - ficheiro demasiado grande para extração automática.`;
  }

  const aiData = await aiResponse.json();
  const content = aiData.choices?.[0]?.message?.content || "";
  return `[Contexto gerado para catálogo grande: ${fileName}]\n\n${content}`.substring(0, 50000);
}

async function parseExcel(
  fileData: Blob, columnMapping?: Record<string, string>, targetSheet?: string
): Promise<Array<Record<string, unknown>>> {
  const buffer = await fileData.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetName = targetSheet && workbook.SheetNames.includes(targetSheet)
    ? targetSheet : workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (columnMapping && Object.keys(columnMapping).length > 0) {
    return rows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const [productField, excelColumn] of Object.entries(columnMapping)) {
        if (excelColumn && row[excelColumn] !== undefined) mapped[productField] = row[excelColumn];
      }
      return mapped;
    });
  }

  const autoMap: Record<string, RegExp> = {
    title: /^(title|titulo|título|nome|produto|name|product|designa[cç][aã]o)$/i,
    description: /^(description|descri[cç][aã]o|desc|detalhe|details|content|conteudo|conteúdo)$/i,
    short_description: /^(short[\s_-]?description|descri[cç][aã]o[\s_-]?curta|resumo|summary|excerpt)$/i,
    price: /^(price|pre[cç]o|valor|pvp|custo|cost|unit_price|regular[\s_-]?price)$/i,
    sale_price: /^(sale[\s_-]?price|pre[cç]o[\s_-]?promocional)$/i,
    sku: /^(sku|ref|refer[eê]ncia|codigo|código|code|ean|barcode)$/i,
    category: /^(category|categoria|cat|categories|categorias|product[\s_-]?cat)$/i,
    supplier_ref: /^(supplier_ref|ref_fornecedor|fornecedor|supplier|marca|brand)$/i,
    product_type: /^(type|tipo)$/i,
    parent_sku: /^(parent|parent[\s_-]?sku|sku[\s_-]?pai)$/i,
    upsell_skus: /^(up[\s_-]?sells?|upsells?)$/i,
    crosssell_skus: /^(cross[\s_-]?sells?|crosssells?)$/i,
    image_urls: /^(image|imagem|images|imagens|image[\s_-]?url|foto|photo|thumbnail)$/i,
    weight: /^(weight|peso)$/i,
    length: /^(length|comprimento)$/i,
    width: /^(width|largura)$/i,
    height: /^(height|altura)$/i,
    meta_title: /^(meta[\s_:-]?title|rank[\s_-]?math[\s_-]?title|meta:rank_math_title)$/i,
    meta_description: /^(meta[\s_:-]?description|rank[\s_-]?math[\s_-]?description|meta:rank_math_description)$/i,
    focus_keyword: /^(meta[\s_:-]?focus[\s_-]?keyword|rank[\s_-]?math[\s_-]?focus[\s_-]?keyword|focus[\s_-]?keyword|meta:rank_math_focus_keyword)$/i,
    seo_slug: /^(slug|seo[\s_-]?slug|permalink)$/i,
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const detectedMapping: Record<string, string> = {};
  for (const [field, regex] of Object.entries(autoMap)) {
    const found = headers.find((h) => regex.test(h.trim()));
    if (found) detectedMapping[field] = found;
  }

  for (const h of headers) {
    const attrNameMatch = h.match(/^Attribute\s+(\d+)\s+name$/i);
    if (attrNameMatch) {
      const num = attrNameMatch[1];
      detectedMapping[`attribute_${num}_name`] = h;
      const valCol = headers.find((vh) => new RegExp(`^Attribute\\s+${num}\\s+value`, "i").test(vh));
      if (valCol) detectedMapping[`attribute_${num}_values`] = valCol;
    }
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

  const fileSizeKB = fileData.size / 1024;
  if (fileSizeKB > 12000) {
    console.warn(`⚠️ PDF "${fileName}" too large for product parsing. Skipping.`);
    return [];
  }

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
          content: `És um extrator de dados de catálogos de produtos. Analisa o PDF e extrai TODOS os produtos. Para cada produto, extrai: title, description, price, sku, category, supplier_ref. Responde APENAS com a tool call.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extrai todos os produtos deste catálogo PDF: "${fileName}".` },
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
