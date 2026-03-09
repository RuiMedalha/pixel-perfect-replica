import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GitBranch, Eye, Save, Pencil, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product } from "@/hooks/useProducts";

// ── Inference logic (mirrors edge function) ──

const SIZE_PATTERN = /\b(\d+[\.,]?\d*)\s*(cm|mm|m|ml|cl|l|lt|kg|g|oz|"|''|pol)\b/i;
const SIZE_WORDS = new Set(["pequeno","medio","médio","grande","extra","xs","s","m","l","xl","xxl","xxxl","2xl","3xl","4xl","pp","p","g","gg","xg","xxg"]);
const COLOR_WORDS = new Set([
  "preto","branco","azul","vermelho","verde","amarelo","laranja","roxo","rosa",
  "cinza","cinzento","castanho","dourado","prateado","violeta","bege","coral",
  "turquesa","creme","bordeaux","borgonha","fucsia","magenta","caqui","salmon",
  "salmão","marfim","champanhe","nude","terracota","índigo","indigo","lima",
  "black","white","blue","red","green","yellow","orange","purple","pink",
  "gray","grey","brown","gold","silver","beige","navy","teal","olive",
  "inox","aço","cromado","natural","transparente","multicolor"
]);

// Color name to CSS color mapping
const COLOR_MAP: Record<string, string> = {
  preto: "#1a1a1a", black: "#1a1a1a",
  branco: "#ffffff", white: "#ffffff",
  azul: "#2563eb", blue: "#2563eb",
  vermelho: "#dc2626", red: "#dc2626",
  verde: "#16a34a", green: "#16a34a",
  amarelo: "#eab308", yellow: "#eab308",
  laranja: "#ea580c", orange: "#ea580c",
  roxo: "#9333ea", purple: "#9333ea",
  rosa: "#ec4899", pink: "#ec4899",
  cinza: "#6b7280", cinzento: "#6b7280", gray: "#6b7280", grey: "#6b7280",
  castanho: "#92400e", brown: "#92400e",
  dourado: "#d97706", gold: "#d97706",
  prateado: "#9ca3af", silver: "#9ca3af",
  violeta: "#7c3aed",
  bege: "#d4b896", beige: "#d4b896",
  coral: "#f97316",
  turquesa: "#14b8a6", teal: "#14b8a6",
  creme: "#fef3c7",
  bordeaux: "#7f1d1d", borgonha: "#7f1d1d",
  fucsia: "#d946ef", magenta: "#d946ef",
  caqui: "#a3a385",
  salmon: "#fb923c", salmão: "#fb923c",
  marfim: "#fffbeb",
  champanhe: "#f5e6d3",
  nude: "#e8d4c4",
  terracota: "#c2410c",
  índigo: "#4f46e5", indigo: "#4f46e5",
  lima: "#84cc16",
  navy: "#1e3a5f",
  olive: "#65a30d",
  inox: "#a1a1aa", aço: "#71717a",
  cromado: "#d4d4d8",
  natural: "#d6b88a",
  transparente: "transparent",
  multicolor: "linear-gradient(135deg, #ef4444, #eab308, #22c55e, #3b82f6, #a855f7)",
};

function getColorFromValue(value: string): string | null {
  const lower = value.toLowerCase().trim();
  // Direct match
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];
  // Partial match
  for (const [name, color] of Object.entries(COLOR_MAP)) {
    if (lower.includes(name)) return color;
  }
  return null;
}

const TECHNICAL_NAMES = new Set(["marca","brand","ean","ean13","gtin","barcode","modelo","model"]);

function inferAttrNameFromOption(option: string): string {
  const lower = option.toLowerCase().trim();
  if (SIZE_PATTERN.test(lower)) return "Tamanho";
  const words = lower.split(/[\s\-\/]+/).filter(Boolean);
  if (words.length <= 2 && words.some(w => SIZE_WORDS.has(w))) return "Tamanho";
  if (words.some(w => COLOR_WORDS.has(w))) return "Cor";
  if (/^\d+[\.,]?\d*$/.test(lower)) return "Tamanho";
  return "Opção";
}

