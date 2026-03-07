import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, ExternalLink, RotateCcw, History, Send, ArrowUpRight, Shuffle, AlertTriangle, Brain, BookOpen, Globe, Database, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { Product } from "@/hooks/useProducts";
import { useUpdateProduct } from "@/hooks/useUpdateProduct";
import { useUpdateProductStatus } from "@/hooks/useProducts";
import { useProductVersions, useRestoreVersion, type ProductVersion } from "@/hooks/useProductVersions";
import { usePublishWooCommerce } from "@/hooks/usePublishWooCommerce";
import { useProductOptimizationLogs } from "@/hooks/useOptimizationLogs";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

interface Props {
  product: Product | null;
  onClose: () => void;
}

export function ProductDetailModal({ product, onClose }: Props) {
  const updateProduct = useUpdateProduct();
  const updateStatus = useUpdateProductStatus();
  const publishWoo = usePublishWooCommerce();
  const { data: versions } = useProductVersions(product?.id ?? null);
  const { data: optLogs, isLoading: logsLoading } = useProductOptimizationLogs(product?.id ?? null);
  const restoreVersion = useRestoreVersion();

  // Editable fields state
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (product) {
      setEditData({
        optimized_title: product.optimized_title ?? "",
        optimized_description: product.optimized_description ?? "",
        optimized_short_description: product.optimized_short_description ?? "",
        meta_title: product.meta_title ?? "",
        meta_description: product.meta_description ?? "",
        seo_slug: product.seo_slug ?? "",
        tags: (product.tags ?? []).join(", "),
        optimized_price: product.optimized_price ?? product.original_price ?? "",
        category: product.category ?? "",
      });
      setHasChanges(false);
    }
  }, [product]);

  if (!product) return null;

  const handleFieldChange = (key: string, value: string) => {
    setEditData((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const updates: Record<string, any> = {
      optimized_title: editData.optimized_title || null,
      optimized_description: editData.optimized_description || null,
      optimized_short_description: editData.optimized_short_description || null,
      meta_title: editData.meta_title || null,
      meta_description: editData.meta_description || null,
      seo_slug: editData.seo_slug || null,
      tags: editData.tags ? editData.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : null,
      optimized_price: editData.optimized_price ? Number(editData.optimized_price) : null,
      category: editData.category || null,
    };

    // Collect image alt texts from edit fields
    if (product.image_urls && product.image_urls.length > 0) {
      const altTexts = product.image_urls.map((url, i) => ({
        url,
        alt_text: editData[`image_alt_${i}`] ?? "",
      })).filter((a) => a.alt_text);
      if (altTexts.length > 0) {
        updates.image_alt_texts = altTexts;
      }
    }

    updateProduct.mutate({ id: product.id, updates });
    setHasChanges(false);
  };

  const handleRestore = (version: ProductVersion) => {
    if (confirm(`Restaurar versão ${version.version_number}? Os dados atuais serão substituídos.`)) {
      restoreVersion.mutate({ productId: product.id, version });
      onClose();
    }
  };

  const faq = Array.isArray(product.faq) ? product.faq : [];
  const upsells = Array.isArray((product as any).upsell_skus) ? (product as any).upsell_skus : [];
  const crosssells = Array.isArray((product as any).crosssell_skus) ? (product as any).crosssell_skus : [];

  return (
    <Dialog open={!!product} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{product.sku ?? "—"}</span>
            <span className="truncate">{product.original_title ?? "Sem título"}</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="textos" className="mt-2">
          <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
            <TabsTrigger value="textos">Textos</TabsTrigger>
            <TabsTrigger value="imagens">Imagens</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="relacionados">
              <Shuffle className="w-3.5 h-3.5 mr-1" /> Upsells / Cross-sells
            </TabsTrigger>
            <TabsTrigger value="historico">
              <History className="w-3.5 h-3.5 mr-1" /> Versões
            </TabsTrigger>
            <TabsTrigger value="ai-log">
              <Brain className="w-3.5 h-3.5 mr-1" /> Log IA
            </TabsTrigger>
            <TabsTrigger value="brutos">Dados Brutos</TabsTrigger>
          </TabsList>

          {/* TEXTOS TAB */}
          <TabsContent value="textos" className="space-y-6 mt-4">
            <EditableComparison
              label="Título"
              original={product.original_title ?? "—"}
              value={editData.optimized_title}
              onChange={(v) => handleFieldChange("optimized_title", v)}
            />
            <EditableComparison
              label="Descrição Curta"
              original={product.short_description ?? "—"}
              value={editData.optimized_short_description}
              onChange={(v) => handleFieldChange("optimized_short_description", v)}
              multiline
            />
            <EditableComparison
              label="Descrição"
              original={product.original_description ?? "—"}
              value={editData.optimized_description}
              onChange={(v) => handleFieldChange("optimized_description", v)}
              multiline
              large
            />
          </TabsContent>

          {/* SEO TAB */}
          <TabsContent value="seo" className="space-y-6 mt-4">
            <EditableComparison
              label="Meta Title"
              original="—"
              value={editData.meta_title}
              onChange={(v) => handleFieldChange("meta_title", v)}
            />
            <EditableComparison
              label="Meta Description"
              original="—"
              value={editData.meta_description}
              onChange={(v) => handleFieldChange("meta_description", v)}
              multiline
            />
            <EditableComparison
              label="SEO Slug"
              original="—"
              value={editData.seo_slug}
              onChange={(v) => handleFieldChange("seo_slug", v)}
            />
            <div>
              <h4 className="text-sm font-medium mb-2">Tags</h4>
              <Input
                value={editData.tags}
                onChange={(e) => handleFieldChange("tags", e.target.value)}
                placeholder="tag1, tag2, tag3"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">Separadas por vírgula</p>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Preço Otimizado</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Original</p>
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">{product.original_price ?? "—"}€</div>
                </div>
                <div>
                  <p className="text-xs text-primary mb-1">Otimizado</p>
                  <Input
                    type="number"
                    value={editData.optimized_price}
                    onChange={(e) => handleFieldChange("optimized_price", e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* FAQ TAB */}
          <TabsContent value="faq" className="mt-4">
            {faq.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhuma FAQ gerada para este produto.</p>
                <p className="text-xs mt-1">Otimize com o campo "FAQ" selecionado.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{faq.length} pergunta(s) frequente(s)</p>
                {faq.map((item: { question: string; answer: string }, idx: number) => (
                  <Card key={idx}>
                    <CardContent className="p-4">
                      <h4 className="font-medium text-sm mb-2">❓ {item.question}</h4>
                      <p className="text-sm text-muted-foreground">{item.answer}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* IMAGES TAB */}
          <TabsContent value="imagens" className="mt-4">
            {product.image_urls && product.image_urls.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{product.image_urls.length} imagem(ns)</p>
                <div className="grid grid-cols-2 gap-4">
                  {product.image_urls.map((url, i) => {
                    const altTexts = Array.isArray((product as any).image_alt_texts) ? (product as any).image_alt_texts : [];
                    const altEntry = altTexts.find((a: any) => a.url === url);
                    const altText = altEntry?.alt_text || "";
                    return (
                      <div key={i} className="space-y-2">
                        <img src={url} alt={altText || `Produto ${i + 1}`} className="rounded-lg border object-cover aspect-square w-full" />
                        <div>
                          <label className="text-xs text-muted-foreground">Alt Text (SEO)</label>
                          <Input
                            value={editData[`image_alt_${i}`] ?? altText}
                            onChange={(e) => handleFieldChange(`image_alt_${i}`, e.target.value)}
                            placeholder="Texto alternativo para SEO..."
                            className="text-xs h-8 mt-1"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhuma imagem carregada para este produto.</p>
              </div>
            )}
          </TabsContent>

          {/* UPSELLS / CROSS-SELLS TAB */}
          <TabsContent value="relacionados" className="mt-4 space-y-6">
            {upsells.length === 0 && crosssells.length === 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-sm text-yellow-700 dark:text-yellow-400">
                  {product.status === "optimized" || product.status === "published"
                    ? "A otimização não encontrou produtos válidos no catálogo para sugerir como upsell ou cross-sell. Verifique se existem produtos suficientes com SKUs definidos."
                    : "Nenhuma sugestão disponível. Otimize o produto com os campos \"Upsells\" e \"Cross-sells\" selecionados."}
                </AlertDescription>
              </Alert>
            )}
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <ArrowUpRight className="w-4 h-4 text-primary" /> Upsells
                <span className="text-xs text-muted-foreground font-normal">(produtos superiores sugeridos)</span>
              </h4>
              {upsells.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum upsell sugerido.</p>
              ) : (
                <div className="space-y-2">
                  {upsells.map((item: { sku: string; title: string }, idx: number) => (
                    <div key={idx} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                      <Badge variant="outline" className="font-mono text-xs shrink-0">{item.sku}</Badge>
                      <span className="text-sm">{item.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Shuffle className="w-4 h-4 text-primary" /> Cross-sells
                <span className="text-xs text-muted-foreground font-normal">(produtos complementares sugeridos)</span>
              </h4>
              {crosssells.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cross-sell sugerido.</p>
              ) : (
                <div className="space-y-2">
                  {crosssells.map((item: { sku: string; title: string }, idx: number) => (
                    <div key={idx} className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                      <Badge variant="outline" className="font-mono text-xs shrink-0">{item.sku}</Badge>
                      <span className="text-sm">{item.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* VERSION HISTORY TAB */}
          <TabsContent value="historico" className="mt-4">
            {!versions || versions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Nenhuma versão anterior guardada.</p>
                <p className="text-xs mt-1">As versões são guardadas automaticamente antes de cada otimização.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {versions.length} versão(ões) anteriore(s) disponíve(is) (máx. 3)
                </p>
                {versions.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            v{v.version_number}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(v.created_at), "dd MMM yyyy HH:mm", { locale: pt })}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(v)}
                          disabled={restoreVersion.isPending}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restaurar
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Título:</span>
                          <p className="truncate">{v.optimized_title ?? "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Slug:</span>
                          <p className="truncate">{v.seo_slug ?? "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Desc. Curta:</span>
                          <p className="truncate">{v.optimized_short_description ?? "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Preço:</span>
                          <p>{v.optimized_price ?? "—"}€</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* AI LOG TAB */}
          <TabsContent value="ai-log" className="mt-4 space-y-4">
            {logsLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !optLogs || optLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Nenhum log de otimização disponível.</p>
                <p className="text-xs mt-1">Os logs são guardados automaticamente a cada otimização.</p>
              </div>
            ) : (
              optLogs.map((log) => (
                <Card key={log.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono text-xs">{log.model}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), "dd MMM yyyy HH:mm", { locale: pt })}
                      </span>
                    </div>

                    {/* Token usage */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-2 rounded-lg bg-muted/50">
                        <p className="text-lg font-bold text-primary">{log.prompt_tokens.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Prompt tokens</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-muted/50">
                        <p className="text-lg font-bold text-primary">{log.completion_tokens.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Completion tokens</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-muted/50">
                        <p className="text-lg font-bold text-primary">{log.total_tokens.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Total tokens</p>
                      </div>
                    </div>

                    {/* Sources used */}
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fontes de contexto</h5>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={log.had_knowledge ? "default" : "secondary"} className="text-xs">
                          <BookOpen className="w-3 h-3 mr-1" /> Conhecimento {log.had_knowledge ? "✓" : "✗"}
                        </Badge>
                        <Badge variant={log.had_supplier ? "default" : "secondary"} className="text-xs">
                          <Globe className="w-3 h-3 mr-1" /> Fornecedor {log.had_supplier ? "✓" : "✗"}
                        </Badge>
                        <Badge variant={log.had_catalog ? "default" : "secondary"} className="text-xs">
                          <Database className="w-3 h-3 mr-1" /> Catálogo {log.had_catalog ? "✓" : "✗"}
                        </Badge>
                      </div>
                    </div>

                    {/* Knowledge sources detail */}
                    {Array.isArray(log.knowledge_sources) && log.knowledge_sources.length > 0 && (
                      <div>
                        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ficheiros de conhecimento utilizados</h5>
                        <div className="space-y-1">
                          {log.knowledge_sources.map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30">
                              <span>{s.source}</span>
                              <Badge variant="outline" className="text-[10px]">{s.chunks} chunks</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Supplier URL */}
                    {log.supplier_url && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Fornecedor: </span>
                        <a href={log.supplier_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                          {log.supplier_name || "Link"} <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {/* Fields */}
                    <div className="flex flex-wrap gap-1">
                      {log.fields_optimized.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* RAW DATA TAB */}
          <TabsContent value="brutos" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-[400px] overflow-y-auto">
                  {JSON.stringify(product, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t gap-2 flex-wrap">
          <div>
            {hasChanges && (
              <Button size="sm" onClick={handleSave} disabled={updateProduct.isPending}>
                Guardar Alterações
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => { updateStatus.mutate({ ids: [product.id], status: "error" }); onClose(); }}>
              Rejeitar
            </Button>
            <Button size="sm" onClick={() => { 
              if (hasChanges) handleSave();
              updateStatus.mutate({ ids: [product.id], status: "optimized" }); 
              onClose(); 
            }}>
              <Check className="w-4 h-4 mr-1" /> Aprovar
            </Button>
            <Button size="sm" variant="outline" onClick={() => { 
              publishWoo.mutate([product.id]); 
              onClose(); 
            }} disabled={publishWoo.isPending}>
              <Send className="w-4 h-4 mr-1" /> Publicar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditableComparison({
  label,
  original,
  value,
  onChange,
  multiline = false,
  large = false,
}: {
  label: string;
  original: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  large?: boolean;
}) {
  return (
    <div className="border border-border/50 rounded-lg p-4">
      <h4 className="text-sm font-semibold mb-3">{label}</h4>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Original</p>
          <div className={cn(
            "p-3 rounded-lg bg-muted/50 text-sm whitespace-pre-wrap",
            large && "max-h-[200px] overflow-y-auto"
          )}>
            {original}
          </div>
        </div>
        <div>
          <p className="text-xs text-primary mb-1">Otimizado</p>
          {multiline ? (
            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className={cn("text-sm", large ? "min-h-[200px]" : "min-h-[80px]")}
            />
          ) : (
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="text-sm"
            />
          )}
        </div>
      </div>
    </div>
  );
}
