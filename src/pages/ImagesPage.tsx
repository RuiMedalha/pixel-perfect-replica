import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ImageIcon, Loader2, Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAllProductIds } from "@/hooks/useProducts";
import { useProcessImages } from "@/hooks/useProcessImages";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

type ImageFilter = "all" | "with_images" | "without_images" | "optimized";

const ImagesPage = () => {
  const { activeWorkspace } = useWorkspaceContext();
  const { processImages, isProcessing, progress } = useProcessImages();
  const { data: allProducts } = useAllProductIds();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ImageFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"optimize" | "lifestyle">("optimize");

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
    return { total: all.length, withImages, totalImages, withAlts };
  }, [allProducts]);

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            <p className="text-2xl font-bold text-success">{stats.withAlts}</p>
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
    </div>
  );
};

export default ImagesPage;
