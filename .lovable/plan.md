

## Melhorias ao Processamento de Catálogos PDF

### Problema
A função `parsePdfWithAI` tem duas limitações críticas:
1. **Limite de 12MB** — rejeita PDFs grandes sem tentar (retorna `[]`)
2. **Prompt genérico** — não instrui a IA a identificar coleções/modelos nas páginas, nem a extrair campos como dimensões, marca ou tipo de produto (variable/variation)
3. **Schema limitado** — só extrai 6 campos básicos (title, description, price, sku, category, supplier_ref)

### Solução

#### 1. Remover bloqueio de 12MB em `parsePdfWithAI`
Os PDFs já são divididos em partes de 10MB no frontend (`splitPdfFile`). Não faz sentido rejeitar no servidor. Remover o `if (fileSizeKB > 12000) return []`.

#### 2. Melhorar o prompt de extração
Prompt especializado que instrui a IA a:
- Identificar o nome da **coleção/modelo** no cabeçalho de cada página (ex: "Mica", "Gema") e associar a cada produto
- Compor títulos como `{Item} {Modelo} {Marca}` (ex: "Cuchara mesa Mica JAY")
- Detetar produtos que pertencem à mesma coleção e marcá-los como `product_type: "variable"` (pai) e `"variation"` (filhos)
- Extrair dimensões e especificações técnicas

#### 3. Expandir schema da tool call
Adicionar campos ao schema de extração:
- `brand` — marca (ex: "JAY", "Lacor")
- `model` — coleção/modelo (ex: "Mica")
- `technical_specs` — dimensões (ex: "L: 202mm | e: 4.0mm")
- `short_description` — descrição curta
- `product_type` — "simple", "variable", ou "variation"
- `parent_title` — título do produto pai (para variações)
- `image_urls` — referências de imagens encontradas

#### 4. Usar modelo mais potente
Trocar `google/gemini-2.5-flash` por `google/gemini-2.5-pro` em `parsePdfWithAI` para melhor interpretação visual de tabelas complexas.

#### 5. Fallback de texto
Se a tool call não devolver produtos, tentar extrair do conteúdo de texto da resposta como JSON.

### Ficheiro a alterar
- `supabase/functions/parse-catalog/index.ts` — reescrever `parsePdfWithAI` (linhas 561-649)

### Sobre o scraping do site Lacor
Sim, podemos usar o Firecrawl para enriquecer os dados dos produtos com informações do site lacor.es. Isso pode ser integrado como contexto de conhecimento ou como fonte de dados complementar durante a otimização.

