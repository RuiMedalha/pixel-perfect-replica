import { useState } from "react";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useWooCategories, useWooAttributes, useWooImport, type WooImportFilters } from "@/hooks/useWooImport";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, ShoppingCart, Package, Filter, CheckCircle, AlertTriangle } from "lucide-react";

const WooImportPage = () => {
  const { activeWorkspace } = useWorkspaceContext();
  const { data: categories, isLoading: loadingCats } = useWooCategories(!!activeWorkspace);
  const { data: attributes, isLoading: loadingAttrs } = useWooAttributes(!!activeWorkspace);
  const { importProducts, isImporting, result } = useWooImport();

  const [filters, setFilters] = useState<WooImportFilters>({});
  const [selectedAttribute, setSelectedAttribute] = useState<string>("");
  const [selectedTerm, setSelectedTerm] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");

  const isLoading = loadingCats || loadingAttrs;

  // Find the brand attribute (common names: marca, brand, pa_marca, pa_brand)
  const brandAttr = attributes?.find(a => 
    ['marca', 'brand', 'marcas', 'brands'].includes(a.name.toLowerCase())
  );
  
  // Non-brand attributes for generic filter
  const otherAttributes = attributes?.filter(a => a.id !== brandAttr?.id) || [];

  // Find the selected attribute object (non-brand)
  const attrObj = otherAttributes.find(a => String(a.id) === selectedAttribute);

  const handleImport = async () => {
    if (!activeWorkspace) return;

    const finalFilters: WooImportFilters = { ...filters };
    
    // Brand filter
    if (selectedBrand && brandAttr) {
      finalFilters.attribute = `pa_${brandAttr.name.toLowerCase().replace(/\s+/g, '-')}`;
      finalFilters.attribute_term = selectedBrand;
    }
    // Generic attribute filter (only if no brand filter active)
    else if (selectedAttribute && selectedTerm) {
      finalFilters.attribute = `pa_${attrObj?.name?.toLowerCase().replace(/\s+/g, '-') || selectedAttribute}`;
      finalFilters.attribute_term = selectedTerm;
    }

    await importProducts(activeWorkspace.id, finalFilters);
  };

  // Build hierarchical category tree
  const buildCatTree = (cats: typeof categories) => {
    if (!cats) return [];
    const topLevel = cats.filter(c => c.parent === 0).sort((a, b) => a.name.localeCompare(b.name));
    const getChildren = (parentId: number, depth: number): { id: number; name: string; count: number; depth: number }[] => {
      const children = cats.filter(c => c.parent === parentId).sort((a, b) => a.name.localeCompare(b.name));
      const result: any[] = [];
      for (const child of children) {
        result.push({ ...child, depth });
        result.push(...getChildren(child.id, depth + 1));
      }
      return result;
    };
    const tree: any[] = [];
    for (const cat of topLevel) {
      tree.push({ ...cat, depth: 0 });
      tree.push(...getChildren(cat.id, 1));
    }
    return tree;
  };

  const catTree = buildCatTree(categories);

  const activeFiltersCount = [
    filters.type && filters.type !== "all",
    filters.status && filters.status !== "all",
    filters.category,
    filters.stock_status && filters.stock_status !== "all",
    filters.search,
    selectedBrand,
    selectedAttribute && selectedTerm,
  ].filter(Boolean).length;

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-lg sm:text-2xl font-bold text-foreground flex items-center gap-2">
          <ShoppingCart className="w-6 h-6" />
          Importar do WooCommerce
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Descarregue produtos da sua loja WooCommerce para otimizar e reimportar.
        </p>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtros de Importação
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="ml-1">{activeFiltersCount} ativo(s)</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Selecione os filtros para definir quais produtos deseja importar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">A carregar dados do WooCommerce...</span>
            </div>
          ) : (
            <>
              {/* Row 1: Search + Type + Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Pesquisa</Label>
                  <Input
                    placeholder="Nome ou SKU..."
                    value={filters.search || ""}
                    onChange={(e) => setFilters(f => ({ ...f, search: e.target.value || undefined }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Tipo de Produto</Label>
                  <Select value={filters.type || "all"} onValueChange={(v) => setFilters(f => ({ ...f, type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      <SelectItem value="simple">Simples</SelectItem>
                      <SelectItem value="variable">Variável</SelectItem>
                      <SelectItem value="grouped">Agrupado</SelectItem>
                      <SelectItem value="external">Externo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Estado no WooCommerce</Label>
                  <Select value={filters.status || "all"} onValueChange={(v) => setFilters(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os estados</SelectItem>
                      <SelectItem value="publish">Publicado</SelectItem>
                      <SelectItem value="draft">Rascunho</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="private">Privado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: Category + Brand + Stock */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Categoria</Label>
                  <Select value={filters.category || "all"} onValueChange={(v) => setFilters(f => ({ ...f, category: v === "all" ? undefined : v }))}>
                    <SelectTrigger><SelectValue placeholder="Todas as categorias" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      {catTree.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {"—".repeat(cat.depth)} {cat.name} ({cat.count})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {brandAttr && brandAttr.terms.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Marca</Label>
                    <Select value={selectedBrand || "all"} onValueChange={(v) => setSelectedBrand(v === "all" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Todas as marcas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as marcas</SelectItem>
                        {brandAttr.terms.sort((a, b) => a.name.localeCompare(b.name)).map((term) => (
                          <SelectItem key={term.id} value={String(term.id)}>
                            {term.name} ({term.count})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Stock</Label>
                  <Select value={filters.stock_status || "all"} onValueChange={(v) => setFilters(f => ({ ...f, stock_status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Qualquer stock</SelectItem>
                      <SelectItem value="instock">Em stock</SelectItem>
                      <SelectItem value="outofstock">Sem stock</SelectItem>
                      <SelectItem value="onbackorder">Encomenda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 3: Other attributes filter */}
              {otherAttributes.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Outro Atributo</Label>
                    <Select value={selectedAttribute || "none"} onValueChange={(v) => { setSelectedAttribute(v === "none" ? "" : v); setSelectedTerm(""); }}>
                      <SelectTrigger><SelectValue placeholder="Selecionar atributo..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {otherAttributes.map((attr) => (
                          <SelectItem key={attr.id} value={String(attr.id)}>
                            {attr.name} ({attr.terms.length} valores)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {attrObj && attrObj.terms.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Valor de {attrObj.name}</Label>
                      <Select value={selectedTerm || "none"} onValueChange={(v) => setSelectedTerm(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder={`Selecionar ${attrObj.name}...`} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Todos</SelectItem>
                          {attrObj.terms.sort((a, b) => a.name.localeCompare(b.name)).map((term) => (
                            <SelectItem key={term.id} value={String(term.id)}>
                              {term.name} ({term.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({});
                    setSelectedAttribute("");
                    setSelectedTerm("");
                    setSelectedBrand("");
                  }}
                  disabled={activeFiltersCount === 0}
                >
                  Limpar filtros
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={isImporting || !activeWorkspace}
                  size="lg"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      A importar...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Importar Produtos
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Result Card */}
      {result && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              {result.imported > 0 ? (
                <CheckCircle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
              )}
              <div className="space-y-2">
                <p className="font-semibold text-sm">
                  {result.imported > 0
                    ? `Importação concluída com sucesso!`
                    : `Nenhum produto novo importado.`
                  }
                </p>
                <div className="flex flex-wrap gap-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <span><strong>{result.imported}</strong> produtos</span>
                  </div>
                  {result.variations > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span><strong>{result.variations}</strong> variações</span>
                    </div>
                  )}
                  {result.skipped > 0 && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span>{result.skipped} duplicados ignorados</span>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    ({result.total} encontrados no WooCommerce)
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WooImportPage;
