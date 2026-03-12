DROP FUNCTION IF EXISTS public.get_products_page(uuid,text,text,text,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION public.get_products_page(_workspace_id uuid, _search text DEFAULT ''::text, _status text DEFAULT 'all'::text, _category text DEFAULT 'all'::text, _product_type text DEFAULT 'all'::text, _source_file text DEFAULT 'all'::text, _woo_filter text DEFAULT 'all'::text, _page integer DEFAULT 1, _page_size integer DEFAULT 100)
 RETURNS TABLE(id uuid, sku text, original_title text, optimized_title text, original_price numeric, optimized_price numeric, sale_price numeric, optimized_sale_price numeric, status product_status, product_type text, parent_product_id uuid, category text, category_id uuid, image_urls text[], technical_specs text, attributes jsonb, meta_title text, meta_description text, seo_slug text, optimized_description text, optimized_short_description text, short_description text, original_description text, tags text[], faq jsonb, focus_keyword text[], image_alt_texts jsonb, seo_score integer, woocommerce_id bigint, source_file text, supplier_ref text, workspace_id uuid, user_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, upsell_skus jsonb, crosssell_skus jsonb, suggested_category text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _offset integer;
  _total bigint;
  _search_lower text;
BEGIN
  _offset := (_page - 1) * _page_size;
  _search_lower := lower(trim(_search));

  SELECT COUNT(*) INTO _total
  FROM public.products p
  WHERE p.user_id = auth.uid()
    AND (_workspace_id IS NULL OR p.workspace_id = _workspace_id)
    AND (_search_lower = '' OR lower(p.sku) LIKE '%' || _search_lower || '%' OR lower(p.original_title) LIKE '%' || _search_lower || '%')
    AND (_status = 'all' OR p.status::text = _status)
    AND (_category = 'all' OR COALESCE(p.category, '') = _category)
    AND (_product_type = 'all' OR p.product_type = _product_type)
    AND (_source_file = 'all' OR COALESCE(p.source_file, '') = _source_file)
    AND (_woo_filter = 'all' OR (_woo_filter = 'published' AND p.woocommerce_id IS NOT NULL) OR (_woo_filter = 'not_published' AND p.woocommerce_id IS NULL));

  RETURN QUERY
  SELECT
    p.id, p.sku, p.original_title, p.optimized_title,
    p.original_price, p.optimized_price, p.sale_price, p.optimized_sale_price,
    p.status, p.product_type, p.parent_product_id,
    p.category, p.category_id, p.image_urls, p.technical_specs, p.attributes,
    p.meta_title, p.meta_description, p.seo_slug,
    p.optimized_description, p.optimized_short_description, p.short_description, p.original_description,
    p.tags, p.faq, p.focus_keyword, p.image_alt_texts, p.seo_score,
    p.woocommerce_id, p.source_file, p.supplier_ref,
    p.workspace_id, p.user_id, p.created_at, p.updated_at,
    p.upsell_skus, p.crosssell_skus,
    p.suggested_category,
    _total as total_count
  FROM public.products p
  WHERE p.user_id = auth.uid()
    AND (_workspace_id IS NULL OR p.workspace_id = _workspace_id)
    AND (_search_lower = '' OR lower(p.sku) LIKE '%' || _search_lower || '%' OR lower(p.original_title) LIKE '%' || _search_lower || '%')
    AND (_status = 'all' OR p.status::text = _status)
    AND (_category = 'all' OR COALESCE(p.category, '') = _category)
    AND (_product_type = 'all' OR p.product_type = _product_type)
    AND (_source_file = 'all' OR COALESCE(p.source_file, '') = _source_file)
    AND (_woo_filter = 'all' OR (_woo_filter = 'published' AND p.woocommerce_id IS NOT NULL) OR (_woo_filter = 'not_published' AND p.woocommerce_id IS NULL))
  ORDER BY p.updated_at DESC
  LIMIT _page_size
  OFFSET _offset;
END;
$function$;