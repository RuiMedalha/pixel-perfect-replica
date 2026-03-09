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
    const { filePath, fileName, columnMapping, sheetName, parseKnowledge, workspaceId, fileId, parsedRows, _batch } = body;

    // ─── Batch continuation mode (for large inserts) ───
    if (_batch) {
      await processBatch(_batch, userId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!fileName) {
      return new Response(JSON.stringify({ error: "fileName é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Knowledge file: process in background ───
    if (parseKnowledge) {
      if (!filePath) {
        return new Response(JSON.stringify({ error: "filePath é obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const promise = processKnowledge(supabase, userId, filePath, fileName, workspaceId, fileId);
      (globalThis as any).EdgeRuntime?.waitUntil?.(promise.catch((e: any) => console.error("Knowledge bg error:", e)));
      return new Response(
        JSON.stringify({ extractedText: "", count: 0, background: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Product parsing with pre-parsed rows from frontend ───
    if (parsedRows && Array.isArray(parsedRows)) {
      // Frontend already parsed the Excel — just insert into DB
      const result = await insertProducts(parsedRows, columnMapping, userId, workspaceId, fileName);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── PDF parsing: still needs server-side processing ───
    if (filePath) {
      const ext = fileName.toLowerCase().split(".").pop();
      if (ext === "pdf") {
        // PDF: process in background
        const promise = processPdfInBackground(supabase, userId, filePath, fileName, workspaceId);
        (globalThis as any).EdgeRuntime?.waitUntil?.(promise.catch((e: any) => console.error("PDF bg error:", e)));
        return new Response(
          JSON.stringify({ background: true, message: "PDF em processamento" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Dados insuficientes para processamento" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("parse-catalog error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Insert products directly (no file parsing needed) ───
async function insertProducts(
  products: Array<Record<string, unknown>>,
  columnMapping: Record<string, string> | undefined,
  userId: string,
  workspaceId: string | undefined,
  fileName: string
) {
  const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (products.length === 0) {
    return { count: 0, updated: 0, total: 0, skipped: 0, errors: [] };
  }

  const mappedFieldKeys = new Set<string>(columnMapping ? Object.keys(columnMapping) : []);
  const hasMapping = mappedFieldKeys.size > 0;

  // SKU lookup
  const productSkus = products.map((p) => toStr(p.sku, 100)).filter((s): s is string => !!s);
  const existingSkuMap = new Map<string, string>();
  if (productSkus.length > 0) {
    for (let i = 0; i < productSkus.length; i += 200) {
      const batch = productSkus.slice(i, i + 200);
      const query = adminDb.from("products").select("id, sku").in("sku", batch);
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
        const updateData = buildProductData(p, true, mappedFieldKeys, hasMapping);
        if (Object.keys(updateData).length > 0) {
          toUpdate.push({ id: existingId, data: updateData, product: p });
        } else {
          skipped++;
        }
      } else {
        const productData = buildProductData(p, false, mappedFieldKeys, hasMapping);
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
      const { error: insertError, data: insertedData } = await adminDb
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
      const { error: updateError } = await adminDb.from("products").update(updateData).eq("id", id);
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
    const { data: parentProducts } = await adminDb.from("products").select("id, sku").in("sku", parentSkus);
    const skuToId = new Map<string, string>();
    (parentProducts || []).forEach((p: any) => { if (p.sku) skuToId.set(p.sku, p.id); });
    for (const { productId, parentSku } of parentSkuMap) {
      const parentId = skuToId.get(parentSku);
      if (parentId) await adminDb.from("products").update({ parent_product_id: parentId }).eq("id", productId);
    }
  }

  // Log activity
  await adminDb.from("activity_log").insert({
    user_id: userId,
    action: "upload",
    details: { file: fileName, products_count: inserted, updated, skipped, woo_mode: isWooMode },
  });

  console.log(`✅ Parse complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${errors.length} errors`);

  return { count: inserted, updated, total: products.length, skipped, errors };
}

async function processBatch(batchData: any, userId: string) {
  const { products, columnMapping, workspaceId, fileName } = batchData;
  await insertProducts(products, columnMapping, userId, workspaceId, fileName);
}

function buildProductData(p: Record<string, unknown>, onlyMapped: boolean, mappedFieldKeys: Set<string>, hasMapping: boolean) {
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

  // Collect extra technical attributes (Marca, EAN, Modelo) into the attributes array
  const brandVal = toStr(p.brand, 200);
  const eanVal = toStr(p.ean, 100);
  const modeloVal = toStr(p.modelo, 200);
  if (brandVal) attributes.push({ name: "Marca", value: brandVal, variation: false });
  if (eanVal) attributes.push({ name: "EAN", value: eanVal, variation: false });
  if (modeloVal) attributes.push({ name: "Modelo", value: modeloVal, variation: false });

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
    brand: () => { /* handled above as attribute */ },
    ean: () => { /* handled above as attribute */ },
    modelo: () => { /* handled above as attribute */ },
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

// ─── PDF background processing ───
async function processPdfInBackground(supabase: any, userId: string, filePath: string, fileName: string, workspaceId?: string) {
  const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: fileData, error: downloadError } = await adminDb.storage.from("catalogs").download(filePath);
  if (downloadError || !fileData) {
    console.error("PDF download error:", downloadError?.message);
    await updateParseStatus(adminDb, userId, fileName, workspaceId, { count: 0, updated: 0, total: 0, skipped: 0, errors: [downloadError?.message || "Download failed"], done: true });
    return;
  }

  const products = await parsePdfWithAI(fileData, fileName);
  if (products.length === 0) {
    await updateParseStatus(adminDb, userId, fileName, workspaceId, { count: 0, updated: 0, total: 0, skipped: 0, errors: [], done: true });
    return;
  }

  const result = await insertProducts(products, undefined, userId, workspaceId, fileName);
  await updateParseStatus(adminDb, userId, fileName, workspaceId, { ...result, done: true });
}

// ─── Knowledge processing ───
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

async function updateParseStatus(supabase: any, userId: string, fileName: string, workspaceId: string | undefined, result: any) {
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

async function parsePdfWithAI(fileData: Blob, fileName: string): Promise<Array<Record<string, unknown>>> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  console.log(`📄 Parsing PDF "${fileName}" (${(fileData.size / 1024 / 1024).toFixed(1)}MB) for products...`);

  const buffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const base64 = btoa(binary);

  const systemPrompt = `És um especialista em extração de dados de catálogos de produtos industriais e comerciais.

REGRAS DE EXTRAÇÃO:
1. CABEÇALHOS DE PÁGINA: Identifica o nome da COLEÇÃO/MODELO que aparece no topo ou cabeçalho de cada página (ex: "Mica", "Gema", "Ópera"). Este nome aplica-se a TODOS os produtos listados nessa página.
2. TÍTULO: Compõe o título como "{Descrição do item} {Coleção/Modelo} {Marca}" (ex: "Cuchara mesa Mica JAY", "Cazo Ópera Lacor").
3. MARCA: Identifica a marca do catálogo pelo nome do ficheiro, logótipo ou cabeçalho (ex: "JAY", "Lacor").
4. SKU/REFERÊNCIA: Extrai o código de referência de cada produto (coluna "Ref", "Código", "Art.", etc).
5. PREÇO: Extrai o preço unitário (coluna "€", "PVP", "Precio", etc). Usa ponto como separador decimal.
6. ESPECIFICAÇÕES TÉCNICAS: Extrai dimensões como comprimento (L), espessura (e), diâmetro (Ø), capacidade (cl/L), etc. Formata como "L: 202mm | e: 4.0mm".
7. CATEGORIA: Identifica a categoria geral dos produtos (ex: "Cubiertos INOX 18/10", "Utensilios de cocina").
8. DESCRIÇÃO CURTA: Se existir texto descritivo sobre o produto ou coleção, extrai-o.
9. PRODUTOS VARIÁVEIS: Se vários produtos pertencem à mesma coleção/modelo (ex: colher, garfo, faca da coleção "Mica"), marca-os como variações:
   - O produto "pai" (a coleção) tem product_type="variable" e parent_title vazio
   - Cada item individual tem product_type="variation" e parent_title="Coleção {Modelo} {Marca}"
   - Se não pertencem a uma coleção, usa product_type="simple"
10. IMAGENS: Se encontrares URLs ou referências de imagens, inclui-as.
11. Extrai TODOS os produtos — não ignores nenhuma linha de tabela.

Responde APENAS com a tool call.`;

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Extrai TODOS os produtos deste catálogo PDF: "${fileName}". Analisa cada página, identifica coleções/modelos nos cabeçalhos e extrai cada linha de produto.` },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_products",
            description: "Devolve os produtos extraídos do catálogo com coleções, variações e especificações técnicas",
            parameters: {
              type: "object",
              properties: {
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Título completo: {Item} {Coleção} {Marca}" },
                      description: { type: "string", description: "Descrição longa do produto ou coleção" },
                      short_description: { type: "string", description: "Descrição curta" },
                      price: { type: "string", description: "Preço com ponto decimal (ex: 2.68)" },
                      sku: { type: "string", description: "Código de referência" },
                      category: { type: "string", description: "Categoria do produto" },
                      supplier_ref: { type: "string", description: "Referência do fornecedor" },
                      brand: { type: "string", description: "Marca (ex: JAY, Lacor)" },
                      model: { type: "string", description: "Nome da coleção/modelo (ex: Mica, Gema)" },
                      technical_specs: { type: "string", description: "Especificações técnicas formatadas (ex: L: 202mm | e: 4.0mm)" },
                      product_type: { type: "string", enum: ["simple", "variable", "variation"], description: "Tipo de produto" },
                      parent_title: { type: "string", description: "Título do produto pai para variações" },
                      image_urls: { type: "array", items: { type: "string" }, description: "URLs de imagens" },
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
  
  // Try tool call first
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      const products = parsed.products || [];
      console.log(`✅ Extracted ${products.length} products from PDF via tool call`);
      
      // Post-process: map brand/model into attributes and enrich data
      return products.map((p: any) => {
        const result: Record<string, unknown> = { ...p };
        // Map model to the modelo field used by buildProductData
        if (p.model && !p.modelo) result.modelo = p.model;
        return result;
      });
    } catch (parseErr) {
      console.error("Tool call JSON parse error:", parseErr);
    }
  }

  // Fallback: try to extract JSON from text content
  const textContent = aiData.choices?.[0]?.message?.content || "";
  if (textContent) {
    console.log("⚠️ No tool call returned, trying text fallback...");
    const jsonMatch = textContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const products = JSON.parse(jsonMatch[0]);
        console.log(`✅ Extracted ${products.length} products from PDF via text fallback`);
        return products;
      } catch { /* ignore */ }
    }
  }

  console.warn("⚠️ No products extracted from PDF");
  return [];
}
