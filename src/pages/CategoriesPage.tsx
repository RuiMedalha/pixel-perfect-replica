import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderTree, Plus, Edit, Trash2, ChevronRight, ChevronDown, Loader2, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCategoryTree, useCreateCategory, useUpdateCategory, useDeleteCategory, useSyncWooCategories, type CategoryTree, type Category } from "@/hooks/useCategories";

import { useProducts } from "@/hooks/useProducts";

function CategoryTreeItem({
  cat,
  flat,
  onEdit,
  onDelete,
  productCounts,
}: {
  cat: CategoryTree;
  flat: Category[];
  onEdit: (cat: Category) => void;
  onDelete: (id: string) => void;
  productCounts: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = cat.children.length > 0;
  const count = productCounts[cat.name] ?? 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group",
        )}
        style={{ paddingLeft: `${cat.depth * 24 + 12}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn("w-5 h-5 flex items-center justify-center", !hasChildren && "invisible")}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium flex-1">{cat.name}</span>
        {cat.slug && <span className="text-xs text-muted-foreground font-mono">/{cat.slug}</span>}
        {count > 0 && (
          <Badge variant="secondary" className="text-[10px]">{count} produto(s)</Badge>
        )}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onEdit(cat)}>
            <Edit className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => onDelete(cat.id)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {expanded && hasChildren && (
        <div>
          {cat.children.map(child => (
            <CategoryTreeItem key={child.id} cat={child} flat={flat} onEdit={onEdit} onDelete={onDelete} productCounts={productCounts} />
          ))}
        </div>
      )}
    </div>
  );
}

const CategoriesPage = () => {
  const { data: tree, flat, isLoading } = useCategoryTree();
  const { data: products } = useProducts();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const syncWooCategories = useSyncWooCategories();

  const [showForm, setShowForm] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", meta_title: "", meta_description: "", parent_id: "" });

  // Count products per category name
  const productCounts: Record<string, number> = {};
  (products ?? []).forEach(p => {
    if (p.category) {
      // Handle "Parent > Child" format - count for both
      const parts = p.category.split(">").map((s: string) => s.trim());
      parts.forEach((part: string) => {
        productCounts[part] = (productCounts[part] ?? 0) + 1;
      });
    }
  });

  const openCreate = (parentId?: string) => {
    setEditingCat(null);
    setForm({ name: "", slug: "", description: "", meta_title: "", meta_description: "", parent_id: parentId ?? "" });
    setShowForm(true);
  };

  const openEdit = (cat: Category) => {
    setEditingCat(cat);
    setForm({
      name: cat.name,
      slug: cat.slug ?? "",
      description: cat.description ?? "",
      meta_title: cat.meta_title ?? "",
      meta_description: cat.meta_description ?? "",
      parent_id: cat.parent_id ?? "",
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (editingCat) {
      updateCategory.mutate({
        id: editingCat.id,
        updates: {
          name: form.name,
          slug: form.slug || null,
          description: form.description || null,
          meta_title: form.meta_title || null,
          meta_description: form.meta_description || null,
          parent_id: form.parent_id || null,
        },
      });
    } else {
      createCategory.mutate({
        name: form.name,
        slug: form.slug || undefined,
        description: form.description || undefined,
        meta_title: form.meta_title || undefined,
        meta_description: form.meta_description || undefined,
        parent_id: form.parent_id || null,
      });
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    const cat = flat.find(c => c.id === id);
    const hasChildren = flat.some(c => c.parent_id === id);
    if (hasChildren) {
      if (!confirm("Esta categoria tem subcategorias. As subcategorias ficarão sem pai. Continuar?")) return;
    } else {
      if (!confirm(`Eliminar "${cat?.name}"?`)) return;
    }
    deleteCategory.mutate(id);
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderTree className="w-6 h-6" /> Categorias
          </h1>
          <p className="text-muted-foreground mt-1">{flat.length} categoria(s) — partilhadas entre todos os workspaces</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => syncWooCategories.mutate()} disabled={syncWooCategories.isPending}>
            {syncWooCategories.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Sincronizar WooCommerce
          </Button>
          <Button onClick={() => openCreate()}>
            <Plus className="w-4 h-4 mr-1" /> Nova Categoria
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : tree.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FolderTree className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Nenhuma categoria criada neste workspace.</p>
              <p className="text-xs mt-1">Crie categorias para organizar os seus produtos.</p>
              <Button variant="outline" className="mt-4" onClick={() => openCreate()}>
                <Plus className="w-4 h-4 mr-1" /> Criar Primeira Categoria
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {tree.map(cat => (
                <CategoryTreeItem key={cat.id} cat={cat} flat={flat} onEdit={openEdit} onDelete={handleDelete} productCounts={productCounts} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCat ? "Editar Categoria" : "Nova Categoria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Equipamento de Cozinha" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slug</Label>
              <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="equipamento-de-cozinha" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria Pai</Label>
              <Select value={form.parent_id || "none"} onValueChange={v => setForm(f => ({ ...f, parent_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Nenhuma (raiz)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma (raiz)</SelectItem>
                  {flat.filter(c => c.id !== editingCat?.id).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição SEO</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Descrição da categoria para SEO..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Meta Title</Label>
                <Input value={form.meta_title} onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Meta Description</Label>
                <Input value={form.meta_description} onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || createCategory.isPending || updateCategory.isPending}>
              {editingCat ? "Guardar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CategoriesPage;
