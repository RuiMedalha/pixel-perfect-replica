import { useCallback, useState, useMemo } from "react";
import { Upload as UploadIcon, File, CheckCircle, AlertCircle, Loader2, X, Play, BookOpen, Package, Clock, Plus, Trash2, Globe, Search, Eye, RefreshCw, Download } from "lucide-react";
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

const UPDATE_FIELD_OPTIONS = [
  { key: "price", label: "Preço Original", group: "Preços" },
  { key: "optimized_price", label: "Preço Otimizado", group: "Preços" },
  { key: "sale_price", label: "Preço Promocional", group: "Preços" },
  { key: "optimized_sale_price", label: "Preço Promocional Otimizado", group: "Preços" },
  { key: "title", label: "Título Original", group: "Conteúdo" },
  { key: "optimized_title", label: "Título Otimizado", group: "Conteúdo" },
  { key: "description", label: "Descrição Original", group: "Conteúdo" },
  { key: "optimized_description", label: "Descrição Otimizada", group: "Conteúdo" },
  { key: "short_description", label: "Descrição Curta", group: "Conteúdo" },
  { key: "optimized_short_description", label: "Descrição Curta Otimizada", group: "Conteúdo" },
  { key: "category", label: "Categoria", group: "Classificação" },
  { key: "tags", label: "Tags", group: "Classificação" },
  { key: "meta_title", label: "Meta Title SEO", group: "SEO" },
  { key: "meta_description", label: "Meta Description SEO", group: "SEO" },
  { key: "seo_slug", label: "SEO Slug", group: "SEO" },
  { key: "focus_keyword", label: "Focus Keyword", group: "SEO" },
  { key: "image_urls", label: "Imagens", group: "Media" },
  { key: "attributes", label: "Atributos", group: "Classificação" },
  { key: "technical_specs", label: "Especificações Técnicas", group: "Conteúdo" },
  { key: "supplier_ref", label: "Ref. Fornecedor", group: "Classificação" },
];

