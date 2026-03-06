import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export type ColumnMapping = Record<string, string>; // productField -> excelColumn

export type FileUploadType = "products" | "knowledge";

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
  { key: "sku", label: "SKU / Referência", required: false },
  { key: "category", label: "Categoria", required: false },
  { key: "supplier_ref", label: "Ref. Fornecedor", required: false },
  { key: "image_urls", label: "URLs de Imagens", required: false },
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

function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lower = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));

  const patterns: Record<string, RegExp> = {
    title: /^(title|titulo|título|nome|produto|name|product|designa[cç][aã]o)$/i,
    description: /^(description|descri[cç][aã]o|desc|detalhe|details|content|conteudo|conteúdo)$/i,
    short_description: /^(short_description|descri[cç][aã]o_curta|resumo|summary|excerpt)$/i,
    technical_specs: /^(technical_specs|especifica[cç][oõ]es|specs|caracter[ií]sticas|ficha_t[eé]cnica)$/i,
    price: /^(price|pre[cç]o|valor|pvp|custo|cost|unit_price)$/i,
    sku: /^(sku|ref|refer[eê]ncia|codigo|código|code|ean|barcode)$/i,
    category: /^(category|categoria|cat|tipo|type|grupo|group|fam[ií]lia|categorias_de_produto)$/i,
    supplier_ref: /^(supplier_ref|ref_fornecedor|fornecedor|supplier|marca|brand|short_description)$/i,
    image_urls: /^(image|imagem|images|imagens|image_url|foto|photo|thumbnail)$/i,
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
      // Check for duplicates
      const hash = await computeFileHash(f);
      const isDuplicate = await checkDuplicate(f.name, hash);
      if (isDuplicate) {
        toast.warning(`"${f.name}" já foi carregado anteriormente. A ignorar.`);
        continue;
      }

      const isPdf = f.name.endsWith(".pdf");
      const base: UploadedFile = {
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        type: isPdf ? "PDF" : "Excel",
        uploadType,
        status: isPdf ? "aguardando" : (uploadType === "knowledge" ? "aguardando" : "a_mapear"),
        progress: 0,
      };

      if (!isPdf && uploadType === "products") {
        try {
          const workbook = await readExcelFile(f);
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

    setFiles((prev) => [...prev, ...newFiles]);
  };

  const setColumnMapping = (id: string, mapping: ColumnMapping) => {
    updateFile(id, { columnMapping: mapping });
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

      if (uploadedFile.uploadType === "knowledge") {
        // Knowledge files: parse to extract text content
        updateFile(uploadedFile.id, { status: "a_processar", progress: 60 });
        
        let extractedText = "";
        try {
          const { data: parseData, error: parseError } = await supabase.functions.invoke("parse-catalog", {
            body: { filePath, fileName: uploadedFile.name, parseKnowledge: true },
          });
          if (!parseError && parseData?.extractedText) {
            extractedText = parseData.extractedText;
          }
        } catch (e) {
          console.warn("Knowledge parsing failed, storing without text:", e);
        }

        const hash = await computeFileHash(uploadedFile.file);
        await supabase.from("uploaded_files").insert({
          user_id: user.id,
          file_name: uploadedFile.name,
          file_size: uploadedFile.size,
          file_hash: hash,
          file_type: uploadedFile.uploadType,
          storage_path: filePath,
          status: "processed",
          products_count: 0,
          extracted_text: extractedText || null,
          metadata: { type: uploadedFile.type },
        } as any);

        updateFile(uploadedFile.id, { status: "concluido", progress: 100, productsCount: 0 });
        toast.success(`Ficheiro de conhecimento "${uploadedFile.name}" processado com sucesso.${extractedText ? " Texto extraído para contexto." : ""}`);
        qc.invalidateQueries({ queryKey: ["uploaded-files"] });
        return;
      }

      const { data, error } = await supabase.functions.invoke("parse-catalog", {
        body: {
          filePath,
          fileName: uploadedFile.name,
          columnMapping: uploadedFile.columnMapping || undefined,
          sheetName: uploadedFile.selectedSheet || undefined,
        },
      });

      if (error) throw new Error(error.message || "Erro ao processar ficheiro");
      if (data?.error && data?.count === undefined) throw new Error(data.error);

      const count = data?.count || 0;
      await registerUpload(uploadedFile, user.id, filePath, count);

      updateFile(uploadedFile.id, {
        status: "concluido",
        progress: 100,
        productsCount: count,
      });
      toast.success(`${count} produto(s) importado(s) de "${uploadedFile.name}"`);

      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      updateFile(uploadedFile.id, { status: "erro", progress: 0, error: msg });
      toast.error(msg);
    }
  };

  const processAll = async () => {
    const pending = files.filter((f) => f.status === "aguardando");
    for (const file of pending) {
      await processFile(file);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return {
    files,
    addFiles,
    processAll,
    processFile,
    removeFile,
    setColumnMapping,
    confirmMapping,
    selectSheet,
    allFields,
    customFields,
    addCustomField,
    removeCustomField,
  };
}
