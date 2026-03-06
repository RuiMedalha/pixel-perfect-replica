import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useUploadedFiles() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["uploaded-files", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let query = supabase
        .from("uploaded_files")
        .select("*")
        .order("created_at", { ascending: false });
      if (activeWorkspace) {
        query = query.eq("workspace_id", activeWorkspace.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
