import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useDeleteUploadedFile() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      // Get file info first to delete from storage
      const { data: file } = await supabase
        .from("uploaded_files")
        .select("storage_path")
        .eq("id", fileId)
        .single();

      if (file?.storage_path) {
        await supabase.storage.from("catalogs").remove([file.storage_path]);
      }

      const { error } = await supabase
        .from("uploaded_files")
        .delete()
        .eq("id", fileId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
      toast.success("Ficheiro eliminado com sucesso.");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
