import { useCallback, useState, useMemo } from "react";
import { Upload as UploadIcon, File, CheckCircle, AlertCircle, Loader2, X, Play, BookOpen, Package, Clock, Plus, Trash2, Globe, Search, Eye, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUploadCatalog, type FileUploadType } from "@/hooks/useUploadCatalog";
import { useUploadedFiles } from "@/hooks/useUploadedFiles";
import { useDeleteUploadedFile } from "@/hooks/useDeleteUploadedFile";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { ColumnMapper } from "@/components/ColumnMapper";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const UploadPage = () => {
  const {
    files, addFiles, processAllFiles: processAll, processFile, removeFile,
    setColumnMapping, confirmMapping, selectSheet, setUpdateFields,
    allFields, customFields, addCustomField, removeCustomField,
  } = useUploadCatalog();
  const { data: uploadHistory } = useUploadedFiles();
  const deleteUploadedFile = useDeleteUploadedFile();
  const { activeWorkspace } = useWorkspaceContext();
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<FileUploadType>("products");
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [addFieldOpen, setAddFieldOpen] = useState(false);

  // Scraping state
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; text: string } | null>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, activeTab);
    },
    [addFiles, activeTab]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files, activeTab);
      e.target.value = "";
    },
    [addFiles, activeTab]
  );

  const handleScrapeUrl = async () => {
    if (!scrapeUrl.trim()) return;
    setIsScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-supplier", {
        body: { url: scrapeUrl.trim(), action: "scrape", workspaceId: activeWorkspace?.id },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro ao extrair conteúdo");

      toast.success(`Conteúdo extraído de "${data.title}" (${data.chars} caracteres). Guardado como conhecimento.`);
      setScrapeUrl("");
      qc.invalidateQueries({ queryKey: ["uploaded-files"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fazer scraping");
    } finally {
      setIsScraping(false);
    }
  };

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

  const handleAddField = () => {
    if (newFieldKey && newFieldLabel) {
      addCustomField(newFieldKey.toLowerCase().replace(/\s+/g, "_"), newFieldLabel);
      setNewFieldKey("");
      setNewFieldLabel("");
      setAddFieldOpen(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Upload de Ficheiros</h1>
        <p className="text-muted-foreground mt-1">
          Carregue catálogos de produtos, ficheiros de conhecimento, ou extraia dados de sites de fornecedores.
        </p>
      </div>

      {/* File type tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FileUploadType)}>
        <TabsList>
          <TabsTrigger value="products" className="gap-2">
            <Package className="w-4 h-4" /> Produtos
          </TabsTrigger>
          <TabsTrigger value="update" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Atualização
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2">
            <BookOpen className="w-4 h-4" /> Conhecimento
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Ficheiros com listas de produtos para importar (Excel com mapeamento de colunas, ou PDF processado com IA).
          </p>
        </TabsContent>
        <TabsContent value="update" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Re-importe um Excel exportado com alterações. Escolha os campos a atualizar — os produtos são identificados pelo SKU.
          </p>
        </TabsContent>
        <TabsContent value="knowledge" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Ficheiros de referência ou sites de fornecedores. O conteúdo será extraído e usado como contexto nas otimizações.
          </p>

          {/* Web Scraping Section */}
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Extrair de Site de Fornecedor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Cole a URL de uma página de produto ou catálogo do fornecedor. O conteúdo será extraído automaticamente e guardado como conhecimento para enriquecer as otimizações.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="https://fornecedor.com/catalogo/produto-xyz"
                  value={scrapeUrl}
                  onChange={(e) => setScrapeUrl(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleScrapeUrl()}
                />
                <Button onClick={handleScrapeUrl} disabled={isScraping || !scrapeUrl.trim()} size="sm">
                  {isScraping ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 mr-1" />
                  )}
                  {isScraping ? "A extrair..." : "Extrair"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
          {activeTab === "products" ? (
            <Package className="w-12 h-12 text-muted-foreground mb-4" />
          ) : (
            <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
          )}
          <p className="text-lg font-medium mb-1">
            Arraste ficheiros {activeTab === "products" ? "de produtos" : "de conhecimento"} para aqui
          </p>
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
            Formatos aceites: PDF, XLSX, XLS
            {activeTab === "products" && " — Excel permite mapeamento de colunas"}
          </p>
        </CardContent>
      </Card>

      {/* Custom fields management for products */}
      {activeTab === "products" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Campos mapeáveis:</span>
          {allFields.map((f) => (
            <Badge key={f.key} variant="secondary" className="text-xs gap-1">
              {f.label}
              {customFields.some((cf) => cf.key === f.key) && (
                <button onClick={() => removeCustomField(f.key)} className="ml-1 hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              )}
            </Badge>
          ))}
          <Dialog open={addFieldOpen} onOpenChange={setAddFieldOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                <Plus className="w-3 h-3" /> Adicionar Campo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Adicionar Campo Personalizado</DialogTitle>
                <DialogDescription>Crie um novo campo para mapear colunas do Excel.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Chave (sem espaços)</Label>
                  <Input placeholder="ex: weight" value={newFieldKey} onChange={(e) => setNewFieldKey(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nome visível</Label>
                  <Input placeholder="ex: Peso" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} />
                </div>
                <Button onClick={handleAddField} disabled={!newFieldKey || !newFieldLabel} size="sm">
                  Adicionar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

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
            sheetNames={file.sheetNames}
            selectedSheet={file.selectedSheet}
            fields={allFields}
            onSheetChange={(s) => selectSheet(file.id, s)}
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
              <Button onClick={() => processAll(activeWorkspace?.id)} disabled={isProcessing} size="sm">
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
                      {file.uploadType === "knowledge" ? (
                        <BookOpen className="w-4 h-4 text-accent-foreground" />
                      ) : (
                        <span className="text-xs font-mono font-medium text-accent-foreground">
                          {file.type}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <Badge variant={file.uploadType === "knowledge" ? "outline" : "secondary"} className="text-[10px]">
                          {file.uploadType === "knowledge" ? "Conhecimento" : "Produtos"}
                        </Badge>
                      </div>
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
                          onClick={() => processFile(file, activeWorkspace?.id)}
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

      {/* Upload history */}
      {uploadHistory && uploadHistory.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Histórico de Uploads
            </CardTitle>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm(`Tem a certeza que deseja eliminar todos os ${uploadHistory.length} ficheiro(s) do histórico?`)) {
                  uploadHistory.forEach((r: any) => deleteUploadedFile.mutate(r.id));
                }
              }}
              disabled={deleteUploadedFile.isPending}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Apagar Todos
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {uploadHistory.map((record: any) => {
                const isWebScrape = record.metadata?.type === "web_scrape";
                return (
                  <div key={record.id} className="flex items-center gap-3 p-2 rounded bg-muted/30 text-sm">
                    <Badge
                      variant={isWebScrape ? "default" : record.file_type === "knowledge" ? "outline" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      {isWebScrape ? "🌐 Web" : record.file_type === "knowledge" ? "Conhecimento" : "Produtos"}
                    </Badge>
                    <span className="truncate flex-1">{record.file_name}</span>
                    {record.extracted_text && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] shrink-0 gap-1"
                        onClick={() => setPreviewFile({ name: record.file_name, text: record.extracted_text })}
                      >
                        <Eye className="w-3 h-3" />
                        Ver Conteúdo
                      </Button>
                    )}
                    {record.products_count > 0 && (
                      <span className="text-xs text-muted-foreground">{record.products_count} produtos</span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0">
                      {format(new Date(record.created_at), "dd/MM/yyyy HH:mm")}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => deleteUploadedFile.mutate(record.id)}
                      disabled={deleteUploadedFile.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Knowledge preview dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">{previewFile?.name}</DialogTitle>
            <DialogDescription className="text-xs">
              Conteúdo extraído ({previewFile?.text.length.toLocaleString()} caracteres)
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[60vh] border rounded-lg p-4">
            <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">{previewFile?.text}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UploadPage;
