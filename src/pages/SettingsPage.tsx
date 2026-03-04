import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Save, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

interface Supplier {
  prefix: string;
  url: string;
}

const SettingsPage = () => {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([{ prefix: "", url: "" }]);

  const toggleShow = (key: string) => setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));

  const addSupplier = () => setSuppliers((prev) => [...prev, { prefix: "", url: "" }]);
  const removeSupplier = (index: number) => setSuppliers((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    toast.success("Configurações guardadas com sucesso!");
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerir credenciais e preferências da aplicação.</p>
      </div>

      {/* AI Models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🤖 Modelos de IA</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField label="API Key OpenAI" id="openai" showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="API Key Anthropic" id="anthropic" showKeys={showKeys} toggleShow={toggleShow} />
          <div className="space-y-2">
            <Label>Modelo Padrão</Label>
            <Select defaultValue="gemini-flash">
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
            <Input placeholder="https://hotelequip.pt" />
          </div>
          <SecretField label="Consumer Key" id="woo_key" showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="Consumer Secret" id="woo_secret" showKeys={showKeys} toggleShow={toggleShow} />
        </CardContent>
      </Card>

      {/* Amazon S3 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">☁️ Amazon S3</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SecretField label="Access Key ID" id="s3_key" showKeys={showKeys} toggleShow={toggleShow} />
          <SecretField label="Secret Access Key" id="s3_secret" showKeys={showKeys} toggleShow={toggleShow} />
          <div className="space-y-2">
            <Label>Nome do Bucket</Label>
            <Input placeholder="hotelequip-images" />
          </div>
          <div className="space-y-2">
            <Label>Região</Label>
            <Input placeholder="eu-west-1" />
          </div>
        </CardContent>
      </Card>

      {/* Suppliers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🏭 Fornecedores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
        <Button onClick={handleSave} size="lg">
          <Save className="w-4 h-4 mr-2" /> Guardar Configurações
        </Button>
      </div>
    </div>
  );
};

function SecretField({
  label,
  id,
  showKeys,
  toggleShow,
}: {
  label: string;
  id: string;
  showKeys: Record<string, boolean>;
  toggleShow: (key: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input type={showKeys[id] ? "text" : "password"} placeholder="••••••••••••" className="flex-1" />
        <Button variant="ghost" size="icon" onClick={() => toggleShow(id)}>
          {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

export default SettingsPage;
