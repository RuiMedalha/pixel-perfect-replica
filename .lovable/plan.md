

## Problema

Quando o Excel contém referências de imagens como `codigo.webp` ou `foto.jpeg` (apenas nomes de ficheiro, sem URL completo), a função `buildImageEntry` envia `{ src: "codigo.webp" }` ao WooCommerce, que não consegue resolver isto como imagem válida. Estas imagens já existem na Media Library do WordPress e precisam de ser encontradas pelo nome.

## Solução

Transformar `buildImageEntry` numa função **assíncrona** (`resolveImageRef`) que deteta o tipo de referência e pesquisa na WP Media Library quando necessário.

### Lógica de resolução (por ordem de prioridade)

1. **Puramente numérico** (`"12345"`) → `{ id: 12345 }` (já funciona)
2. **URL completo** (`http...`) → `{ src: url }` (já funciona)
3. **Nome de ficheiro** (`codigo.webp`, `foto.jpeg`) → **Novo**: pesquisa `GET /wp-json/wp/v2/media?search=codigo` na API REST do WordPress, retorna `{ id: mediaId }` se encontrar
4. **Fallback** → constrói URL provável: `{ src: baseUrl/wp-content/uploads/filename }` 

### Cache

Um `Map<string, imageEntry>` local durante o batch evita pesquisas duplicadas para o mesmo ficheiro.

### Ficheiros a alterar

- `supabase/functions/publish-woocommerce/index.ts`:
  - Substituir `buildImageEntry` (sync) por `resolveImageRef` (async) com pesquisa na WP Media Library
  - Criar helper `searchWPMediaByFilename(baseUrl, auth, filename)` que faz GET a `/wp-json/wp/v2/media?search=...`
  - Atualizar `buildBasePayload`, `buildVariationPayload` e agregação de imagens do pai para usar `await resolveImageRef()`
  - Extensões suportadas: `.webp`, `.jpeg`, `.jpg`, `.png`, `.gif`, `.svg`, `.bmp`, `.avif`, `.tiff`

### Detalhes técnicos

```text
Fluxo de resolução de imagem:
┌─────────────┐
│ ref string   │
└──────┬──────┘
       │
  ┌────▼────┐   sim   ┌──────────┐
  │numérico?├────────►│{ id: N } │
  └────┬────┘         └──────────┘
       │não
  ┌────▼────────┐ sim  ┌────────────┐
  │começa http? ├─────►│{ src: url }│
  └────┬────────┘      └────────────┘
       │não
  ┌────▼──────────────┐
  │tem extensão imagem│
  └────┬──────────────┘
       │sim
  ┌────▼─────────────────────┐
  │GET /wp-json/wp/v2/media  │
  │?search=nome_sem_extensão │
  └────┬─────────────────────┘
       │
  ┌────▼────┐  sim  ┌──────────────┐
  │encontrou├──────►│{ id: media } │
  └────┬────┘       └──────────────┘
       │não
  ┌────▼──────────────────────────────┐
  │{ src: baseUrl/wp-content/uploads/ │
  │       filename }                  │
  └───────────────────────────────────┘
```

