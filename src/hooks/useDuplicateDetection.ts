import { useState, useCallback, useRef } from "react";
import type { Product } from "@/hooks/useProducts";

export interface DuplicateGroup {
  key: string;
  reason: "sku" | "title" | "both";
  products: Product[];
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-záàâãéèêíóòôõúüç0-9]/gi, " ").replace(/\s+/g, " ").trim();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  const intersection = [...setA].filter(w => setB.has(w) && w.length > 2).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function detectDuplicates(products: Product[]): DuplicateGroup[] {
  if (products.length < 2) return [];

  const groups: DuplicateGroup[] = [];
  const used = new Set<string>();

  // 1) Group by exact SKU
  const skuMap = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.sku) continue;
    const key = p.sku.trim().toUpperCase();
    if (!skuMap.has(key)) skuMap.set(key, []);
    skuMap.get(key)!.push(p);
  }

  for (const [sku, prods] of skuMap) {
    if (prods.length < 2) continue;
    groups.push({ key: `sku:${sku}`, reason: "sku", products: prods });
    prods.forEach(p => used.add(p.id));
  }

  // 2) Group by title similarity (Jaccard > 0.7) — cap at 2000 for safety
  const remaining = products.filter(p => !used.has(p.id) && (p.original_title || p.optimized_title));
  const cap = Math.min(remaining.length, 2000);
  for (let i = 0; i < cap; i++) {
    if (used.has(remaining[i].id)) continue;
    const titleA = normalizeTitle(remaining[i].optimized_title || remaining[i].original_title || "");
    if (!titleA) continue;

    const similar: Product[] = [remaining[i]];
    for (let j = i + 1; j < cap; j++) {
      if (used.has(remaining[j].id)) continue;
      const titleB = normalizeTitle(remaining[j].optimized_title || remaining[j].original_title || "");
      if (!titleB) continue;
      if (similarity(titleA, titleB) >= 0.7) {
        similar.push(remaining[j]);
      }
    }

    if (similar.length >= 2) {
      groups.push({ key: `title:${titleA.slice(0, 40)}`, reason: "title", products: similar });
      similar.forEach(p => used.add(p.id));
    }
  }

  return groups;
}

/** Lazy duplicate detection — only computes when `run()` is called */
export function useDuplicateDetection(products: Product[] | undefined) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const lastRef = useRef<string>("");

  const run = useCallback(() => {
    if (!products || products.length < 2) {
      setGroups([]);
      return;
    }
    // avoid re-running for same dataset
    const fingerprint = `${products.length}-${products[0]?.id}`;
    if (fingerprint === lastRef.current && groups.length > 0) return;
    lastRef.current = fingerprint;

    setIsRunning(true);
    // Use setTimeout to not block the main thread
    setTimeout(() => {
      const result = detectDuplicates(products);
      setGroups(result);
      setIsRunning(false);
    }, 50);
  }, [products]);

  return { groups, run, isRunning };
}
