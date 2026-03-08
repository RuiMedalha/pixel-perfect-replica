

## Diagnóstico

Analisando o código, o problema mais provável é:

1. **Auto-mapeamento silencioso**: A função `autoMapColumns` mapeia automaticamente qualquer coluna cujo nome corresponda a "category", "categoria", "cat", "grupo", etc. Mesmo que o utilizador pense que desmarcou a categoria, ela pode ter sido re-mapeada automaticamente (ex: ao mudar de sheet) ou o utilizador não reparou que estava mapeada.

2. **Valor vazio sobrescreve**: Quando a categoria ESTÁ mapeada e a célula do Excel está vazia, `toStr("", 200)` retorna `null`, o que faz um `UPDATE ... SET category = null` — apagando o valor existente `cat>sub>sub`.

3. **Formato diferente**: Mesmo que a célula tenha valor, o Excel pode ter a categoria num formato diferente (ex: "Categoria" em vez de "Cat > Sub > Sub"), sobrescrevendo o formato hierárquico correto.

## Solução

### Alteração em `supabase/functions/parse-catalog/index.ts`

Na função `buildProductData`, para **atualizações de produtos existentes** (`onlyMapped = true`):

- **Não incluir campos cujo valor resolvido seja `null` ou vazio** — isto evita que um campo mapeado mas com célula vazia no Excel sobrescreva dados existentes
- Isto aplica-se a TODOS os campos, não só à categoria — um campo mapeado mas vazio no Excel não deve apagar o valor existente no produto

```text
// Antes (linha ~264):
if (onlyMapped && hasMapping) {
  for (const key of mappedFieldKeys) {
    if (fieldMap[key]) fieldMap[key]();
  }
}

// Depois:
if (onlyMapped && hasMapping) {
  for (const key of mappedFieldKeys) {
    if (fieldMap[key]) fieldMap[key]();
  }
  // Remove null/empty values to avoid overwriting existing data with blanks
  for (const k of Object.keys(data)) {
    if (data[k] === null || data[k] === "" || data[k] === undefined) {
      delete data[k];
    }
  }
}
```

Isto garante que:
- Campos não mapeados (sem visto) → nunca tocados ✓
- Campos mapeados com valor no Excel → atualizados ✓  
- Campos mapeados mas com célula vazia → **não apagam** o valor existente ✓

### Melhoria no log de debug

Adicionar log que mostra o `columnMapping` tal como chega do frontend, para confirmar que o campo `category` está ou não presente quando o utilizador diz que desmarcou.

