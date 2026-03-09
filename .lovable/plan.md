

## Diagnóstico

Dois bugs impedem o enriquecimento:

1. **Chave errada no ProductsPage** (linha 679): lê `settings?.supplier_prefixes` mas a chave na BD é `suppliers_json`
2. **Campo errado na Edge Function**: os fornecedores são guardados com campo `url` (ex: `https://www.lacor.es/buscar/`), mas a Edge Function procura `searchUrl` com placeholder `{sku}` (linha 116). Como não encontra, retorna "No supplier URL configured"

## Correções

### `src/pages/ProductsPage.tsx` (linha 679)
- Mudar `settings?.supplier_prefixes` para `settings?.suppliers_json`
- Mapear os objetos para o formato esperado pela Edge Function: `{ name, prefix, searchUrl: url + "{sku}" }`

### `supabase/functions/enrich-products/index.ts` (linhas 100-132)
- Aceitar tanto `searchUrl` como `url` nos objetos de fornecedor
- Se a URL não contiver `{sku}`, construir automaticamente: `url + sku` (append direto, como o teste nas Settings já faz)
- Se nenhum prefixo corresponder, usar o primeiro fornecedor com o SKU completo (sem remover prefixo)
- Se não houver fornecedores configurados de todo, tentar pesquisa web via Firecrawl Search API como fallback

