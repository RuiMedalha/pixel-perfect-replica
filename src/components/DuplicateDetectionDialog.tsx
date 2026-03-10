import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Merge, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/hooks/useDuplicateDetection";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DuplicateGroup[];
  onDelete: (ids: string[]) => void;
}

export function DuplicateDetectionDialog({ open, onOpenChange, groups, onDelete }: Props) {
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());

  const toggleDelete = (id: string) => {
    setSelectedToDelete(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedToDelete.size === 0) return;
    if (confirm(`Eliminar ${selectedToDelete.size} produto(s) duplicado(s)?`)) {
      onDelete(Array.from(selectedToDelete));
      setSelectedToDelete(new Set());
    }
  };

  const totalDuplicates = groups.reduce((sum, g) => sum + g.products.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
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
            <p className="text-sm text-muted-foreground">
              Encontrados <strong>{groups.length}</strong> grupo(s) com <strong>{totalDuplicates}</strong> produtos potencialmente duplicados.
              Selecione os que deseja eliminar.
            </p>

            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-4 pr-3">
                {groups.map((group, gi) => (
                  <div key={group.key} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn(
                        "text-xs",
                        group.reason === "sku" ? "bg-destructive/10 text-destructive border-destructive/20" :
                        group.reason === "title" ? "bg-warning/10 text-warning border-warning/20" :
                        "bg-primary/10 text-primary border-primary/20"
                      )}>
                        {group.reason === "sku" ? "SKU Idêntico" : group.reason === "title" ? "Título Similar" : "SKU + Título"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{group.products.length} produtos</span>
                    </div>

                    <div className="space-y-1">
                      {group.products.map((p, pi) => (
                        <div
                          key={p.id}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded text-sm",
                            pi === 0 ? "bg-muted/50" : "bg-background",
                            selectedToDelete.has(p.id) && "bg-destructive/5 border border-destructive/20"
                          )}
                        >
                          <Checkbox
                            checked={selectedToDelete.has(p.id)}
                            onCheckedChange={() => toggleDelete(p.id)}
                          />
                          <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{p.sku || "—"}</span>
                          <span className="truncate flex-1">{p.optimized_title || p.original_title || "Sem título"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{p.product_type}</Badge>
                          {pi === 0 && <Badge variant="secondary" className="text-[10px]">Original</Badge>}
                        </div>
                      ))}
                    </div>

                    {/* Quick select: keep first, delete rest */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-6"
                      onClick={() => {
                        setSelectedToDelete(prev => {
                          const next = new Set(prev);
                          group.products.slice(1).forEach(p => next.add(p.id));
                          next.delete(group.products[0].id); // keep first
                          return next;
                        });
                      }}
                    >
                      <Merge className="w-3 h-3 mr-1" /> Manter primeiro, selecionar restantes
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {selectedToDelete.size > 0 && (
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              Eliminar {selectedToDelete.size} duplicado(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
