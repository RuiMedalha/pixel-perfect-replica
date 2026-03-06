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
  deleteWorkspace: (id: string) => void;
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
    mutationFn: async ({ id, name, description }: { id: string; name: string; description?: string }) => {
      const { error } = await supabase
        .from("workspaces")
        .update({ name, description: description || null })
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

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        setActiveWorkspaceId,
        isLoading,
        createWorkspace: (name, description) => createMutation.mutate({ name, description }),
        updateWorkspace: (id, name, description) => updateMutation.mutate({ id, name, description }),
        deleteWorkspace: (id) => deleteMutation.mutate(id),
        isCreating: createMutation.isPending,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
