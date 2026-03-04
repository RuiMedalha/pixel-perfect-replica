import { useState, useCallback } from "react";
import { Upload as UploadIcon, File, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  status: "aguardando" | "a_processar" | "concluido" | "erro";
  progress: number;
}

const UploadPage = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback((fileList: FileList) => {
    const accepted = Array.from(fileList).filter(
      (f) => f.name.endsWith(".pdf") || f.name.endsWith(".xlsx") || f.name.endsWith(".xls")
    );
    const newFiles: UploadedFile[] = accepted.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.name.endsWith(".pdf") ? "PDF" : "Excel",
      status: "aguardando",
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const statusConfig = {
    aguardando: { label: "Aguardando", icon: File, className: "text-muted-foreground" },
    a_processar: { label: "A processar...", icon: Loader2, className: "text-primary animate-spin" },
    concluido: { label: "Concluído", icon: CheckCircle, className: "text-success" },
    erro: { label: "Erro", icon: AlertCircle, className: "text-destructive" },
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload de Ficheiros</h1>
        <p className="text-muted-foreground mt-1">
          Carregue catálogos em PDF ou listas de produtos em Excel.
        </p>
      </div>

      {/* Drop zone */}
      <Card
        className={cn(
          "border-2 border-dashed transition-colors cursor-pointer",
          dragOver ? "border-primary bg-accent" : "border-border hover:border-primary/50"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-16">
          <UploadIcon className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-lg font-medium mb-1">Arraste ficheiros para aqui</p>
          <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar</p>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              Selecionar Ficheiros
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls"
                className="hidden"
                onChange={onFileSelect}
              />
            </label>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Formatos aceites: PDF, XLSX, XLS</p>
        </CardContent>
      </Card>

      {/* File list */}
      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ficheiros Carregados ({files.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {files.map((file, i) => {
                const config = statusConfig[file.status];
                const StatusIcon = config.icon;
                return (
                  <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                    <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
                      <span className="text-xs font-mono font-medium text-accent-foreground">
                        {file.type}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </p>
                      {file.status === "a_processar" && (
                        <Progress value={file.progress} className="mt-2 h-1.5" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusIcon className={cn("w-4 h-4", config.className)} />
                      <span className={cn("text-xs font-medium", config.className)}>
                        {config.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default UploadPage;
