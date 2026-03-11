import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronDown, ChevronRight, Send, Loader2, TrendingUp, Percent, CalendarIcon, Clock, AlertTriangle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { WOO_PUBLISH_GROUPS, ALL_WOO_FIELD_KEYS, DEFAULT_WOO_FIELDS, SETTING_KEY_WOO_PUBLISH_FIELDS } from "@/lib/wooPublishFields";
import { useSettings } from "@/hooks/useSettings";
import { WooSiteSelector } from "@/components/WooSiteSelector";
import type { Product } from "@/hooks/useProducts";

export interface PricingOptions {
  markupPercent: number;
  discountPercent: number;
}

export interface SkuPrefixOptions {
  prefix: string;
  onlyIfMissing: boolean;
}

interface ValidationItem {
  label: string;
  passed: boolean;
  detail: string;
}

function validateProducts(products: Product[]): { items: ValidationItem[]; passRate: number } {
  const items: ValidationItem[] = [];
  const withTitle = products.filter(p => (p.optimized_title ?? '').length > 5);
  items.push({ label: "Título otimizado", passed: withTitle.length === products.length, detail: `${withTitle.length}/${products.length}` });
  
  const withDesc = products.filter(p => (p.optimized_description ?? '').length > 20);
  items.push({ label: "Descrição otimizada", passed: withDesc.length === products.length, detail: `${withDesc.length}/${products.length}` });
  
  const withPrice = products.filter(p => p.optimized_price != null || p.original_price != null);
  items.push({ label: "Preço definido", passed: withPrice.length === products.length, detail: `${withPrice.length}/${products.length}` });
  
  const withImages = products.filter(p => (p.image_urls ?? []).length > 0);
  items.push({ label: "Pelo menos 1 imagem", passed: withImages.length === products.length, detail: `${withImages.length}/${products.length}` });
  
  const withSku = products.filter(p => (p.sku ?? '').length > 0);
  items.push({ label: "SKU definido", passed: withSku.length === products.length, detail: `${withSku.length}/${products.length}` });

  const passRate = Math.round((items.filter(i => i.passed).length / items.length) * 100);
  return { items, passRate };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (fields: string[], pricing?: PricingOptions, scheduledFor?: string, skuPrefix?: SkuPrefixOptions) => void;
  productCount: number;
  variableParentCount?: number;
  autoIncludedVariationsCount?: number;
  isPending: boolean;
  products?: Product[];
}

