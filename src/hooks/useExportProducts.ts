import * as XLSX from "xlsx";
import { toast } from "sonner";
import type { Product } from "./useProducts";

const EXPORT_COLUMNS = [
  { key: "sku", header: "SKU" },
  { key: "original_title", header: "Título Original" },
  { key: "optimized_title", header: "Título Otimizado" },
  { key: "original_description", header: "Descrição Original" },
  { key: "optimized_description", header: "Descrição Otimizada" },
  { key: "short_description", header: "Descrição Curta Original" },
  { key: "optimized_short_description", header: "Descrição Curta Otimizada" },
  { key: "technical_specs", header: "Características Técnicas" },
  { key: "original_price", header: "Preço Original" },
  { key: "optimized_price", header: "Preço Otimizado" },
  { key: "category", header: "Categoria" },
  { key: "supplier_ref", header: "Ref. Fornecedor" },
  { key: "tags", header: "Tags" },
  { key: "meta_title", header: "Meta Title SEO" },
  { key: "meta_description", header: "Meta Description SEO" },
  { key: "seo_slug", header: "SEO Slug" },
  { key: "faq", header: "FAQ" },
  { key: "image_urls", header: "URLs Imagens" },
  { key: "status", header: "Estado" },
];

export function exportProductsToExcel(products: Product[], fileName = "produtos-otimizados") {
  if (products.length === 0) {
    toast.error("Nenhum produto para exportar.");
    return;
  }

  const rows = products.map((p) => {
    const row: Record<string, unknown> = {};
    for (const col of EXPORT_COLUMNS) {
      const val = (p as any)[col.key];
      if (col.key === "faq" && Array.isArray(val)) {
        row[col.header] = val.map((f: any) => `Q: ${f.question} A: ${f.answer}`).join(" | ");
      } else if (Array.isArray(val)) {
        row[col.header] = val.join(", ");
      } else {
        row[col.header] = val ?? "";
      }
    }
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");

  // Auto-size columns
  const colWidths = EXPORT_COLUMNS.map((col) => ({
    wch: Math.max(col.header.length, 20),
  }));
  ws["!cols"] = colWidths;

  XLSX.writeFile(wb, `${fileName}.xlsx`);
  toast.success(`${products.length} produto(s) exportado(s) com sucesso!`);
}
