

## Análise do Estado Atual e Roadmap Enterprise

### O que já existe em produção

```text
┌─────────────────────────────────────────────────────────┐
│                    ESTADO ATUAL                         │
├──────────────────┬──────────────────────────────────────┤
│ Upload           │ Excel/CSV/PDF + splitting auto       │
│                  │ Mapeamento de colunas                │
│                  │ Scraping de URLs (Firecrawl)         │
├──────────────────┼──────────────────────────────────────┤
│ Otimização IA    │ 13 campos (título, desc, SEO, FAQ…)  │
│                  │ 9 modelos IA selecionáveis           │
│                  │ Hybrid RAG (FTS + trigram + família)  │
│                  │ AI Reranking de chunks               │
│                  │ Auto-scrape fornecedor por SKU       │
│                  │ Upsells/Cross-sells com engine       │
│                  │ Versionamento (max 3 versões)        │
│                  │ Processamento unitário + cancelar    │
├──────────────────┼──────────────────────────────────────┤
│ Publicação       │ WooCommerce (criar/atualizar)        │
│                  │ Meta Yoast SEO                       │
├──────────────────┼──────────────────────────────────────┤
│ Gestão           │ Workspaces multi-marca               │
│                  │ RBAC (admin/user + aprovação)        │
│                  │ Dashboard com métricas RAG           │
│                  │ Logs de otimização + tokens           │
│                  │ Produtos variáveis                   │
│                  │ Exportação Excel                     │
├──────────────────┼──────────────────────────────────────┤
│ Knowledge Base   │ Upload de PDFs como conhecimento     │
│                  │ Chunks + busca híbrida               │
│                  │ Prompts por campo personalizáveis    │
└──────────────────┴──────────────────────────────────────┘
```

### O que falta para nível Enterprise

Organizei em 4 blocos estratégicos:

---

### BLOCO 1 — Gestão de Categorias (Taxonomia Inteligente)

**Problema atual:** As categorias são texto livre no campo `category`. Não há hierarquia, não há gestão centralizada, e a IA pode criar categorias duplicadas/inconsistentes.

**Implementação:**
- Nova tabela `categories` com hierarquia (parent_id), slug, descrição SEO e imagem
- Página dedicada "Categorias" com árvore visual drag-and-drop
- Otimização IA por categoria (meta title, meta description, slug, descrição SEO da categoria)
- Mapeamento automático de produtos a categorias existentes
- Sincronização bidirecional com WooCommerce (importar/exportar árvore)
- Regras de merge: detetar categorias semelhantes e sugerir fusão

---

### BLOCO 2 — RankMath SEO Completo

**Problema atual:** A publicação WooCommerce envia apenas meta Yoast (`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`). Não suporta RankMath nem análise de qualidade SEO.

**Implementação:**
- Campos RankMath na publicação: `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword`, `rank_math_robots`, `rank_math_canonical_url`, `rank_math_primary_category`
- Score SEO simulado no frontend (0-100) baseado em regras: keyword no título, comprimento meta, slug, alt texts, FAQ presente
- Painel "SEO Score" no detalhe do produto com checklist visual (verde/amarelo/vermelho)
- Schema.org / JSON-LD: gerar Product schema automático (nome, preço, SKU, imagem, FAQ como FAQPage schema)
- Opção nas Settings para escolher plugin SEO: Yoast vs RankMath
- Bulk SEO audit: listar todos os produtos com score < 70 para re-otimização

---

### BLOCO 3 — Google Ads Integration

**Problema atual:** Zero integração com publicidade. Os dados otimizados não fluem para campanhas.

**Implementação:**
- Geração automática de Google Merchant Center Feed (XML/CSV) com campos: `title`, `description`, `price`, `image_link`, `gtin`, `brand`, `condition`, `availability`, `google_product_category`
- Nova Edge Function `generate-merchant-feed` que produz feed válido para download ou URL pública
- Geração de anúncios Google Ads por produto: headlines (max 30 chars x 15), descriptions (max 90 chars x 4) otimizados por IA
- Novo campo no produto: `google_product_category` (taxonomia Google)
- Mapeamento automático categoria interna → Google taxonomy
- Exportação de campanhas em formato Google Ads Editor (CSV)
- Dashboard de cobertura: % produtos com feed completo, campos em falta

---

### BLOCO 4 — Funcionalidades Enterprise Transversais

**4.1 — Agendamento e Filas**
- Fila de otimização persistente (tabela `optimization_queue`) para processar em background
- Agendar otimizações (ex: re-otimizar todos os pendentes às 3h)
- Retry automático com backoff exponencial para erros 429/502

**4.2 — Comparação e Aprovação**
- Vista side-by-side: original vs otimizado por campo
- Workflow de aprovação: otimizado → aprovado → publicado
- Aceitar/rejeitar campo a campo (não tudo-ou-nada)

**4.3 — Analytics Avançado**
- Gráfico temporal de otimizações por dia/semana
- Custo estimado por otimização (baseado em tokens × preço modelo)
- Relatório de qualidade por workspace/fornecedor
- Top categorias com mais produtos, categorias vazias

**4.4 — Bulk Operations Melhoradas**
- Edição em massa de categoria (selecionar 50 produtos → mudar categoria)
- Re-otimização inteligente: só re-fazer campos vazios ou com score baixo
- Importação de categorias WooCommerce existentes

---

### Prioridade Sugerida de Implementação

```text
Fase 1 (Impacto imediato):
  ├── Gestão de Categorias com hierarquia
  ├── Score SEO + RankMath fields
  └── Comparação side-by-side original/otimizado

Fase 2 (Monetização):
  ├── Google Merchant Feed
  ├── Geração de anúncios Google Ads
  └── Analytics temporal + custos

Fase 3 (Escala):
  ├── Fila persistente + agendamento
  ├── Workflow de aprovação por campo
  └── Bulk category edit + importação WooCommerce
```

### Decisão necessária

Qual bloco ou fase quer começar a implementar primeiro?

