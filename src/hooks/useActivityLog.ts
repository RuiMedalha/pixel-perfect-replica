import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";

export function useRecentActivity() {
  const { activeWorkspace } = useWorkspaceContext();
  return useQuery({
    queryKey: ["recent-activity", activeWorkspace?.id],
    enabled: !!activeWorkspace,
    queryFn: async () => {
      let query = supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (activeWorkspace) {
        query = query.eq("workspace_id", activeWorkspace.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