function extractTitleSuffix(parentTitle: string, childTitle: string): string {
  const p = parentTitle.toLowerCase().trim();
  const c = childTitle.toLowerCase().trim();
  let i = 0;
  while (i < p.length && i < c.length && p[i] === c[i]) i++;
  const suffix = childTitle.trim().substring(i).trim();
  return suffix || childTitle.trim();
}

function tokenizeTitle(s: string): string[] {
  return (s || "")
    .replace(/[()\[\]{}]/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.replace(/[^\p{L}\p{N}\-\.]+/gu, ""))
    .filter(Boolean);
}

function inferVariationOption(parentTitle: string, childTitle: string): string | null {
  const rawChild = (childTitle || "").trim();
  const rawParent = (parentTitle || "").trim();
  if (!rawChild) return null;

  const suffix = extractTitleSuffix(rawParent, rawChild);
  if (suffix && suffix !== rawChild && suffix.length <= 80) {
    const cleaned = suffix.replace(/^[-–—:,\s]+/, "").trim();
    if (cleaned && cleaned.length <= 80) return cleaned;
  }

  const pTokens = new Set(tokenizeTitle(rawParent).map(t => t.toLowerCase()));
  const remaining = tokenizeTitle(rawChild).filter(t => !pTokens.has(t.toLowerCase()));
  const candidate = remaining.join(" ").trim();
  if (candidate && candidate.length <= 80) return candidate;

  return null;
}

interface InferredAttr {
  childId: string;
  attrName: string;
  attrValue: string;
  source: "db" | "inferred";
}

interface Props {
  product: Product;
  allProducts: Product[];
  updateProduct: any;
}

