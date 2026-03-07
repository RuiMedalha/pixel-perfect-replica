import type { Product } from "@/hooks/useProducts";

export interface SeoCheck {
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export function calculateSeoScore(product: Product): { score: number; checks: SeoCheck[] } {
  const checks: SeoCheck[] = [];

  // 1. Meta title exists and good length
  const metaTitle = product.meta_title ?? "";
  const mtLen = metaTitle.length;
  checks.push({
    label: "Meta Title",
    passed: mtLen >= 20 && mtLen <= 60,
    weight: 15,
    detail: mtLen === 0 ? "Em falta" : mtLen < 20 ? `Muito curto (${mtLen}/20)` : mtLen > 60 ? `Muito longo (${mtLen}/60)` : `OK (${mtLen} chars)`,
  });

  // 2. Meta description exists and good length
  const metaDesc = product.meta_description ?? "";
  const mdLen = metaDesc.length;
  checks.push({
    label: "Meta Description",
    passed: mdLen >= 50 && mdLen <= 160,
    weight: 15,
    detail: mdLen === 0 ? "Em falta" : mdLen < 50 ? `Muito curta (${mdLen}/50)` : mdLen > 160 ? `Muito longa (${mdLen}/160)` : `OK (${mdLen} chars)`,
  });

  // 3. SEO Slug exists
  const slug = product.seo_slug ?? "";
  checks.push({
    label: "SEO Slug",
    passed: slug.length > 0,
    weight: 10,
    detail: slug.length === 0 ? "Em falta" : `OK (${slug})`,
  });

  // 4. Focus keyword (if exists) present in meta title
  const focusKw = (product as any).focus_keyword ?? "";
  if (focusKw) {
    checks.push({
      label: "Keyword no Meta Title",
      passed: metaTitle.toLowerCase().includes(focusKw.toLowerCase()),
      weight: 10,
      detail: metaTitle.toLowerCase().includes(focusKw.toLowerCase()) ? "Presente" : "Ausente",
    });
  } else {
    checks.push({
      label: "Focus Keyword",
      passed: false,
      weight: 10,
      detail: "Não definida",
    });
  }

  // 5. Optimized title exists
  checks.push({
    label: "Título Otimizado",
    passed: (product.optimized_title ?? "").length > 10,
    weight: 10,
    detail: (product.optimized_title ?? "").length === 0 ? "Em falta" : "OK",
  });

  // 6. Optimized description exists and has good length
  const desc = product.optimized_description ?? "";
  checks.push({
    label: "Descrição Otimizada",
    passed: desc.length > 100,
    weight: 10,
    detail: desc.length === 0 ? "Em falta" : desc.length < 100 ? `Curta (${desc.length} chars)` : "OK",
  });

  // 7. Short description
  checks.push({
    label: "Descrição Curta",
    passed: (product.optimized_short_description ?? "").length > 20,
    weight: 5,
    detail: (product.optimized_short_description ?? "").length === 0 ? "Em falta" : "OK",
  });

  // 8. FAQ present
  const faq = Array.isArray(product.faq) ? product.faq : [];
  checks.push({
    label: "FAQ",
    passed: faq.length >= 3,
    weight: 10,
    detail: faq.length === 0 ? "Em falta" : `${faq.length} pergunta(s)`,
  });

  // 9. Image alt texts
  const altTexts = Array.isArray((product as any).image_alt_texts) ? (product as any).image_alt_texts : [];
  const imageCount = (product.image_urls ?? []).length;
  checks.push({
    label: "Alt Text Imagens",
    passed: imageCount > 0 && altTexts.length >= imageCount,
    weight: 10,
    detail: imageCount === 0 ? "Sem imagens" : `${altTexts.length}/${imageCount} preenchidos`,
  });

  // 10. Category defined
  checks.push({
    label: "Categoria",
    passed: (product.category ?? "").length > 0,
    weight: 5,
    detail: (product.category ?? "").length === 0 ? "Em falta" : "OK",
  });

  // Calculate score
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const earnedWeight = checks.filter(c => c.passed).reduce((sum, c) => sum + c.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  return { score, checks };
}

export function getSeoScoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

export function getSeoScoreBg(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}
