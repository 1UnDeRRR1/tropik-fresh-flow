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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      branch_request_items: {
        Row: {
          branch_request_id: string
          id: string
          product_name: string
          qty: number
          unit: string
        }
        Insert: {
          branch_request_id: string
          id?: string
          product_name: string
          qty?: number
          unit?: string
        }
        Update: {
          branch_request_id?: string
          id?: string
          product_name?: string
          qty?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_request_items_branch_request_id_fkey"
            columns: ["branch_request_id"]
            isOneToOne: false
            referencedRelation: "branch_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_requests: {
        Row: {
          approved_qty: number | null
          branch_id: string
          created_at: string
          decision_notes: string | null
          id: string
          notes: string | null
          qty: number | null
          request_type: string
          requested_by: string | null
          shipment_id: string | null
          status: Database["public"]["Enums"]["branch_request_status"]
          to_branch_id: string | null
          updated_at: string
        }
        Insert: {
          approved_qty?: number | null
          branch_id: string
          created_at?: string
          decision_notes?: string | null
          id?: string
          notes?: string | null
          qty?: number | null
          request_type?: string
          requested_by?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["branch_request_status"]
          to_branch_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_qty?: number | null
          branch_id?: string
          created_at?: string
          decision_notes?: string | null
          id?: string
          notes?: string | null
          qty?: number | null
          request_type?: string
          requested_by?: string | null
          shipment_id?: string | null
          status?: Database["public"]["Enums"]["branch_request_status"]
          to_branch_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          manager_name: string | null
          name: string
          phone: string | null
          sort_order: number | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          manager_name?: string | null
          name: string
          phone?: string | null
          sort_order?: number | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          manager_name?: string | null
          name?: string
          phone?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      country_logistics: {
        Row: {
          country: string
          created_at: string
          id: string
          logistics_days: number
          updated_at: string
          weekend_adjustment: boolean
        }
        Insert: {
          country: string
          created_at?: string
          id?: string
          logistics_days?: number
          updated_at?: string
          weekend_adjustment?: boolean
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          logistics_days?: number
          updated_at?: string
          weekend_adjustment?: boolean
        }
        Relationships: []
      }
      distribution_items: {
        Row: {
          distribution_id: string
          id: string
          pallets: number | null
          qty: number
          shipment_item_id: string
          unit_cost: number | null
        }
        Insert: {
          distribution_id: string
          id?: string
          pallets?: number | null
          qty?: number
          shipment_item_id: string
          unit_cost?: number | null
        }
        Update: {
          distribution_id?: string
          id?: string
          pallets?: number | null
          qty?: number
          shipment_item_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "distribution_items_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_items_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
        ]
      }
      distributions: {
        Row: {
          branch_id: string
          created_at: string
          dispatched_at: string | null
          id: string
          notes: string | null
          received_at: string | null
          shipment_id: string
          status: Database["public"]["Enums"]["distribution_status"]
        }
        Insert: {
          branch_id: string
          created_at?: string
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          shipment_id: string
          status?: Database["public"]["Enums"]["distribution_status"]
        }
        Update: {
          branch_id?: string
          created_at?: string
          dispatched_at?: string | null
          id?: string
          notes?: string | null
          received_at?: string | null
          shipment_id?: string
          status?: Database["public"]["Enums"]["distribution_status"]
        }
        Relationships: [
          {
            foreignKeyName: "distributions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      import_managers: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          default_pallet_weight: number | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          default_pallet_weight?: number | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          default_pallet_weight?: number | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          branch_id: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_item_changes: {
        Row: {
          changed_by: string | null
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          shipment_id: string
          shipment_item_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          shipment_id: string
          shipment_item_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          shipment_id?: string
          shipment_item_id?: string
        }
        Relationships: []
      }
      shipment_items: {
        Row: {
          caliber: string | null
          created_at: string
          id: string
          indicative_price: number | null
          invoice_price: number | null
          pallet_count: number | null
          pallet_weight: number | null
          product_name: string
          qty: number
          shipment_id: string
          sku: string | null
          unit: string
          unit_price: number
          weight_kg: number | null
        }
        Insert: {
          caliber?: string | null
          created_at?: string
          id?: string
          indicative_price?: number | null
          invoice_price?: number | null
          pallet_count?: number | null
          pallet_weight?: number | null
          product_name: string
          qty?: number
          shipment_id: string
          sku?: string | null
          unit?: string
          unit_price?: number
          weight_kg?: number | null
        }
        Update: {
          caliber?: string | null
          created_at?: string
          id?: string
          indicative_price?: number | null
          invoice_price?: number | null
          pallet_count?: number | null
          pallet_weight?: number | null
          product_name?: string
          qty?: number
          shipment_id?: string
          sku?: string | null
          unit?: string
          unit_price?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          arrived_at: string | null
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customs_cost: number | null
          eta: string | null
          fx_rate: number | null
          id: string
          import_manager_id: string | null
          loading_date: string | null
          logistics_cost: number | null
          logistics_days: number | null
          notes: string | null
          other_costs: number | null
          status: Database["public"]["Enums"]["shipment_status"]
          supplier_id: string | null
          total_weight_kg: number | null
          updated_at: string
        }
        Insert: {
          arrived_at?: string | null
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customs_cost?: number | null
          eta?: string | null
          fx_rate?: number | null
          id?: string
          import_manager_id?: string | null
          loading_date?: string | null
          logistics_cost?: number | null
          logistics_days?: number | null
          notes?: string | null
          other_costs?: number | null
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          total_weight_kg?: number | null
          updated_at?: string
        }
        Update: {
          arrived_at?: string | null
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customs_cost?: number | null
          eta?: string | null
          fx_rate?: number | null
          id?: string
          import_manager_id?: string | null
          loading_date?: string | null
          logistics_cost?: number | null
          logistics_days?: number | null
          notes?: string | null
          other_costs?: number | null
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          total_weight_kg?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          import_manager_id: string | null
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          rating: number | null
        }
        Insert: {
          contact?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          import_manager_id?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
        }
        Update: {
          contact?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          import_manager_id?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_import_manager_id_fkey"
            columns: ["import_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_request_items: {
        Row: {
          id: string
          product_name: string
          qty: number
          transfer_request_id: string
          unit: string
        }
        Insert: {
          id?: string
          product_name: string
          qty?: number
          transfer_request_id: string
          unit?: string
        }
        Update: {
          id?: string
          product_name?: string
          qty?: number
          transfer_request_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_items_transfer_id_fkey"
            columns: ["transfer_request_id"]
            isOneToOne: false
            referencedRelation: "transfer_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_requests: {
        Row: {
          created_at: string
          created_by: string | null
          from_branch_id: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          to_branch_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_branch_id: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          to_branch_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_branch_id?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          to_branch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          payload: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          payload?: Json | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      user_branch_id: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "import_manager" | "branch"
      branch_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "fulfilled"
        | "cancelled"
      distribution_status: "planned" | "dispatched" | "received" | "cancelled"
      shipment_status:
        | "draft"
        | "loading"
        | "in_transit"
        | "customs"
        | "arrived"
        | "distributing"
        | "completed"
        | "cancelled"
        | "delayed"
      transfer_status:
        | "requested"
        | "approved"
        | "in_transit"
        | "received"
        | "cancelled"
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
      app_role: ["super_admin", "admin", "import_manager", "branch"],
      branch_request_status: [
        "pending",
        "approved",
        "rejected",
        "fulfilled",
        "cancelled",
      ],
      distribution_status: ["planned", "dispatched", "received", "cancelled"],
      shipment_status: [
        "draft",
        "loading",
        "in_transit",
        "customs",
        "arrived",
        "distributing",
        "completed",
        "cancelled",
        "delayed",
      ],
      transfer_status: [
        "requested",
        "approved",
        "in_transit",
        "received",
        "cancelled",
      ],
    },
  },
} as const
