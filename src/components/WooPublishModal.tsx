import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Send, Loader2 } from "lucide-react";
import { WOO_PUBLISH_GROUPS, ALL_WOO_FIELD_KEYS, DEFAULT_WOO_FIELDS, SETTING_KEY_WOO_PUBLISH_FIELDS } from "@/lib/wooPublishFields";
import { useSettings } from "@/hooks/useSettings";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (fields: string[]) => void;
  productCount: number;
  isPending: boolean;
}

export function WooPublishModal({ open, onClose, onConfirm, productCount, isPending }: Props) {
  const { data: settings } = useSettings();
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(DEFAULT_WOO_FIELDS));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Load defaults from settings
  useEffect(() => {
    if (settings) {
      try {
        const saved = JSON.parse(settings[SETTING_KEY_WOO_PUBLISH_FIELDS] ?? "null");
        if (Array.isArray(saved)) {
          setSelectedFields(new Set(saved));
        }
      } catch { /* use defaults */ }
    }
  }, [settings]);

  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (groupKey: string) => {
    const group = WOO_PUBLISH_GROUPS.find(g => g.key === groupKey);
    if (!group) return;
    const groupFieldKeys = group.fields.map(f => f.key);
    const allSelected = groupFieldKeys.every(k => selectedFields.has(k));
    setSelectedFields(prev => {
      const next = new Set(prev);
      groupFieldKeys.forEach(k => {
        if (allSelected) next.delete(k);
        else next.add(k);
      });
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => !isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Publicar {productCount} produto(s) no WooCommerce</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">Escolha os campos a enviar. Apenas os campos selecionados serão atualizados no WooCommerce.</p>

        <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
          {WOO_PUBLISH_GROUPS.map(group => {
            const groupFieldKeys = group.fields.map(f => f.key);
            const selectedCount = groupFieldKeys.filter(k => selectedFields.has(k)).length;
            const allSelected = selectedCount === groupFieldKeys.length;
            const someSelected = selectedCount > 0 && !allSelected;
            const isExpanded = expandedGroups.has(group.key);

            return (
              <Collapsible key={group.key} open={isExpanded} onOpenChange={() => toggleExpand(group.key)}>
                <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => toggleGroup(group.key)}
                  />
                  <CollapsibleTrigger className="flex items-center gap-1.5 flex-1 text-sm font-medium">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>{group.icon} {group.label}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{selectedCount}/{group.fields.length}</span>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <div className="ml-8 space-y-1 pb-1">
                    {group.fields.map(field => (
                      <label key={field.key} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/30 cursor-pointer text-sm">
                        <Checkbox
                          checked={selectedFields.has(field.key)}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                        {field.label}
                      </label>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(Array.from(selectedFields))}
            disabled={isPending || selectedFields.size === 0}
          >
            {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            Publicar ({selectedFields.size} campos)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
