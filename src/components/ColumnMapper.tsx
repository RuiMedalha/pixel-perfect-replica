import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, ArrowRight } from "lucide-react";
import { PRODUCT_FIELDS, type ColumnMapping } from "@/hooks/useUploadCatalog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const IGNORE_VALUE = "__ignore__";

interface ColumnMapperProps {
  fileName: string;
  headers: string[];
  previewRows: Record<string, unknown>[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  onConfirm: () => void;
}

export function ColumnMapper({
  fileName,
  headers,
  previewRows,
  mapping,
  onMappingChange,
  onConfirm,
}: ColumnMapperProps) {
  const setField = (productField: string, excelColumn: string) => {
    const newMapping = { ...mapping };
    if (excelColumn === IGNORE_VALUE) {
      delete newMapping[productField];
    } else {
      newMapping[productField] = excelColumn;
    }
    onMappingChange(newMapping);
  };

  const hasTitleMapped = !!mapping.title;

  // Get the mapped headers for preview
  const mappedHeaders = PRODUCT_FIELDS.filter((f) => mapping[f.key]).map((f) => ({
    field: f,
    excelCol: mapping[f.key],
  }));

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowRight className="w-4 h-4 text-primary" />
          Mapear Colunas — <span className="font-normal text-muted-foreground">{fileName}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mapping selects */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PRODUCT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
                {mapping[field.key] && (
                  <Check className="w-3 h-3 text-green-600 ml-auto" />
                )}
              </label>
              <Select
                value={mapping[field.key] || IGNORE_VALUE}
                onValueChange={(v) => setField(field.key, v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Ignorar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE_VALUE}>
                    <span className="text-muted-foreground">— Ignorar —</span>
                  </SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {/* Preview table */}
        {mappedHeaders.length > 0 && previewRows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Pré-visualização ({previewRows.length} primeiras linhas)
            </p>
            <div className="border rounded-lg overflow-auto max-h-48">
              <Table>
                <TableHeader>
                  <TableRow>
                    {mappedHeaders.map(({ field }) => (
                      <TableHead key={field.key} className="text-xs whitespace-nowrap py-1.5 px-2">
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {field.label}
                        </Badge>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {mappedHeaders.map(({ field, excelCol }) => (
                        <TableCell key={field.key} className="text-xs py-1.5 px-2 max-w-[200px] truncate">
                          {String(row[excelCol] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {hasTitleMapped
              ? "Mapeamento pronto. Confirme para prosseguir."
              : "Mapeie pelo menos o campo Título para continuar."}
          </p>
          <Button size="sm" disabled={!hasTitleMapped} onClick={onConfirm}>
            <Check className="w-4 h-4 mr-1" />
            Confirmar Mapeamento
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
