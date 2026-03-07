import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Search, Check, X, Edit, Sparkles, Loader2, Download, Send, Trash2, Settings2, Save, GitBranch, Layers, Plus, Ban, Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProducts, useUpdateProductStatus, type Product } from "@/hooks/useProducts";
import { useOptimizeProducts, OPTIMIZATION_FIELDS, OPTIMIZATION_PHASES, AI_MODELS, CancellationToken, type OptimizationField } from "@/hooks/useOptimizeProducts";
import { usePublishWooCommerce } from "@/hooks/usePublishWooCommerce";
import { useDeleteProducts } from "@/hooks/useDeleteProducts";
import { useUpdateProduct } from "@/hooks/useUpdateProduct";
import { exportProductsToExcel } from "@/hooks/useExportProducts";
import { ProductDetailModal } from "@/components/ProductDetailModal";
import { useDetectVariations, useApplyVariations, type VariationGroup } from "@/hooks/useVariableProducts";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { calculateSeoScore, getSeoScoreColor } from "@/lib/seoScore";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
const ALL_PHASES = OPTIMIZATION_PHASES.map(p => p.phase);

const ProductsPage = () => {
  const { data: products, isLoading } = useProducts();
  const { activeWorkspace, toggleVariableProducts } = useWorkspaceContext();
  const updateStatus = useUpdateProductStatus();
  const optimizeProducts = useOptimizeProducts();
  const publishWoo = usePublishWooCommerce();
  const deleteProducts = useDeleteProducts();
  const updateProduct = useUpdateProduct();
  const detectVariations = useDetectVariations();
  const applyVariations = useApplyVariations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFileFilter, setSourceFileFilter] = useState<string>("all");
  const [seoScoreFilter, setSeoScoreFilter] = useState<string>("all"); // "all", "good", "medium", "weak"
  const [hasKeywordFilter, setHasKeywordFilter] = useState<string>("all"); // "all", "yes", "no"
  const [productTypeFilter, setProductTypeFilter] = useState<string>("all"); // "all", "simple", "variable", "variation"
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<OptimizationField>>(new Set(ALL_FIELDS));
  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(new Set(ALL_PHASES));
  const [pendingOptimizeIds, setPendingOptimizeIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [confirmReoptimize, setConfirmReoptimize] = useState(false);
  const [showVariations, setShowVariations] = useState(false);
  const [detectedGroups, setDetectedGroups] = useState<VariationGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Batch progress tracking
  const [batchProgress, setBatchProgress] = useState<import("@/hooks/useOptimizeProducts").OptimizationProgress | null>(null);
  const cancellationTokenRef = useRef<CancellationToken | null>(null);

  // Extract unique categories for filter
  const uniqueCategories = Array.from(
    new Set((products ?? []).map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  // Extract unique source files for filter
  const uniqueSourceFiles = Array.from(
    new Set((products ?? []).map((p) => p.source_file).filter(Boolean) as string[])
  ).sort();

  const filtered = (products ?? []).filter((p) => {
    const matchesSearch =
      (p.sku ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.original_title ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    const matchesCategory = categoryFilter === "all" || (p.category ?? "") === categoryFilter;
    const matchesSourceFile = sourceFileFilter === "all" || (p.source_file ?? "") === sourceFileFilter;
    
    // SEO score filter
    let matchesSeoScore = true;
    if (seoScoreFilter !== "all") {
      const { score } = calculateSeoScore(p);
      if (seoScoreFilter === "good") matchesSeoScore = score >= 80;
      else if (seoScoreFilter === "medium") matchesSeoScore = score >= 50 && score < 80;
      else if (seoScoreFilter === "weak") matchesSeoScore = score < 50;
    }

    // Has keyword filter
    let matchesKeyword = true;
    if (hasKeywordFilter === "yes") matchesKeyword = Array.isArray(p.focus_keyword) && p.focus_keyword.length > 0;
    else if (hasKeywordFilter === "no") matchesKeyword = !p.focus_keyword || (Array.isArray(p.focus_keyword) && p.focus_keyword.length === 0);

    // Product type filter
    let matchesType = true;
    if (productTypeFilter !== "all") matchesType = (p.product_type ?? "simple") === productTypeFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesSourceFile && matchesSeoScore && matchesKeyword && matchesType;
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
    setConfirmReoptimize(false);
    setShowFieldSelector(true);
  };

  const handleConfirmOptimize = () => {
    const nameMap: Record<string, string> = {};
    (products ?? []).forEach(p => {
      if (pendingOptimizeIds.includes(p.id)) {
        nameMap[p.id] = p.optimized_title || p.original_title || p.sku || p.id.slice(0, 8);
      }
    });

    const token = new CancellationToken();
    cancellationTokenRef.current = token;

    // Get fields from selected phases
    const phaseFields = OPTIMIZATION_PHASES
      .filter(p => selectedPhases.has(p.phase))
      .flatMap(p => p.fields);
    const fieldsToUse = phaseFields.filter(f => selectedFields.has(f));

    optimizeProducts.mutate({
      productIds: pendingOptimizeIds,
      fieldsToOptimize: fieldsToUse,
      selectedPhases: Array.from(selectedPhases),
      modelOverride: selectedModel !== "default" ? selectedModel : undefined,
      workspaceId: activeWorkspace?.id,
      productNames: nameMap,
      cancellationToken: token,
      onProgress: (progress) => {
        setBatchProgress(progress);
        if (progress.done >= progress.total || progress.cancelled) {
          setTimeout(() => setBatchProgress(null), 3000);
        }
      },
    });
    setShowFieldSelector(false);
    setPendingOptimizeIds([]);
    setSelected(new Set());
    setSelectedModel("default");
  };

  const togglePhase = (phase: number) => {
    setSelectedPhases(prev => {
      const next = new Set(prev);
      const phaseFields = OPTIMIZATION_PHASES.find(p => p.phase === phase)?.fields || [];
      if (next.has(phase)) {
        next.delete(phase);
        // Also remove this phase's fields
        setSelectedFields(prevF => {
          const nf = new Set(prevF);
          phaseFields.forEach(f => nf.delete(f));
          return nf;
        });
      } else {
        next.add(phase);
        // Also add this phase's fields
        setSelectedFields(prevF => {
          const nf = new Set(prevF);
          phaseFields.forEach(f => nf.add(f));
          return nf;
        });
      }
      return next;
    });
  };

  const handleCancelOptimize = () => {
    cancellationTokenRef.current?.cancel();
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
        {/* Quick select dropdown */}
        <div className="flex items-center gap-2">
          <Select onValueChange={(val) => {
            const count = parseInt(val);
            const ids = filtered.slice(0, count).map(p => p.id);
            setSelected(new Set(ids));
            toast.info(`${ids.length} produtos selecionados`);
          }}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Selecionar rápido..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">Primeiros 20</SelectItem>
              <SelectItem value="50">Primeiros 50</SelectItem>
              <SelectItem value="100">Primeiros 100</SelectItem>
              <SelectItem value={String(filtered.length)}>Todos ({filtered.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Variable Products Toggle */}
          {activeWorkspace && (
            <div className="flex items-center gap-2 mr-2 px-3 py-1.5 rounded-lg border bg-muted/30">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <Label className="text-xs cursor-pointer" htmlFor="var-toggle">Variáveis</Label>
              <Switch
                id="var-toggle"
                checked={activeWorkspace.has_variable_products}
                onCheckedChange={(checked) => toggleVariableProducts(activeWorkspace.id, checked)}
              />
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => {
            const selectedProducts = (products ?? []).filter(p => statusFilter === "all" ? true : p.status === "optimized");
            exportProductsToExcel(selectedProducts);
          }}>
            <Download className="w-4 h-4 mr-1" /> Exportar Excel
          </Button>
          {activeWorkspace?.has_variable_products && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const result = await detectVariations.mutateAsync({
                  workspaceId: activeWorkspace.id,
                  productIds: selected.size > 0 ? Array.from(selected) : undefined,
                });
                if (result.groups.length > 0) {
                  setDetectedGroups(result.groups);
                  setSelectedGroups(new Set(result.groups.map((_, i) => i)));
                  setShowVariations(true);
                }
              }}
              disabled={detectVariations.isPending}
            >
              {detectVariations.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Layers className="w-4 h-4 mr-1" />}
              Detetar Variações{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          )}
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
                {batchProgress.cancelled ? (
                  <Ban className="w-4 h-4 text-muted-foreground" />
                ) : batchProgress.done < batchProgress.total ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Check className="w-4 h-4 text-primary" />
                )}
                <span className="text-sm font-medium">
                  {batchProgress.cancelled
                    ? `Cancelado — ${batchProgress.done} de ${batchProgress.total} processados`
                    : batchProgress.done < batchProgress.total
                      ? `A otimizar: ${batchProgress.currentProductName}${batchProgress.currentPhaseLabel ? ` — ${batchProgress.currentPhaseLabel}` : ""}`
                      : "Otimização concluída!"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {batchProgress.estimatedSecondsLeft != null && batchProgress.done < batchProgress.total && !batchProgress.cancelled && (
                  <span className="text-xs text-muted-foreground">
                    ~{batchProgress.estimatedSecondsLeft > 60
                      ? `${Math.round(batchProgress.estimatedSecondsLeft / 60)}min`
                      : `${batchProgress.estimatedSecondsLeft}s`} restantes
                  </span>
                )}
                <span className="text-sm font-mono text-muted-foreground">
                  {batchProgress.done}/{batchProgress.total}
                </span>
                {batchProgress.done < batchProgress.total && !batchProgress.cancelled && (
                  <Button size="sm" variant="destructive" onClick={handleCancelOptimize} className="h-7 px-2 text-xs">
                    <Ban className="w-3 h-3 mr-1" /> Cancelar
                  </Button>
                )}
              </div>
            </div>
            <Progress value={(batchProgress.done / batchProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por SKU ou título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Category filter */}
          {uniqueCategories.length > 0 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {uniqueCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
          <Button
            size="sm"
            variant={showAdvancedFilters ? "secondary" : "outline"}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            <Filter className="w-4 h-4 mr-1" />
            Filtros
            {(seoScoreFilter !== "all" || hasKeywordFilter !== "all" || sourceFileFilter !== "all" || productTypeFilter !== "all") && (
              <Badge variant="default" className="ml-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {[seoScoreFilter, hasKeywordFilter, sourceFileFilter, productTypeFilter].filter(f => f !== "all").length}
              </Badge>
            )}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && (
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* SEO Score */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Score SEO</Label>
                  <Select value={seoScoreFilter} onValueChange={setSeoScoreFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="good">🟢 Bom (≥80)</SelectItem>
                      <SelectItem value="medium">🟡 Médio (50-79)</SelectItem>
                      <SelectItem value="weak">🔴 Fraco (&lt;50)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Focus Keywords */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Focus Keywords</Label>
                  <Select value={hasKeywordFilter} onValueChange={setHasKeywordFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Com keywords</SelectItem>
                      <SelectItem value="no">Sem keywords</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Source File */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Ficheiro Origem</Label>
                  <Select value={sourceFileFilter} onValueChange={setSourceFileFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {uniqueSourceFiles.map((sf) => (
                        <SelectItem key={sf} value={sf}>{sf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Product Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo</Label>
                  <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="simple">Simples</SelectItem>
                      <SelectItem value="variable">Variável</SelectItem>
                      <SelectItem value="variation">Variação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSeoScoreFilter("all");
                    setHasKeywordFilter("all");
                    setSourceFileFilter("all");
                    setProductTypeFilter("all");
                  }}
                >
                  Limpar filtros
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
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
                    <th className="p-3 text-left font-medium text-muted-foreground">Categoria</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Desc. Curta</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Slug</th>
                    <th className="p-3 text-left font-medium text-muted-foreground">Estado</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">SEO</th>
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

                      {/* Category column */}
                      <td className="p-3 max-w-[140px]" onClick={(e) => e.stopPropagation()}>
                        {editingCell?.id === product.id && editingCell.field === "category" ? (
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
                            onDoubleClick={() => startInlineEdit(product.id, "category", product.category ?? "")}
                            title="Duplo-clique para editar"
                          >
                            {product.category ?? "—"}
                          </span>
                        )}
                      </td>

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
                        <div className="flex items-center gap-1.5">
                          {(product as any).product_type && (product as any).product_type !== "simple" && (
                            <Badge variant="secondary" className="text-[10px]">
                              {(product as any).product_type === "variable" ? "Variável" : "Variação"}
                            </Badge>
                          )}
                          <Badge variant="outline" className={cn("text-xs", statusColors[product.status])}>
                            {product.status === "processing" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                            {statusLabels[product.status]}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {(() => {
                          const { score } = calculateSeoScore(product);
                          return (
                            <span className={cn("text-xs font-bold", getSeoScoreColor(score))}>{score}</span>
                          );
                        })()}
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
          {(() => {
            const alreadyOptimized = (products ?? []).filter(
              p => pendingOptimizeIds.includes(p.id) && (p.status === "optimized" || p.status === "published")
            ).length;
            const pendingCount = pendingOptimizeIds.length - alreadyOptimized;
            return (
              <>
                <p className="text-sm text-muted-foreground">
                  Selecione os campos que pretende otimizar com IA para {pendingOptimizeIds.length} produto(s).
                </p>
                {alreadyOptimized > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
                    <span className="text-warning text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">
                        <strong>{alreadyOptimized}</strong> produto(s) já estão otimizados{pendingCount > 0 ? ` e ${pendingCount} pendente(s)` : ""}.
                        Re-otimizar irá substituir os dados existentes.
                      </p>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <Checkbox
                          checked={confirmReoptimize}
                          onCheckedChange={(v) => setConfirmReoptimize(!!v)}
                        />
                        <span className="text-xs font-medium">Confirmo que pretendo re-otimizar</span>
                      </label>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          <div className="space-y-3 mt-2">
            {OPTIMIZATION_PHASES.map((phaseInfo) => (
              <div key={phaseInfo.phase} className={cn(
                "rounded-lg border p-3 transition-colors",
                selectedPhases.has(phaseInfo.phase) ? "border-primary/40 bg-primary/5" : "border-border"
              )}>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <Checkbox
                    checked={selectedPhases.has(phaseInfo.phase)}
                    onCheckedChange={() => togglePhase(phaseInfo.phase)}
                  />
                  <div>
                    <span className="text-sm font-medium">Fase {phaseInfo.phase}: {phaseInfo.label}</span>
                    <p className="text-[10px] text-muted-foreground">{phaseInfo.description}</p>
                  </div>
                </label>
                {selectedPhases.has(phaseInfo.phase) && (
                  <div className="grid grid-cols-2 gap-1 ml-6">
                    {OPTIMIZATION_FIELDS.filter(f => f.phase === phaseInfo.phase).map((field) => (
                      <label key={field.key} className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={selectedFields.has(field.key)}
                          onCheckedChange={() => toggleField(field.key)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-xs">{field.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedPhases(new Set(ALL_PHASES)); setSelectedFields(new Set(ALL_FIELDS)); }}>
              Selecionar Todos
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedPhases(new Set()); setSelectedFields(new Set()); }}>
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
            {(() => {
              const hasAlreadyOptimized = (products ?? []).some(
                p => pendingOptimizeIds.includes(p.id) && (p.status === "optimized" || p.status === "published")
              );
              return (
                <Button
                  onClick={handleConfirmOptimize}
                  disabled={selectedFields.size === 0 || optimizeProducts.isPending || (hasAlreadyOptimized && !confirmReoptimize)}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  Otimizar {pendingOptimizeIds.length} produto(s)
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variations Dialog */}
      <Dialog open={showVariations} onOpenChange={setShowVariations}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5" />
              Variações Detetadas
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {detectedGroups.length} grupo(s) detetado(s). Pode mover produtos entre grupos, remover ou criar novos.
          </p>
          <div className="space-y-4 mt-2">
            {detectedGroups.map((group, idx) => (
              <Card key={idx} className={cn("transition-colors", selectedGroups.has(idx) && "border-primary")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedGroups.has(idx)}
                      onCheckedChange={() => {
                        setSelectedGroups(prev => {
                          const next = new Set(prev);
                          next.has(idx) ? next.delete(idx) : next.add(idx);
                          return next;
                        });
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={group.parent_title}
                          onChange={(e) => {
                            setDetectedGroups(prev => prev.map((g, i) =>
                              i === idx ? { ...g, parent_title: e.target.value } : g
                            ));
                          }}
                          className="text-sm font-medium h-8 flex-1"
                        />
                        <Input
                          value={group.attribute_name}
                          onChange={(e) => {
                            setDetectedGroups(prev => prev.map((g, i) =>
                              i === idx ? { ...g, attribute_name: e.target.value } : g
                            ));
                          }}
                          className="text-xs h-8 w-40"
                          placeholder="Atributo (ex: Tamanho)"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() => {
                            setDetectedGroups(prev => prev.filter((_, i) => i !== idx));
                            setSelectedGroups(prev => {
                              const next = new Set<number>();
                              prev.forEach(v => { if (v < idx) next.add(v); else if (v > idx) next.add(v - 1); });
                              return next;
                            });
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {group.variations.map((v, vi) => (
                          <div key={vi} className="flex items-center gap-2 p-1.5 rounded bg-muted/30">
                            <Badge variant="secondary" className="text-xs shrink-0">{v.attribute_value}</Badge>
                            <span className="text-xs truncate flex-1">
                              {(products ?? []).find(p => p.id === v.product_id)?.original_title ?? v.product_id.substring(0, 8)}
                            </span>
                            {/* Move to another group */}
                            {detectedGroups.length > 1 && (
                              <Select
                                value=""
                                onValueChange={(targetIdx) => {
                                  const ti = parseInt(targetIdx);
                                  setDetectedGroups(prev => {
                                    const updated = [...prev];
                                    // Remove from current group
                                    updated[idx] = { ...updated[idx], variations: updated[idx].variations.filter((_, i) => i !== vi) };
                                    // Add to target group
                                    updated[ti] = { ...updated[ti], variations: [...updated[ti].variations, v] };
                                    // Remove empty groups
                                    return updated.filter(g => g.variations.length > 0);
                                  });
                                }}
                              >
                                <SelectTrigger className="h-6 w-24 text-[10px]">
                                  <span className="text-muted-foreground">Mover →</span>
                                </SelectTrigger>
                                <SelectContent>
                                  {detectedGroups.map((g, gi) =>
                                    gi !== idx ? (
                                      <SelectItem key={gi} value={String(gi)} className="text-xs">
                                        {g.parent_title.substring(0, 30)}
                                      </SelectItem>
                                    ) : null
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => {
                                setDetectedGroups(prev => {
                                  const updated = prev.map((g, i) =>
                                    i === idx ? { ...g, variations: g.variations.filter((_, j) => j !== vi) } : g
                                  );
                                  return updated.filter(g => g.variations.length > 0);
                                });
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {group.variations.length} variações → 1 produto pai + {group.variations.length - 1} variação(ões)
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Create new group */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetectedGroups(prev => [...prev, {
                parent_title: "Novo Grupo",
                attribute_name: "Tamanho",
                variations: [],
              }]);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Novo Grupo
          </Button>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVariations(false)}>Cancelar</Button>
            <Button
              onClick={async () => {
                const groupsToApply = detectedGroups.filter((g, i) => selectedGroups.has(i) && g.variations.length >= 2);
                if (groupsToApply.length === 0) {
                  toast("Selecione pelo menos 1 grupo com 2+ variações.");
                  return;
                }
                await applyVariations.mutateAsync({ groups: groupsToApply });
                setShowVariations(false);
                setDetectedGroups([]);
                setSelectedGroups(new Set());
              }}
              disabled={selectedGroups.size === 0 || applyVariations.isPending}
            >
              {applyVariations.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <GitBranch className="w-4 h-4 mr-1" />}
              Aplicar {selectedGroups.size} grupo(s)
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