export function WooPublishModal({ open, onClose, onConfirm, productCount, variableParentCount = 0, autoIncludedVariationsCount = 0, isPending, products = [] }: Props) {
  const { data: settings } = useSettings();
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(DEFAULT_WOO_FIELDS));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [markupPercent, setMarkupPercent] = useState<string>("");
  const [discountPercent, setDiscountPercent] = useState<string>("");
  const [skuPrefix, setSkuPrefix] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState("09:00");

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

  const hasPriceSelected = selectedFields.has("price") || selectedFields.has("sale_price");
  const markup = parseFloat(markupPercent) || 0;
  const discount = parseFloat(discountPercent) || 0;
  const hasPricingAdjustments = markup > 0 || discount > 0;

  const handleConfirm = () => {
    const pricing = hasPricingAdjustments ? { markupPercent: markup, discountPercent: discount } : undefined;
    let scheduledFor: string | undefined;
    if (scheduleEnabled && scheduleDate) {
      const [hours, minutes] = scheduleTime.split(":").map(Number);
      const dt = new Date(scheduleDate);
      dt.setHours(hours, minutes, 0, 0);
      scheduledFor = dt.toISOString();
    }
    const skuPrefixOpt = skuPrefix.trim() ? { prefix: skuPrefix.trim().toUpperCase(), onlyIfMissing: true } : undefined;
    onConfirm(Array.from(selectedFields), pricing, scheduledFor, skuPrefixOpt);
  };

  // Example price calculation for preview
  const examplePrice = 100;
  const adjustedRegular = examplePrice * (1 + markup / 100);
  const adjustedSale = discount > 0 ? adjustedRegular * (1 - discount / 100) : null;

  return (
    <Dialog open={open} onOpenChange={() => !isPending && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Publicar {productCount} produto(s) no WooCommerce</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <WooSiteSelector setGlobal className="h-8 text-xs flex-1" />
        </div>

        <p className="text-xs text-muted-foreground">Escolha os campos a enviar. O processamento é feito em background — pode fechar o browser.</p>

        {/* Pre-publish validation checklist */}
        {products.length > 0 && (() => {
          const { items, passRate } = validateProducts(products);
          const hasIssues = passRate < 100;
          return (
            <div className={cn("border rounded-md p-3 space-y-2", hasIssues ? "border-yellow-500/50 bg-yellow-500/5" : "border-green-500/50 bg-green-500/5")}>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {hasIssues ? <AlertTriangle className="w-4 h-4 text-yellow-500" /> : <Check className="w-4 h-4 text-green-500" />}
                Validação pré-publicação ({passRate}%)
              </div>
              <div className="space-y-1">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {item.passed ? <Check className="w-3 h-3 text-green-500 shrink-0" /> : <X className="w-3 h-3 text-yellow-500 shrink-0" />}
                    <span className={cn(!item.passed && "text-yellow-600 dark:text-yellow-400")}>{item.label}</span>
                    <span className="ml-auto text-muted-foreground">{item.detail}</span>
                  </div>
                ))}
              </div>
              {hasIssues && (
                <p className="text-[10px] text-yellow-600 dark:text-yellow-400">⚠️ Produtos com campos em falta serão publicados, mas podem ter informação incompleta.</p>
              )}
            </div>
          );
        })()}
        {variableParentCount > 0 && (
          <div className="text-xs bg-primary/10 text-primary border border-primary/20 rounded-md px-3 py-2 space-y-0.5">
            <p className="font-medium">🔗 {variableParentCount} produto(s) variável(eis) detetado(s)</p>
            {autoIncludedVariationsCount > 0 && (
              <p>+ {autoIncludedVariationsCount} variação(ões) incluída(s) automaticamente</p>
            )}
            <p className="text-muted-foreground">O produto pai será criado como "variable" e as variações como children na API do WooCommerce.</p>
          </div>
        )}

        <div className="space-y-1 max-h-[250px] overflow-y-auto pr-1">
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

        {/* Pricing adjustments */}
        {hasPriceSelected && (
          <div className="border border-border rounded-md p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <TrendingUp className="w-4 h-4 text-primary" />
              Ajuste de Preços (opcional)
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Markup no regular_price</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="999"
                    step="0.1"
                    placeholder="0"
                    value={markupPercent}
                    onChange={e => setMarkupPercent(e.target.value)}
                    className="pr-7 h-8 text-sm"
                  />
                  <Percent className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Desconto no sale_price</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    placeholder="0"
                    value={discountPercent}
                    onChange={e => setDiscountPercent(e.target.value)}
                    className="pr-7 h-8 text-sm"
                  />
                  <Percent className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </div>

            {hasPricingAdjustments && (
              <div className="text-xs text-muted-foreground bg-background rounded px-2 py-1.5 border border-border space-y-0.5">
                <p className="font-medium text-foreground">Exemplo (preço base: {examplePrice}€):</p>
                <p>Regular: {examplePrice}€ + {markup}% = <span className="font-semibold text-foreground">{adjustedRegular.toFixed(2)}€</span></p>
                {adjustedSale !== null && (
                  <p>Promocional: {adjustedRegular.toFixed(2)}€ - {discount}% = <span className="font-semibold text-success">{adjustedSale.toFixed(2)}€</span></p>
                )}
              </div>
            )}
          </div>
        )}

        {/* SKU Prefix */}
        <div className="border border-border rounded-md p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            🏷️ Prefixo SKU (opcional)
          </div>
          <p className="text-[11px] text-muted-foreground">Adiciona um prefixo aos SKUs que ainda não o tenham. Ex: se colocar "UD", o SKU "12345" ficará "UD12345".</p>
          <Input
            placeholder="Ex: UD, PJ, LC..."
            value={skuPrefix}
            onChange={e => setSkuPrefix(e.target.value.toUpperCase())}
            className="h-8 text-sm w-32"
          />
        </div>

        {/* Schedule */}
        <div className="border border-border rounded-md p-3 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Clock className="w-4 h-4 text-primary" />
              Agendar publicação
            </div>
            <Checkbox
              checked={scheduleEnabled}
              onCheckedChange={(v) => setScheduleEnabled(!!v)}
            />
          </div>
          {scheduleEnabled && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "flex-1 justify-start text-left font-normal h-8 text-sm",
                      !scheduleDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                    {scheduleDate ? format(scheduleDate, "dd/MM/yyyy") : "Escolher data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={scheduleDate}
                    onSelect={setScheduleDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-24 h-8 text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isPending || selectedFields.size === 0 || (scheduleEnabled && !scheduleDate)}
          >
            {isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            {scheduleEnabled ? "Agendar" : "Publicar"} ({selectedFields.size} campos)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
