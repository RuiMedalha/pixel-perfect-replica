

## Plan: Auto-detect variation attributes with AI + "Needs Review" status

### Problem
After optimization, variable products get marked as "optimized" (green) even when their variation attributes are only inferred from titles and not properly defined. The user wants:
1. AI to automatically extract variation attributes (Cor, Tamanho, etc.) by comparing parent/child titles after optimization
2. A new "needs_review" (orange) status when attributes couldn't be confidently resolved

### Changes

**1. Database Migration — Add `needs_review` to `product_status` enum**
- `ALTER TYPE product_status ADD VALUE 'needs_review'`
- This status means "optimized content is ready, but variation attributes need human review"

**2. Edge Function `optimize-product/index.ts` — Post-optimization attribute extraction**
After propagating content to variations (around line 1200), add logic for variable products:
- Collect all child titles (optimized) and compare against the parent title
- Use the Lovable AI gateway (gemini-3-flash) with a structured tool call to extract attribute names and values from the title differences
- Example prompt: given parent "Forno a Carvão Pujadas Functional 140" and children ["...Profissional - Vermelho", "...Preto Profissional", "...Aço Natural"], extract `{attr_name: "Cor", values: {"child1": "Vermelho", "child2": "Preto", "child3": "Aço Natural"}}`
- Save extracted attributes to each child product's `attributes` JSON with `variation: true`
- If AI extraction succeeds confidently: set parent status to `optimized` (green)
- If AI extraction fails or returns ambiguous results: set parent status to `needs_review` (orange)

**3. Frontend `ProductsPage.tsx` — Display `needs_review` status**
- Add to `statusLabels`: `needs_review: "Revisão Necessária"`
- Add to `statusColors`: `needs_review: "bg-amber-500/10 text-amber-600 border-amber-500/20"`
- Add to filter options

**4. Frontend `VariationsPanel.tsx` — Visual indicator**
- When product status is `needs_review`, show a prominent alert encouraging the user to review and confirm attributes
- After user saves corrected attributes via "Editar Atributos", automatically update status to `optimized`

**5. Edge Function structure for AI attribute extraction**
```text
optimize-product finish
  └─ if product_type === "variable" && has variations
      └─ call AI gateway with tool_choice to extract attributes
          ├─ success → save attrs, status = "optimized"
          └─ fail/ambiguous → status = "needs_review"
```

### Files Modified
- `supabase/migrations/` — new migration for enum value
- `supabase/functions/optimize-product/index.ts` — AI attribute extraction post-optimization
- `src/pages/ProductsPage.tsx` — new status label, color, filter
- `src/components/VariationsPanel.tsx` — review alert + auto-update status on save

