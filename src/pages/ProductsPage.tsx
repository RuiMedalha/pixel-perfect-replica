import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { Search, Check, X, Edit, Sparkles, Loader2, Download, Send, Trash2, Settings2, Save, GitBranch, Layers, Plus, Ban, Filter, ChevronDown, ChevronRight, Rocket, XCircle, List, Network, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProducts, useUpdateProductStatus, type Product } from "@/hooks/useProducts";
import { useOptimizeProducts, OPTIMIZATION_FIELDS, OPTIMIZATION_PHASES, AI_MODELS, CancellationToken, type OptimizationField } from "@/hooks/useOptimizeProducts";
import { useOptimizationJob } from "@/hooks/useOptimizationJob";
import { usePublishWooCommerce, type PublishResult } from "@/hooks/usePublishWooCommerce";
import { usePublishJob } from "@/hooks/usePublishJob";
import { useDeleteProducts } from "@/hooks/useDeleteProducts";
import { useUpdateProduct } from "@/hooks/useUpdateProduct";
import { exportProductsToExcel } from "@/hooks/useExportProducts";
import { ProductDetailModal } from "@/components/ProductDetailModal";
import { WooPublishModal } from "@/components/WooPublishModal";
import { useDetectVariations, useApplyVariations, type VariationGroup } from "@/hooks/useVariableProducts";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { calculateSeoScore, getSeoScoreColor } from "@/lib/seoScore";
import { useRepairAttributes } from "@/hooks/useRepairAttributes";
import { useEnrichProducts } from "@/hooks/useEnrichProducts";
import { useSettings } from "@/hooks/useSettings";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
const statusLabels: Record<Enums<"product_status">, string> = {
  pending: "Pendente",
  processing: "A Processar",
  optimized: "Otimizado",
  needs_review: "Revisão Necessária",
  published: "Publicado",
  error: "Erro",
};

