import { useCallback, useState } from "react";
import { Upload as UploadIcon, File, CheckCircle, AlertCircle, Loader2, X, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useUploadCatalog } from "@/hooks/useUploadCatalog";
import { ColumnMapper } from "@/components/ColumnMapper";

const UploadPage = () => {
  const { files, addFiles, processAll, processFile, removeFile, setColumnMapping, confirmMapping } = useUploadCatalog();
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
      e.target.value = "";
    },
    [addFiles]
  );

  const hasPending = files.some((f) => f.status === "aguardando");
  const isProcessing = files.some((f) => f.status === "a_enviar" || f.status === "a_processar");

  const statusConfig: Record<string, { label: string; icon: typeof File; className: string }> = {
    aguardando: { label: "Pronto", icon: File, className: "text-muted-foreground" },
    a_mapear: { label: "A mapear", icon: File, className: "text-primary" },
    a_enviar: { label: "A enviar...", icon: Loader2, className: "text-primary animate-spin" },
    a_processar: { label: "A processar...", icon: Loader2, className: "text-primary animate-spin" },
    concluido: { label: "Concluído", icon: CheckCircle, className: "text-green-600" },
    erro: { label: "Erro", icon: AlertCircle, className: "text-destructive" },
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload de Ficheiros</h1>
        <p className="text-muted-foreground mt-1">
          Carregue catálogos em PDF ou listas de produtos em Excel para importar produtos automaticamente.
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
          <p className="text-xs text-muted-foreground mt-3">
            Formatos aceites: PDF, XLSX, XLS — PDFs são processados com IA, Excel permite mapeamento de colunas
          </p>
        </CardContent>
      </Card>

      {/* Column mapping cards for Excel files */}
      {files
        .filter((f) => f.status === "a_mapear" && f.excelHeaders)
        .map((file) => (
          <ColumnMapper
            key={file.id}
            fileName={file.name}
            headers={file.excelHeaders!}
            previewRows={file.previewRows || []}
            mapping={file.columnMapping || {}}
            onMappingChange={(m) => setColumnMapping(file.id, m)}
            onConfirm={() => confirmMapping(file.id)}
          />
        ))}

      {/* File list */}
      {files.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Ficheiros ({files.length})</CardTitle>
            {hasPending && (
              <Button onClick={processAll} disabled={isProcessing} size="sm">
                <Play className="w-4 h-4 mr-1" />
                Processar Todos
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {files.map((file) => {
                const config = statusConfig[file.status];
                const StatusIcon = config.icon;
                return (
                  <div key={file.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                    <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
                      <span className="text-xs font-mono font-medium text-accent-foreground">
                        {file.type}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                        {file.productsCount != null && ` · ${file.productsCount} produto(s)`}
                        {file.error && ` · ${file.error}`}
                      </p>
                      {(file.status === "a_enviar" || file.status === "a_processar") && (
                        <Progress value={file.progress} className="mt-2 h-1.5" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {file.status === "aguardando" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => processFile(file)}
                          disabled={isProcessing}
                        >
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <StatusIcon className={cn("w-4 h-4", config.className)} />
                      <span className={cn("text-xs font-medium whitespace-nowrap", config.className)}>
                        {config.label}
                      </span>
                      {(file.status === "aguardando" || file.status === "a_mapear" || file.status === "concluido" || file.status === "erro") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeFile(file.id)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
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
