import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Product } from "./useProducts";

const EXPORT_COLUMNS = [
  { key: "sku", header: "SKU" },
  { key: "product_type", header: "Tipo" },
  { key: "original_title", header: "Título Original" },
  { key: "optimized_title", header: "Título Otimizado" },
  { key: "original_description", header: "Descrição Original" },
  { key: "optimized_description", header: "Descrição Otimizada" },
  { key: "short_description", header: "Descrição Curta Original" },
  { key: "optimized_short_description", header: "Descrição Curta Otimizada" },
  { key: "technical_specs", header: "Características Técnicas" },
  { key: "original_price", header: "Preço Original" },
  { key: "sale_price", header: "Preço Promocional" },
  { key: "optimized_price", header: "Preço Otimizado" },
  { key: "optimized_sale_price", header: "Preço Promocional Otimizado" },
  { key: "category", header: "Categoria" },
  { key: "suggested_category", header: "Categoria Proposta (IA)" },
  { key: "supplier_ref", header: "Ref. Fornecedor" },
  { key: "tags", header: "Tags" },
  { key: "meta_title", header: "Meta Title SEO" },
  { key: "meta_description", header: "Meta Description SEO" },
  { key: "seo_slug", header: "SEO Slug" },
  { key: "faq", header: "FAQ" },
  { key: "upsell_skus", header: "Upsells (SKU | Título)" },
  { key: "crosssell_skus", header: "Cross-sells (SKU | Título)" },
  { key: "image_urls", header: "URLs Imagens" },
  { key: "image_alt_texts", header: "Alt Text Imagens" },
  { key: "attributes", header: "Atributos" },
  { key: "status", header: "Estado" },
];

function productToRow(p: Product, skuPrefix?: string) {
  const row: Record<string, unknown> = {};
  for (const col of EXPORT_COLUMNS) {
    let val = (p as any)[col.key];
    if (col.key === "sku" && skuPrefix && val && !String(val).toUpperCase().startsWith(skuPrefix.toUpperCase())) {
      val = skuPrefix + val;
    }
    if (col.key === "faq" && Array.isArray(val)) {
      row[col.header] = val.map((f: any) => `Q: ${f.question} A: ${f.answer}`).join(" | ");
    } else if ((col.key === "upsell_skus" || col.key === "crosssell_skus") && Array.isArray(val)) {
      row[col.header] = val.map((item: any) => typeof item === "string" ? item : item.sku).filter(Boolean).join(",");
    } else if (col.key === "image_alt_texts" && Array.isArray(val)) {
      row[col.header] = val.map((a: any) => a.alt_text).join(" | ");
    } else if (col.key === "attributes" && Array.isArray(val)) {
      row[col.header] = val.map((a: any) => `${a.name}: ${a.value || (a.values || []).join(", ")}`).join(" | ");
    } else if (Array.isArray(val)) {
      row[col.header] = val.join(", ");
    } else {
      row[col.header] = val ?? "";
    }
  }
  return row;
}

function writeExcel(rows: Record<string, unknown>[], fileName: string) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");
  ws["!cols"] = EXPORT_COLUMNS.map((col) => ({ wch: Math.max(col.header.length, 20) }));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

export function exportProductsToExcel(products: Product[], fileName = "produtos-otimizados", skuPrefix?: string) {
  if (products.length === 0) {
    toast.error("Nenhum produto para exportar.");
    return;
  }
  const rows = products.map((p) => productToRow(p, skuPrefix));
  writeExcel(rows, fileName);
  toast.success(`${products.length} produto(s) exportado(s) com sucesso!`);
}

/**
 * Fetch ALL products from a workspace (paginated) and export to Excel.
 * Supports optional status filter.
 */
export async function exportAllProductsToExcel(
  workspaceId: string,
  options: {
    fileName?: string;
    skuPrefix?: string;
    statusFilter?: string;
    onProgress?: (loaded: number, total: number) => void;
  } = {}
) {
  const { fileName = "produtos-todos", skuPrefix, statusFilter = "all", onProgress } = options;

  const allProducts: Product[] = [];
  const PAGE_SIZE = 1000;
  let page = 1;
  let totalCount = 0;

  toast.info("A carregar todos os produtos para exportação...");

  while (true) {
    const { data, error } = await supabase.rpc("get_products_page", {
      _workspace_id: workspaceId,
      _search: "",
      _status: statusFilter,
      _category: "all",
      _product_type: "all",
      _source_file: "all",
      _woo_filter: "all",
      _page: page,
      _page_size: PAGE_SIZE,
    });

    if (error) {
      toast.error(`Erro ao carregar produtos: ${error.message}`);
      return;
    }

    const rows = (data || []) as any[];
    if (rows.length === 0) break;

    if (page === 1 && rows.length > 0) {
      totalCount = Number(rows[0].total_count) || 0;
    }

    const products: Product[] = rows.map(({ total_count, ...rest }: any) => rest as Product);
    allProducts.push(...products);

    onProgress?.(allProducts.length, totalCount);

    if (rows.length < PAGE_SIZE) break;
    page++;
  }

  if (allProducts.length === 0) {
    toast.error("Nenhum produto encontrado para exportar.");
    return;
  }

  const excelRows = allProducts.map((p) => productToRow(p, skuPrefix));
  writeExcel(excelRows, fileName);
  toast.success(`${allProducts.length} produto(s) exportado(s) com sucesso!`);
}