export function VariationsPanel({ product, allProducts, updateProduct }: Props) {
  const children = useMemo(
    () => allProducts.filter(p => p.parent_product_id === product.id),
    [allProducts, product.id]
  );

  const parentTitle = product.optimized_title || product.original_title || "";

  // Compute inferred attributes per child
  const inferredAttrs = useMemo(() => {
    const result: InferredAttr[] = [];

    for (const child of children) {
      const attrs = Array.isArray(child.attributes) ? child.attributes as any[] : [];
      const variationAttrs = attrs.filter((a: any) => a.variation !== false && !TECHNICAL_NAMES.has((a.name || "").toLowerCase().trim()));

      if (variationAttrs.length > 0) {
        // Use DB attributes
        for (const attr of variationAttrs) {
          const val = attr.value || (attr.values || [])[0] || "";
          if (val) {
            result.push({ childId: child.id, attrName: attr.name, attrValue: val, source: "db" });
          }
        }
      } else {
        // Infer from title
        const childTitle = child.optimized_title || child.original_title || "";
        const option = inferVariationOption(parentTitle, childTitle);
        if (option) {
          const name = inferAttrNameFromOption(option);
          result.push({ childId: child.id, attrName: name, attrValue: option, source: "inferred" });
        }
      }
    }

    return result;
  }, [children, parentTitle]);

  // Collect technical (non-variation) attributes
  const techAttrs = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const collect = (attrs: any[]) => {
      if (!Array.isArray(attrs)) return;
      for (const a of attrs) {
        const n = (a.name || "").trim();
        if (!n) continue;
        const isTech = a.variation === false || TECHNICAL_NAMES.has(n.toLowerCase());
        if (!isTech) continue;
        if (!map.has(n)) map.set(n, new Set());
        if (a.value) map.get(n)!.add(a.value);
        if (Array.isArray(a.values)) a.values.forEach((v: string) => map.get(n)!.add(v));
      }
    };
    collect(product.attributes as any[] || []);
    children.forEach(c => collect(c.attributes as any[] || []));
    return map;
  }, [product, children]);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editedAttrs, setEditedAttrs] = useState<Record<string, { name: string; value: string }>>({});
  const [editedAttrName, setEditedAttrName] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    const initial: Record<string, { name: string; value: string }> = {};
    for (const ia of inferredAttrs) {
      initial[ia.childId] = { name: ia.attrName, value: ia.attrValue };
    }
    // Also set any children without inferred attrs
    for (const child of children) {
      if (!initial[child.id]) {
        initial[child.id] = { name: "", value: "" };
      }
    }
    // Global attr name from first inferred
    setEditedAttrName(inferredAttrs[0]?.attrName || "Cor");
    setEditedAttrs(initial);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const child of children) {
        const edited = editedAttrs[child.id];
        if (!edited || !edited.value) continue;

        const existingAttrs = Array.isArray(child.attributes) ? [...(child.attributes as any[])] : [];
        // Filter out old variation attrs (non-technical)
        const techOnly = existingAttrs.filter((a: any) => a.variation === false || TECHNICAL_NAMES.has((a.name || "").toLowerCase().trim()));
        // Add the new variation attribute
        const newAttrs = [
          ...techOnly,
          { name: editedAttrName || edited.name, value: edited.value, variation: true },
        ];

        updateProduct.mutate({ id: child.id, updates: { attributes: newAttrs } });
      }

      // If parent was needs_review, upgrade to optimized
      if (product.status === "needs_review") {
        updateProduct.mutate({ id: product.id, updates: { status: "optimized" } });
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  // Grouped by attr name for display
  const attrGroups = useMemo(() => {
    const groups = new Map<string, Array<{ child: Product; value: string; source: "db" | "inferred" }>>();
    for (const ia of inferredAttrs) {
      if (!groups.has(ia.attrName)) groups.set(ia.attrName, []);
      const child = children.find(c => c.id === ia.childId);
      if (child) groups.get(ia.attrName)!.push({ child, value: ia.attrValue, source: ia.source });
    }
    return groups;
  }, [inferredAttrs, children]);

  const hasInferred = inferredAttrs.some(a => a.source === "inferred");
  const allAttrNames = [...new Set(inferredAttrs.map(a => a.attrName))];

  if (children.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Nenhuma variação associada a este produto.</p>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary">{children.length} variação(ões)</Badge>
          {allAttrNames.map(name => {
            const values = [...new Set(inferredAttrs.filter(a => a.attrName === name).map(a => a.attrValue))];
            return (
              <span key={name} className="text-sm text-muted-foreground">
                <strong>{name}</strong>: {values.join(", ") || "—"}
              </span>
            );
          })}
        </div>
        {!editing ? (
          <Button size="sm" variant="outline" onClick={startEditing}>
            <Pencil className="w-3.5 h-3.5 mr-1" /> Editar Atributos
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-3.5 h-3.5 mr-1" /> Guardar
            </Button>
          </div>
        )}
      </div>

      {/* Warning if inferred */}
      {hasInferred && !editing && (
        <Alert className={cn(
          "border-amber-500/50 bg-amber-500/10",
          product.status === "needs_review" && "border-amber-600 bg-amber-500/20"
        )}>
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-700 dark:text-amber-400">
            {product.status === "needs_review" ? (
              <>
                <strong>Revisão necessária:</strong> A IA não conseguiu determinar os atributos de variação com confiança.
                Clique em "Editar Atributos" para corrigir e confirmar. O status passará a verde automaticamente.
              </>
            ) : (
              <>
                Atributos de variação <strong>inferidos automaticamente</strong> a partir dos títulos (não existem no Excel).
                Clique em "Editar Atributos" para corrigir antes de publicar.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Editing: global attr name selector */}
      {editing && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h4 className="text-sm font-semibold">Nome do Atributo de Variação</h4>
            <div className="flex items-center gap-3">
              <Select value={editedAttrName} onValueChange={setEditedAttrName}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cor">Cor</SelectItem>
                  <SelectItem value="Tamanho">Tamanho</SelectItem>
                  <SelectItem value="Material">Material</SelectItem>
                  <SelectItem value="Capacidade">Capacidade</SelectItem>
                  <SelectItem value="Voltagem">Voltagem</SelectItem>
                  <SelectItem value="Opção">Opção</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={editedAttrName}
                onChange={(e) => setEditedAttrName(e.target.value)}
                placeholder="Ou escreva um nome personalizado..."
                className="text-sm flex-1"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Technical attributes */}
      {techAttrs.size > 0 && (
        <div className="flex flex-wrap gap-3">
          {[...techAttrs.entries()].map(([name, values]) => (
            <div key={name} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">{name}:</span>
              {[...values].map((v, i) => (
                <Badge key={i} variant="outline" className="text-xs">{v}</Badge>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Variations table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">SKU</th>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">
                {editing ? editedAttrName || "Atributo" : allAttrNames[0] || "Atributo"}
              </th>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">Título</th>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">Preço</th>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">Imagem</th>
              <th className="text-left p-3 text-xs font-medium text-muted-foreground">Fonte</th>
            </tr>
          </thead>
          <tbody>
            {children.map(child => {
              const ia = inferredAttrs.find(a => a.childId === child.id);
              const edited = editedAttrs[child.id];
              const displayValue = editing ? (edited?.value || "") : (ia?.attrValue || "—");
              const source = ia?.source || "inferred";
              const hasImage = child.image_urls && child.image_urls.length > 0;

              return (
                <tr key={child.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{child.sku ?? "—"}</td>
                  <td className="p-3">
                    {editing ? (
                      <Input
                        value={edited?.value || ""}
                        onChange={(e) => setEditedAttrs(prev => ({
                          ...prev,
                          [child.id]: { ...prev[child.id], name: editedAttrName, value: e.target.value }
                        }))}
                        className="text-xs h-8 w-32"
                        placeholder="Valor..."
                      />
                    ) : (
                      <Badge
                        variant={source === "db" ? "default" : "secondary"}
                        className={cn("text-xs", source === "inferred" && "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400")}
                      >
                        {displayValue}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 max-w-[200px] truncate text-xs">
                    {child.optimized_title || child.original_title || "—"}
                  </td>
                  <td className="p-3 text-xs">
                    {child.optimized_price ?? child.original_price ?? "—"}€
                  </td>
                  <td className="p-3">
                    {hasImage ? (
                      <img
                        src={child.image_urls![0]}
                        alt=""
                        className="w-8 h-8 rounded object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={cn(
                      "text-[10px]",
                      source === "inferred" ? "border-amber-500/50 text-amber-600" : "text-green-600 border-green-500/50"
                    )}>
                      {source === "db" ? "Excel" : "Inferido"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* WooCommerce Preview */}
      <Card>
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4" /> Preview WooCommerce
          </h4>
          <div className="space-y-3">
            <p className="font-medium">{product.optimized_title || product.original_title}</p>
            {allAttrNames.map(name => {
              const values = [...new Set(inferredAttrs.filter(a => a.attrName === name).map(a => a.attrValue))];
              const isColor = name.toLowerCase() === "cor" || name.toLowerCase() === "color";
              return (
                <div key={name}>
                  <span className="text-xs text-muted-foreground font-medium mb-1.5 block">{name}</span>
                  {isColor ? (
                    <TooltipProvider>
                      <div className="flex flex-wrap gap-2">
                        {values.map((val, i) => {
                          const color = getColorFromValue(val);
                          const isTransparent = color === "transparent";
                          const isGradient = color?.startsWith("linear-gradient");
                          return (
                            <Tooltip key={i}>
                              <TooltipTrigger asChild>
                                <button
                                  className={cn(
                                    "w-7 h-7 rounded-full border-2 border-border shadow-sm transition-transform hover:scale-110",
                                    isTransparent && "bg-[repeating-conic-gradient(#d4d4d4_0%_25%,transparent_0%_50%)] bg-[length:8px_8px]"
                                  )}
                                  style={{
                                    background: color
                                      ? (isTransparent ? undefined : color)
                                      : `hsl(${(val.charCodeAt(0) * 37) % 360}, 60%, 55%)`,
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs">
                                {val}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </TooltipProvider>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {values.map((val, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{val}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {techAttrs.size > 0 && (
              <div className="border-t pt-2 mt-2 space-y-1">
                {[...techAttrs.entries()].map(([name, values]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{name}:</span>
                    <span className="text-xs">{[...values].join(", ")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
