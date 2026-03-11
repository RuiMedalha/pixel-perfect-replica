import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";

export type ColumnMapping = Record<string, string>; // productField -> excelColumn

export type FileUploadType = "products" | "knowledge" | "update";

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: "PDF" | "Excel";
  uploadType: FileUploadType;
  status: "aguardando" | "a_mapear" | "a_enviar" | "a_processar" | "concluido" | "erro";
  progress: number;
  productsCount?: number;
  error?: string;
  sheetNames?: string[];
  selectedSheet?: string;
  excelHeaders?: string[];
  previewRows?: Record<string, unknown>[];
  columnMapping?: ColumnMapping;
  updateFields?: string[];
}

export interface ProductField {
  key: string;
  label: string;
  required: boolean;
}

export const DEFAULT_PRODUCT_FIELDS: ProductField[] = [
  { key: "title", label: "Título", required: true },
  { key: "description", label: "Descrição", required: false },
  { key: "short_description", label: "Descrição Curta", required: false },
  { key: "technical_specs", label: "Características Técnicas", required: false },
  { key: "price", label: "Preço", required: false },
  { key: "sale_price", label: "Preço Promocional", required: false },
  { key: "sku", label: "SKU / Referência", required: false },
  { key: "category", label: "Categoria", required: false },
  { key: "supplier_ref", label: "Ref. Fornecedor", required: false },
  { key: "image_urls", label: "URLs de Imagens", required: false },
  { key: "product_type", label: "Tipo (simple/variable/variation)", required: false },
  { key: "parent_sku", label: "SKU Pai (Parent)", required: false },
  { key: "upsell_skus", label: "Up-Sells (SKUs)", required: false },
  { key: "crosssell_skus", label: "Cross-Sells (SKUs)", required: false },
  { key: "meta_title", label: "Meta Title SEO", required: false },
  { key: "meta_description", label: "Meta Description SEO", required: false },
  { key: "focus_keyword", label: "Focus Keyword", required: false },
  { key: "seo_slug", label: "SEO Slug", required: false },
  { key: "weight", label: "Peso (kg)", required: false },
  { key: "woocommerce_id", label: "WooCommerce ID", required: false },
  { key: "brand", label: "Marca / Brand", required: false },
  { key: "ean", label: "EAN / GTIN", required: false },
  { key: "modelo", label: "Modelo", required: false },
];

// Keep PRODUCT_FIELDS for backward compat
export const PRODUCT_FIELDS = DEFAULT_PRODUCT_FIELDS;

function readExcelFile(file: File): Promise<XLSX.WorkBook> {
  return file.arrayBuffer().then((buf) => XLSX.read(new Uint8Array(buf), { type: "array" }));
}

function readSheetData(workbook: XLSX.WorkBook, sheetName: string): { headers: string[]; previewRows: Record<string, unknown>[] } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { headers: [], previewRows: [] };
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (rows.length === 0) return { headers: [], previewRows: [] };
  return { headers: Object.keys(rows[0]), previewRows: rows.slice(0, 3) };
}

/** Read ALL rows from an Excel sheet, applying columnMapping */
function readAllSheetRows(workbook: XLSX.WorkBook, sheetName: string, columnMapping?: ColumnMapping): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
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

  // Auto-map if no mapping provided
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
    woocommerce_id: /^(id|product[\s_-]?id|woocommerce[\s_-]?id|woo[\s_-]?id)$/i,
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const detectedMapping: Record<string, string> = {};
  for (const [field, regex] of Object.entries(autoMap)) {
    const found = headers.find((h) => regex.test(h.trim()));
    if (found) detectedMapping[field] = found;
  }

  // Detect attribute columns
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

