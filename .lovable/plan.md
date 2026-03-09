

## Análise da Página Lacor (57017)

Analisei o conteúdo real do scrape. A estrutura é:

```text
┌─────────────────────────────┐
│ Título: Cacerola alta...    │
│ Ref: 57017                  │
│ Serie: Eco Chef             │
├─────────────────────────────┤
│ 2 imagens do produto        │  ← Queremos estas
│ (57017.jpg, 57016-A.jpg)    │
├─────────────────────────────┤
│ Diámetro: 16 20 24 28 32 36│  ← Variações (cada uma é um SKU)
├─────────────────────────────┤
│ Especificações (tabela)     │  ← Specs do SKU atual
├─────────────────────────────┤
│ Ícones SVG (compatibilidade)│  ← Ignorar
├─────────────────────────────┤
│ "Descubre la serie"         │  ← Outros produtos da série
│ (8 produtos com imagens)    │  ← Ignorar
├─────────────────────────────┤
│ Newsletter / footer         │  ← Ignorar
└─────────────────────────────┘
```

Problemas atuais:
- Extrai 10-13 imagens quando só 2 são do produto (o resto são série, ícones, newsletter)
- Não identifica as variações estruturadas (diâmetros 16-40)
- Não extrai specs como campos estruturados

## Plano

### 1. Usar IA para análise inteligente do scrape

Em vez de regex simples, enviar o markdown ao **Gemini Flash** com um prompt estruturado que pede:
- Imagens do produto (excluindo série, ícones, footer)
- Variações detetadas (atributo + valores + SKUs se visíveis)
- Especificações técnicas como JSON `{campo: valor}`
- Série/família do produto

### 2. Adicionar campo "Instruções de Scraping" por fornecedor (visual)

No card de Fornecedores nas Settings, adicionar um campo `Textarea` chamado **"Instruções de Extração"** onde o utilizador pode dar dicas à IA, ex:
- "As variações estão na secção 'Diámetro'. Ignorar imagens depois de 'Descubre la serie'. Extrair especificações da tabela."

### 3. Atualizar a Edge Function

| Alteração | Detalhe |
|-----------|---------|
| Filtrar imagens | Excluir SVGs, imagens após "Descubre la serie", ícones pequenos |
| Chamar IA | Enviar markdown + instruções do utilizador ao Gemini para extração estruturada |
| Guardar variações | Guardar no campo `attributes` como `[{name: "Diâmetro", values: ["16","20",...]}]` |
| Guardar specs | Guardar `technical_specs` como JSON estruturado em vez de texto bruto |

### Ficheiros a alterar

| Ficheiro | Ação |
|----------|------|
| `supabase/functions/enrich-products/index.ts` | Adicionar chamada IA para parsing inteligente, filtrar imagens, extrair variações e specs |
| `src/pages/SettingsPage.tsx` | Adicionar campo `scraping_instructions` por fornecedor |
| `src/components/ProductDetailModal.tsx` | Melhorar secção Fornecedor para mostrar specs estruturadas e variações detetadas |

### Fluxo melhorado

```text
Scrape markdown
      │
      ▼
Filtrar imagens (excluir SVG, série, footer)
      │
      ▼
Enviar a Gemini Flash:
  "Analisa este conteúdo de produto.
   Instruções do utilizador: {scraping_instructions}
   Retorna JSON com:
   - product_images: [urls só do produto]
   - variations: [{attribute, values}]
   - specs: {campo: valor}
   - series_name: string"
      │
      ▼
UPDATE produto com dados estruturados
```

