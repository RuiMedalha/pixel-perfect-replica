import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Search, Filter, Check, X, ExternalLink, Edit, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type ProductStatus = "Pendente" | "Aprovado" | "Rejeitado" | "Aplicado" | "Erro";

interface Product {
  id: number;
  sku: string;
  originalTitle: string;
  optimizedTitle: string;
  originalDescription: string;
  optimizedDescription: string;
  optimizedShortDescription: string;
  optimizedMetaTitle: string;
  optimizedMetaDescription: string;
  status: ProductStatus;
  image?: string;
}

const mockProducts: Product[] = [
  {
    id: 1,
    sku: "AB12345",
    originalTitle: "Forno Convecção Industrial 10 Bandejas GN1/1",
    optimizedTitle: "Forno de Convecção Industrial 10 GN1/1 – Profissional",
    originalDescription: "Forno convecção 10 bandejas para uso profissional...",
    optimizedDescription: "O Forno de Convecção Industrial de 10 Bandejas GN1/1 é a solução ideal para cozinhas profissionais que necessitam de alta produtividade e resultados consistentes...",
    optimizedShortDescription: "Forno profissional de 10 bandejas com distribuição uniforme de calor.",
    optimizedMetaTitle: "Forno Convecção Industrial 10 GN1/1 | Hotelequip",
    optimizedMetaDescription: "Forno de convecção industrial com 10 bandejas GN1/1. Ideal para restaurantes e hotelaria. Entrega em Portugal.",
    status: "Pendente",
  },
  {
    id: 2,
    sku: "CD67890",
    originalTitle: "Mesa Refrigerada 2 Portas Inox",
    optimizedTitle: "Mesa Refrigerada Profissional 2 Portas em Aço Inox",
    originalDescription: "Mesa refrigerada com 2 portas em inox...",
    optimizedDescription: "Mesa Refrigerada Profissional de 2 Portas construída em aço inoxidável AISI 304. Perfeita para preparação de alimentos em ambientes profissionais...",
    optimizedShortDescription: "Mesa refrigerada profissional de 2 portas em aço inoxidável.",
    optimizedMetaTitle: "Mesa Refrigerada 2 Portas Inox | Hotelequip",
    optimizedMetaDescription: "Mesa refrigerada profissional com 2 portas em aço inoxidável. Qualidade garantida para hotelaria.",
    status: "Aprovado",
  },
  {
    id: 3,
    sku: "EF11223",
    originalTitle: "Máquina Lavar Louça Cesto 500x500",
    optimizedTitle: "Máquina de Lavar Louça Industrial Cesto 500x500mm",
    originalDescription: "Máquina lavar louça profissional...",
    optimizedDescription: "Máquina de Lavar Louça Industrial com cesto de 500x500mm. Ciclos rápidos e eficientes para grandes volumes de louça...",
    optimizedShortDescription: "Máquina de lavar louça industrial com cesto de 500x500mm.",
    optimizedMetaTitle: "Máquina Lavar Louça Industrial 500x500 | Hotelequip",
    optimizedMetaDescription: "Máquina de lavar louça industrial com cesto 500x500mm. Ciclos rápidos para restaurantes.",
    status: "Aplicado",
  },
];

const statusColors: Record<ProductStatus, string> = {
  Pendente: "bg-warning/10 text-warning border-warning/20",
  Aprovado: "bg-success/10 text-success border-success/20",
  Rejeitado: "bg-destructive/10 text-destructive border-destructive/20",
  Aplicado: "bg-primary/10 text-primary border-primary/20",
  Erro: "bg-destructive/10 text-destructive border-destructive/20",
};

