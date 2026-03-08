import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, Check, X, AlertTriangle, ChevronDown, ChevronRight, Sparkles, Network, Plus, RefreshCw, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProducts, type Product } from "@/hooks/useProducts";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useDetectVariations, useApplyVariations, type VariationGroup, type AddToExistingGroup } from "@/hooks/useVariableProducts";
import { supabase } from "@/integrations/supabase/client";

type AnalysisState = "idle" | "analyzing" | "results";

const VariationsPage = () => {
  const { data: products, isLoading } = useProducts();
  const { activeWorkspace } = useWorkspaceContext();
  const detectVariations = useDetectVariations();
  const applyVariations = useApplyVariations();

  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [detectedGroups, setDetectedGroups] = useState<VariationGroup[]>([]);
  const [detectedAdditions, setDetectedAdditions] = useState<AddToExistingGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [selectedAdditions, setSelectedAdditions] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedAdditions, setExpandedAdditions] = useState<Set<number>>(new Set());
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [reclassifySuggestions, setReclassifySuggestions] = useState<any[]>([]);

  const variableProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "variable"), [products]);
  const variationProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "variation"), [products]);
  const simpleProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "simple"), [products]);

  const orphanVariations = useMemo(() => {
    const parentIds = new Set((products ?? []).map(p => p.id));
    return variationProducts.filter(p => p.parent_product_id && !parentIds.has(p.parent_product_id));
  }, [products, variationProducts]);

  const emptyVariables = useMemo(() => {
    const parentIdsWithChildren = new Set(variationProducts.map(p => p.parent_product_id).filter(Boolean));
    return variableProducts.filter(p => !parentIdsWithChildren.has(p.id));
  }, [variableProducts, variationProducts]);

  // Build existing groups context for AI
  const existingGroupsContext = useMemo(() => {
    return variableProducts.map(parent => {
      const children = variationProducts.filter(p => p.parent_product_id === parent.id);
      const attrs = Array.isArray(parent.attributes) ? parent.attributes as any[] : [];
      const attrNames = attrs.map((a: any) => a.name).filter(Boolean);
      return {
        parent_id: parent.id,
        parent_title: parent.optimized_title || parent.original_title || "",
        attribute_names: attrNames.length > 0 ? attrNames : ["Variação"],
        existing_variations: children.map(c => {
          const childAttrs = Array.isArray(c.attributes) ? c.attributes as any[] : [];
          const vals: Record<string, string> = {};
          childAttrs.forEach((a: any) => { if (a.name && a.value) vals[a.name] = a.value; });
          // Fallback for legacy single-value
          if (Object.keys(vals).length === 0 && childAttrs[0]?.value) {
            vals[attrNames[0] || "Variação"] = childAttrs[0].value;
          }
          return { sku: c.sku, attribute_values: vals };
        }),
      };
    });
  }, [variableProducts, variationProducts]);

  const handleAnalysis = async (mode: "simple" | "full") => {
    if (!activeWorkspace) return;
    setAnalysisState("analyzing");

    try {
      // Fetch knowledge context from PDF catalog
      let knowledgeContext = "";
      try {
        const { data: chunks } = await supabase.rpc("search_knowledge", {
          _query: "variações tamanhos dimensões capacidade modelos série família cores materiais",
          _workspace_id: activeWorkspace.id,
          _limit: 15,
        });
        if (chunks && chunks.length > 0) {
          knowledgeContext = chunks.map((c: any) => `[${c.source_name}]: ${c.content}`).join("\n\n");
        }
      } catch { /* knowledge search is optional */ }

      const allProducts = products ?? [];
      const productsToAnalyze = mode === "full" ? allProducts : simpleProducts;

      const batchSize = 500;
      const allGroups: VariationGroup[] = [];
      const allAdditions: AddToExistingGroup[] = [];
      const allReclassify: any[] = [];
      const total = Math.ceil(productsToAnalyze.length / batchSize);
      setAnalysisProgress({ current: 0, total });

      for (let i = 0; i < productsToAnalyze.length; i += batchSize) {
        const batch = productsToAnalyze.slice(i, i + batchSize);
        const { data, error } = await supabase.functions.invoke("detect-variations", {
          body: {
            workspaceId: activeWorkspace.id,
            products: batch.map(p => ({
              id: p.id, sku: p.sku, original_title: p.original_title,
              optimized_title: p.optimized_title, category: p.category,
              original_price: p.original_price, original_description: p.original_description,
              short_description: p.short_description, product_type: p.product_type,
              attributes: p.attributes, crosssell_skus: p.crosssell_skus,
              upsell_skus: p.upsell_skus, parent_product_id: p.parent_product_id,
            })),
            existingGroups: existingGroupsContext,
            knowledgeContext,
            mode,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        // Normalize results
        const { normalizeGroup, normalizeAddition } = await import("@/hooks/useVariableProducts").then(m => ({
          normalizeGroup: (g: any) => {
            const attrNames = g.attribute_names || (g.attribute_name ? [g.attribute_name] : ["Variação"]);
            return {
              parent_title: g.parent_title,
              attribute_names: attrNames,
              variations: (g.variations || []).map((v: any) => ({
                product_id: v.product_id,
                attribute_values: v.attribute_values || (v.attribute_value ? { [attrNames[0]]: v.attribute_value } : {}),
              })),
            };
          },
          normalizeAddition: (a: any) => {
            const attrNames = a.attribute_names || (a.attribute_name ? [a.attribute_name] : ["Variação"]);
            return {
              existing_parent_id: a.existing_parent_id,
              existing_parent_title: a.existing_parent_title,
              attribute_names: attrNames,
              products_to_add: (a.products_to_add || []).map((v: any) => ({
                product_id: v.product_id,
                attribute_values: v.attribute_values || (v.attribute_value ? { [attrNames[0]]: v.attribute_value } : {}),
              })),
              reason: a.reason,
            };
          },
        }));

        allGroups.push(...(data.groups || []).map(normalizeGroup));
        allAdditions.push(...(data.addToExisting || []).map(normalizeAddition));
        if (data.reclassify) allReclassify.push(...data.reclassify);
        setAnalysisProgress({ current: Math.floor(i / batchSize) + 1, total });
      }

      setDetectedGroups(allGroups);
      setDetectedAdditions(allAdditions);
      setReclassifySuggestions(allReclassify);
      setSelectedGroups(new Set(allGroups.map((_, i) => i)));
      setSelectedAdditions(new Set(allAdditions.map((_, i) => i)));
      setExpandedGroups(new Set());
      setExpandedAdditions(new Set());
      setAnalysisState("results");

      const totalNew = allGroups.reduce((s, g) => s + g.variations.length, 0);
      const totalAdded = allAdditions.reduce((s, g) => s + g.products_to_add.length, 0);
      if (allGroups.length === 0 && allAdditions.length === 0 && allReclassify.length === 0) {
        toast.info("Nenhuma variação ou correção detetada.");
      } else {
        const parts = [];
        if (allGroups.length > 0) parts.push(`${allGroups.length} novo(s) grupo(s) (${totalNew} prod.)`);
        if (allAdditions.length > 0) parts.push(`${allAdditions.length} adição(ões) a existentes (${totalAdded} prod.)`);
        if (allReclassify.length > 0) parts.push(`${allReclassify.length} correção(ões)`);
        toast.success(`Detetado: ${parts.join(" + ")}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro na análise");
      setAnalysisState("idle");
    }
  };

  const handleApplySelected = async () => {
    const groups = detectedGroups.filter((_, i) => selectedGroups.has(i));
    const additions = detectedAdditions.filter((_, i) => selectedAdditions.has(i));
    if (groups.length === 0 && additions.length === 0) {
      toast.warning("Selecione pelo menos um grupo ou adição para aplicar.");
      return;
    }
    await applyVariations.mutateAsync({ groups, addToExisting: additions });
    setAnalysisState("idle");
    setDetectedGroups([]);
    setDetectedAdditions([]);
    setReclassifySuggestions([]);
    setSelectedGroups(new Set());
    setSelectedAdditions(new Set());
  };

  const toggleGroup = (idx: number) => {
    setSelectedGroups(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  };
  const toggleAddition = (idx: number) => {
    setSelectedAdditions(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  };
  const toggleExpand = (idx: number) => {
    setExpandedGroups(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  };
  const toggleExpandAddition = (idx: number) => {
    setExpandedAdditions(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });
  };

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    (products ?? []).forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalSelected = selectedGroups.size + selectedAdditions.size;
  const totalResults = detectedGroups.length + detectedAdditions.length;

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg sm:text-2xl font-bold text-foreground">Análise de Variações</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
          Analise o catálogo para detetar produtos que deveriam ser variações e corrigir erros de agrupamento.
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{simpleProducts.length}</p>
          <p className="text-xs text-muted-foreground">Simples</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-primary">{variableProducts.length}</p>
          <p className="text-xs text-muted-foreground">Variáveis</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{variationProducts.length}</p>
          <p className="text-xs text-muted-foreground">Variações</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className={cn("text-2xl font-bold", (orphanVariations.length + emptyVariables.length) > 0 ? "text-destructive" : "text-muted-foreground")}>
            {orphanVariations.length + emptyVariables.length}
          </p>
          <p className="text-xs text-muted-foreground">Problemas</p>
        </CardContent></Card>
      </div>

      {/* Problems Section */}
      {(orphanVariations.length > 0 || emptyVariables.length > 0) && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Problemas Detetados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orphanVariations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-destructive mb-1">Variações Órfãs ({orphanVariations.length})</p>
                <p className="text-xs text-muted-foreground mb-2">Estas variações referem um produto pai que não existe.</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {orphanVariations.slice(0, 10).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs p-2 rounded bg-destructive/5">
                      <span className="font-mono">{p.sku ?? "—"}</span>
                      <span className="truncate">{p.original_title}</span>
                    </div>
                  ))}
                  {orphanVariations.length > 10 && <p className="text-xs text-muted-foreground">...e mais {orphanVariations.length - 10}</p>}
                </div>
              </div>
            )}
            {emptyVariables.length > 0 && (
              <div>
                <p className="text-xs font-medium text-destructive mb-1">Variáveis sem Filhos ({emptyVariables.length})</p>
                <p className="text-xs text-muted-foreground mb-2">Estes produtos variáveis não têm variações associadas.</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {emptyVariables.slice(0, 10).map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs p-2 rounded bg-destructive/5">
                      <span className="font-mono">{p.sku ?? "—"}</span>
                      <span className="truncate">{p.original_title}</span>
                    </div>
                  ))}
                  {emptyVariables.length > 10 && <p className="text-xs text-muted-foreground">...e mais {emptyVariables.length - 10}</p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing Variable Groups */}
      {variableProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              Grupos Variáveis Existentes ({variableProducts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {variableProducts.map(parent => {
                const children = (products ?? []).filter(p => p.parent_product_id === parent.id);
                const attrs = Array.isArray(parent.attributes) ? parent.attributes as any[] : [];
                return (
                  <div key={parent.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{parent.optimized_title || parent.original_title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px]">{children.length} variações</Badge>
                        {attrs[0]?.name && <Badge variant="outline" className="text-[10px]">{attrs[0].name}</Badge>}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{parent.status}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            Análise IA do Catálogo
          </CardTitle>
          <CardDescription className="text-xs">
            Analisa {simpleProducts.length} produtos simples para detetar novos grupos de variações
            {variableProducts.length > 0 && ` e verificar se algum deve ser adicionado aos ${variableProducts.length} grupos existentes`}.
            {" "}Utiliza dados de crosssell/upsell e o catálogo PDF como contexto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {analysisState === "idle" && (
            <Button onClick={handleFullAnalysis} disabled={simpleProducts.length < 1 || detectVariations.isPending} className="w-full sm:w-auto">
              <Sparkles className="w-4 h-4 mr-2" />
              Analisar {simpleProducts.length} Produtos Simples
            </Button>
          )}

          {analysisState === "analyzing" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm">A analisar produtos com IA (catálogo + crosssell + grupos existentes)...</span>
              </div>
              {analysisProgress.total > 1 && <Progress value={(analysisProgress.current / analysisProgress.total) * 100} />}
              <p className="text-xs text-muted-foreground">Lote {analysisProgress.current}/{analysisProgress.total}</p>
            </div>
          )}

          {analysisState === "results" && (
            <div className="space-y-4">
              {totalResults === 0 ? (
                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertDescription>
                    Não foram detetadas variações potenciais. Todos os produtos simples parecem ser genuinamente distintos.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium">{totalResults} sugestão(ões) — {totalSelected} selecionada(s)</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        setAnalysisState("idle");
                        setDetectedGroups([]);
                        setDetectedAdditions([]);
                      }}>
                        <X className="w-3.5 h-3.5 mr-1" /> Descartar
                      </Button>
                      <Button size="sm" onClick={handleApplySelected} disabled={applyVariations.isPending || totalSelected === 0}>
                        {applyVariations.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Aplicar ({totalSelected})
                      </Button>
                    </div>
                  </div>

                  {/* New Groups */}
                  {detectedGroups.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" /> Novos Grupos ({detectedGroups.length})
                      </p>
                      {detectedGroups.map((group, idx) => (
                        <div key={`new-${idx}`} className={cn("border rounded-lg transition-colors", selectedGroups.has(idx) ? "border-primary/40 bg-primary/5" : "")}>
                          <div className="flex items-center gap-3 p-3">
                            <Checkbox checked={selectedGroups.has(idx)} onCheckedChange={() => toggleGroup(idx)} />
                            <button className="flex items-center gap-1 text-muted-foreground" onClick={() => toggleExpand(idx)}>
                              {expandedGroups.has(idx) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{group.parent_title}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <Badge variant="secondary" className="text-[10px]">{group.variations.length} variações</Badge>
                                {group.attribute_names.map(n => <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>)}
                              </div>
                            </div>
                          </div>
                          {expandedGroups.has(idx) && (
                            <div className="px-3 pb-3 pl-12">
                              <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/50"><tr>
                                    <th className="text-left p-2 font-medium text-muted-foreground">SKU</th>
                                    <th className="text-left p-2 font-medium text-muted-foreground">Título</th>
                                    {group.attribute_names.map(n => <th key={n} className="text-left p-2 font-medium text-muted-foreground">{n}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {group.variations.map((v, vi) => {
                                      const p = productMap.get(v.product_id);
                                      return (
                                        <tr key={vi} className="border-t">
                                          <td className="p-2 font-mono">{p?.sku ?? "—"}</td>
                                          <td className="p-2 truncate max-w-[200px]">{p?.original_title ?? "—"}</td>
                                          {group.attribute_names.map(n => (
                                            <td key={n} className="p-2"><Badge variant="outline" className="text-[10px]">{v.attribute_values[n] || "—"}</Badge></td>
                                          ))}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Additions to Existing Groups */}
                  {detectedAdditions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> Adicionar a Grupos Existentes ({detectedAdditions.length})
                      </p>
                      {detectedAdditions.map((addition, idx) => (
                        <div key={`add-${idx}`} className={cn("border rounded-lg transition-colors", selectedAdditions.has(idx) ? "border-primary/40 bg-primary/5" : "")}>
                          <div className="flex items-center gap-3 p-3">
                            <Checkbox checked={selectedAdditions.has(idx)} onCheckedChange={() => toggleAddition(idx)} />
                            <button className="flex items-center gap-1 text-muted-foreground" onClick={() => toggleExpandAddition(idx)}>
                              {expandedAdditions.has(idx) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                <span className="text-muted-foreground">→</span> {addition.existing_parent_title}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Badge className="text-[10px] bg-primary/20 text-primary border-0">+{addition.products_to_add.length} novo(s)</Badge>
                                {addition.attribute_names.map(n => <Badge key={n} variant="outline" className="text-[10px]">{n}</Badge>)}
                                {addition.reason && <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{addition.reason}</span>}
                              </div>
                            </div>
                          </div>
                          {expandedAdditions.has(idx) && (() => {
                            const existingGroup = existingGroupsContext.find(g => g.parent_id === addition.existing_parent_id);
                            const existingVariations = existingGroup?.existing_variations || [];
                            return (
                              <div className="px-3 pb-3 pl-12">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {/* Current variations */}
                                  <div>
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                      <Network className="w-3 h-3" /> Variações Atuais ({existingVariations.length})
                                    </p>
                                    <div className="border rounded-lg overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead className="bg-muted/50"><tr>
                                          <th className="text-left p-2 font-medium text-muted-foreground">SKU</th>
                                          {addition.attribute_names.map(n => <th key={n} className="text-left p-2 font-medium text-muted-foreground">{n}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {existingVariations.length === 0 ? (
                                            <tr><td colSpan={1 + addition.attribute_names.length} className="p-2 text-muted-foreground italic">Sem variações</td></tr>
                                          ) : existingVariations.map((ev, evi) => (
                                            <tr key={evi} className="border-t">
                                              <td className="p-2 font-mono">{ev.sku ?? "—"}</td>
                                              {addition.attribute_names.map(n => (
                                                <td key={n} className="p-2"><Badge variant="outline" className="text-[10px]">{ev.attribute_values[n] || "—"}</Badge></td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                  {/* New suggested variations */}
                                  <div>
                                    <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                      <Plus className="w-3 h-3" /> Novas Sugeridas ({addition.products_to_add.length})
                                    </p>
                                    <div className="border border-primary/30 rounded-lg overflow-hidden bg-primary/5">
                                      <table className="w-full text-xs">
                                         <thead className="bg-primary/10"><tr>
                                          <th className="text-left p-2 font-medium text-muted-foreground">SKU</th>
                                          <th className="text-left p-2 font-medium text-muted-foreground">Título</th>
                                          {addition.attribute_names.map(n => <th key={n} className="text-left p-2 font-medium text-muted-foreground">{n}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {addition.products_to_add.map((v, vi) => {
                                            const p = productMap.get(v.product_id);
                                            return (
                                              <tr key={vi} className="border-t border-primary/10">
                                                <td className="p-2 font-mono">{p?.sku ?? "—"}</td>
                                                <td className="p-2 truncate max-w-[150px]">{p?.original_title ?? "—"}</td>
                                                {addition.attribute_names.map(n => (
                                                  <td key={n} className="p-2"><Badge className="text-[10px] bg-primary/20 text-primary border-0">{v.attribute_values[n] || "—"}</Badge></td>
                                                ))}
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                                {addition.reason && (
                                  <p className="text-[10px] text-muted-foreground mt-2 italic">💡 {addition.reason}</p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VariationsPage;
