export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at: string
          details: Json | null
          id: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          details?: Json | null
          id?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          parent_id: string | null
          slug: string | null
          sort_order: number | null
          updated_at: string
          user_id: string
          woocommerce_id: number | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name: string
          parent_id?: string | null
          slug?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id: string
          woocommerce_id?: number | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          parent_id?: string | null
          slug?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id?: string
          woocommerce_id?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          error_message: string
          id: string
          severity: string
          source: string
          stack_trace: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          error_message: string
          id?: string
          severity?: string
          source?: string
          stack_trace?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          error_message?: string
          id?: string
          severity?: string
          source?: string
          stack_trace?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      image_credits: {
        Row: {
          id: string
          monthly_limit: number
          reset_at: string
          updated_at: string
          used_this_month: number
          workspace_id: string
        }
        Insert: {
          id?: string
          monthly_limit?: number
          reset_at?: string
          updated_at?: string
          used_this_month?: number
          workspace_id: string
        }
        Update: {
          id?: string
          monthly_limit?: number
          reset_at?: string
          updated_at?: string
          used_this_month?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_credits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          optimized_url: string | null
          original_url: string | null
          product_id: string
          s3_key: string | null
          sort_order: number | null
          status: Database["public"]["Enums"]["image_status"]
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          optimized_url?: string | null
          original_url?: string | null
          product_id: string
          s3_key?: string | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["image_status"]
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          optimized_url?: string | null
          original_url?: string | null
          product_id?: string
          s3_key?: string | null
          sort_order?: number | null
          status?: Database["public"]["Enums"]["image_status"]
        }
        Relationships: [
          {
            foreignKeyName: "images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          file_id: string
          id: string
          source_name: string | null
          tsv: unknown
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          file_id: string
          id?: string
          source_name?: string | null
          tsv?: unknown
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          file_id?: string
          id?: string
          source_name?: string | null
          tsv?: unknown
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      optimization_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          current_phase: number | null
          current_product_name: string | null
          error_message: string | null
          failed_products: number
          fields_to_optimize: string[] | null
          id: string
          model_override: string | null
          processed_products: number
          product_ids: string[]
          results: Json | null
          selected_phases: number[] | null
          started_at: string | null
          status: string
          total_products: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_phase?: number | null
          current_product_name?: string | null
          error_message?: string | null
          failed_products?: number
          fields_to_optimize?: string[] | null
          id?: string
          model_override?: string | null
          processed_products?: number
          product_ids?: string[]
          results?: Json | null
          selected_phases?: number[] | null
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_phase?: number | null
          current_product_name?: string | null
          error_message?: string | null
          failed_products?: number
          fields_to_optimize?: string[] | null
          id?: string
          model_override?: string | null
          processed_products?: number
          product_ids?: string[]
          results?: Json | null
          selected_phases?: number[] | null
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "optimization_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      optimization_logs: {
        Row: {
          chunks_used: number | null
          completion_tokens: number | null
          created_at: string
          fields_optimized: string[] | null
          had_catalog: boolean | null
          had_knowledge: boolean | null
          had_supplier: boolean | null
          id: string
          knowledge_sources: Json | null
          model: string
          product_id: string
          prompt_length: number | null
          prompt_tokens: number | null
          rag_match_types: Json | null
          supplier_name: string | null
          supplier_url: string | null
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          chunks_used?: number | null
          completion_tokens?: number | null
          created_at?: string
          fields_optimized?: string[] | null
          had_catalog?: boolean | null
          had_knowledge?: boolean | null
          had_supplier?: boolean | null
          id?: string
          knowledge_sources?: Json | null
          model?: string
          product_id: string
          prompt_length?: number | null
          prompt_tokens?: number | null
          rag_match_types?: Json | null
          supplier_name?: string | null
          supplier_url?: string | null
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          chunks_used?: number | null
          completion_tokens?: number | null
          created_at?: string
          fields_optimized?: string[] | null
          had_catalog?: boolean | null
          had_knowledge?: boolean | null
          had_supplier?: boolean | null
          id?: string
          knowledge_sources?: Json | null
          model?: string
          product_id?: string
          prompt_length?: number | null
          prompt_tokens?: number | null
          rag_match_types?: Json | null
          supplier_name?: string | null
          supplier_url?: string | null
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "optimization_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_versions: {
        Row: {
          created_at: string
          faq: Json | null
          id: string
          meta_description: string | null
          meta_title: string | null
          optimized_description: string | null
          optimized_price: number | null
          optimized_sale_price: number | null
          optimized_short_description: string | null
          optimized_title: string | null
          product_id: string
          seo_slug: string | null
          tags: string[] | null
          user_id: string
          version_number: number
        }
        Insert: {
          created_at?: string
          faq?: Json | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_sale_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          product_id: string
          seo_slug?: string | null
          tags?: string[] | null
          user_id: string
          version_number?: number
        }
        Update: {
          created_at?: string
          faq?: Json | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_sale_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          product_id?: string
          seo_slug?: string | null
          tags?: string[] | null
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json | null
          category: string | null
          category_id: string | null
          created_at: string
          crosssell_skus: Json | null
          faq: Json | null
          focus_keyword: string[] | null
          id: string
          image_alt_texts: Json | null
          image_urls: string[] | null
          meta_description: string | null
          meta_title: string | null
          optimized_description: string | null
          optimized_price: number | null
          optimized_sale_price: number | null
          optimized_short_description: string | null
          optimized_title: string | null
          original_description: string | null
          original_price: number | null
          original_title: string | null
          parent_product_id: string | null
          product_type: string
          sale_price: number | null
          seo_score: number | null
          seo_slug: string | null
          short_description: string | null
          sku: string | null
          source_file: string | null
          status: Database["public"]["Enums"]["product_status"]
          supplier_ref: string | null
          tags: string[] | null
          technical_specs: string | null
          updated_at: string
          upsell_skus: Json | null
          user_id: string
          woocommerce_id: number | null
          workspace_id: string | null
        }
        Insert: {
          attributes?: Json | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          crosssell_skus?: Json | null
          faq?: Json | null
          focus_keyword?: string[] | null
          id?: string
          image_alt_texts?: Json | null
          image_urls?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_sale_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          original_description?: string | null
          original_price?: number | null
          original_title?: string | null
          parent_product_id?: string | null
          product_type?: string
          sale_price?: number | null
          seo_score?: number | null
          seo_slug?: string | null
          short_description?: string | null
          sku?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_ref?: string | null
          tags?: string[] | null
          technical_specs?: string | null
          updated_at?: string
          upsell_skus?: Json | null
          user_id: string
          woocommerce_id?: number | null
          workspace_id?: string | null
        }
        Update: {
          attributes?: Json | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          crosssell_skus?: Json | null
          faq?: Json | null
          focus_keyword?: string[] | null
          id?: string
          image_alt_texts?: Json | null
          image_urls?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_sale_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          original_description?: string | null
          original_price?: number | null
          original_title?: string | null
          parent_product_id?: string | null
          product_type?: string
          sale_price?: number | null
          seo_score?: number | null
          seo_slug?: string | null
          short_description?: string | null
          sku?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_ref?: string | null
          tags?: string[] | null
          technical_specs?: string | null
          updated_at?: string
          upsell_skus?: Json | null
          user_id?: string
          woocommerce_id?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      publish_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          current_product_name: string | null
          error_message: string | null
          failed_products: number
          id: string
          pricing: Json | null
          processed_products: number
          product_ids: string[]
          publish_fields: string[] | null
          results: Json | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          total_products: number
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_product_name?: string | null
          error_message?: string | null
          failed_products?: number
          id?: string
          pricing?: Json | null
          processed_products?: number
          product_ids?: string[]
          publish_fields?: string[] | null
          results?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_product_name?: string | null
          error_message?: string | null
          failed_products?: number
          id?: string
          pricing?: Json | null
          processed_products?: number
          product_ids?: string[]
          publish_fields?: string[] | null
          results?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publish_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scrape_cache: {
        Row: {
          content_html: string | null
          content_markdown: string | null
          created_at: string
          expires_at: string
          id: string
          metadata: Json | null
          url: string
          url_hash: string
          workspace_id: string | null
        }
        Insert: {
          content_html?: string | null
          content_markdown?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          url: string
          url_hash: string
          workspace_id?: string | null
        }
        Update: {
          content_html?: string | null
          content_markdown?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          url?: string
          url_hash?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrape_cache_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scraping_credits: {
        Row: {
          id: string
          monthly_limit: number
          reset_at: string
          updated_at: string
          used_this_month: number
          workspace_id: string
        }
        Insert: {
          id?: string
          monthly_limit?: number
          reset_at?: string
          updated_at?: string
          used_this_month?: number
          workspace_id: string
        }
        Update: {
          id?: string
          monthly_limit?: number
          reset_at?: string
          updated_at?: string
          used_this_month?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraping_credits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string | null
        }
        Relationships: []
      }
      uploaded_files: {
        Row: {
          created_at: string
          extracted_text: string | null
          file_hash: string | null
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          metadata: Json | null
          products_count: number | null
          status: string
          storage_path: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          file_hash?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          metadata?: Json | null
          products_count?: number | null
          status?: string
          storage_path?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          file_hash?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          metadata?: Json | null
          products_count?: number | null
          status?: string
          storage_path?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          created_at: string
          description: string | null
          has_variable_products: boolean
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          has_variable_products?: boolean
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          has_variable_products?: boolean
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_product_filter_options: {
        Args: { _workspace_id: string }
        Returns: {
          filter_type: string
          filter_value: string
        }[]
      }
      get_product_stats: {
        Args: { _workspace_id: string }
        Returns: {
          count: number
          status: string
        }[]
      }
      get_products_page: {
        Args: {
          _category?: string
          _page?: number
          _page_size?: number
          _product_type?: string
          _search?: string
          _source_file?: string
          _status?: string
          _woo_filter?: string
          _workspace_id: string
        }
        Returns: {
          attributes: Json
          category: string
          category_id: string
          created_at: string
          crosssell_skus: Json
          faq: Json
          focus_keyword: string[]
          id: string
          image_alt_texts: Json
          image_urls: string[]
          meta_description: string
          meta_title: string
          optimized_description: string
          optimized_price: number
          optimized_sale_price: number
          optimized_short_description: string
          optimized_title: string
          original_description: string
          original_price: number
          original_title: string
          parent_product_id: string
          product_type: string
          sale_price: number
          seo_score: number
          seo_slug: string
          short_description: string
          sku: string
          source_file: string
          status: Database["public"]["Enums"]["product_status"]
          supplier_ref: string
          tags: string[]
          technical_specs: string
          total_count: number
          updated_at: string
          upsell_skus: Json
          user_id: string
          woocommerce_id: number
          workspace_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_scraping_credits: {
        Args: { _workspace_id: string }
        Returns: undefined
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      search_knowledge:
        | {
            Args: { _limit?: number; _query: string }
            Returns: {
              content: string
              id: string
              rank: number
              source_name: string
            }[]
          }
        | {
            Args: { _limit?: number; _query: string; _workspace_id?: string }
            Returns: {
              content: string
              id: string
              rank: number
              source_name: string
            }[]
          }
      search_knowledge_hybrid: {
        Args: {
          _family_keywords?: string
          _limit?: number
          _query: string
          _workspace_id?: string
        }
        Returns: {
          content: string
          id: string
          match_type: string
          rank: number
          source_name: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      activity_action:
        | "upload"
        | "optimize"
        | "publish"
        | "settings_change"
        | "error"
      app_role: "admin" | "user"
      image_status:
        | "pending"
        | "downloading"
        | "optimizing"
        | "uploading"
        | "done"
        | "error"
      product_status:
        | "pending"
        | "processing"
        | "optimized"
        | "published"
        | "error"
        | "needs_review"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_action: [
        "upload",
        "optimize",
        "publish",
        "settings_change",
        "error",
      ],
      app_role: ["admin", "user"],
      image_status: [
        "pending",
        "downloading",
        "optimizing",
        "uploading",
        "done",
        "error",
      ],
      product_status: [
        "pending",
        "processing",
        "optimized",
        "published",
        "error",
        "needs_review",
      ],
    },
  },
} as const