function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lower = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));

  const patterns: Record<string, RegExp> = {
    title: /^(title|titulo|título|nome|produto|name|product|designa[cç][aã]o)$/i,
    description: /^(description|descri[cç][aã]o|desc|detalhe|details|content|conteudo|conteúdo)$/i,
    short_description: /^(short[\s_-]?description|descri[cç][aã]o[\s_-]?curta|resumo|summary|excerpt)$/i,
    technical_specs: /^(technical_specs|especifica[cç][oõ]es|specs|caracter[ií]sticas|ficha_t[eé]cnica)$/i,
    price: /^(price|pre[cç]o|valor|pvp|custo|cost|unit_price|regular[\s_-]?price)$/i,
    sale_price: /^(sale[\s_-]?price|pre[cç]o[\s_-]?promocional)$/i,
    sku: /^(sku|ref|refer[eê]ncia|codigo|código|code|ean|barcode)$/i,
    category: /^(category|categoria|cat|categories|categorias[\s_-]?de[\s_-]?produto|product[\s_-]?cat|grupo|group|fam[ií]lia)$/i,
    supplier_ref: /^(supplier_ref|ref_fornecedor|fornecedor|supplier|marca|brand)$/i,
    image_urls: /^(image|imagem|images|imagens|image[\s_-]?url|foto|photo|thumbnail)$/i,
    product_type: /^(type|tipo)$/i,
    parent_sku: /^(parent|parent[\s_-]?sku|sku[\s_-]?pai)$/i,
    upsell_skus: /^(up[\s_-]?sells?|upsells?)$/i,
    crosssell_skus: /^(cross[\s_-]?sells?|crosssells?)$/i,
    meta_title: /^(meta[\s_:-]?title|rank[\s_-]?math[\s_-]?title|meta:rank_math_title)$/i,
    meta_description: /^(meta[\s_:-]?description|rank[\s_-]?math[\s_-]?description|meta:rank_math_description)$/i,
    focus_keyword: /^(meta[\s_:-]?focus[\s_-]?keyword|rank[\s_-]?math[\s_-]?focus[\s_-]?keyword|focus[\s_-]?keyword|meta:rank_math_focus_keyword)$/i,
    seo_slug: /^(slug|seo[\s_-]?slug|permalink)$/i,
    weight: /^(weight|peso)$/i,
    woocommerce_id: /^(id|product[\s_-]?id|woocommerce[\s_-]?id|woo[\s_-]?id)$/i,
  };

  for (const [field, regex] of Object.entries(patterns)) {
    const idx = lower.findIndex((h) => regex.test(h));
    if (idx !== -1) mapping[field] = headers[idx];
  }

  return mapping;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_PDF_PART_SIZE = 10 * 1024 * 1024; // 10MB

async function splitPdfFile(file: File): Promise<File[]> {
  const buffer = await file.arrayBuffer();
  if (file.size <= MAX_PDF_PART_SIZE) return [file];

  try {
    const srcDoc = await PDFDocument.load(buffer);
    const totalPages = srcDoc.getPageCount();
    if (totalPages <= 1) return [file];

    const avgPageSize = file.size / totalPages;
    const pagesPerPart = Math.max(1, Math.floor(MAX_PDF_PART_SIZE / avgPageSize));
    const parts: File[] = [];
    const baseName = file.name.replace(/\.pdf$/i, "");

    for (let start = 0; start < totalPages; start += pagesPerPart) {
      const end = Math.min(start + pagesPerPart, totalPages);
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i));
      copiedPages.forEach((p) => newDoc.addPage(p));
      const pdfBytes = await newDoc.save();
      const partNum = Math.floor(start / pagesPerPart) + 1;
      const totalParts = Math.ceil(totalPages / pagesPerPart);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const partFile = new File(
        [blob],
        `${baseName}_parte${partNum}de${totalParts}.pdf`,
        { type: "application/pdf" }
      );
      parts.push(partFile);
    }

    return parts;
  } catch (e) {
    console.warn("PDF split failed, uploading as single file:", e);
    return [file];
  }
}

async function pollForParseResult(fileName: string, userId: string, workspaceId?: string, maxWaitMs = 300_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const query = supabase
      .from("uploaded_files")
      .select("metadata, status")
      .eq("user_id", userId)
      .eq("file_name", fileName)
      .order("created_at", { ascending: false })
      .limit(1);
    if (workspaceId) query.eq("workspace_id", workspaceId);
    const { data } = await query.maybeSingle();
    const meta = data?.metadata as any;
    if (meta?.parseResult?.done) {
      return meta.parseResult;
    }
  }
  return { count: 0, updated: 0, total: 0, skipped: 0, errors: ["Timeout ao aguardar processamento"] };
}

