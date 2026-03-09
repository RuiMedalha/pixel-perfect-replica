import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  has_variable_products: boolean;
  created_at: string;
  updated_at: string;
}

interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  createWorkspace: (name: string, description?: string) => void;
  updateWorkspace: (id: string, name: string, description?: string) => void;
  toggleVariableProducts: (id: string, value: boolean) => void;
  deleteWorkspace: (id: string) => void;
  mergeWorkspaces: (sourceId: string, targetId: string) => void;
  isCreating: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function useWorkspaceContext() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => {
    return localStorage.getItem("active_workspace_id");
  });

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ["workspaces"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Workspace[];
    },
  });

  // Auto-create default workspace if none exist
  useEffect(() => {
    if (!isLoading && workspaces.length === 0 && user) {
      supabase
        .from("workspaces")
        .insert({ user_id: user.id, name: "Geral", description: "Workspace padrão" } as any)
        .select()
        .single()
        .then(({ data }) => {
          if (data) {
            qc.invalidateQueries({ queryKey: ["workspaces"] });
          }
        });
    }
  }, [isLoading, workspaces.length, user]);

  // Auto-select first workspace
  useEffect(() => {
    if (workspaces.length > 0 && (!activeId || !workspaces.find((w) => w.id === activeId))) {
      const id = workspaces[0].id;
      setActiveId(id);
      localStorage.setItem("active_workspace_id", id);
    }
  }, [workspaces, activeId]);

  const activeWorkspace = workspaces.find((w) => w.id === activeId) || null;

  const setActiveWorkspaceId = (id: string) => {
    setActiveId(id);
    localStorage.setItem("active_workspace_id", id);
    // Invalidate data queries so they re-fetch with new workspace
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product-stats"] });
    qc.invalidateQueries({ queryKey: ["uploaded-files"] });
    qc.invalidateQueries({ queryKey: ["recent-activity"] });
    qc.invalidateQueries({ queryKey: ["token-usage-summary"] });
    qc.invalidateQueries({ queryKey: ["optimization-logs"] });
    qc.invalidateQueries({ queryKey: ["quality-metrics"] });
  };

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("workspaces")
        .insert({ user_id: user.id, name, description: description || null } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Workspace;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      setActiveWorkspaceId(data.id);
      toast.success(`Workspace "${data.name}" criado!`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, description, has_variable_products }: { id: string; name: string; description?: string; has_variable_products?: boolean }) => {
      const updateData: any = { name, description: description || null };
      if (has_variable_products !== undefined) updateData.has_variable_products = has_variable_products;
      const { error } = await supabase
        .from("workspaces")
        .update(updateData)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace atualizado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (deletedId) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      if (activeId === deletedId && workspaces.length > 1) {
        const other = workspaces.find((w) => w.id !== deletedId);
        if (other) setActiveWorkspaceId(other.id);
      }
      toast.success("Workspace eliminado!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      // Move all products, uploaded_files, knowledge_chunks, categories, activity_log, optimization_jobs, publish_jobs
      const tables = ["products", "uploaded_files", "knowledge_chunks", "categories", "activity_log", "optimization_jobs", "publish_jobs"] as const;
      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .update({ workspace_id: targetId } as any)
          .eq("workspace_id", sourceId);
        if (error) console.warn(`Merge ${table}:`, error.message);
      }
      // Delete source workspace
      const { error } = await supabase.from("workspaces").delete().eq("id", sourceId);
      if (error) throw error;
      return targetId;
    },
    onSuccess: (targetId) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
      setActiveWorkspaceId(targetId);
      toast.success("Workspaces fundidos com sucesso!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        setActiveWorkspaceId,
        isLoading,
        createWorkspace: (name, description) => createMutation.mutate({ name, description }),
        updateWorkspace: (id, name, description) => updateMutation.mutate({ id, name, description }),
        toggleVariableProducts: (id: string, value: boolean) => {
          const ws = workspaces.find((w) => w.id === id);
          if (ws) updateMutation.mutate({ id, name: ws.name, description: ws.description || undefined, has_variable_products: value });
        },
        deleteWorkspace: (id) => deleteMutation.mutate(id),
        isCreating: createMutation.isPending,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
