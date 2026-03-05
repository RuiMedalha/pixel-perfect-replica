import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export interface UploadedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: "aguardando" | "a_enviar" | "a_processar" | "concluido" | "erro";
  progress: number;
  productsCount?: number;
  error?: string;
}

export function useUploadCatalog() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const qc = useQueryClient();

  const updateFile = (id: string, update: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...update } : f)));
  };

  const addFiles = (fileList: FileList) => {
    const accepted = Array.from(fileList).filter(
      (f) =>
        f.name.endsWith(".pdf") ||
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls")
    );
    if (accepted.length === 0) {
      toast.error("Apenas ficheiros PDF, XLSX e XLS são aceites.");
      return;
    }
    const newFiles: UploadedFile[] = accepted.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      size: f.size,
      type: f.name.endsWith(".pdf") ? "PDF" : "Excel",
      status: "aguardando",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const processFile = async (uploadedFile: UploadedFile) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      updateFile(uploadedFile.id, { status: "erro", error: "Utilizador não autenticado" });
      toast.error("É necessário estar autenticado para fazer upload.");
      return;
    }

    try {
      // 1. Upload to storage
      updateFile(uploadedFile.id, { status: "a_enviar", progress: 20 });
      const filePath = `${user.id}/${Date.now()}_${uploadedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("catalogs")
        .upload(filePath, uploadedFile.file);

      if (uploadError) throw new Error("Erro no upload: " + uploadError.message);

      // 2. Call edge function to parse
      updateFile(uploadedFile.id, { status: "a_processar", progress: 50 });
      const { data, error } = await supabase.functions.invoke("parse-catalog", {
        body: { filePath, fileName: uploadedFile.name },
      });

      if (error) throw new Error(error.message || "Erro ao processar ficheiro");
      if (data?.error && data?.count === undefined) throw new Error(data.error);

      const count = data?.count || 0;
      updateFile(uploadedFile.id, {
        status: "concluido",
        progress: 100,
        productsCount: count,
      });
      toast.success(`${count} produto(s) importado(s) de "${uploadedFile.name}"`);

      // Invalidate queries
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product-stats"] });
      qc.invalidateQueries({ queryKey: ["recent-activity"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      updateFile(uploadedFile.id, { status: "erro", progress: 0, error: msg });
      toast.error(msg);
    }
  };

  const processAll = async () => {
    const pending = files.filter((f) => f.status === "aguardando");
    for (const file of pending) {
      await processFile(file);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return { files, addFiles, processAll, processFile, removeFile };
}
