import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Save, Eye, EyeOff, Loader2, Zap } from "lucide-react";
import { useSettings, useSaveSettings } from "@/hooks/useSettings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FieldPromptsSettings } from "@/components/FieldPromptsSettings";
import { DescriptionTemplateEditor } from "@/components/DescriptionTemplateEditor";
import { AI_MODELS } from "@/hooks/useOptimizeProducts";
import { WOO_PUBLISH_GROUPS, DEFAULT_WOO_FIELDS, SETTING_KEY_WOO_PUBLISH_FIELDS } from "@/lib/wooPublishFields";

interface Supplier {
  name: string;
  prefix: string;
  url: string;
  scrapingInstructions?: string;
}

const SETTING_KEYS = {
  openai_key: "openai_api_key",
  anthropic_key: "anthropic_api_key",
  gemini_key: "gemini_api_key",
  mistral_key: "mistral_api_key",
  default_model: "default_model",
  woo_url: "woocommerce_url",
  woo_key: "woocommerce_consumer_key",
  woo_secret: "woocommerce_consumer_secret",
  s3_key: "s3_access_key_id",
  s3_secret: "s3_secret_access_key",
  s3_bucket: "s3_bucket_name",
  s3_region: "s3_region",
  suppliers: "suppliers_json",
  optimization_prompt: "optimization_prompt",
  knowledge_urls: "knowledge_urls_json",
  whatsapp_webhook: "whatsapp_webhook_url",
};

const DEFAULT_OPTIMIZATION_PROMPT = `Optimiza o seguinte produto de e-commerce para SEO e conversão em português europeu.

Gera:
1. Um título otimizado (máx 70 chars, com keyword principal)
2. Uma descrição otimizada (200-400 chars, persuasiva, com benefícios e keywords)
3. Uma descrição curta (máx 160 chars, resumo conciso)
4. Meta title SEO (máx 60 chars)
5. Meta description SEO (máx 155 chars, com call-to-action)
6. SEO slug (url-friendly, lowercase, hífens)
7. Tags relevantes (3-6 palavras-chave)
8. Preço sugerido (pode manter o original ou ajustar ligeiramente)

IMPORTANTE: Mantém e melhora as características técnicas do produto (dimensões, peso, potência, etc.) na descrição otimizada. Não percas informação técnica.`;

