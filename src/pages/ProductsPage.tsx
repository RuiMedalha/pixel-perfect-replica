import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Search, Check, X, ExternalLink, Edit, Sparkles, Loader2, Download, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProducts, useUpdateProductStatus, type Product } from "@/hooks/useProducts";
import { useOptimizeProducts } from "@/hooks/useOptimizeProducts";
import { usePublishWooCommerce } from "@/hooks/usePublishWooCommerce";
import { useDeleteProducts } from "@/hooks/useDeleteProducts";
import { exportProductsToExcel } from "@/hooks/useExportProducts";
import type { Enums } from "@/integrations/supabase/types";

const statusLabels: Record<Enums<"product_status">, string> = {
  pending: "Pendente",
  processing: "A Processar",
  optimized: "Otimizado",
  published: "Publicado",
  error: "Erro",
};

const statusColors: Record<Enums<"product_status">, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  processing: "bg-primary/10 text-primary border-primary/20",
  optimized: "bg-success/10 text-success border-success/20",
  published: "bg-primary/10 text-primary border-primary/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

type FilterStatus = Enums<"product_status"> | "all";

const ProductsPage = () => {
  const { data: products, isLoading } = useProducts();
  const updateStatus = useUpdateProductStatus();
  const optimizeProducts = useOptimizeProducts();
  const publishWoo = usePublishWooCommerce();
  const deleteProducts = useDeleteProducts();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  const filtered = (products ?? []).filter((p) => {
    const matchesSearch =
      (p.sku ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.original_title ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkAction = (status: Enums<"product_status">) => {
    updateStatus.mutate({ ids: Array.from(selected), status });
    setSelected(new Set());
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleBulkDelete = () => {
    if (confirm(`Tem a certeza que deseja eliminar ${selected.size} produto(s)? Esta ação é irreversível.`)) {
      deleteProducts.mutate(Array.from(selected));
      setSelected(new Set());
    }
  };

  const statuses: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "pending", label: "Pendente" },
    { value: "optimized", label: "Otimizado" },
    { value: "published", label: "Publicado" },
    { value: "error", label: "Erro" },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Painel de Produtos</h1>
          <p className="text-muted-foreground mt-1">{products?.length ?? 0} produtos no total</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => {
            const selectedProducts = (products ?? []).filter(p => statusFilter === "all" ? true : p.status === "optimized");
            exportProductsToExcel(selectedProducts);
          }}>
            <Download className="w-4 h-4 mr-1" /> Exportar Excel
          </Button>
          {selected.size > 0 && (
            <>
              <Button size="sm" onClick={() => bulkAction("optimized")}>
                <Check className="w-4 h-4 mr-1" /> Aprovar ({selected.size})
              </Button>
              <Button size="sm" variant="destructive" onClick={() => bulkAction("error")}>
                <X className="w-4 h-4 mr-1" /> Rejeitar ({selected.size})
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={deleteProducts.isPending}>
                <Trash2 className="w-4 h-4 mr-1" /> Eliminar ({selected.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => { publishWoo.mutate(Array.from(selected)); setSelected(new Set()); }} disabled={publishWoo.isPending}>
                <Send className="w-4 h-4 mr-1" /> Publicar WooCommerce ({selected.size})
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { optimizeProducts.mutate(Array.from(selected)); setSelected(new Set()); }} disabled={optimizeProducts.isPending}>
                <Sparkles className="w-4 h-4 mr-1" /> Otimizar IA ({selected.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                const selectedProducts = (products ?? []).filter(p => selected.has(p.id));
                exportProductsToExcel(selectedProducts, "produtos-selecionados");
                setSelected(new Set());
              }}>
                <Download className="w-4 h-4 mr-1" /> Exportar Seleção ({selected.size})
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar por SKU ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={statusFilter === s.value ? "default" : "outline"}
              onClick={() => setStatusFilter(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>Sem produtos encontrados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">SKU</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Título Original</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Título Otimizado</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => (
                    <tr
                      key={product.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setDetailProduct(product)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(product.id)}
                          onCheckedChange={() => toggleSelect(product.id)}
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">{product.sku ?? "—"}</td>
                      <td className="p-3 max-w-[200px] truncate">{product.original_title ?? "—"}</td>
                      <td className="p-3 max-w-[200px] truncate text-primary font-medium">
                        {product.optimized_title ?? "—"}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={cn("text-xs", statusColors[product.status])}>
                          {statusLabels[product.status]}
                        </Badge>
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDetailProduct(product)}>
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => optimizeProducts.mutate([product.id])} disabled={optimizeProducts.isPending}>
                            <Sparkles className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus.mutate({ ids: [product.id], status: "optimized" })}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!detailProduct} onOpenChange={() => setDetailProduct(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{detailProduct.sku ?? "—"}</span>
                  {detailProduct.original_title ?? "Sem título"}
                </DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="textos" className="mt-4">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="textos">Textos</TabsTrigger>
                  <TabsTrigger value="imagens">Imagens</TabsTrigger>
                  <TabsTrigger value="seo">SEO</TabsTrigger>
                  <TabsTrigger value="brutos">Dados Brutos</TabsTrigger>
                </TabsList>

                <TabsContent value="textos" className="space-y-6 mt-4">
                  <ComparisonField label="Título" original={detailProduct.original_title ?? "—"} optimized={detailProduct.optimized_title ?? "—"} />
                  <ComparisonField label="Descrição" original={detailProduct.original_description ?? "—"} optimized={detailProduct.optimized_description ?? "—"} multiline />
                </TabsContent>

                <TabsContent value="seo" className="space-y-6 mt-4">
                  <ComparisonField label="Meta Title" original="—" optimized={detailProduct.meta_title ?? "—"} />
                  <ComparisonField label="Meta Description" original="—" optimized={detailProduct.meta_description ?? "—"} multiline />
                  <ComparisonField label="SEO Slug" original="—" optimized={detailProduct.seo_slug ?? "—"} />
                </TabsContent>

                <TabsContent value="imagens" className="mt-4">
                  <div className="text-center py-12 text-muted-foreground">
                    <p>Nenhuma imagem carregada para este produto.</p>
                    <Button variant="outline" className="mt-4">Carregar Imagem</Button>
                  </div>
                </TabsContent>

                <TabsContent value="brutos" className="mt-4">
                  <Card>
                    <CardContent className="p-4">
                      <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                        {JSON.stringify(detailProduct, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                <Button variant="destructive" size="sm" onClick={() => { updateStatus.mutate({ ids: [detailProduct.id], status: "error" }); setDetailProduct(null); }}>
                  Rejeitar
                </Button>
                <Button size="sm" onClick={() => { updateStatus.mutate({ ids: [detailProduct.id], status: "optimized" }); setDetailProduct(null); }}>
                  <Check className="w-4 h-4 mr-1" /> Aprovar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { updateStatus.mutate({ ids: [detailProduct.id], status: "published" }); setDetailProduct(null); }}>
                  <ExternalLink className="w-4 h-4 mr-1" /> Publicar
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function ComparisonField({
  label,
  original,
  optimized,
  multiline = false,
}: {
  label: string;
  original: string;
  optimized: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{label}</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Original</p>
          <div className="p-3 rounded-lg bg-muted/50 text-sm">{original}</div>
        </div>
        <div>
          <p className="text-xs text-primary mb-1">Otimizado</p>
          {multiline ? (
            <Textarea defaultValue={optimized} className="text-sm min-h-[80px]" />
          ) : (
            <Input defaultValue={optimized} className="text-sm" />
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductsPage;
