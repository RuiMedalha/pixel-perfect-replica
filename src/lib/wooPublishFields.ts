// WooCommerce publish field groups and individual fields

export interface WooPublishField {
  key: string;
  label: string;
  group: string;
}

export interface WooPublishGroup {
  key: string;
  label: string;
  icon: string;
  fields: WooPublishField[];
}

export const WOO_PUBLISH_GROUPS: WooPublishGroup[] = [
  {
    key: "content",
    label: "Conteúdo",
    icon: "📝",
    fields: [
      { key: "title", label: "Título", group: "content" },
      { key: "description", label: "Descrição", group: "content" },
      { key: "short_description", label: "Descrição Curta", group: "content" },
    ],
  },
  {
    key: "media",
    label: "Media",
    icon: "🖼️",
    fields: [
      { key: "images", label: "Imagens", group: "media" },
      { key: "image_alt_text", label: "Alt Text das Imagens", group: "media" },
    ],
  },
  {
    key: "pricing",
    label: "Preço",
    icon: "💰",
    fields: [
      { key: "price", label: "Preço", group: "pricing" },
    ],
  },
  {
    key: "taxonomy",
    label: "Taxonomias",
    icon: "🏷️",
    fields: [
      { key: "categories", label: "Categorias", group: "taxonomy" },
      { key: "tags", label: "Tags", group: "taxonomy" },
    ],
  },
  {
    key: "seo",
    label: "SEO (Yoast/RankMath)",
    icon: "🔍",
    fields: [
      { key: "meta_title", label: "Meta Title", group: "seo" },
      { key: "meta_description", label: "Meta Description", group: "seo" },
      { key: "slug", label: "Slug", group: "seo" },
    ],
  },
  {
    key: "commercial",
    label: "Comercial",
    icon: "🔗",
    fields: [
      { key: "sku", label: "SKU", group: "commercial" },
      { key: "upsells", label: "Upsells", group: "commercial" },
      { key: "crosssells", label: "Cross-sells", group: "commercial" },
    ],
  },
];

export const ALL_WOO_FIELD_KEYS = WOO_PUBLISH_GROUPS.flatMap(g => g.fields.map(f => f.key));

export const DEFAULT_WOO_FIELDS = ALL_WOO_FIELD_KEYS.filter(k => k !== "meta_title" && k !== "meta_description" && k !== "slug");

export const SETTING_KEY_WOO_PUBLISH_FIELDS = "woo_publish_fields_json";
