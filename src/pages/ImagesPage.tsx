import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ImageIcon, Loader2, Sparkles, Check, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAllProductIds } from "@/hooks/useProducts";
import { useProcessImages } from "@/hooks/useProcessImages";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type ImageFilter = "all" | "with_images" | "without_images" | "optimized";

const ImagesPage = () => {
  const { activeWorkspace } = useWorkspaceContext();
  const { processImages, isProcessing, progress } = useProcessImages();
  const { data: allProducts } = useAllProductIds();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ImageFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"optimize" | "lifestyle">("optimize");
  const [processedFilter, setProcessedFilter] = useState<"all" | "optimized" | "lifestyle">("all");

  // Fetch processed images from images table
  const { data: processedImages } = useQuery({
    queryKey: ["processed-images", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      // Get all images with optimized_url set, joined with product info
      const { data, error } = await supabase
        .from("images")
        .select("id, product_id, original_url, optimized_url, alt_text, status, sort_order, created_at, s3_key")
        .not("optimized_url", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Get product titles for these images
      const productIds = [...new Set((data || []).map(img => img.product_id))];
      if (productIds.length === 0) return [];

      const { data: products } = await supabase
        .from("products")
        .select("id, original_title, optimized_title, sku, image_urls")
        .in("id", productIds);

      const productMap = new Map((products || []).map(p => [p.id, p]));

      return (data || []).map(img => {
        const product = productMap.get(img.product_id);
        const path = `${img.s3_key || ""} ${img.optimized_url || ""}`.toLowerCase();
        const isLifestyle = path.includes("lifestyle");
        return {
          ...img,
          productTitle: product?.optimized_title || product?.original_title || product?.sku || "Sem título",
          productSku: product?.sku,
          isLifestyle,
        };
      });
    },
  });

  const filteredProcessed = useMemo(() => {
    let list = processedImages || [];
    if (processedFilter === "optimized") list = list.filter(i => !i.isLifestyle);
    if (processedFilter === "lifestyle") list = list.filter(i => i.isLifestyle);
    return list;
  }, [processedImages, processedFilter]);

  const products = useMemo(() => {
    let list = allProducts ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) =>
        (p.original_title || "").toLowerCase().includes(q) ||
        (p.optimized_title || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
      );
    }
    if (filter === "with_images") {
      list = list.filter((p: any) => p.image_urls?.length > 0);
    } else if (filter === "without_images") {
      list = list.filter((p: any) => !p.image_urls || p.image_urls.length === 0);
    } else if (filter === "optimized") {
      list = list.filter((p: any) => {
        const alts = p.image_alt_texts;
        return alts && typeof alts === "object" && Object.keys(alts).length > 0;
      });
    }
    return list;
  }, [allProducts, search, filter]);

  const stats = useMemo(() => {
    const all = allProducts ?? [];
    const withImages = all.filter((p: any) => p.image_urls?.length > 0).length;
    const totalImages = all.reduce((acc: number, p: any) => acc + (p.image_urls?.length || 0), 0);
    const withAlts = all.filter((p: any) => {
      const alts = p.image_alt_texts;
      return alts && typeof alts === "object" && Object.keys(alts).length > 0;
    }).length;
    const processed = processedImages?.length || 0;
    return { total: all.length, withImages, totalImages, withAlts, processed };
  }, [allProducts, processedImages]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p: any) => p.id)));
    }
  };

  const handleProcess = () => {
    if (!activeWorkspace) return;
    const ids = selected.size > 0
      ? Array.from(selected)
      : products.filter((p: any) => p.image_urls?.length > 0).map((p: any) => p.id);
    if (ids.length === 0) {
      toast.warning("Nenhum produto com imagens para processar.");
      return;
    }
    processImages({ workspaceId: activeWorkspace.id, productIds: ids, mode });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Otimização de Imagens</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Processe e otimize as imagens dos seus produtos com IA
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as "optimize" | "lifestyle")}>
            <SelectTrigger className="w-40 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="optimize">Otimizar (Upscale)</SelectItem>
              <SelectItem value="lifestyle">Lifestyle (IA)</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleProcess} disabled={isProcessing} size="sm">
            {isProcessing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            Processar{selected.size > 0 ? ` (${selected.size})` : " Todos"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Produtos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{stats.withImages}</p>
            <p className="text-xs text-muted-foreground">Com Imagens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.totalImages}</p>
            <p className="text-xs text-muted-foreground">Total Imagens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent-foreground">{stats.processed}</p>
            <p className="text-xs text-muted-foreground">Processadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.withAlts}</p>
            <p className="text-xs text-muted-foreground">Com Alt Text</p>
          </CardContent>
        </Card>
      </div>

      {/* Progress */}
      {progress && progress.done < progress.total && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                <span className="text-sm font-medium">
                  A processar: {progress.currentProduct}
                </span>
              </div>
              <span className="text-sm font-mono text-muted-foreground">
                {progress.done}/{progress.total}
              </span>
            </div>
            <Progress value={(progress.done / progress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="catalog" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="catalog">
            <ImageIcon className="w-4 h-4 mr-1.5" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="processed">
            <Eye className="w-4 h-4 mr-1.5" />
            Processadas ({stats.processed})
          </TabsTrigger>
        </TabsList>

        {/* ====== TAB: Catálogo ====== */}
        <TabsContent value="catalog" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar produto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as ImageFilter)}>
              <SelectTrigger className="w-44 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="with_images">Com Imagens</SelectItem>
                <SelectItem value="without_images">Sem Imagens</SelectItem>
                <SelectItem value="optimized">Com Alt Text</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{products.length} produto(s)</span>
          </div>

          {/* Product Image Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.slice(0, 200).map((p: any) => {
              const title = p.optimized_title || p.original_title || p.sku || "Sem título";
              const images = p.image_urls || [];
              const isSelected = selected.has(p.id);
              const hasAlt = p.image_alt_texts && typeof p.image_alt_texts === "object" && Object.keys(p.image_alt_texts).length > 0;

              return (
                <Card
                  key={p.id}
                  className={cn(
                    "overflow-hidden cursor-pointer transition-all hover:shadow-md",
                    isSelected && "ring-2 ring-primary"
                  )}
                  onClick={() => toggleSelect(p.id)}
                >
                  <div className="relative aspect-square bg-muted flex items-center justify-center">
                    {images.length > 0 ? (
                      <img
                        src={images[0]}
                        alt={title}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                    )}
                    <div className="absolute top-2 left-2">
                      <Checkbox checked={isSelected} className="bg-background/80" />
                    </div>
                    {images.length > 1 && (
                      <Badge className="absolute top-2 right-2 text-[10px]" variant="secondary">
                        {images.length} imgs
                      </Badge>
                    )}
                    {hasAlt && (
                      <Badge className="absolute bottom-2 right-2 text-[10px] bg-success/80 text-success-foreground">
                        <Check className="w-3 h-3 mr-0.5" /> Alt
                      </Badge>
                    )}
                  </div>
                  <CardContent className="p-3">
                    <p className="text-xs font-medium truncate text-foreground">{title}</p>
                    {p.sku && <p className="text-[10px] text-muted-foreground">SKU: {p.sku}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {products.length > 200 && (
            <p className="text-center text-sm text-muted-foreground">
              A mostrar 200 de {products.length} produtos. Use os filtros para refinar.
            </p>
          )}

          {products.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum produto encontrado.</p>
            </div>
          )}

          {/* Select All bar */}
          {products.length > 0 && (
            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="text-xs">
                {selected.size === products.length ? "Desselecionar todos" : `Selecionar todos (${products.length})`}
              </Button>
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">{selected.size} selecionado(s)</span>
              )}
            </div>
          )}
        </TabsContent>

        {/* ====== TAB: Processadas ====== */}
        <TabsContent value="processed" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={processedFilter} onValueChange={(v) => setProcessedFilter(v as any)}>
              <SelectTrigger className="w-48 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas Processadas</SelectItem>
                <SelectItem value="optimized">Otimizadas (Upscale)</SelectItem>
                <SelectItem value="lifestyle">Lifestyle (IA)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{filteredProcessed.length} imagem(ns)</span>
          </div>

          {filteredProcessed.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhuma imagem processada ainda.</p>
              <p className="text-xs mt-1">Selecione produtos no tab Catálogo e processe.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProcessed.map((img: any) => (
                <Card key={img.id} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-0.5 bg-muted">
                    {/* Original */}
                    <div className="relative aspect-square bg-muted flex items-center justify-center">
                      {img.original_url ? (
                        <img
                          src={img.original_url}
                          alt="Original"
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      )}
                      <span className="absolute bottom-1 left-1 text-[9px] bg-background/80 px-1.5 py-0.5 rounded text-muted-foreground font-medium">
                        Original
                      </span>
                    </div>
                    {/* Processed */}
                    <div className="relative aspect-square bg-muted flex items-center justify-center">
                      <img
                        src={img.optimized_url}
                        alt="Processada"
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                      <span className={cn(
                        "absolute bottom-1 left-1 text-[9px] px-1.5 py-0.5 rounded font-medium",
                        img.isLifestyle
                          ? "bg-purple-500/80 text-white"
                          : "bg-primary/80 text-primary-foreground"
                      )}>
                        {img.isLifestyle ? "Lifestyle" : "Otimizada"}
                      </span>
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <p className="text-xs font-medium truncate text-foreground">{img.productTitle}</p>
                    {img.productSku && <p className="text-[10px] text-muted-foreground">SKU: {img.productSku}</p>}
                    {img.alt_text && <p className="text-[10px] text-muted-foreground truncate mt-0.5">Alt: {img.alt_text}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImagesPage;