/** Send parsed rows to edge function in chunks to avoid payload limits */
async function sendParsedRowsInBatches(
  rows: Record<string, unknown>[],
  columnMapping: ColumnMapping | undefined,
  fileName: string,
  workspaceId: string | undefined,
  maxRetries = 3,
  updateMode?: boolean,
  updateFields?: string[]
): Promise<{ count: number; updated: number; total: number; skipped: number; errors: string[] }> {
  const BATCH_SIZE = 500; // rows per request
  let totalCount = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let success = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { data, error } = await supabase.functions.invoke("parse-catalog", {
          body: {
            fileName,
            parsedRows: batch,
            columnMapping: columnMapping || undefined,
            workspaceId: workspaceId || undefined,
            updateMode: updateMode || undefined,
            updateFields: updateFields || undefined,
          },
        });

        if (error) {
          console.warn(`Batch ${i / BATCH_SIZE + 1} attempt ${attempt} error:`, error.message);
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
          }
          allErrors.push(`Batch ${i / BATCH_SIZE + 1}: ${error.message}`);
          break;
        }

        totalCount += data?.count || 0;
        totalUpdated += data?.updated || 0;
        totalSkipped += data?.skipped || 0;
        if (data?.errors?.length) allErrors.push(...data.errors);
        success = true;
        break;
      } catch (e: any) {
        console.warn(`Batch ${i / BATCH_SIZE + 1} attempt ${attempt} failed:`, e?.message);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        } else {
          allErrors.push(`Batch ${i / BATCH_SIZE + 1}: ${e?.message || "Unknown error"}`);
        }
      }
    }
  }

  return { count: totalCount, updated: totalUpdated, total: rows.length, skipped: totalSkipped, errors: allErrors };
}