const SettingsPage = () => {
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettings();
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([{ name: "", prefix: "", url: "" }]);
  const [knowledgeUrls, setKnowledgeUrls] = useState<string[]>([""]);
  const [testingSku, setTestingSku] = useState<Record<number, string>>({});
  const [testingLoading, setTestingLoading] = useState<Record<number, boolean>>({});
  const [testResult, setTestResult] = useState<{ index: number; preview: string; chars: number; url: string } | null>(null);
  const [wooPublishFields, setWooPublishFields] = useState<Set<string>>(new Set(DEFAULT_WOO_FIELDS));
  useEffect(() => {
    if (settings) {
      setForm(settings);
      try {
        const parsed = JSON.parse(settings[SETTING_KEYS.suppliers] ?? "[]");
        if (Array.isArray(parsed) && parsed.length > 0) setSuppliers(parsed);
      } catch { /* keep default */ }
      try {
        const parsed = JSON.parse(settings[SETTING_KEYS.knowledge_urls] ?? "[]");
        if (Array.isArray(parsed) && parsed.length > 0) setKnowledgeUrls(parsed);
      } catch { /* keep default */ }
      try {
        const parsed = JSON.parse(settings[SETTING_KEY_WOO_PUBLISH_FIELDS] ?? "null");
        if (Array.isArray(parsed)) setWooPublishFields(new Set(parsed));
      } catch { /* keep default */ }
    }
  }, [settings]);

  const toggleShow = (key: string) => setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  const updateField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const addSupplier = () => setSuppliers((prev) => [...prev, { name: "", prefix: "", url: "" }]);
  const removeSupplier = (index: number) => setSuppliers((prev) => prev.filter((_, i) => i !== index));

  const testSupplierScrape = async (index: number) => {
    const supplier = suppliers[index];
    const sku = testingSku[index];
    if (!supplier.url || !sku) {
      toast.error("Preencha o URL e um SKU de teste.");
      return;
    }
    const cleanSku = supplier.prefix && sku.toUpperCase().startsWith(supplier.prefix.toUpperCase())
      ? sku.substring(supplier.prefix.length)
      : sku;
    const testUrl = supplier.url.endsWith("=") || supplier.url.endsWith("/")
      ? `${supplier.url}${encodeURIComponent(cleanSku)}`
      : `${supplier.url}/${encodeURIComponent(cleanSku)}`;

    setTestingLoading((prev) => ({ ...prev, [index]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("scrape-supplier", {
        body: { url: testUrl, action: "scrape" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Falha no scrape");
      setTestResult({
        index,
        preview: data.preview || data.title || "Sem conteúdo",
        chars: data.chars || 0,
        url: testUrl,
      });
      toast.success(`Scrape OK — ${data.chars || 0} caracteres extraídos`);
    } catch (err: any) {
      toast.error(err.message || "Erro no teste de scrape");
    } finally {
      setTestingLoading((prev) => ({ ...prev, [index]: false }));
    }
  };

  const addKnowledgeUrl = () => setKnowledgeUrls((prev) => [...prev, ""]);
  const removeKnowledgeUrl = (index: number) => setKnowledgeUrls((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    const data = {
      ...form,
      [SETTING_KEYS.suppliers]: JSON.stringify(suppliers),
      [SETTING_KEYS.knowledge_urls]: JSON.stringify(knowledgeUrls.filter(Boolean)),
      [SETTING_KEY_WOO_PUBLISH_FIELDS]: JSON.stringify(Array.from(wooPublishFields)),
    };
    saveSettings.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="p-3 sm:p-6 lg:p-8 flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerir credenciais e preferências da aplicação.</p>
      </div>

      {/* Optimization Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">✍️ Prompt Global de Otimização</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Prompt Global (contexto base para todos os campos)</Label>
            <p className="text-xs text-muted-foreground">
              Este prompt é incluído como contexto base em todas as otimizações. Os prompts por campo abaixo adicionam regras específicas.
            </p>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={DEFAULT_OPTIMIZATION_PROMPT}
              value={form[SETTING_KEYS.optimization_prompt] ?? DEFAULT_OPTIMIZATION_PROMPT}
              onChange={(e) => updateField(SETTING_KEYS.optimization_prompt, e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Description Template */}
      <DescriptionTemplateEditor />

      {/* Per-field prompts */}
      <FieldPromptsSettings />

      {/* WhatsApp Notification */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📱 Notificações WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Webhook URL (Zapier, Make, n8n, etc.)</Label>
            <p className="text-xs text-muted-foreground">
              Cole o URL do webhook que recebe os dados e envia para o WhatsApp. O sistema envia uma notificação quando um job de otimização em background termina.
            </p>
            <Input
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              value={form[SETTING_KEYS.whatsapp_webhook] ?? ""}
              onChange={(e) => updateField(SETTING_KEYS.whatsapp_webhook, e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Knowledge URLs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🔗 URLs de Conhecimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            URLs de sites de fornecedores/marcas para pesquisa de informação adicional durante a otimização.
          </p>
          {knowledgeUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                placeholder="https://fornecedor.com/catalogo"
                value={url}
                className="flex-1"
                onChange={(e) => {
                  const updated = [...knowledgeUrls];
                  updated[index] = e.target.value;
                  setKnowledgeUrls(updated);
                }}
              />
              <Button variant="ghost" size="icon" onClick={() => removeKnowledgeUrl(index)} disabled={knowledgeUrls.length === 1}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addKnowledgeUrl}>
            <Plus className="w-4 h-4 mr-1" /> Adicionar URL
          </Button>
        </CardContent>
      </Card>

      {/* AI Models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🤖 Modelos de IA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            A otimização usa o Lovable AI Gateway por defeito (não requer API keys). Opcionalmente, pode guardar chaves para uso futuro ou integrações externas.
          </p>
          <SecretField label="API Key OpenAI" id="openai" settingKey={SETTING_KEYS.openai_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="API Key Anthropic (Claude)" id="anthropic" settingKey={SETTING_KEYS.anthropic_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="API Key Google Gemini" id="gemini" settingKey={SETTING_KEYS.gemini_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="API Key Mistral AI" id="mistral" settingKey={SETTING_KEYS.mistral_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <Separator />
          <div className="space-y-2">
            <Label>Modelo Padrão</Label>
            <Select value={form[SETTING_KEYS.default_model] ?? "gemini-3-flash"} onValueChange={(v) => updateField(SETTING_KEYS.default_model, v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AI_MODELS.map((m) => (
                  <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Modelo usado por defeito na otimização (pode ser alterado por otimização).</p>
          </div>
        </CardContent>
      </Card>

      {/* WooCommerce */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🛒 WooCommerce</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL do Site</Label>
            <Input placeholder="https://hotelequip.pt" value={form[SETTING_KEYS.woo_url] ?? ""} onChange={(e) => updateField(SETTING_KEYS.woo_url, e.target.value)} />
          </div>
          <SecretField label="Consumer Key" id="woo_key" settingKey={SETTING_KEYS.woo_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="Consumer Secret" id="woo_secret" settingKey={SETTING_KEYS.woo_secret} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
        </CardContent>
      </Card>

      {/* WooCommerce Publish Fields */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📋 Campos a Publicar no WooCommerce</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Defina os campos enviados por defeito ao publicar no WooCommerce. Pode ajustar caso a caso no momento da publicação.
          </p>
          {WOO_PUBLISH_GROUPS.map(group => {
            const groupFieldKeys = group.fields.map(f => f.key);
            const selectedCount = groupFieldKeys.filter(k => wooPublishFields.has(k)).length;
            const allSelected = selectedCount === groupFieldKeys.length;
            const someSelected = selectedCount > 0 && !allSelected;

            return (
              <div key={group.key} className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-sm">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => {
                      setWooPublishFields(prev => {
                        const next = new Set(prev);
                        groupFieldKeys.forEach(k => {
                          if (allSelected) next.delete(k); else next.add(k);
                        });
                        return next;
                      });
                    }}
                  />
                  {group.icon} {group.label}
                </label>
                <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                  {group.fields.map(field => (
                    <label key={field.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={wooPublishFields.has(field.key)}
                        onCheckedChange={() => {
                          setWooPublishFields(prev => {
                            const next = new Set(prev);
                            if (next.has(field.key)) next.delete(field.key); else next.add(field.key);
                            return next;
                          });
                        }}
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">☁️ Amazon S3</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField label="Access Key ID" id="s3_key" settingKey={SETTING_KEYS.s3_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="Secret Access Key" id="s3_secret" settingKey={SETTING_KEYS.s3_secret} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <div className="space-y-2">
            <Label>Nome do Bucket</Label>
            <Input placeholder="hotelequip-images" value={form[SETTING_KEYS.s3_bucket] ?? ""} onChange={(e) => updateField(SETTING_KEYS.s3_bucket, e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Região</Label>
            <Input placeholder="eu-west-1" value={form[SETTING_KEYS.s3_region] ?? ""} onChange={(e) => updateField(SETTING_KEYS.s3_region, e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* Suppliers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🏭 Fornecedores (Auto-Scrape por SKU)</CardTitle>
        </CardHeader>
         <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Configure os fornecedores e o URL de pesquisa. O prefixo SKU é <strong>opcional</strong> — se vazio, o sistema pesquisa com o SKU completo. Na exportação/publicação, poderá adicionar um prefixo aos SKUs que ainda não o tenham.
          </p>
          {suppliers.map((supplier, index) => (
            <div key={index} className="space-y-2 border rounded-lg p-3">
              <div className="flex gap-3 items-end">
              <div className="w-36 space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input
                    placeholder="Udex"
                    value={supplier.name}
                    onChange={(e) => {
                      const updated = [...suppliers];
                      updated[index].name = e.target.value;
                      setSuppliers(updated);
                    }}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Prefixo SKU <span className="text-muted-foreground">(opcional)</span></Label>
                  <Input
                    placeholder="ex: UD"
                    value={supplier.prefix}
                    onChange={(e) => {
                      const updated = [...suppliers];
                      updated[index].prefix = e.target.value.toUpperCase();
                      setSuppliers(updated);
                    }}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">URL de Pesquisa</Label>
                  <Input
                    placeholder="https://www.udex.pt/pt/pesquisa/"
                    value={supplier.url}
                    onChange={(e) => {
                      const updated = [...suppliers];
                      updated[index].url = e.target.value;
                      setSuppliers(updated);
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSupplier(index)}
                  disabled={suppliers.length === 1}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {/* Scraping Instructions */}
              <div className="space-y-1">
                <Label className="text-xs">Instruções de Extração <span className="text-muted-foreground">(opcional)</span></Label>
                <Textarea
                  rows={3}
                  className="text-xs font-mono"
                  placeholder={`Ex: As variações estão na secção "Diámetro". Ignorar imagens depois de "Descubre la serie". Extrair especificações da tabela.`}
                  value={supplier.scrapingInstructions ?? ""}
                  onChange={(e) => {
                    const updated = [...suppliers];
                    updated[index] = { ...updated[index], scrapingInstructions: e.target.value };
                    setSuppliers(updated);
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Dicas para a IA sobre como interpretar a página deste fornecedor (ex: quais secções ignorar, onde estão as variações, etc.)
                </p>
              </div>
              {/* Test scrape row */}
              {supplier.url && (
                <div className="flex gap-2 items-center pt-1">
                  <Input
                    placeholder={`SKU de teste (ex: ${supplier.prefix ? supplier.prefix + "12345" : "12345"})`}
                    value={testingSku[index] ?? ""}
                    className="flex-1 h-8 text-xs"
                    onChange={(e) => setTestingSku((prev) => ({ ...prev, [index]: e.target.value }))}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    disabled={!testingSku[index] || testingLoading[index]}
                    onClick={() => testSupplierScrape(index)}
                  >
                    {testingLoading[index] ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Testar Scrape
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addSupplier}>
            <Plus className="w-4 h-4 mr-1" /> Adicionar Fornecedor
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={handleSave} size="lg" disabled={saveSettings.isPending}>
          {saveSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar Configurações
        </Button>
      </div>

      {/* Test Result Dialog */}
      <Dialog open={!!testResult} onOpenChange={() => setTestResult(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Resultado do Teste de Scrape</DialogTitle>
          </DialogHeader>
          {testResult && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground break-all">
                <strong>URL:</strong> {testResult.url}
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Caracteres extraídos:</strong> {testResult.chars.toLocaleString()}
              </div>
              <ScrollArea className="h-64 border rounded-lg p-3">
                <pre className="text-xs whitespace-pre-wrap font-mono">{testResult.preview}</pre>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function SecretField({
  label,
  id,
  settingKey,
  form,
  updateField,
  showKeys,
  toggleShow,
}: {
  label: string;
  id: string;
  settingKey: string;
  form: Record<string, string>;
  updateField: (key: string, value: string) => void;
  showKeys: Record<string, boolean>;
  toggleShow: (key: string) => void;
}) {
  const isMasked = form[settingKey] === "••••••••";
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type={showKeys[id] ? "text" : "password"}
          placeholder={isMasked ? "Credencial guardada — introduza novo valor para alterar" : "••••••••••••"}
          className="flex-1"
          value={isMasked ? "" : (form[settingKey] ?? "")}
          onChange={(e) => updateField(settingKey, e.target.value)}
        />
        <Button variant="ghost" size="icon" onClick={() => toggleShow(id)}>
          {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      </div>
      {isMasked && (
        <p className="text-xs text-muted-foreground">Credencial já configurada. Deixe vazio para manter ou introduza novo valor.</p>
      )}
    </div>
  );
}

export default SettingsPage;
