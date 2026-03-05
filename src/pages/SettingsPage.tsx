import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Save, Eye, EyeOff, Loader2 } from "lucide-react";
import { useSettings, useSaveSettings } from "@/hooks/useSettings";

interface Supplier {
  prefix: string;
  url: string;
}

const SETTING_KEYS = {
  openai_key: "openai_api_key",
  anthropic_key: "anthropic_api_key",
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
  const [suppliers, setSuppliers] = useState<Supplier[]>([{ prefix: "", url: "" }]);
  const [knowledgeUrls, setKnowledgeUrls] = useState<string[]>([""]);

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
    }
  }, [settings]);

  const toggleShow = (key: string) => setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  const updateField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const addSupplier = () => setSuppliers((prev) => [...prev, { prefix: "", url: "" }]);
  const removeSupplier = (index: number) => setSuppliers((prev) => prev.filter((_, i) => i !== index));

  const addKnowledgeUrl = () => setKnowledgeUrls((prev) => [...prev, ""]);
  const removeKnowledgeUrl = (index: number) => setKnowledgeUrls((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    const data = {
      ...form,
      [SETTING_KEYS.suppliers]: JSON.stringify(suppliers),
      [SETTING_KEYS.knowledge_urls]: JSON.stringify(knowledgeUrls.filter(Boolean)),
    };
    saveSettings.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerir credenciais e preferências da aplicação.</p>
      </div>

      {/* Optimization Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">✍️ Prompt de Otimização</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Prompt Global</Label>
            <p className="text-xs text-muted-foreground">
              Este prompt é usado pela IA para otimizar todos os produtos. Personalize-o conforme as suas necessidades.
            </p>
            <Textarea
              rows={12}
              className="font-mono text-xs"
              placeholder={DEFAULT_OPTIMIZATION_PROMPT}
              value={form[SETTING_KEYS.optimization_prompt] ?? DEFAULT_OPTIMIZATION_PROMPT}
              onChange={(e) => updateField(SETTING_KEYS.optimization_prompt, e.target.value)}
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
          <SecretField label="API Key OpenAI" id="openai" settingKey={SETTING_KEYS.openai_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="API Key Anthropic" id="anthropic" settingKey={SETTING_KEYS.anthropic_key} form={form} updateField={updateField} showKeys={showKeys} toggleShow={toggleShow} />
          <div className="space-y-2">
            <Label>Modelo Padrão</Label>
            <Select value={form[SETTING_KEYS.default_model] ?? "gemini-flash"} onValueChange={(v) => updateField(SETTING_KEYS.default_model, v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-flash">Gemini 3 Flash (Recomendado)</SelectItem>
                <SelectItem value="gemini-pro">Gemini 2.5 Pro</SelectItem>
                <SelectItem value="gpt5">GPT-5</SelectItem>
                <SelectItem value="gpt5-mini">GPT-5 Mini</SelectItem>
              </SelectContent>
            </Select>
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

      {/* Amazon S3 */}
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
            Configure o prefixo de SKU de cada fornecedor e o URL de pesquisa. Durante a otimização, o sistema remove o prefixo do SKU e pesquisa automaticamente no site do fornecedor. O URL deve terminar com <code className="bg-muted px-1 rounded">/</code> ou <code className="bg-muted px-1 rounded">=</code> (ex: <code className="bg-muted px-1 rounded">https://www.udex.pt/pt/pesquisa/</code>).
          </p>
          {suppliers.map((supplier, index) => (
            <div key={index} className="flex gap-3 items-end">
              <div className="w-28 space-y-1">
                <Label className="text-xs">Prefixo SKU</Label>
                <Input
                  placeholder="AB"
                  value={supplier.prefix}
                  onChange={(e) => {
                    const updated = [...suppliers];
                    updated[index].prefix = e.target.value;
                    setSuppliers(updated);
                  }}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">URL de Pesquisa</Label>
                <Input
                  placeholder="https://fornecedor.com/search?q="
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
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type={showKeys[id] ? "text" : "password"}
          placeholder="••••••••••••"
          className="flex-1"
          value={form[settingKey] ?? ""}
          onChange={(e) => updateField(settingKey, e.target.value)}
        />
        <Button variant="ghost" size="icon" onClick={() => toggleShow(id)}>
          {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

export default SettingsPage;