export function useUploadCatalog() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [customFields, setCustomFields] = useState<ProductField[]>([]);
  const qc = useQueryClient();

  const allFields = [...DEFAULT_PRODUCT_FIELDS, ...customFields];

  const updateFile = (id: string, update: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...update } : f)));
  };

  const addCustomField = (key: string, label: string) => {
    if (allFields.some((f) => f.key === key)) return;
    setCustomFields((prev) => [...prev, { key, label, required: false }]);
  };

  const removeCustomField = (key: string) => {
    setCustomFields((prev) => prev.filter((f) => f.key !== key));
  };

  const checkDuplicate = async (fileName: string, fileHash: string): Promise<boolean> => {
    const { data } = await supabase
      .from("uploaded_files")
      .select("id, file_name")
      .or(`file_hash.eq.${fileHash},file_name.eq.${fileName}`)
      .limit(1);
    return (data?.length ?? 0) > 0;
  };

  const addFiles = async (fileList: FileList, uploadType: FileUploadType = "products") => {
    const accepted = Array.from(fileList).filter(
      (f) =>
        f.name.endsWith(".pdf") ||
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls")
    );
    if (accepted.length === 0) {
      toast.error("Apenas ficheiros PDF, XLSX e XLS são aceites.");
      return;
    }

    const newFiles: UploadedFile[] = [];

    for (const f of accepted) {
      const isPdf = f.name.endsWith(".pdf");

      // Split large PDFs into parts
      const filesToProcess: File[] = isPdf && f.size > MAX_PDF_PART_SIZE
        ? await (async () => {
            toast.info(`"${f.name}" tem ${(f.size / 1024 / 1024).toFixed(1)}MB. A dividir em partes...`);
            const parts = await splitPdfFile(f);
            if (parts.length > 1) {
              toast.success(`"${f.name}" dividido em ${parts.length} partes para melhor extração.`);
            }
            return parts;
          })()
        : [f];

      for (const partFile of filesToProcess) {
        // Check for duplicates
        const hash = await computeFileHash(partFile);
        const isDuplicate = await checkDuplicate(partFile.name, hash);
        if (isDuplicate) {
          toast.warning(`"${partFile.name}" já foi carregado anteriormente. A ignorar.`);
          continue;
        }

        const base: UploadedFile = {
          id: crypto.randomUUID(),
          file: partFile,
          name: partFile.name,
          size: partFile.size,
          type: isPdf ? "PDF" : "Excel",
          uploadType,
          status: isPdf ? "aguardando" : (uploadType === "knowledge" ? "aguardando" : "a_mapear"),
          progress: 0,
        };

      if (!isPdf && (uploadType === "products" || uploadType === "update")) {
        try {
          const workbook = await readExcelFile(partFile);
          base.sheetNames = workbook.SheetNames;
          const firstSheet = workbook.SheetNames[0];
          if (firstSheet) {
            base.selectedSheet = firstSheet;
            const { headers, previewRows } = readSheetData(workbook, firstSheet);
            base.excelHeaders = headers;
            base.previewRows = previewRows;
            base.columnMapping = autoMapColumns(headers);
          }
        } catch {
          base.status = "erro";
          base.error = "Não foi possível ler o ficheiro Excel";
        }
      }

        newFiles.push(base);
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
  };

  const setColumnMapping = (id: string, mapping: ColumnMapping) => {
    updateFile(id, { columnMapping: mapping });
  };

  const setUpdateFields = (id: string, fields: string[]) => {
    updateFile(id, { updateFields: fields });
  };

  const confirmMapping = (id: string) => {
    updateFile(id, { status: "aguardando" });
  };

  const selectSheet = async (id: string, sheetName: string) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    try {
      const workbook = await readExcelFile(file.file);
      const { headers, previewRows } = readSheetData(workbook, sheetName);
      updateFile(id, {
        selectedSheet: sheetName,
        excelHeaders: headers,
        previewRows,
        columnMapping: autoMapColumns(headers),
      });
    } catch {
      toast.error("Erro ao ler a folha selecionada.");
    }
  };

  const registerUpload = async (uploadedFile: UploadedFile, userId: string, storagePath: string, productsCount: number, workspaceId?: string) => {
    const hash = await computeFileHash(uploadedFile.file);
    await supabase.from("uploaded_files").insert({
      user_id: userId,
      file_name: uploadedFile.name,
      file_size: uploadedFile.size,
      file_hash: hash,
      file_type: uploadedFile.uploadType,
      storage_path: storagePath,
      status: "processed",
      products_count: productsCount,
      workspace_id: workspaceId || null,
      metadata: {
        type: uploadedFile.type,
        columnMapping: uploadedFile.columnMapping,
        selectedSheet: uploadedFile.selectedSheet,
      },
    } as any);
  };

  const processFile = async (uploadedFile: UploadedFile, workspaceId?: string) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      updateFile(uploadedFile.id, { status: "erro", error: "Utilizador não autenticado" });
      toast.error("É necessário estar autenticado para fazer upload.");
      return;
    }

    try {
      updateFile(uploadedFile.id, { status: "a_enviar", progress: 20 });
      const filePath = `${user.id}/${Date.now()}_${uploadedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("catalogs")
        .upload(filePath, uploadedFile.file);

      if (uploadError) throw new Error("Erro no upload: " + uploadError.message);

      updateFile(uploadedFile.id, { status: "a_processar", progress: 50 });

      // ─── Knowledge files ───
      if (uploadedFile.uploadType === "knowledge") {
        updateFile(uploadedFile.id, { status: "a_processar", progress: 60 });
        
        const hash = await computeFileHash(uploadedFile.file);
        const { data: insertedFile } = await supabase.from("uploaded_files").insert({
          user_id: user.id,
          file_name: uploadedFile.name,
          file_size: uploadedFile.size,
          file_hash: hash,
          file_type: uploadedFile.uploadType,
          storage_path: filePath,
          status: "processing",
          products_count: 0,
          workspace_id: workspaceId || null,
          metadata: { type: uploadedFile.type },
        } as any).select("id").single();

        let extractedText = "";
        try {
          const { data: parseData, error: parseError } = await supabase.functions.invoke("parse-catalog", {
            body: { 
              filePath, 
              fileName: uploadedFile.name, 
              parseKnowledge: true, 
              workspaceId: workspaceId || undefined,
              fileId: insertedFile?.id,
            },
          });
          if (!parseError && parseData?.extractedText) {
            extractedText = parseData.extractedText;
          }
        } catch (e) {
          console.warn("Knowledge parsing failed:", e);
        }

        if (insertedFile?.id) {
          await supabase.from("uploaded_files").update({
            status: "processed",
            extracted_text: extractedText || null,
          } as any).eq("id", insertedFile.id);
        }

        updateFile(uploadedFile.id, { status: "concluido", progress: 100, productsCount: 0 });
        toast.success(`Ficheiro de conhecimento "${uploadedFile.name}" processado com sucesso.${extractedText ? " Texto extraído para contexto." : ""}`);
        qc.invalidateQueries({ queryKey: ["uploaded-files"] });
        return;
      }

      // ─── Excel products: parse on frontend, send rows to backend ───
      if (uploadedFile.type === "Excel") {
        updateFile(uploadedFile.id, { status: "a_processar", progress: 60 });
        toast.info(`A processar "${uploadedFile.name}" localmente...`);

        const workbook = await readExcelFile(uploadedFile.file);
        const sheetName = uploadedFile.selectedSheet || workbook.SheetNames[0];
        const parsedRows = readAllSheetRows(workbook, sheetName, uploadedFile.columnMapping);

        if (parsedRows.length === 0) {
          await registerUpload(uploadedFile, user.id, filePath, 0, workspaceId);
          updateFile(uploadedFile.id, { status: "concluido", progress: 100, productsCount: 0 });
          toast.warning(`Nenhum produto encontrado em "${uploadedFile.name}".`);
          qc.invalidateQueries({ queryKey: ["products"] });
          qc.invalidateQueries({ queryKey: ["uploaded-files"] });
          return;
        }

        updateFile(uploadedFile.id, { status: "a_processar", progress: 70 });

        const isUpdateMode = uploadedFile.uploadType === "update";
        const result = await sendParsedRowsInBatches(
          parsedRows,
          uploadedFile.columnMapping,
          uploadedFile.name,
          workspaceId,
          3,
          isUpdateMode,
          isUpdateMode ? uploadedFile.updateFields : undefined
        );

        const totalProcessed = (result.count || 0) + (result.updated || 0);
        await registerUpload(uploadedFile, user.id, filePath, totalProcessed, workspaceId);
        updateFile(uploadedFile.id, {
          status: "concluido",
          progress: 100,
          productsCount: totalProcessed,
        });

        const msgParts: string[] = [];
        if (result.count > 0) msgParts.push(`${result.count} novo(s)`);
        if (result.updated > 0) msgParts.push(`${result.updated} atualizado(s)`);
        if (result.skipped > 0) msgParts.push(`${result.skipped} ignorado(s)`);
        if (msgParts.length > 0) {
          toast.success(`${msgParts.join(", ")} de "${uploadedFile.name}"`);
        } else {
          toast.success(`"${uploadedFile.name}" processado.`);
        }
        if (result.errors.length > 0) {
          console.warn("Parse errors:", result.errors);
          toast.warning(`${result.errors.length} erro(s) durante o processamento.`);
        }

        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["uploaded-files"] });
        return;
      }

      // ─── PDF products: still use server-side processing ───
      const { data, error } = await supabase.functions.invoke("parse-catalog", {
        body: {
          filePath,
          fileName: uploadedFile.name,
          workspaceId: workspaceId || undefined,
        },
      });

      if (error) throw new Error(error.message || "Erro ao processar ficheiro");
      if (data?.error && data?.count === undefined && !data?.background) throw new Error(data.error);

      if (data?.background) {
        toast.info(`A processar "${uploadedFile.name}" em segundo plano...`);
        const result = await pollForParseResult(uploadedFile.name, user.id, workspaceId);
        const count = result?.count || 0;
        const updatedCount = result?.updated || 0;
        await registerUpload(uploadedFile, user.id, filePath, count + updatedCount, workspaceId);
        updateFile(uploadedFile.id, {
          status: "concluido",
          progress: 100,
          productsCount: count + updatedCount,
        });
        const msgParts: string[] = [];
        if (count > 0) msgParts.push(`${count} novo(s)`);
        if (updatedCount > 0) msgParts.push(`${updatedCount} atualizado(s)`);
        if (msgParts.length > 0) {
          toast.success(`${msgParts.join(", ")} de "${uploadedFile.name}"`);
        } else {
          toast.success(`"${uploadedFile.name}" processado.`);
        }
      } else {
        const count = data?.count || 0;
        const updatedCount = data?.updated || 0;
        await registerUpload(uploadedFile, user.id, filePath, count + updatedCount, workspaceId);
        updateFile(uploadedFile.id, {
          status: "concluido",
          progress: 100,
          productsCount: count + updatedCount,
        });
        const msgParts: string[] = [];
        if (count > 0) msgParts.push(`${count} novo(s)`);
        if (updatedCount > 0) msgParts.push(`${updatedCount} atualizado(s)`);
        if (msgParts.length > 0) {
          toast.success(`${msgParts.join(", ")} de "${uploadedFile.name}"`);
        } else {
          toast.success(`"${uploadedFile.name}" processado.`);
        }
      }

      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      updateFile(uploadedFile.id, { status: "erro", error: msg });
      toast.error(`Erro ao processar "${uploadedFile.name}": ${msg}`);
    }
  };

  const processAllFiles = async (workspaceId?: string) => {
    const pending = files.filter((f) => f.status === "aguardando");
    for (const f of pending) {
      await processFile(f, workspaceId);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return {
    files,
    addFiles,
    removeFile,
    processFile,
    processAllFiles,
    setColumnMapping,
    setUpdateFields,
    confirmMapping,
    selectSheet,
    allFields,
    customFields,
    addCustomField,
    removeCustomField,
  };
}