const ProductsPage = () => {
  const [products] = useState<Product[]>(mockProducts);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStatus | "Todos">("Todos");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  const filtered = products.filter((p) => {
    const matchesSearch =
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.originalTitle.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "Todos" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const statuses: (ProductStatus | "Todos")[] = ["Todos", "Pendente", "Aprovado", "Rejeitado", "Aplicado", "Erro"];

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Painel de Produtos</h1>
          <p className="text-muted-foreground mt-1">{products.length} produtos no total</p>
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm">
              <Check className="w-4 h-4 mr-1" /> Aprovar ({selected.size})
            </Button>
            <Button size="sm" variant="destructive">
              <X className="w-4 h-4 mr-1" /> Rejeitar ({selected.size})
            </Button>
            <Button size="sm" variant="outline">
              <ExternalLink className="w-4 h-4 mr-1" /> Aplicar no Site ({selected.size})
            </Button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar por SKU ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 w-10"></th>
                  <th className="p-3 text-left font-medium text-muted-foreground">SKU</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Título Original</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Título Otimizado</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">Estado</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setDetailProduct(product)}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(product.id)}
                        onCheckedChange={() => toggleSelect(product.id)}
                      />
                    </td>
                    <td className="p-3 font-mono text-xs">{product.sku}</td>
                    <td className="p-3 max-w-[200px] truncate">{product.originalTitle}</td>
                    <td className="p-3 max-w-[200px] truncate text-primary font-medium">
                      {product.optimizedTitle}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={cn("text-xs", statusColors[product.status])}>
                        {product.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetailProduct(product)}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost">
                          <Sparkles className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost">
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!detailProduct} onOpenChange={() => setDetailProduct(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detailProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{detailProduct.sku}</span>
                  {detailProduct.originalTitle}
                </DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="textos" className="mt-4">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="textos">Textos</TabsTrigger>
                  <TabsTrigger value="imagens">Imagens</TabsTrigger>
                  <TabsTrigger value="sugestoes">Sugestões</TabsTrigger>
                  <TabsTrigger value="brutos">Dados Brutos</TabsTrigger>
                </TabsList>

                <TabsContent value="textos" className="space-y-6 mt-4">
                  <ComparisonField label="Título" original={detailProduct.originalTitle} optimized={detailProduct.optimizedTitle} />
                  <ComparisonField label="Meta Title" original="—" optimized={detailProduct.optimizedMetaTitle} />
                  <ComparisonField label="Meta Description" original="—" optimized={detailProduct.optimizedMetaDescription} multiline />
                  <ComparisonField label="Descrição Curta" original="—" optimized={detailProduct.optimizedShortDescription} multiline />
                  <ComparisonField label="Descrição Completa" original={detailProduct.originalDescription} optimized={detailProduct.optimizedDescription} multiline />
                </TabsContent>

                <TabsContent value="imagens" className="mt-4">
                  <div className="text-center py-12 text-muted-foreground">
                    <p>Nenhuma imagem carregada para este produto.</p>
                    <Button variant="outline" className="mt-4">Carregar Imagem</Button>
                  </div>
                </TabsContent>

                <TabsContent value="sugestoes" className="mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Cross-sell</CardTitle></CardHeader>
                      <CardContent><p className="text-sm text-muted-foreground">Sem sugestões disponíveis.</p></CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-sm">Upsell</CardTitle></CardHeader>
                      <CardContent><p className="text-sm text-muted-foreground">Sem sugestões disponíveis.</p></CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="brutos" className="mt-4">
                  <Card>
                    <CardContent className="p-4">
                      <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                        {detailProduct.originalDescription}
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                <Button variant="destructive" size="sm">Rejeitar</Button>
                <Button variant="outline" size="sm">
                  <Sparkles className="w-4 h-4 mr-1" /> Re-otimizar
                </Button>
                <Button size="sm">
                  <Check className="w-4 h-4 mr-1" /> Aprovar
                </Button>
                <Button size="sm" variant="secondary">
                  <ExternalLink className="w-4 h-4 mr-1" /> Aplicar no Site
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function ComparisonField({
  label,
  original,
  optimized,
  multiline = false,
}: {
  label: string;
  original: string;
  optimized: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{label}</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Original</p>
          <div className="p-3 rounded-lg bg-muted/50 text-sm">{original}</div>
        </div>
        <div>
          <p className="text-xs text-primary mb-1">Otimizado</p>
          {multiline ? (
            <Textarea defaultValue={optimized} className="text-sm min-h-[80px]" />
          ) : (
            <Input defaultValue={optimized} className="text-sm" />
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductsPage;
