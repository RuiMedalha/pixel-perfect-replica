import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Upload, Package, Settings, ChevronLeft, ChevronRight, LogOut, Users, Plus, FolderOpen, Check, FolderTree, GitBranch, Pencil, Trash2, Merge, MoreHorizontal, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUserProfile } from "@/hooks/useUserManagement";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast } from "sonner";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Upload" },
  { to: "/produtos", icon: Package, label: "Produtos" },
  { to: "/variacoes", icon: GitBranch, label: "Variações" },
  { to: "/categorias", icon: FolderTree, label: "Categorias" },
  { to: "/importar-woo", icon: ShoppingCart, label: "Importar WooCommerce" },
];

const adminItems = [
  { to: "/configuracoes", icon: Settings, label: "Configurações" },
  { to: "/admin/utilizadores", icon: Users, label: "Utilizadores" },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { data: profile } = useCurrentUserProfile();
  const { workspaces, activeWorkspace, setActiveWorkspaceId, createWorkspace, updateWorkspace, deleteWorkspace, mergeWorkspaces, isCreating } = useWorkspaceContext();
  const [showNewWs, setShowNewWs] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [editWs, setEditWs] = useState<{ id: string; name: string } | null>(null);
  const [deleteWs, setDeleteWs] = useState<{ id: string; name: string } | null>(null);
  const [mergeWs, setMergeWs] = useState<{ sourceId: string; sourceName: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const allItems = [...navItems, ...(profile?.isAdmin ? adminItems : [])];

  const handleCreateWorkspace = () => {
    if (newWsName.trim()) {
      createWorkspace(newWsName.trim());
      setNewWsName("");
      setShowNewWs(false);
    }
  };

  const handleEditWorkspace = () => {
    if (editWs && editWs.name.trim()) {
      updateWorkspace(editWs.id, editWs.name.trim());
      setEditWs(null);
    }
  };

  const handleDeleteWorkspace = () => {
    if (deleteWs) {
      deleteWorkspace(deleteWs.id);
      setDeleteWs(null);
    }
  };

  const handleMergeWorkspaces = () => {
    if (mergeWs && mergeTargetId) {
      mergeWorkspaces(mergeWs.sourceId, mergeTargetId);
      setMergeWs(null);
      setMergeTargetId("");
    }
  };

  return (
    <>
      <aside
        className={cn(
          "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 h-screen sticky top-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-border">
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
                <span className="text-sidebar-primary-foreground font-bold text-sm">HE</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-sidebar-accent-foreground font-semibold text-sm truncate">Hotelequip</h1>
                <p className="text-sidebar-muted text-xs truncate">Product Optimizer</p>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center mx-auto">
              <span className="text-sidebar-primary-foreground font-bold text-sm">HE</span>
            </div>
          )}
        </div>

        {/* Workspace Selector */}
        {!collapsed && (
          <div className="px-2 py-3 border-b border-sidebar-border">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-muted px-3 mb-1.5 font-medium">Workspace</p>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {workspaces.map((ws) => (
                <div key={ws.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => setActiveWorkspaceId(ws.id)}
                    className={cn(
                      "flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 rounded-md text-xs transition-colors",
                      ws.id === activeWorkspace?.id
                        ? "bg-sidebar-accent text-sidebar-primary font-medium"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{ws.name}</span>
                    {ws.id === activeWorkspace?.id && <Check className="w-3 h-3 ml-auto shrink-0" />}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-sidebar-accent/50 transition-all shrink-0">
                        <MoreHorizontal className="w-3 h-3 text-sidebar-muted" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => setEditWs({ id: ws.id, name: ws.name })}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Renomear
                      </DropdownMenuItem>
                      {workspaces.length > 1 && (
                        <DropdownMenuItem onClick={() => { setMergeWs({ sourceId: ws.id, sourceName: ws.name }); setMergeTargetId(""); }}>
                          <Merge className="w-3.5 h-3.5 mr-2" /> Fundir noutro
                        </DropdownMenuItem>
                      )}
                      {workspaces.length > 1 && (
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteWs({ id: ws.id, name: ws.name })}>
                          <Trash2 className="w-3.5 h-3.5 mr-2" /> Eliminar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowNewWs(true)}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors mt-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo workspace</span>
            </button>
          </div>
        )}
        {collapsed && (
          <div className="px-2 py-3 border-b border-sidebar-border">
            <button
              onClick={() => setShowNewWs(true)}
              className="w-10 h-10 mx-auto rounded-lg bg-sidebar-accent flex items-center justify-center text-sidebar-primary"
              title={activeWorkspace?.name || "Workspace"}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        <nav className="flex-1 py-4 px-2 space-y-1">
          {allItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border px-2 py-2 space-y-1">
          {!collapsed && user && (
            <p className="text-sidebar-muted text-xs truncate px-3 py-1">{user.email}</p>
          )}
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={signOut}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive transition-colors w-full",
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-muted hover:text-sidebar-accent-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* New Workspace Dialog */}
      <Dialog open={showNewWs} onOpenChange={setShowNewWs}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                placeholder="Ex: Fornecedor X, Marca Y"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewWs(false)}>Cancelar</Button>
            <Button onClick={handleCreateWorkspace} disabled={!newWsName.trim() || isCreating}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Workspace Dialog */}
      <Dialog open={!!editWs} onOpenChange={(open) => !open && setEditWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={editWs?.name ?? ""}
                onChange={(e) => setEditWs((prev) => prev ? { ...prev, name: e.target.value } : null)}
                onKeyDown={(e) => e.key === "Enter" && handleEditWorkspace()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditWs(null)}>Cancelar</Button>
            <Button onClick={handleEditWorkspace} disabled={!editWs?.name.trim()}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workspace Dialog */}
      <Dialog open={!!deleteWs} onOpenChange={(open) => !open && setDeleteWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar Workspace</DialogTitle>
            <DialogDescription>
              Tem a certeza que deseja eliminar o workspace <strong>"{deleteWs?.name}"</strong>? Todos os produtos, ficheiros e dados associados serão eliminados permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteWs(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteWorkspace}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Workspace Dialog */}
      <Dialog open={!!mergeWs} onOpenChange={(open) => !open && setMergeWs(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fundir Workspaces</DialogTitle>
            <DialogDescription>
              Mover todos os produtos e dados de <strong>"{mergeWs?.sourceName}"</strong> para outro workspace. O workspace de origem será eliminado após a fusão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Workspace destino</Label>
              <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                <SelectTrigger><SelectValue placeholder="Selecionar workspace..." /></SelectTrigger>
                <SelectContent>
                  {workspaces.filter((w) => w.id !== mergeWs?.sourceId).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeWs(null)}>Cancelar</Button>
            <Button onClick={handleMergeWorkspaces} disabled={!mergeTargetId}>Fundir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
