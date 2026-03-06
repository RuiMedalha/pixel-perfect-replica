import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, Check, X, Edit, Sparkles, Loader2, Download, Send, Trash2, Settings2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProducts, useUpdateProductStatus, type Product } from "@/hooks/useProducts";
import { useOptimizeProducts, OPTIMIZATION_FIELDS, AI_MODELS, type OptimizationField } from "@/hooks/useOptimizeProducts";
import { usePublishWooCommerce } from "@/hooks/usePublishWooCommerce";
import { useDeleteProducts } from "@/hooks/useDeleteProducts";
import { useUpdateProduct } from "@/hooks/useUpdateProduct";
import { exportProductsToExcel } from "@/hooks/useExportProducts";
import { ProductDetailModal } from "@/components/ProductDetailModal";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

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

const ALL_FIELDS: OptimizationField[] = OPTIMIZATION_FIELDS.map(f => f.key);

const ProductsPage = () => {
  const { data: products, isLoading } = useProducts();
  const { activeWorkspace } = useWorkspaceContext();
  const updateStatus = useUpdateProductStatus();
  const optimizeProducts = useOptimizeProducts();
  const publishWoo = usePublishWooCommerce();
  const deleteProducts = useDeleteProducts();
  const updateProduct = useUpdateProduct();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<OptimizationField>>(new Set(ALL_FIELDS));
  const [pendingOptimizeIds, setPendingOptimizeIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("default");

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Batch progress tracking via Realtime
  const [batchProgress, setBatchProgress] = useState<{ total: number; done: number; processing: string[] } | null>(null);

  // Subscribe to realtime product status changes for batch progress
  useEffect(() => {
    if (!batchProgress || batchProgress.done >= batchProgress.total) return;

    const channel = supabase
      .channel("batch-progress")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products" },
        (payload) => {
          const updated = payload.new as any;
          if (batchProgress.processing.includes(updated.id)) {
            if (updated.status === "optimized" || updated.status === "error") {
              setBatchProgress((prev) => {
                if (!prev) return null;
                const newDone = prev.done + 1;
                const newProcessing = prev.processing.filter((id) => id !== updated.id);
                if (newDone >= prev.total) {
                  // Auto-clear after 2s
                  setTimeout(() => setBatchProgress(null), 2000);
                }
                return { ...prev, done: newDone, processing: newProcessing };
              });
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [batchProgress]);

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

  const handleOptimizeClick = (ids: string[]) => {
    setPendingOptimizeIds(ids);
    setShowFieldSelector(true);
  };

  const handleConfirmOptimize = () => {
    // Start batch progress tracking
    setBatchProgress({ total: pendingOptimizeIds.length, done: 0, processing: [...pendingOptimizeIds] });
    optimizeProducts.mutate({
      productIds: pendingOptimizeIds,
      fieldsToOptimize: Array.from(selectedFields),
      modelOverride: selectedModel !== "default" ? selectedModel : undefined,
      workspaceId: activeWorkspace?.id,
    });
    setShowFieldSelector(false);
    setPendingOptimizeIds([]);
    setSelected(new Set());
    setSelectedModel("default");
  };

  const toggleField = (field: OptimizationField) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  // Inline edit handlers
  const startInlineEdit = (id: string, field: string, currentValue: string) => {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  };

  const saveInlineEdit = () => {
    if (!editingCell) return;
    updateProduct.mutate({
      id: editingCell.id,
      updates: { [editingCell.field]: editValue || null },
    });
    setEditingCell(null);
  };

  const cancelInlineEdit = () => {
    setEditingCell(null);
  };

  // Update detailProduct when products data changes
  useEffect(() => {
    if (detailProduct && products) {
      const updated = products.find((p) => p.id === detailProduct.id);
      if (updated) setDetailProduct(updated);
    }
  }, [products]);

  const statuses: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "pending", label: "Pendente" },
    { value: "processing", label: "A Processar" },
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
        <div className="flex gap-2 flex-wrap">
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
              <Button size="sm" variant="secondary" onClick={() => handleOptimizeClick(Array.from(selected))} disabled={optimizeProducts.isPending}>
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

      {/* Batch Progress Bar */}
      {batchProgress && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">A otimizar produtos com IA...</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {batchProgress.done}/{batchProgress.total}
              </span>
            </div>
            <Progress value={(batchProgress.done / batchProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

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
                    <th className="p-3 text-left font-medium text-muted-foreground">Desc. Curta</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Slug</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => (
                    <tr
                      key={product.id}
                      className={cn(
                        "border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer",
                        product.status === "processing" && "bg-primary/5"
                      )}
                      onClick={() => setDetailProduct(product)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(product.id)}
                          onCheckedChange={() => toggleSelect(product.id)}
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">{product.sku ?? "—"}</td>
                      <td className="p-3 max-w-[180px] truncate">{product.original_title ?? "—"}</td>

                      {/* Inline editable: optimized_title */}
                      <td className="p-3 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                        {editingCell?.id === product.id && editingCell.field === "optimized_title" ? (
                          <div className="flex gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-xs h-7"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlineEdit();
                                if (e.key === "Escape") cancelInlineEdit();
                              }}
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
                              <Save className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="truncate block text-primary font-medium cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
                            onDoubleClick={() => startInlineEdit(product.id, "optimized_title", product.optimized_title ?? "")}
                            title="Duplo-clique para editar"
                          >
                            {product.optimized_title ?? "—"}
                          </span>
                        )}
                      </td>

                      {/* Inline editable: optimized_short_description */}
                      <td className="p-3 max-w-[140px]" onClick={(e) => e.stopPropagation()}>
                        {editingCell?.id === product.id && editingCell.field === "optimized_short_description" ? (
                          <div className="flex gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-xs h-7"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlineEdit();
                                if (e.key === "Escape") cancelInlineEdit();
                              }}
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
                              <Save className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="truncate block text-xs cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
                            onDoubleClick={() => startInlineEdit(product.id, "optimized_short_description", product.optimized_short_description ?? "")}
                            title="Duplo-clique para editar"
                          >
                            {product.optimized_short_description ?? "—"}
                          </span>
                        )}
                      </td>

                      {/* Inline editable: seo_slug */}
                      <td className="p-3 max-w-[120px]" onClick={(e) => e.stopPropagation()}>
                        {editingCell?.id === product.id && editingCell.field === "seo_slug" ? (
                          <div className="flex gap-1">
                            <Input
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-xs h-7 font-mono"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveInlineEdit();
                                if (e.key === "Escape") cancelInlineEdit();
                              }}
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveInlineEdit}>
                              <Save className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="truncate block text-xs font-mono text-muted-foreground cursor-text hover:bg-primary/5 rounded px-1 -mx-1"
                            onDoubleClick={() => startInlineEdit(product.id, "seo_slug", product.seo_slug ?? "")}
                            title="Duplo-clique para editar"
                          >
                            {product.seo_slug ?? "—"}
                          </span>
                        )}
                      </td>

                      <td className="p-3">
                        <Badge variant="outline" className={cn("text-xs", statusColors[product.status])}>
                          {product.status === "processing" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                          {statusLabels[product.status]}
                        </Badge>
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDetailProduct(product)}>
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleOptimizeClick([product.id])} disabled={optimizeProducts.isPending}>
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

      {/* Field Selector Dialog */}
      <Dialog open={showFieldSelector} onOpenChange={setShowFieldSelector}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Campos a Otimizar
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Selecione os campos que pretende otimizar com IA para {pendingOptimizeIds.length} produto(s).
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {OPTIMIZATION_FIELDS.map((field) => (
              <label key={field.key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                <Checkbox
                  checked={selectedFields.has(field.key)}
                  onCheckedChange={() => toggleField(field.key)}
                />
                <span className="text-sm">{field.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedFields(new Set(ALL_FIELDS))}>
              Selecionar Todos
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedFields(new Set())}>
              Limpar
            </Button>
          </div>
          {/* Model Override */}
          <div className="space-y-1.5 mt-3 pt-3 border-t">
            <Label className="text-xs font-medium">Modelo de IA</Label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Usar modelo padrão (Settings)</SelectItem>
                {AI_MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">Escolha um modelo diferente para esta otimização ou use o configurado nas Settings.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFieldSelector(false)}>Cancelar</Button>
            <Button onClick={handleConfirmOptimize} disabled={selectedFields.size === 0 || optimizeProducts.isPending}>
              <Sparkles className="w-4 h-4 mr-1" />
              Otimizar {pendingOptimizeIds.length} produto(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
      />
    </div>
  );
};

export default ProductsPage;