function UpdateFieldsSelector({ selectedFields, onChange }: { selectedFields: string[]; onChange: (fields: string[]) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof UPDATE_FIELD_OPTIONS>();
    UPDATE_FIELD_OPTIONS.forEach((f) => {
      if (!map.has(f.group)) map.set(f.group, []);
      map.get(f.group)!.push(f);
    });
    return map;
  }, []);

  const toggle = (key: string) => {
    onChange(selectedFields.includes(key) ? selectedFields.filter((f) => f !== key) : [...selectedFields, key]);
  };

  const selectGroup = (group: string) => {
    const groupKeys = UPDATE_FIELD_OPTIONS.filter((f) => f.group === group).map((f) => f.key);
    const allSelected = groupKeys.every((k) => selectedFields.includes(k));
    if (allSelected) {
      onChange(selectedFields.filter((f) => !groupKeys.includes(f)));
    } else {
      onChange([...new Set([...selectedFields, ...groupKeys])]);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" />
          Campos a Atualizar
          {selectedFields.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{selectedFields.length} selecionado(s)</Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Apenas os campos selecionados serão sobrescritos nos produtos existentes (identificados pelo SKU).
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from(groups.entries()).map(([group, fields]) => (
            <div key={group}>
              <button
                onClick={() => selectGroup(group)}
                className="text-xs font-semibold text-muted-foreground mb-1.5 hover:text-foreground transition-colors cursor-pointer"
              >
                {group}
              </button>
              <div className="flex flex-wrap gap-2">
                {fields.map((f) => (
                  <label
                    key={f.key}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer transition-all",
                      selectedFields.includes(f.key)
                        ? "bg-primary/10 border-primary/40 text-primary font-medium"
                        : "bg-muted/30 border-border text-muted-foreground hover:border-primary/20"
                    )}
                  >
                    <Checkbox
                      checked={selectedFields.includes(f.key)}
                      onCheckedChange={() => toggle(f.key)}
                      className="w-3.5 h-3.5"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const UploadPage = () => {
  const {
    files, addFiles, processAllFiles: processAll, processFile, removeFile,
    setColumnMapping, confirmMapping, reopenMapping, selectSheet, setUpdateFields,
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
            <br />
            <span className="text-primary font-medium">💡 Pode re-importar o mesmo Excel com colunas diferentes — os dados são acrescentados sem apagar o que já existe (merge inteligente por SKU).</span>
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
          {activeTab === "update" ? (
            <RefreshCw className="w-12 h-12 text-muted-foreground mb-4" />
          ) : activeTab === "products" ? (
            <Package className="w-12 h-12 text-muted-foreground mb-4" />
          ) : (
            <BookOpen className="w-12 h-12 text-muted-foreground mb-4" />
          )}
          <p className="text-lg font-medium mb-1">
            {activeTab === "update"
              ? "Arraste o Excel com alterações para aqui"
              : `Arraste ficheiros ${activeTab === "products" ? "de produtos" : "de conhecimento"} para aqui`}
          </p>
          <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar</p>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              Selecionar Ficheiros
              <input
                type="file"
                multiple
                accept={activeTab === "update" ? ".xlsx,.xls" : ".pdf,.xlsx,.xls"}
                className="hidden"
                onChange={onFileSelect}
              />
            </label>
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            {activeTab === "update"
              ? "Apenas Excel (XLSX/XLS) — os produtos serão identificados pelo SKU"
              : `Formatos aceites: PDF, XLSX, XLS${activeTab === "products" ? " — Excel permite mapeamento de colunas" : ""}`}
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

      {/* Column mapping cards for Excel files — visible even after confirmation */}
      {files
        .filter((f) => f.excelHeaders && (f.status === "a_mapear" || f.status === "aguardando" || f.status === "concluido" || f.status === "erro"))
        .map((file) => {
          const isConfirmed = file.status === "aguardando" || file.status === "concluido" || file.status === "erro";
          return (
            <div key={file.id} className="space-y-4">
              {isConfirmed ? (
                <Card className={cn(
                  "border-primary/30",
                  file.status === "concluido" ? "border-green-500/30 bg-green-500/5" : 
                  file.status === "erro" ? "border-destructive/30 bg-destructive/5" : 
                  "bg-primary/5"
                )}>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {file.status === "concluido" ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : file.status === "erro" ? (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-primary" />
                      )}
                      <span className="truncate">
                        {file.status === "concluido" ? "Processado" : file.status === "erro" ? "Erro" : "Mapeamento Confirmado"}
                        {" — "}
                      </span>
                      <span className="font-normal text-muted-foreground truncate">{file.name}</span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {Object.keys(file.columnMapping || {}).length} campos mapeados
                      </Badge>
                    </CardTitle>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => reopenMapping(file.id)}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Editar Mapeamento
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-1.5">
                      {allFields.filter((f) => file.columnMapping?.[f.key]).map((f) => (
                        <Badge key={f.key} variant="outline" className="text-[10px] font-normal gap-1">
                          {f.label} <span className="text-muted-foreground">← {file.columnMapping?.[f.key]}</span>
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <ColumnMapper
                  fileName={file.name}
                  headers={file.excelHeaders!}
                  previewRows={file.previewRows || []}
                  mapping={file.columnMapping || {}}
                  sheetNames={file.sheetNames}
                  selectedSheet={file.selectedSheet}
                  fields={allFields}
                  onSheetChange={(s) => selectSheet(file.id, s)}
                  onMappingChange={(m) => setColumnMapping(file.id, m)}
                  onConfirm={() => {
                    if (file.uploadType === "update" && (!file.updateFields || file.updateFields.length === 0)) {
                      toast.error("Selecione pelo menos um campo para atualizar.");
                      return;
                    }
                    confirmMapping(file.id);
                  }}
                />
              )}
              {/* Update fields selector for update mode */}
              {file.uploadType === "update" && (
                <UpdateFieldsSelector
                  selectedFields={file.updateFields || []}
                  onChange={(fields) => setUpdateFields(file.id, fields)}
                />
              )}
            </div>
          );
        })}

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
                        <Badge variant={file.uploadType === "knowledge" ? "outline" : file.uploadType === "update" ? "default" : "secondary"} className="text-[10px]">
                          {file.uploadType === "knowledge" ? "Conhecimento" : file.uploadType === "update" ? "Atualização" : "Produtos"}
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
                const isExcel = record.metadata?.type === "Excel";
                const savedMapping = record.metadata?.columnMapping as Record<string, string> | undefined;
                const mappedFieldCount = savedMapping ? Object.keys(savedMapping).length : 0;
                return (
                  <div key={record.id} className="space-y-1">
                    <div className="flex items-center gap-3 p-2 rounded bg-muted/30 text-sm">
                      <Badge
                        variant={isWebScrape ? "default" : record.file_type === "knowledge" ? "outline" : "secondary"}
                        className="text-[10px] shrink-0"
                      >
                        {isWebScrape ? "🌐 Web" : record.file_type === "knowledge" ? "Conhecimento" : "Produtos"}
                      </Badge>
                      <span className="truncate flex-1">{record.file_name}</span>
                      {isExcel && mappedFieldCount > 0 && (
                        <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                          {mappedFieldCount} campos mapeados
                        </Badge>
                      )}
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
                      {record.storage_path && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] shrink-0 gap-1"
                          onClick={async () => {
                            const { data, error } = await supabase.storage
                              .from("catalogs")
                              .createSignedUrl(record.storage_path, 60);
                            if (error || !data?.signedUrl) {
                              toast.error("Erro ao gerar link de download.");
                              return;
                            }
                            const a = document.createElement("a");
                            a.href = data.signedUrl;
                            a.download = record.file_name;
                            a.click();
                          }}
                        >
                          <Download className="w-3 h-3" />
                          Descarregar
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
                    {isExcel && savedMapping && mappedFieldCount > 0 && (
                      <div className="pl-4 flex flex-wrap gap-1">
                        {allFields.filter((f) => savedMapping[f.key]).map((f) => (
                          <Badge key={f.key} variant="outline" className="text-[10px] font-normal gap-1">
                            {f.label} <span className="text-muted-foreground">← {savedMapping[f.key]}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
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