const statusColors: Record<Enums<"product_status">, string> = {
  pending: "bg-warning/10 text-warning border-warning/20",
  processing: "bg-primary/10 text-primary border-primary/20",
  optimized: "bg-success/10 text-success border-success/20",
  needs_review: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  published: "bg-primary/10 text-primary border-primary/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

type FilterStatus = Enums<"product_status"> | "all";

const ALL_FIELDS: OptimizationField[] = OPTIMIZATION_FIELDS.map(f => f.key);
const ALL_PHASES = OPTIMIZATION_PHASES.map(p => p.phase);

const ProductsPage = () => {
  const { data: products, isLoading } = useProducts();
  const { activeWorkspace, toggleVariableProducts } = useWorkspaceContext();
  useRepairAttributes();
  const { enrich, isEnriching } = useEnrichProducts();
  const { data: settings } = useSettings();
  const updateStatus = useUpdateProductStatus();
  const optimizeProducts = useOptimizeProducts();
  const { activeJob, isCreating: isCreatingJob, createJob, cancelJob, dismissJob } = useOptimizationJob();
  const publishWoo = usePublishWooCommerce();
  const { activePublishJob, isCreating: isCreatingPublish, createPublishJob, cancelPublishJob, dismissPublishJob } = usePublishJob();
  const deleteProducts = useDeleteProducts();
  const updateProduct = useUpdateProduct();
  const detectVariations = useDetectVariations();
  const applyVariations = useApplyVariations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sourceFileFilter, setSourceFileFilter] = useState<string>("all");
  const [seoScoreFilter, setSeoScoreFilter] = useState<string>("all");
  const [hasKeywordFilter, setHasKeywordFilter] = useState<string>("all");
  const [productTypeFilter, setProductTypeFilter] = useState<string>("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [wooFilter, setWooFilter] = useState<string>("all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<OptimizationField>>(new Set(ALL_FIELDS));
  const [selectedPhases, setSelectedPhases] = useState<Set<number>>(new Set(ALL_PHASES));
  const [pendingOptimizeIds, setPendingOptimizeIds] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("default");
  const [confirmReoptimize, setConfirmReoptimize] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [skipKnowledge, setSkipKnowledge] = useState(false);
  const [skipScraping, setSkipScraping] = useState(false);
  const [skipReranking, setSkipReranking] = useState(false);
  const [showVariations, setShowVariations] = useState(false);
  const [detectedGroups, setDetectedGroups] = useState<VariationGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grouped">("list");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100;
  

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Batch progress tracking
  const [batchProgress, setBatchProgress] = useState<import("@/hooks/useOptimizeProducts").OptimizationProgress | null>(null);
  const cancellationTokenRef = useRef<CancellationToken | null>(null);

  // Auto-enable background mode for large selections
  useEffect(() => {
    if (pendingOptimizeIds.length >= 50) {
      setBackgroundMode(true);
    }
  }, [pendingOptimizeIds.length]);

  // Extract unique categories for filter
  const uniqueCategories = Array.from(
    new Set((products ?? []).map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  // Extract unique source files for filter
  const uniqueSourceFiles = Array.from(
    new Set((products ?? []).map((p) => p.source_file).filter(Boolean) as string[])
  ).sort();

  const getProductPhases = useCallback((p: Product) => {
    const p1 = !!(p.optimized_title || p.optimized_description || p.optimized_short_description);
    const p2 = !!(p.meta_title || p.meta_description || p.seo_slug || (p.faq && (Array.isArray(p.faq) ? (p.faq as any[]).length > 0 : true)));
    const p3 = !!(p.optimized_price || p.upsell_skus || p.crosssell_skus);
    return { p1, p2, p3 };
  }, []);

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

    // Phase filter
    let matchesPhase = true;
    if (phaseFilter !== "all") {
      const phases = getProductPhases(p);
      if (phaseFilter === "missing1") matchesPhase = !phases.p1;
      else if (phaseFilter === "missing2") matchesPhase = !phases.p2;
      else if (phaseFilter === "missing3") matchesPhase = !phases.p3;
      else if (phaseFilter === "complete") matchesPhase = phases.p1 && phases.p2 && phases.p3;
      else if (phaseFilter === "none") matchesPhase = !phases.p1 && !phases.p2 && !phases.p3;
    }

    // WooCommerce filter
    let matchesWoo = true;
    if (wooFilter === "published") matchesWoo = !!p.woocommerce_id;
    else if (wooFilter === "not_published") matchesWoo = !p.woocommerce_id;

    return matchesSearch && matchesStatus && matchesCategory && matchesSourceFile && matchesSeoScore && matchesKeyword && matchesType && matchesPhase && matchesWoo;
  });

  // Build grouped view structure
  const groupedView = useMemo(() => {
    if (viewMode !== "grouped") return null;

    type GroupedItem = 
      | { type: "parent"; product: Product; children: Product[] }
      | { type: "standalone"; product: Product };

    const items: GroupedItem[] = [];
    const variationIds = new Set<string>();

    // Find all variable products and their children
    const variableProducts = filtered.filter(p => p.product_type === "variable");
    const allProducts = products ?? [];

    for (const parent of variableProducts) {
      // Find children in filtered AND in all products (show all children of matching parents)
      const children = allProducts.filter(p => p.parent_product_id === parent.id);
      children.forEach(c => variationIds.add(c.id));
      items.push({ type: "parent", product: parent, children });
    }

    // Add standalone products (simple or orphan variations not already shown)
    for (const p of filtered) {
      if (p.product_type !== "variable" && !variationIds.has(p.id)) {
        items.push({ type: "standalone", product: p });
      }
    }

    return items;
  }, [filtered, products, viewMode]);

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
    // Auto-include children of variable products for group optimization
    const allProducts = products ?? [];
    const expandedIds = new Set(ids);
    ids.forEach(id => {
      const p = allProducts.find(pr => pr.id === id);
      if (p?.product_type === "variable") {
        // Add all children of this variable product
        allProducts.filter(c => c.parent_product_id === id).forEach(c => expandedIds.add(c.id));
      }
    });
    const finalIds = Array.from(expandedIds);
    if (finalIds.length > ids.length) {
      toast.info(`${finalIds.length - ids.length} variação(ões) incluídas automaticamente para otimização em grupo.`);
    }
    setPendingOptimizeIds(finalIds);
    setConfirmReoptimize(false);
    setShowFieldSelector(true);
  };

  const handleConfirmOptimize = () => {
    const phaseFields = OPTIMIZATION_PHASES
      .filter(p => selectedPhases.has(p.phase))
      .flatMap(p => p.fields);
    const fieldsToUse = phaseFields.filter(f => selectedFields.has(f));

    const speedFlags = {
      skipKnowledge,
      skipScraping,
      skipReranking,
    };

    if (backgroundMode) {
      createJob({
        productIds: pendingOptimizeIds,
        selectedPhases: Array.from(selectedPhases),
        fieldsToOptimize: fieldsToUse,
        modelOverride: selectedModel !== "default" ? selectedModel : undefined,
        workspaceId: activeWorkspace?.id,
        ...speedFlags,
      });
      setShowFieldSelector(false);
      setPendingOptimizeIds([]);
      setSelected(new Set());
      setSelectedModel("default");
      setBackgroundMode(false);
      return;
    }

    const nameMap: Record<string, string> = {};
    (products ?? []).forEach(p => {
      if (pendingOptimizeIds.includes(p.id)) {
        nameMap[p.id] = p.optimized_title || p.original_title || p.sku || p.id.slice(0, 8);
      }
    });

    const token = new CancellationToken();
    cancellationTokenRef.current = token;

    optimizeProducts.mutate({
      productIds: pendingOptimizeIds,
      fieldsToOptimize: fieldsToUse,
      selectedPhases: Array.from(selectedPhases),
      modelOverride: selectedModel !== "default" ? selectedModel : undefined,
      workspaceId: activeWorkspace?.id,
      productNames: nameMap,
      cancellationToken: token,
      ...speedFlags,
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
    setBackgroundMode(false);
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
    { value: "needs_review", label: "Revisão Necessária" },
    { value: "published", label: "Publicado" },
    { value: "error", label: "Erro" },
  ];

  const PhaseIndicator = ({ product }: { product: Product }) => {
    const p1 = !!(product.optimized_title || product.optimized_description || product.optimized_short_description);
    const p2 = !!(product.meta_title || product.meta_description || product.seo_slug || product.faq);
    const p3 = !!(product.optimized_price || (product.upsell_skus && (product.upsell_skus as any[]).length > 0) || (product.crosssell_skus && (product.crosssell_skus as any[]).length > 0));
    return (
      <div className="flex items-center justify-center gap-0.5">
        {[
          { done: p1, label: "1" },
          { done: p2, label: "2" },
          { done: p3, label: "3" },
        ].map(ph => (
          <span
            key={ph.label}
            className={cn(
              "inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold",
              ph.done ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground/50"
            )}
            title={`Fase ${ph.label}: ${ph.done ? "Concluída" : "Pendente"}`}
          >
            {ph.label}
          </span>
        ))}
      </div>
    );
  };

  const ProductRow = ({ product }: { product: Product }) => (
    <tr
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
          {product.product_type && product.product_type !== "simple" && (
            <Badge variant="secondary" className="text-[10px]">
              {product.product_type === "variable" ? "Variável" : "Variação"}
            </Badge>
          )}
          <Badge variant="outline" className={cn("text-xs", statusColors[product.status])}>
            {product.status === "processing" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {statusLabels[product.status]}
          </Badge>
          {product.woocommerce_id && (
            <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20 gap-0.5" title={`Publicado no WooCommerce (ID: ${product.woocommerce_id})`}>
              <Send className="w-2.5 h-2.5" />
              WC
            </Badge>
          )}
        </div>
      </td>
      <td className="p-3 text-center">
        <PhaseIndicator product={product} />
      </td>
      <td className="p-3 text-center">
        {(() => {
          const { score } = calculateSeoScore(product);
          return <span className={cn("text-xs font-bold", getSeoScoreColor(score))}>{score}</span>;
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
  );

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 animate-fade-in">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-foreground">Painel de Produtos</h1>
            <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">{products?.length ?? 0} produtos no total</p>
          </div>
          <Select onValueChange={(val) => {
            const count = parseInt(val);
            const ids = filtered.slice(0, count).map(p => p.id);
            setSelected(new Set(ids));
            toast.info(`${ids.length} produtos selecionados`);
          }}>
            <SelectTrigger className="w-[140px] sm:w-[180px] h-8 sm:h-9 text-xs sm:text-sm shrink-0">
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
        <div className="flex gap-1.5 sm:gap-2 flex-wrap items-center">
          {/* Variable Products Toggle */}
          {activeWorkspace && (
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border bg-muted/30">
              <GitBranch className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
              <Label className="text-[10px] sm:text-xs cursor-pointer" htmlFor="var-toggle">Variáveis</Label>
              <Switch
                id="var-toggle"
                checked={activeWorkspace.has_variable_products}
                onCheckedChange={(checked) => toggleVariableProducts(activeWorkspace.id, checked)}
              />
            </div>
          )}
          <div className="flex items-center gap-1 border rounded-lg p-0.5 bg-muted/30">
            <Button
              size="sm"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setViewMode("list")}
            >
              <List className="w-3.5 h-3.5 mr-1" /> Lista
            </Button>
            <Button
              size="sm"
              variant={viewMode === "grouped" ? "secondary" : "ghost"}
              className="text-xs h-7 px-2"
              onClick={() => setViewMode("grouped")}
            >
              <Network className="w-3.5 h-3.5 mr-1" /> Agrupado
            </Button>
          </div>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
            const selectedProducts = (products ?? []).filter(p => statusFilter === "all" ? true : p.status === "optimized");
            exportProductsToExcel(selectedProducts);
          }}>
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" /> <span className="hidden sm:inline">Exportar </span>Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8"
            onClick={() => {
              if (!activeWorkspace) return;
              // Parse supplier prefixes from settings
              try {
                const raw = settings?.supplier_prefixes;
                const prefixes = raw ? JSON.parse(raw) : [];
                if (!prefixes.length) {
                  toast.error("Configure os prefixos de fornecedor nas Definições primeiro.");
                  return;
                }
                enrich({
                  workspaceId: activeWorkspace.id,
                  supplierPrefixes: prefixes,
                  productIds: selected.size > 0 ? Array.from(selected) : undefined,
                });
              } catch {
                toast.error("Erro ao ler prefixos de fornecedor. Verifique as Definições.");
              }
            }}
            disabled={isEnriching}
          >
            {isEnriching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Globe className="w-3.5 h-3.5 mr-1" />}
            <span className="hidden sm:inline">Enriquecer </span>Web{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          {activeWorkspace?.has_variable_products && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={async () => {
                const selectedProducts = selected.size > 0
                  ? (products ?? []).filter(p => selected.has(p.id) && p.product_type === 'simple')
                  : (products ?? []).filter(p => p.product_type === 'simple').slice(0, 500);
                const result = await detectVariations.mutateAsync({
                  workspaceId: activeWorkspace.id,
                  products: selectedProducts.map(p => ({ id: p.id, sku: p.sku, original_title: p.original_title, optimized_title: p.optimized_title, category: p.category, original_price: p.original_price, original_description: p.original_description, short_description: p.short_description, product_type: p.product_type, attributes: p.attributes, crosssell_skus: p.crosssell_skus, upsell_skus: p.upsell_skus })),
                });
                if (result.groups.length > 0) {
                  setDetectedGroups(result.groups);
                  setSelectedGroups(new Set(result.groups.map((_, i) => i)));
                  setShowVariations(true);
                }
              }}
              disabled={detectVariations.isPending}
            >
              {detectVariations.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Layers className="w-3.5 h-3.5 mr-1" />}
              <span className="hidden sm:inline">Detetar </span>Variações{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          )}
          {selected.size > 0 && (
            <>
              <Button size="sm" className="text-xs h-8" onClick={() => bulkAction("optimized")}>
                <Check className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Aprovar </span>({selected.size})
              </Button>
              <Button size="sm" variant="destructive" className="text-xs h-8" onClick={() => bulkAction("error")}>
                <X className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Rejeitar </span>({selected.size})
              </Button>
              <Button size="sm" variant="destructive" className="text-xs h-8" onClick={handleBulkDelete} disabled={deleteProducts.isPending}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Eliminar </span>({selected.size})
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowPublishModal(true)} disabled={isCreatingPublish}>
                <Send className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Publicar </span>WC ({selected.size})
              </Button>
              <Button size="sm" variant="secondary" className="text-xs h-8" onClick={() => handleOptimizeClick(Array.from(selected))} disabled={optimizeProducts.isPending}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Otimizar </span>IA ({selected.size})
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
                const selectedProducts = (products ?? []).filter(p => selected.has(p.id));
                exportProductsToExcel(selectedProducts, "produtos-selecionados");
                setSelected(new Set());
              }}>
                <Download className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Exportar Seleção </span>({selected.size})
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

      {/* Background Job Progress Bar */}
      {activeJob && activeJob.status !== "completed" && activeJob.status !== "cancelled" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">
                  Background: {activeJob.current_product_name || "A processar..."}
                </span>
                <Badge variant="secondary" className="text-[10px]">5x paralelo</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  {activeJob.processed_products}/{activeJob.total_products}
                </span>
                {activeJob.failed_products > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {activeJob.failed_products} erros
                  </Badge>
                )}
                <Button size="sm" variant="destructive" onClick={cancelJob} className="h-7 px-2 text-xs">
                  <Ban className="w-3 h-3 mr-1" /> Cancelar
                </Button>
              </div>
            </div>
            <Progress value={activeJob.total_products > 0 ? (activeJob.processed_products / activeJob.total_products) * 100 : 0} className="h-2" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Pode fechar o browser — o processamento continua em segundo plano.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Background Job Completed */}
      {activeJob && (activeJob.status === "completed" || activeJob.status === "cancelled") && (
        <Card className={cn(
          "border-l-4",
          activeJob.status === "completed" ? "border-l-primary" : "border-l-warning"
        )}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {activeJob.status === "completed" ? (
                <Check className="w-4 h-4 text-primary" />
              ) : (
                <Ban className="w-4 h-4 text-warning" />
              )}
              <span className="text-sm">
                {activeJob.status === "completed"
                  ? `Job concluído: ${activeJob.processed_products - activeJob.failed_products} otimizados, ${activeJob.failed_products} erros`
                  : `Job cancelado: ${activeJob.processed_products} de ${activeJob.total_products} processados`
                }
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={dismissJob} className="h-7 px-2 text-xs">
              <XCircle className="w-3 h-3 mr-1" /> Fechar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* WooCommerce Publish Job Progress */}
      {activePublishJob && activePublishJob.status !== "completed" && activePublishJob.status !== "cancelled" && activePublishJob.status !== "failed" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activePublishJob.status === "scheduled" ? (
                  <Send className="w-4 h-4 text-primary" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium">
                  {activePublishJob.status === "scheduled"
                    ? `Agendado para ${activePublishJob.scheduled_for ? new Date(activePublishJob.scheduled_for).toLocaleString("pt-PT") : "..."}`
                    : `A publicar no WC: ${activePublishJob.current_product_name || "A iniciar..."}`
                  }
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-muted-foreground">
                  {activePublishJob.processed_products}/{activePublishJob.total_products}
                </span>
                {activePublishJob.failed_products > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {activePublishJob.failed_products} erros
                  </Badge>
                )}
                <Button size="sm" variant="destructive" onClick={cancelPublishJob} className="h-7 px-2 text-xs">
                  <Ban className="w-3 h-3 mr-1" /> Cancelar
                </Button>
              </div>
            </div>
            <Progress value={activePublishJob.total_products > 0 ? (activePublishJob.processed_products / activePublishJob.total_products) * 100 : 0} className="h-2" />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Pode fechar o browser — a publicação continua em segundo plano.
            </p>
          </CardContent>
        </Card>
      )}

      {/* WooCommerce Publish Job Completed */}
      {activePublishJob && (activePublishJob.status === "completed" || activePublishJob.status === "cancelled" || activePublishJob.status === "failed") && (
        <Card className={cn(
          "border-l-4",
          activePublishJob.status === "completed" ? "border-l-success" : "border-l-warning"
        )}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activePublishJob.status === "completed" ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Ban className="w-4 h-4 text-warning" />
                )}
                <span className="text-sm">
                  {activePublishJob.status === "completed"
                    ? `Publicação concluída: ${activePublishJob.processed_products - activePublishJob.failed_products} publicados, ${activePublishJob.failed_products} erros`
                    : `Publicação cancelada: ${activePublishJob.processed_products} de ${activePublishJob.total_products} processados`
                  }
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={dismissPublishJob} className="h-7 px-2 text-xs">
                <XCircle className="w-3 h-3 mr-1" /> Fechar
              </Button>
            </div>
            {activePublishJob.status === "completed" && activePublishJob.results && (activePublishJob.results as any[]).length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(activePublishJob.results as any[]).map((r: any, i: number) => {
                  const product = (products ?? []).find(p => p.id === r.id);
                  const label = product?.optimized_title || product?.original_title || product?.sku || r.id?.slice(0, 8);
                  return (
                    <div key={i} className={cn(
                      "flex items-center gap-2 text-xs px-2 py-1 rounded",
                      r.status === "created" ? "bg-success/10 text-success" :
                      r.status === "updated" ? "bg-primary/10 text-primary" :
                      r.status === "error" ? "bg-destructive/5 text-destructive" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {r.status === "created" ? <Check className="w-3 h-3 shrink-0" /> :
                       r.status === "updated" ? <Check className="w-3 h-3 shrink-0" /> :
                       r.status === "error" ? <X className="w-3 h-3 shrink-0" /> :
                       <Ban className="w-3 h-3 shrink-0" />}
                      <span className="truncate flex-1">{label}</span>
                      {r.status === "created" && <Badge className="text-[9px] bg-success/20 text-success border-success/30">Criado</Badge>}
                      {r.status === "updated" && <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">Atualizado</Badge>}
                      {r.woocommerce_id && (
                        <Badge variant="secondary" className="text-[9px]">WC #{r.woocommerce_id}</Badge>
                      )}
                      {r.error && (
                        <span className="text-[10px] text-destructive truncate max-w-[200px]" title={r.error}>{r.error}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
          <div className="relative flex-1 min-w-[150px] sm:min-w-[200px] max-w-sm">
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
          <div className="flex gap-1 sm:gap-1.5 flex-wrap">
            {statuses.map((s) => (
              <Button
                key={s.value}
                size="sm"
                className="text-xs h-7 sm:h-8 px-2 sm:px-3"
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
            {(seoScoreFilter !== "all" || hasKeywordFilter !== "all" || sourceFileFilter !== "all" || productTypeFilter !== "all" || phaseFilter !== "all") && (
              <Badge variant="default" className="ml-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {[seoScoreFilter, hasKeywordFilter, sourceFileFilter, productTypeFilter, phaseFilter].filter(f => f !== "all").length}
              </Badge>
            )}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showAdvancedFilters && (
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
                {/* Phase Filter */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Fases</Label>
                  <Select value={phaseFilter} onValueChange={setPhaseFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="missing1">❌ Falta Fase 1</SelectItem>
                      <SelectItem value="missing2">❌ Falta Fase 2</SelectItem>
                      <SelectItem value="missing3">❌ Falta Fase 3</SelectItem>
                      <SelectItem value="complete">✅ Todas completas</SelectItem>
                      <SelectItem value="none">⚪ Nenhuma fase</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* WooCommerce */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">WooCommerce</Label>
                  <Select value={wooFilter} onValueChange={setWooFilter}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="published">🟢 Publicados no WC</SelectItem>
                      <SelectItem value="not_published">⚪ Não publicados</SelectItem>
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
                    setPhaseFilter("all");
                    setWooFilter("all");
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
                    <th className="p-3 text-center font-medium text-muted-foreground">Fases</th>
                    <th className="p-3 text-center font-medium text-muted-foreground">SEO</th>
                    <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {viewMode === "list" ? (
                    filtered.map((product) => (
                      <ProductRow key={product.id} product={product} />
                    ))
                  ) : (
                    (groupedView ?? []).map((item) => {
                      if (item.type === "standalone") {
                        return <ProductRow key={item.product.id} product={item.product} />;
                      }
                      // Parent with children
                      const isExpanded = expandedGroups.has(item.product.id);
                      return (
                        <React.Fragment key={item.product.id}>
                          <tr
                            className={cn(
                              "border-b hover:bg-muted/30 transition-colors cursor-pointer bg-accent/30",
                              item.product.status === "processing" && "bg-primary/5"
                            )}
                            onClick={() => setDetailProduct(item.product)}
                          >
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <Checkbox
                                  checked={selected.has(item.product.id)}
                                  onCheckedChange={() => toggleSelect(item.product.id)}
                                />
                                <button
                                  onClick={() => toggleGroupExpand(item.product.id)}
                                  className="p-0.5 rounded hover:bg-muted"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-xs">
                              <div className="flex items-center gap-1.5">
                                <GitBranch className="w-3 h-3 text-primary shrink-0" />
                                {item.product.sku ?? "—"}
                              </div>
                            </td>
                            <td className="p-3 max-w-[180px] truncate font-medium">{item.product.original_title ?? "—"}</td>
                            <td className="p-3 max-w-[180px] truncate text-primary font-medium">{item.product.optimized_title ?? "—"}</td>
                            <td className="p-3 max-w-[140px] truncate text-xs">{item.product.category ?? "—"}</td>
                            <td className="p-3 max-w-[140px] truncate text-xs">{item.product.optimized_short_description ?? "—"}</td>
                            <td className="p-3 max-w-[120px] truncate text-xs font-mono text-muted-foreground">{item.product.seo_slug ?? "—"}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px]">Variável</Badge>
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                  {item.children.length} var.
                                </Badge>
                                <Badge variant="outline" className={cn("text-xs", statusColors[item.product.status])}>
                                  {statusLabels[item.product.status]}
                                </Badge>
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <PhaseIndicator product={item.product} />
                            </td>
                            <td className="p-3 text-center">
                              {(() => {
                                const { score } = calculateSeoScore(item.product);
                                return <span className={cn("text-xs font-bold", getSeoScoreColor(score))}>{score}</span>;
                              })()}
                            </td>
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => setDetailProduct(item.product)}>
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => handleOptimizeClick([item.product.id])} disabled={optimizeProducts.isPending}>
                                  <Sparkles className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && item.children.map((child) => (
                            <tr
                              key={child.id}
                              className={cn(
                                "border-b last:border-0 hover:bg-muted/20 transition-colors cursor-pointer bg-muted/10",
                                child.status === "processing" && "bg-primary/5"
                              )}
                              onClick={() => setDetailProduct(child)}
                            >
                              <td className="p-3 pl-10" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={selected.has(child.id)}
                                  onCheckedChange={() => toggleSelect(child.id)}
                                />
                              </td>
                              <td className="p-3 font-mono text-xs text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-muted-foreground/40">└</span>
                                  {child.sku ?? "—"}
                                </div>
                              </td>
                              <td className="p-3 max-w-[180px] truncate text-muted-foreground text-xs">{child.original_title ?? "—"}</td>
                              <td className="p-3 max-w-[180px] truncate text-primary/70 text-xs">{child.optimized_title ?? "—"}</td>
                              <td className="p-3 max-w-[140px] truncate text-xs text-muted-foreground">
                                {/* Show attribute values instead of category for variations */}
                                {Array.isArray(child.attributes) && (child.attributes as any[]).length > 0
                                  ? (child.attributes as any[]).map((a: any) => 
                                      Array.isArray(a.values) ? a.values.join("/") : (a.value || "")
                                    ).filter(Boolean).join(", ")
                                  : child.category ?? "—"
                                }
                              </td>
                              <td className="p-3 max-w-[140px] truncate text-xs text-muted-foreground">{child.optimized_short_description ?? "—"}</td>
                              <td className="p-3 max-w-[120px] truncate text-xs font-mono text-muted-foreground/60">{child.seo_slug ?? "—"}</td>
                              <td className="p-3">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">Variação</Badge>
                                  <Badge variant="outline" className={cn("text-xs", statusColors[child.status])}>
                                    {statusLabels[child.status]}
                                  </Badge>
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <PhaseIndicator product={child} />
                              </td>
                              <td className="p-3 text-center">
                                {(() => {
                                  const { score } = calculateSeoScore(child);
                                  return <span className={cn("text-xs font-bold", getSeoScoreColor(score))}>{score}</span>;
                                })()}
                              </td>
                              <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => setDetailProduct(child)}>
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Field Selector Dialog */}
      <Dialog open={showFieldSelector} onOpenChange={setShowFieldSelector}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
          {/* Speed Toggles */}
          <div className="space-y-2 mt-3 pt-3 border-t">
            <Label className="text-xs font-medium text-muted-foreground">⚡ Controlos de Velocidade</Label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                  <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-knowledge">Desativar Base de Conhecimento (RAG)</Label>
                  <p className="text-[10px] text-muted-foreground">Ignora pesquisa em documentos. Mais rápido, menos contexto.</p>
                </div>
                <Switch id="skip-knowledge" checked={skipKnowledge} onCheckedChange={setSkipKnowledge} />
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                  <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-scraping">Desativar Scraping do Fornecedor</Label>
                  <p className="text-[10px] text-muted-foreground">Não consulta páginas do fornecedor. Elimina ~2s por produto.</p>
                </div>
                <Switch id="skip-scraping" checked={skipScraping} onCheckedChange={setSkipScraping} />
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div>
                  <Label className="text-xs font-medium cursor-pointer" htmlFor="skip-reranking">Desativar AI Reranking</Label>
                  <p className="text-[10px] text-muted-foreground">Usa ranking simples em vez de IA. Poupa 1 chamada de IA por produto.</p>
                </div>
                <Switch id="skip-reranking" checked={skipReranking} onCheckedChange={setSkipReranking} />
              </div>
            </div>
          </div>
          {/* Background Mode Toggle */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary" />
              <div>
                <Label className="text-xs font-medium cursor-pointer" htmlFor="bg-mode">
                  Modo Background {pendingOptimizeIds.length >= 50 && <Badge variant="secondary" className="text-[10px] ml-1">Recomendado</Badge>}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Processa em segundo plano com 5x paralelismo. Pode fechar o browser.
                </p>
              </div>
            </div>
            <Switch
              id="bg-mode"
              checked={backgroundMode}
              onCheckedChange={setBackgroundMode}
            />
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
                  disabled={selectedFields.size === 0 || optimizeProducts.isPending || isCreatingJob || (hasAlreadyOptimized && !confirmReoptimize)}
                >
                  {backgroundMode ? (
                    <Rocket className="w-4 h-4 mr-1" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  {backgroundMode ? "Lançar em Background" : "Otimizar"} {pendingOptimizeIds.length} produto(s)
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
                            <Badge variant="secondary" className="text-xs shrink-0">{Object.values(v.attribute_values).join(" / ")}</Badge>
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
                 attribute_names: ["Tamanho"],
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

      {/* WooCommerce Publish Modal */}
      {(() => {
        // Compute publish info: auto-include child variations for selected variable parents
        const selectedArr = Array.from(selected);
        const selectedProducts = (products ?? []).filter(p => selected.has(p.id));
        const variableParentIds = selectedProducts.filter(p => p.product_type === "variable").map(p => p.id);
        const childVariations = (products ?? []).filter(p => p.parent_product_id && variableParentIds.includes(p.parent_product_id) && !selected.has(p.id));
        const allPublishIds = [...selectedArr, ...childVariations.map(c => c.id)];
        const variationCount = childVariations.length;

        return (
          <WooPublishModal
            open={showPublishModal}
            onClose={() => setShowPublishModal(false)}
            productCount={allPublishIds.length}
            variableParentCount={variableParentIds.length}
            autoIncludedVariationsCount={variationCount}
            isPending={isCreatingPublish}
            onConfirm={async (fields, pricing, scheduledFor) => {
              try {
                await createPublishJob({
                  productIds: allPublishIds,
                  publishFields: fields,
                  pricing,
                  scheduledFor,
                  workspaceId: activeWorkspace?.id,
                });
                setSelected(new Set());
                setShowPublishModal(false);
              } catch (err) {
                // Modal permanece aberto e seleção mantida em caso de erro
                // Feedback já é mostrado via toast no hook
              }
            }}
          />
        );
      })()}
    </div>
  );
};

export default ProductsPage;
