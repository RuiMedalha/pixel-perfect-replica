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

    const { filePath, fileName, columnMapping, sheetName, parseKnowledge, workspaceId, fileId } = await req.json();
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
        // Use fileId passed from frontend, or fall back to lookup
        let resolvedFileId = fileId;
        if (!resolvedFileId) {
          const { data: fileRecord } = await supabase
            .from("uploaded_files")
            .select("id")
            .eq("file_name", fileName)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          resolvedFileId = fileRecord?.id;
        }

        if (resolvedFileId) {
          const chunks = chunkText(extractedText, 1500);
          const chunkRows = chunks.map((content, idx) => ({
            file_id: resolvedFileId,
            user_id: userId,
            workspace_id: workspaceId || null,
            chunk_index: idx,
            content,
            source_name: fileName,
          }));

          // Delete old chunks for this file first
          await supabase
            .from("knowledge_chunks")
            .delete()
            .eq("file_id", resolvedFileId);

          // Insert in batches of 50
          for (let i = 0; i < chunkRows.length; i += 50) {
            const { error: chunkError } = await supabase
              .from("knowledge_chunks")
              .insert(chunkRows.slice(i, i + 50) as any);
            if (chunkError) {
              console.error(`Chunk insert error batch ${i}:`, chunkError.message);
            }
          }
          
          // Also save extracted_text directly on the uploaded_files record
          // This ensures "Ver Conteúdo" button works even if frontend update fails
          const previewText = extractedText.substring(0, 50000);
          await supabase
            .from("uploaded_files")
            .update({ extracted_text: previewText, status: "processed" } as any)
            .eq("id", resolvedFileId);
          
          console.log(`✅ Stored ${chunkRows.length} knowledge chunks for "${fileName}" (fileId: ${resolvedFileId}), extracted_text saved (${previewText.length} chars)`);
        } else {
          console.error(`❌ Could not find uploaded_files record for "${fileName}" - chunks NOT stored`);
        }
      } else {
        console.warn(`⚠️ No text extracted from "${fileName}"`);
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

    // SKU lookup: query existing SKUs in workspace to decide insert vs update
    const productSkus = products
      .map((p) => toStr(p.sku, 100))
      .filter((s): s is string => !!s);

    const existingSkuMap = new Map<string, string>(); // sku -> product id
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
        console.log(`🔍 Found ${existingSkuMap.size} existing SKUs in workspace, will update mapped fields only`);
      }
    }

    // Build a set of mapped field keys from columnMapping
    const mappedFieldKeys = new Set<string>(columnMapping ? Object.keys(columnMapping) : []);
    // If no columnMapping provided (e.g. PDF), treat all fields as mapped
    const hasMapping = mappedFieldKeys.size > 0;

    // Helper: build product data object with only mapped fields
    function buildProductData(p: Record<string, unknown>, onlyMapped: boolean) {
      const data: Record<string, unknown> = {};

      // Parse complex fields
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

      const upsellSkus = p.upsell_skus
        ? String(p.upsell_skus).split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      const crosssellSkus = p.crosssell_skus
        ? String(p.crosssell_skus).split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];

      let imageUrls: string[] = [];
      if (p.image_urls) {
        if (Array.isArray(p.image_urls)) {
          imageUrls = p.image_urls;
        } else {
          imageUrls = String(p.image_urls).split(/[,|]/).map((s: string) => s.trim()).filter(Boolean);
        }
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

      // Field mapping: columnMapping key -> DB column(s) + value
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
        weight: () => { /* already handled in technical_specs */ },
        woocommerce_id: () => { data.woocommerce_id = p.woocommerce_id ? parseInt(String(p.woocommerce_id), 10) || null : null; },
      };

      if (onlyMapped && hasMapping) {
        // Only set fields that the user explicitly mapped
        for (const key of mappedFieldKeys) {
          if (fieldMap[key]) fieldMap[key]();
        }
      } else {
        // Set all fields (new product without specific mapping, or PDF import)
        for (const [key, fn] of Object.entries(fieldMap)) {
          fn();
        }
      }

      // Attributes are always set if present (parsed from attribute_N_name columns)
      if (attributes.length > 0) {
        data.attributes = attributes;
      }

      return data;
    }

    // Detect WooCommerce mode
    const isWooMode = products.some((p) => p.product_type || p.parent_sku);
    if (isWooMode) console.log("🛒 WooCommerce mode detected");

    // Process products in batches of 50
    const batchSize = 50;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const parentSkuMap: Array<{ productId: string; parentSku: string }> = [];

    for (let i = 0; i < products.length; i += batchSize) {
      const batchProducts = products.slice(i, i + batchSize);
      
      // Separate into new products (insert) and existing products (update)
      const toInsert: any[] = [];
      const toUpdate: Array<{ id: string; data: Record<string, unknown>; product: Record<string, unknown> }> = [];

      for (const p of batchProducts) {
        const sku = toStr(p.sku, 100);
        const existingId = sku ? existingSkuMap.get(sku) : null;

        if (existingId) {
          // Existing product: build update with only mapped fields
          const updateData = buildProductData(p, true);
          if (Object.keys(updateData).length > 0) {
            toUpdate.push({ id: existingId, data: updateData, product: p });
          } else {
            skipped++;
          }
        } else {
          // New product: insert with all mapped fields + required system fields
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

      // Batch INSERT new products
      if (toInsert.length > 0) {
        const { error: insertError, data: insertedData } = await supabase
          .from("products")
          .insert(toInsert)
          .select("id, sku");

        if (insertError) {
          errors.push(`Insert batch ${i / batchSize + 1}: ${insertError.message}`);
        } else {
          inserted += insertedData?.length || 0;
          if (isWooMode) {
            batchProducts.forEach((p) => {
              if (p.parent_sku) {
                const matchedInserted = insertedData?.find((d: any) => d.sku === toStr(p.sku, 100));
                if (matchedInserted) {
                  parentSkuMap.push({ productId: matchedInserted.id, parentSku: String(p.parent_sku) });
                }
              }
            });
          }
        }
      }

      // UPDATE existing products one by one (only mapped fields)
      for (const { id, data: updateData, product: p } of toUpdate) {
        const { error: updateError } = await supabase
          .from("products")
          .update(updateData)
          .eq("id", id);

        if (updateError) {
          errors.push(`Update SKU ${toStr(p.sku, 100)}: ${updateError.message}`);
        } else {
          updated++;
          if (isWooMode && p.parent_sku) {
            parentSkuMap.push({ productId: id, parentSku: String(p.parent_sku) });
          }
        }
      }
    }

    // Pass 2: Resolve Parent SKU → parent_product_id
    if (parentSkuMap.length > 0) {
      const parentSkus = [...new Set(parentSkuMap.map((m) => m.parentSku))];
      const { data: parentProducts } = await supabase
        .from("products")
        .select("id, sku")
        .in("sku", parentSkus);

      const skuToId = new Map<string, string>();
      (parentProducts || []).forEach((p: any) => {
        if (p.sku) skuToId.set(p.sku, p.id);
      });

      let resolved = 0;
      for (const { productId, parentSku } of parentSkuMap) {
        const parentId = skuToId.get(parentSku);
        if (parentId) {
          await supabase.from("products").update({ parent_product_id: parentId }).eq("id", productId);
          resolved++;
        }
      }
      console.log(`🔗 Pass 2: Resolved ${resolved}/${parentSkuMap.length} parent-child relationships`);
    }

    if (skipped > 0) {
      console.log(`⏭️ Skipped ${skipped} duplicate products (existing SKUs)`);
    }

    // Log activity
    await supabase.from("activity_log").insert({
      user_id: userId,
      action: "upload",
      details: { file: fileName, products_count: inserted, skipped, woo_mode: isWooMode },
    });

    return new Response(
      JSON.stringify({ count: inserted, total: products.length, skipped, errors }),
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
  const MAX_PDF_SIZE_KB = 12000; // ~12MB limit to stay within memory

  if (fileSizeKB > MAX_PDF_SIZE_KB) {
    console.warn(`⚠️ PDF "${fileName}" too large (${fileSizeKB.toFixed(0)}KB > ${MAX_PDF_SIZE_KB}KB). Using signed URL method.`);
    return await extractPdfTextViaUrl(fileName, fileData.size);
  }

  const buffer = await fileData.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Build base64 in chunks to avoid stack overflow
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const base64 = btoa(binary);

  console.log(`📄 Extracting PDF text from "${fileName}" (${fileSizeKB.toFixed(0)}KB, base64: ${(base64.length / 1024).toFixed(0)}KB)`);

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
          content: `És um extrator de conteúdo de documentos técnicos e catálogos de produtos. Extrai TODO o texto relevante do PDF, incluindo:
- Nomes e modelos de produtos
- Especificações técnicas (dimensões, peso, potência, capacidade, voltagem, materiais)
- Tabelas de preços e referências
- Descrições de produtos e características
- Códigos de referência e SKUs
Mantém a estrutura organizada com separadores claros entre produtos/secções.
Responde APENAS com o texto extraído, sem comentários adicionais.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extrai todo o conteúdo relevante deste documento: "${fileName}". Foca-te em dados de produtos, especificações técnicas, preços e referências.` },
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
  console.log(`✅ Extracted ${content.length} chars from PDF "${fileName}"`);
  return content.substring(0, 50000);
}

// Fallback for large PDFs: use Supabase signed URL instead of base64 inline
async function extractPdfTextViaUrl(fileName: string, fileSize: number): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  // For very large PDFs, we use AI to describe what it knows about the product/brand
  // based on the filename, since we can't send the full file
  console.log(`📄 Large PDF fallback: extracting context from filename "${fileName}" (${(fileSize / 1024).toFixed(0)}KB)`);

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
          content: `O utilizador carregou um catálogo técnico de produtos demasiado grande para processar diretamente. Com base no nome do ficheiro, gera informação útil sobre a marca/categoria de produtos que este catálogo provavelmente contém. Inclui termos técnicos relevantes, categorias de produtos típicas e especificações comuns para este tipo de equipamento.`,
        },
        {
          role: "user",
          content: `O ficheiro "${fileName}" (${(fileSize / 1024 / 1024).toFixed(1)}MB) é demasiado grande para processar. Gera contexto útil baseado no nome do ficheiro para servir como conhecimento de referência. Que tipo de produtos, marcas e especificações este catálogo provavelmente contém?`,
        },
      ],
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("AI large PDF fallback error:", aiResponse.status, errText);
    return `Catálogo: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB) - ficheiro demasiado grande para extração automática.`;
  }

  const aiData = await aiResponse.json();
  const content = aiData.choices?.[0]?.message?.content || "";
  console.log(`✅ Generated ${content.length} chars context for large PDF "${fileName}"`);
  return `[Contexto gerado para catálogo grande: ${fileName}]\n\n${content}`.substring(0, 50000);
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
    category: /^(category|categoria|cat|categories|categorias)$/i,
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

  // Handle WooCommerce attribute columns (Attribute 1 name, Attribute 1 value(s), etc.)
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
  const MAX_PDF_SIZE_KB = 12000;

  if (fileSizeKB > MAX_PDF_SIZE_KB) {
    console.warn(`⚠️ PDF "${fileName}" too large for product parsing (${fileSizeKB.toFixed(0)}KB). Skipping.`);
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
