import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Save, RotateCcw, Loader2 } from "lucide-react";
import { FIELD_PROMPTS, useFieldPrompts, useSaveFieldPrompt, useProductCategories } from "@/hooks/useFieldPrompts";
import { ScrollArea } from "@/components/ui/scroll-area";

export function FieldPromptsSettings() {
  const { data: savedPrompts, isLoading } = useFieldPrompts();
  const { data: categories } = useProductCategories();
  const savePrompt = useSaveFieldPrompt();
  const [openFields, setOpenFields] = useState<Set<string>>(new Set());
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({});

  const toggle = (key: string) => {
    setOpenFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getPromptValue = (field: typeof FIELD_PROMPTS[0]) => {
    if (editedPrompts[field.settingKey] !== undefined) return editedPrompts[field.settingKey];
    if (savedPrompts?.[field.settingKey]) return savedPrompts[field.settingKey];
    return field.defaultPrompt;
  };

  const isModified = (field: typeof FIELD_PROMPTS[0]) => {
    return editedPrompts[field.settingKey] !== undefined;
  };

  const handleSave = (field: typeof FIELD_PROMPTS[0]) => {
    const value = getPromptValue(field);
    savePrompt.mutate({ key: field.settingKey, value });
    setEditedPrompts((prev) => {
      const next = { ...prev };
      delete next[field.settingKey];
      return next;
    });
  };

  const handleReset = (field: typeof FIELD_PROMPTS[0]) => {
    setEditedPrompts((prev) => ({ ...prev, [field.settingKey]: field.defaultPrompt }));
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">📝 Prompts por Campo</CardTitle>
        <p className="text-xs text-muted-foreground">
          Personalize as instruções da IA para cada campo de otimização. Cada campo tem regras obrigatórias que a IA segue.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Category list */}
        {categories && categories.length > 0 && (
          <div className="mb-4 p-3 border rounded-lg bg-muted/30">
            <p className="text-xs font-medium mb-2">📂 Categorias existentes ({categories.length}):</p>
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <Badge key={cat} variant="outline" className="text-xs font-normal">
                  {cat}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              A IA pode sugerir recategorização durante a otimização se ativares o campo "Categoria Sugerida".
            </p>
          </div>
        )}

        {FIELD_PROMPTS.map((field) => {
          const isOpen = openFields.has(field.key);
          const hasCustom = !!savedPrompts?.[field.settingKey];
          const modified = isModified(field);

          return (
            <Collapsible key={field.key} open={isOpen} onOpenChange={() => toggle(field.key)}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-left">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="text-sm font-medium">{field.label}</span>
                    {hasCustom && <Badge variant="secondary" className="text-xs">Personalizado</Badge>}
                    {modified && <Badge className="text-xs bg-warning text-warning-foreground">Não guardado</Badge>}
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 pb-1 px-1">
                <Textarea
                  rows={10}
                  className="font-mono text-xs"
                  value={getPromptValue(field)}
                  onChange={(e) =>
                    setEditedPrompts((prev) => ({ ...prev, [field.settingKey]: e.target.value }))
                  }
                />
                <div className="flex gap-2 mt-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleReset(field)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Repor Padrão
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    disabled={!modified || savePrompt.isPending}
                    onClick={() => handleSave(field)}
                  >
                    {savePrompt.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3 mr-1" />
                    )}
                    Guardar
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}
