import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, GitBranch, Search, Check, X, AlertTriangle, Layers, ChevronDown, ChevronRight, Sparkles, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProducts, type Product } from "@/hooks/useProducts";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useDetectVariations, useApplyVariations, type VariationGroup } from "@/hooks/useVariableProducts";
import { supabase } from "@/integrations/supabase/client";

type AnalysisState = "idle" | "analyzing" | "results";

const VariationsPage = () => {
  const { data: products, isLoading } = useProducts();
  const { activeWorkspace } = useWorkspaceContext();
  const detectVariations = useDetectVariations();
  const applyVariations = useApplyVariations();

  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [detectedGroups, setDetectedGroups] = useState<VariationGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });

  // Current variable products overview
  const variableProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "variable"), [products]);
  const variationProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "variation"), [products]);
  const simpleProducts = useMemo(() => (products ?? []).filter(p => p.product_type === "simple"), [products]);

  // Orphan variations (variation without valid parent)
  const orphanVariations = useMemo(() => {
    const parentIds = new Set((products ?? []).map(p => p.id));
    return variationProducts.filter(p => p.parent_product_id && !parentIds.has(p.parent_product_id));
  }, [products, variationProducts]);

  // Variable products with no children
  const emptyVariables = useMemo(() => {
    const parentIdsWithChildren = new Set(variationProducts.map(p => p.parent_product_id).filter(Boolean));
    return variableProducts.filter(p => !parentIdsWithChildren.has(p.id));
  }, [variableProducts, variationProducts]);

  const handleFullAnalysis = async () => {
    if (!activeWorkspace) return;
    setAnalysisState("analyzing");
    
    try {
      // Process in batches of 500 simple products
      const batchSize = 500;
      const allGroups: VariationGroup[] = [];
      const total = Math.ceil(simpleProducts.length / batchSize);
      setAnalysisProgress({ current: 0, total });

      for (let i = 0; i < simpleProducts.length; i += batchSize) {
        const batch = simpleProducts.slice(i, i + batchSize);
        const result = await detectVariations.mutateAsync({
          workspaceId: activeWorkspace.id,
          products: batch.map(p => ({ id: p.id, sku: p.sku, original_title: p.original_title, optimized_title: p.optimized_title, category: p.category, original_price: p.original_price, original_description: p.original_description, short_description: p.short_description, product_type: p.product_type, attributes: p.attributes })),
        });
        allGroups.push(...result.groups);
        setAnalysisProgress({ current: Math.floor(i / batchSize) + 1, total });
      }

      setDetectedGroups(allGroups);
      setSelectedGroups(new Set(allGroups.map((_, i) => i)));
      setExpandedGroups(new Set());
      setAnalysisState("results");

      if (allGroups.length === 0) {
        toast.info("Nenhuma variação potencial detetada nos produtos simples.");
      } else {
        const totalVariations = allGroups.reduce((s, g) => s + g.variations.length, 0);
        toast.success(`${allGroups.length} grupo(s) com ${totalVariations} variações detetados!`);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro na análise");
      setAnalysisState("idle");
    }
  };

  const handleApplySelected = async () => {
    const groups = detectedGroups.filter((_, i) => selectedGroups.has(i));
    if (groups.length === 0) {
      toast.warning("Selecione pelo menos um grupo para aplicar.");
      return;
    }
    await applyVariations.mutateAsync({ groups });
    setAnalysisState("idle");
    setDetectedGroups([]);
    setSelectedGroups(new Set());
  };

  const toggleGroup = (idx: number) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleExpand = (idx: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
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
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{simpleProducts.length}</p>
            <p className="text-xs text-muted-foreground">Simples</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{variableProducts.length}</p>
            <p className="text-xs text-muted-foreground">Variáveis</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{variationProducts.length}</p>
            <p className="text-xs text-muted-foreground">Variações</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className={cn("text-2xl font-bold", (orphanVariations.length + emptyVariables.length) > 0 ? "text-destructive" : "text-success")}>
              {orphanVariations.length + emptyVariables.length}
            </p>
            <p className="text-xs text-muted-foreground">Problemas</p>
          </CardContent>
        </Card>
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
                  {orphanVariations.length > 10 && (
                    <p className="text-xs text-muted-foreground">...e mais {orphanVariations.length - 10}</p>
                  )}
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
                  {emptyVariables.length > 10 && (
                    <p className="text-xs text-muted-foreground">...e mais {emptyVariables.length - 10}</p>
                  )}
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
            Corre uma análise com IA a todos os {simpleProducts.length} produtos simples para detetar potenciais variações não agrupadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {analysisState === "idle" && (
            <Button
              onClick={handleFullAnalysis}
              disabled={simpleProducts.length < 2 || detectVariations.isPending}
              className="w-full sm:w-auto"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Analisar {simpleProducts.length} Produtos Simples
            </Button>
          )}

          {analysisState === "analyzing" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm">A analisar produtos com IA...</span>
              </div>
              {analysisProgress.total > 1 && (
                <Progress value={(analysisProgress.current / analysisProgress.total) * 100} />
              )}
              <p className="text-xs text-muted-foreground">
                Lote {analysisProgress.current}/{analysisProgress.total}
              </p>
            </div>
          )}

          {analysisState === "results" && (
            <div className="space-y-4">
              {detectedGroups.length === 0 ? (
                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertDescription>
                    Não foram detetadas variações potenciais. Todos os produtos simples parecem ser genuinamente distintos.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-sm font-medium">
                      {detectedGroups.length} grupo(s) sugerido(s) — {selectedGroups.size} selecionado(s)
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        setAnalysisState("idle");
                        setDetectedGroups([]);
                      }}>
                        <X className="w-3.5 h-3.5 mr-1" /> Descartar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        if (selectedGroups.size === detectedGroups.length) {
                          setSelectedGroups(new Set());
                        } else {
                          setSelectedGroups(new Set(detectedGroups.map((_, i) => i)));
                        }
                      }}>
                        {selectedGroups.size === detectedGroups.length ? "Desselecionar Tudo" : "Selecionar Tudo"}
                      </Button>
                      <Button size="sm" onClick={handleApplySelected} disabled={applyVariations.isPending || selectedGroups.size === 0}>
                        {applyVariations.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Aplicar ({selectedGroups.size})
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {detectedGroups.map((group, idx) => (
                      <div key={idx} className={cn("border rounded-lg transition-colors", selectedGroups.has(idx) ? "border-primary/40 bg-primary/5" : "")}>
                        <div className="flex items-center gap-3 p-3">
                          <Checkbox
                            checked={selectedGroups.has(idx)}
                            onCheckedChange={() => toggleGroup(idx)}
                          />
                          <button
                            className="flex items-center gap-1 text-muted-foreground"
                            onClick={() => toggleExpand(idx)}
                          >
                            {expandedGroups.has(idx) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{group.parent_title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="secondary" className="text-[10px]">{group.variations.length} variações</Badge>
                              <Badge variant="outline" className="text-[10px]">{group.attribute_name}</Badge>
                            </div>
                          </div>
                        </div>

                        {expandedGroups.has(idx) && (
                          <div className="px-3 pb-3 pl-12">
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="text-left p-2 font-medium text-muted-foreground">SKU</th>
                                    <th className="text-left p-2 font-medium text-muted-foreground">Título</th>
                                    <th className="text-left p-2 font-medium text-muted-foreground">{group.attribute_name}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.variations.map((v, vi) => {
                                    const p = productMap.get(v.product_id);
                                    return (
                                      <tr key={vi} className="border-t">
                                        <td className="p-2 font-mono">{p?.sku ?? "—"}</td>
                                        <td className="p-2 truncate max-w-[200px]">{p?.original_title ?? "—"}</td>
                                        <td className="p-2">
                                          <Badge variant="outline" className="text-[10px]">{v.attribute_value}</Badge>
                                        </td>
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
