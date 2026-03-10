import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, AlertTriangle, Check, X, Eye, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/hooks/useDuplicateDetection";

type GroupDecision = "pending" | "approved" | "rejected";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DuplicateGroup[];
  onDelete: (ids: string[]) => void;
  onOpenProduct?: (productId: string) => void;
}

export function DuplicateDetectionDialog({ open, onOpenChange, groups, onDelete, onOpenProduct }: Props) {
  const [decisions, setDecisions] = useState<Map<string, { decision: GroupDecision; keepIndex: number }>>(new Map());

  const setGroupDecision = (key: string, decision: GroupDecision, keepIndex = 0) => {
    setDecisions(prev => {
      const next = new Map(prev);
      next.set(key, { decision, keepIndex });
      return next;
    });
  };

  const skuGroups = groups.filter(g => g.reason === "sku");
  const titleGroups = groups.filter(g => g.reason === "title");

  // Auto-reject all SKU duplicates (keep first of each group)
  const handleAutoDeleteSkuDuplicates = () => {
    const idsToDelete: string[] = [];
    for (const group of skuGroups) {
      group.products.forEach((p, i) => {
        if (i !== 0) idsToDelete.push(p.id);
      });
    }
    if (idsToDelete.length === 0) return;
    if (confirm(`Eliminar automaticamente ${idsToDelete.length} produto(s) com SKU duplicado? (mantém o primeiro de cada grupo)`)) {
      onDelete(idsToDelete);
      skuGroups.forEach(g => setGroupDecision(g.key, "rejected", 0));
    }
  };

  // Auto-approve all title similar groups (different SKUs = unique/variable products)
  const handleAutoApproveTitleSimilar = () => {
    titleGroups.forEach(g => setGroupDecision(g.key, "approved", 0));
  };

  const handleApplySelected = () => {
    const idsToDelete: string[] = [];
    for (const group of groups) {
      const d = decisions.get(group.key);
      if (d?.decision === "rejected") {
        group.products.forEach((p, i) => {
          if (i !== d.keepIndex) idsToDelete.push(p.id);
        });
      }
    }
    if (idsToDelete.length === 0) return;
    if (confirm(`Eliminar ${idsToDelete.length} produto(s) duplicado(s) dos grupos rejeitados?`)) {
      onDelete(idsToDelete);
      setDecisions(new Map());
    }
  };

  const visibleGroups = groups.filter(g => {
    const d = decisions.get(g.key);
    return !d || d.decision !== "approved";
  });
  const totalDuplicates = groups.reduce((sum, g) => sum + g.products.length, 0);
  const approvedCount = Array.from(decisions.values()).filter(d => d.decision === "approved").length;
  const rejectedCount = Array.from(decisions.values()).filter(d => d.decision === "rejected").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Deteção de Duplicados
          </DialogTitle>
        </DialogHeader>

        {groups.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-lg font-medium">Sem duplicados encontrados! ✓</p>
            <p className="text-sm mt-1">Todos os produtos no workspace são únicos.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong>{groups.length}</strong> grupo(s), <strong>{totalDuplicates}</strong> produtos.
              </p>

              {/* Quick action buttons */}
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground mr-1">Ações rápidas:</span>
                {skuGroups.length > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-8"
                    onClick={handleAutoDeleteSkuDuplicates}
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Eliminar SKU duplicados ({skuGroups.reduce((s, g) => s + g.products.length - 1, 0)})
                  </Button>
                )}
                {titleGroups.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 border-success/40 text-success hover:bg-success/10"
                    onClick={handleAutoApproveTitleSimilar}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Aprovar similares — são únicos ({titleGroups.length} grupos)
                  </Button>
                )}
                <Badge variant="outline" className="text-xs ml-auto">
                  {reviewedCount}/{groups.length} revistos
                </Badge>
              </div>
            </div>

            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-3 pr-3">
                {visibleGroups.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground">
                    <p className="text-sm">Todos os grupos foram revistos ✓</p>
                  </div>
                ) : visibleGroups.map((group) => {
                  const d = decisions.get(group.key);
                  const decision = d?.decision || "pending";
                  const keepIndex = d?.keepIndex ?? 0;

                  return (
                    <div
                      key={group.key}
                      className={cn(
                        "border rounded-lg p-3 space-y-2 transition-colors",
                        decision === "rejected" && "border-destructive/40 bg-destructive/5",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            group.reason === "sku" ? "bg-destructive/10 text-destructive border-destructive/20" :
                            "bg-warning/10 text-warning border-warning/20"
                          )}>
                            {group.reason === "sku" ? "SKU Idêntico" : "Título Similar"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{group.products.length} produtos</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 px-2 border-success/40 text-success hover:bg-success/10"
                            onClick={() => setGroupDecision(group.key, "approved", 0)}
                          >
                            <Check className="w-3 h-3 mr-1" /> Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant={decision === "rejected" ? "destructive" : "outline"}
                            className="text-xs h-7 px-2"
                            onClick={() => setGroupDecision(group.key, "rejected", keepIndex)}
                          >
                            <X className="w-3 h-3 mr-1" /> Rejeitar
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        {group.products.map((p, pi) => (
                          <div
                            key={p.id}
                            className={cn(
                              "flex items-center gap-2 p-2 rounded text-sm",
                              decision === "rejected" && pi === keepIndex && "bg-success/10 border border-success/20",
                              decision === "rejected" && pi !== keepIndex && "bg-destructive/5 border border-destructive/20 opacity-60 line-through",
                              decision !== "rejected" && pi === 0 && "bg-muted/50",
                            )}
                          >
                            {decision === "rejected" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 shrink-0"
                                title="Manter este produto"
                                onClick={() => setGroupDecision(group.key, "rejected", pi)}
                              >
                                {pi === keepIndex ? <Check className="w-3 h-3 text-success" /> : <span className="w-3 h-3" />}
                              </Button>
                            )}
                            <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{p.sku || "—"}</span>
                            <span className="truncate flex-1">{p.optimized_title || p.original_title || "Sem título"}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{p.product_type}</Badge>
                            {p.technical_specs && (
                              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0">
                                Web
                              </Badge>
                            )}
                            {onOpenProduct && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 shrink-0"
                                onClick={() => onOpenProduct(p.id)}
                              >
                                <Eye className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {rejectedCount > 0 && (
            <Button variant="destructive" onClick={handleApplySelected}>
              <Trash2 className="w-4 h-4 mr-1" />
              Aplicar {rejectedCount} rejeição(ões)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
