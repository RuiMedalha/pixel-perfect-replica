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
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          details?: Json | null
          id?: string
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          details?: Json | null
          id?: string
          user_id?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "uploaded_files"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          faq: Json | null
          id: string
          image_urls: string[] | null
          meta_description: string | null
          meta_title: string | null
          optimized_description: string | null
          optimized_price: number | null
          optimized_short_description: string | null
          optimized_title: string | null
          original_description: string | null
          original_price: number | null
          original_title: string | null
          seo_slug: string | null
          short_description: string | null
          sku: string | null
          source_file: string | null
          status: Database["public"]["Enums"]["product_status"]
          supplier_ref: string | null
          tags: string[] | null
          technical_specs: string | null
          updated_at: string
          user_id: string
          woocommerce_id: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          faq?: Json | null
          id?: string
          image_urls?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          original_description?: string | null
          original_price?: number | null
          original_title?: string | null
          seo_slug?: string | null
          short_description?: string | null
          sku?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_ref?: string | null
          tags?: string[] | null
          technical_specs?: string | null
          updated_at?: string
          user_id: string
          woocommerce_id?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          faq?: Json | null
          id?: string
          image_urls?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          optimized_description?: string | null
          optimized_price?: number | null
          optimized_short_description?: string | null
          optimized_title?: string | null
          original_description?: string | null
          original_price?: number | null
          original_title?: string | null
          seo_slug?: string | null
          short_description?: string | null
          sku?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_ref?: string | null
          tags?: string[] | null
          technical_specs?: string | null
          updated_at?: string
          user_id?: string
          woocommerce_id?: number | null
        }
        Relationships: []
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
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      search_knowledge: {
        Args: { _limit?: number; _query: string; _user_id: string }
        Returns: {
          content: string
          id: string
          rank: number
          source_name: string
        }[]
      }
    }
    Enums: {
      activity_action:
        | "upload"
        | "optimize"
        | "publish"
        | "settings_change"
        | "error"
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
      ],
    },
  },
} as const
