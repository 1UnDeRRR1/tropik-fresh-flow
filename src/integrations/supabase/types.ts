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
      branch_distribution_baselines: {
        Row: {
          baseline_cost_ind: number | null
          baseline_cost_inv: number | null
          baseline_eta: string | null
          baseline_pallets: number | null
          branch_id: string
          distribution_id: string
          identified_at: string
          seen_cost_ind: number | null
          seen_cost_inv: number | null
          seen_eta: string | null
          seen_pallets: number | null
          shipment_item_id: string
          updated_at: string
        }
        Insert: {
          baseline_cost_ind?: number | null
          baseline_cost_inv?: number | null
          baseline_eta?: string | null
          baseline_pallets?: number | null
          branch_id: string
          distribution_id: string
          identified_at?: string
          seen_cost_ind?: number | null
          seen_cost_inv?: number | null
          seen_eta?: string | null
          seen_pallets?: number | null
          shipment_item_id: string
          updated_at?: string
        }
        Update: {
          baseline_cost_ind?: number | null
          baseline_cost_inv?: number | null
          baseline_eta?: string | null
          baseline_pallets?: number | null
          branch_id?: string
          distribution_id?: string
          identified_at?: string
          seen_cost_ind?: number | null
          seen_cost_inv?: number | null
          seen_eta?: string | null
          seen_pallets?: number | null
          shipment_item_id?: string
          updated_at?: string
        }
        Relationships: []
      }
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
          pallets: number | null
          qty: number | null
          request_type: string
          requested_by: string | null
          sale_currency: string | null
          sale_price: number | null
          shipment_id: string | null
          shipment_item_id: string | null
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
          pallets?: number | null
          qty?: number | null
          request_type?: string
          requested_by?: string | null
          sale_currency?: string | null
          sale_price?: number | null
          shipment_id?: string | null
          shipment_item_id?: string | null
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
          pallets?: number | null
          qty?: number | null
          request_type?: string
          requested_by?: string | null
          sale_currency?: string | null
          sale_price?: number | null
          shipment_id?: string | null
          shipment_item_id?: string | null
          status?: Database["public"]["Enums"]["branch_request_status"]
          to_branch_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      branch_transfer_offers: {
        Row: {
          accepted_pallets: number
          created_at: string
          created_by: string | null
          decided_at: string | null
          decision_notes: string | null
          distribution_id: string
          from_branch_id: string
          id: string
          notes: string | null
          offered_pallets: number
          shipment_item_id: string
          status: Database["public"]["Enums"]["branch_offer_status"]
          to_branch_id: string
          updated_at: string
        }
        Insert: {
          accepted_pallets?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision_notes?: string | null
          distribution_id: string
          from_branch_id: string
          id?: string
          notes?: string | null
          offered_pallets: number
          shipment_item_id: string
          status?: Database["public"]["Enums"]["branch_offer_status"]
          to_branch_id: string
          updated_at?: string
        }
        Update: {
          accepted_pallets?: number
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision_notes?: string | null
          distribution_id?: string
          from_branch_id?: string
          id?: string
          notes?: string | null
          offered_pallets?: number
          shipment_item_id?: string
          status?: Database["public"]["Enums"]["branch_offer_status"]
          to_branch_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_transfer_offers_distribution_fk"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_transfer_offers_from_branch_fk"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_transfer_offers_shipment_item_fk"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_transfer_offers_shipment_item_fk"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items_branch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_transfer_offers_to_branch_fk"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_visible_prices: {
        Row: {
          branch_id: string
          cost_indicative_usd: number
          cost_invoice_usd: number
          created_at: string
          distribution_id: string
          id: string
          reason: string
          shipment_item_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          cost_indicative_usd: number
          cost_invoice_usd: number
          created_at?: string
          distribution_id: string
          id?: string
          reason: string
          shipment_item_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cost_indicative_usd?: number
          cost_invoice_usd?: number
          created_at?: string
          distribution_id?: string
          id?: string
          reason?: string
          shipment_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_visible_prices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_visible_prices_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_visible_prices_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_visible_prices_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items_branch"
            referencedColumns: ["id"]
          },
        ]
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
      calendar_accounts: {
        Row: {
          access_type: string
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
          user_id: string
          username: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          access_type: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          user_id: string
          username: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          access_type?: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          user_id?: string
          username?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_accounts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cancelled_shipments_archive: {
        Row: {
          archived_at: string
          cancelled_at: string
          cancelled_by: string | null
          cancelled_by_name: string | null
          id: string
          shipment_code: string
          shipment_id: string
          snapshot: Json
        }
        Insert: {
          archived_at?: string
          cancelled_at: string
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          id?: string
          shipment_code: string
          shipment_id: string
          snapshot: Json
        }
        Update: {
          archived_at?: string
          cancelled_at?: string
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          id?: string
          shipment_code?: string
          shipment_id?: string
          snapshot?: Json
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_eu: boolean
          iso2: string | null
          iso3: string | null
          name: string
          scope_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_eu?: boolean
          iso2?: string | null
          iso3?: string | null
          name: string
          scope_type?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_eu?: boolean
          iso2?: string | null
          iso3?: string | null
          name?: string
          scope_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      country_aliases: {
        Row: {
          alias: string
          alias_normalized: string
          alias_type: string | null
          country_name: string
          created_at: string
          id: number
          lang: string | null
        }
        Insert: {
          alias: string
          alias_normalized: string
          alias_type?: string | null
          country_name: string
          created_at?: string
          id?: number
          lang?: string | null
        }
        Update: {
          alias?: string
          alias_normalized?: string
          alias_type?: string | null
          country_name?: string
          created_at?: string
          id?: number
          lang?: string | null
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
      customs_reference: {
        Row: {
          active: boolean
          country: string
          created_at: string
          customs_fee_percent: number
          euro1_markup_usd: number
          euro1_percent: number
          id: string
          product_name: string
          threshold_price_usd: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          country: string
          created_at?: string
          customs_fee_percent?: number
          euro1_markup_usd?: number
          euro1_percent?: number
          id?: string
          product_name: string
          threshold_price_usd?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          country?: string
          created_at?: string
          customs_fee_percent?: number
          euro1_markup_usd?: number
          euro1_percent?: number
          id?: string
          product_name?: string
          threshold_price_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
      distribution_items: {
        Row: {
          distribution_id: string
          id: string
          pallets: number | null
          qty: number
          reserved_offer_id: string | null
          reserved_pallets: number
          shipment_item_id: string
          unit_cost: number | null
        }
        Insert: {
          distribution_id: string
          id?: string
          pallets?: number | null
          qty?: number
          reserved_offer_id?: string | null
          reserved_pallets?: number
          shipment_item_id: string
          unit_cost?: number | null
        }
        Update: {
          distribution_id?: string
          id?: string
          pallets?: number | null
          qty?: number
          reserved_offer_id?: string | null
          reserved_pallets?: number
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
            foreignKeyName: "distribution_items_reserved_offer_id_fkey"
            columns: ["reserved_offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_items_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distribution_items_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items_branch"
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
          {
            foreignKeyName: "distributions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          base_currency: string
          created_at: string
          id: string
          rate: number
          rate_date: string
          source: string
          target_currency: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          id?: string
          rate: number
          rate_date?: string
          source?: string
          target_currency?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string
          target_currency?: string
        }
        Relationships: []
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      loading_plan: {
        Row: {
          caliber: string | null
          count_existing: boolean
          country: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          notes: string | null
          planned_pallets: number
          product_name: string
          updated_at: string
          variety: string | null
        }
        Insert: {
          caliber?: string | null
          count_existing?: boolean
          country?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          planned_pallets?: number
          product_name: string
          updated_at?: string
          variety?: string | null
        }
        Update: {
          caliber?: string | null
          count_existing?: boolean
          country?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          planned_pallets?: number
          product_name?: string
          updated_at?: string
          variety?: string | null
        }
        Relationships: []
      }
      manager_offer_allocation_parts: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          offer_id: string
          pallets: number
          response_id: string
          shipment_id: string | null
          shipment_item_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          offer_id: string
          pallets: number
          response_id: string
          shipment_id?: string | null
          shipment_item_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          offer_id?: string
          pallets?: number
          response_id?: string
          shipment_id?: string | null
          shipment_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moap_branch_fk"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_offer_fk"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_response_fk"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "manager_offer_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_shipment_fk"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_shipment_fk"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_shipment_item_fk"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moap_shipment_item_fk"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_offer_responses: {
        Row: {
          approved_pallets: number | null
          branch_id: string
          created_at: string
          id: string
          linked_pallets: number
          offer_id: string
          prev_approved_pallets: number | null
          requested_pallets: number
          updated_at: string
        }
        Insert: {
          approved_pallets?: number | null
          branch_id: string
          created_at?: string
          id?: string
          linked_pallets?: number
          offer_id: string
          prev_approved_pallets?: number | null
          requested_pallets?: number
          updated_at?: string
        }
        Update: {
          approved_pallets?: number | null
          branch_id?: string
          created_at?: string
          id?: string
          linked_pallets?: number
          offer_id?: string
          prev_approved_pallets?: number | null
          requested_pallets?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_offer_responses_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_offer_shipment_links: {
        Row: {
          allow_caliber_mismatch: boolean
          created_at: string
          created_by: string | null
          final_caliber: string | null
          id: string
          offer_id: string
          original_caliber: string | null
          pallets: number
          shipment_item_id: string
        }
        Insert: {
          allow_caliber_mismatch?: boolean
          created_at?: string
          created_by?: string | null
          final_caliber?: string | null
          id?: string
          offer_id: string
          original_caliber?: string | null
          pallets: number
          shipment_item_id: string
        }
        Update: {
          allow_caliber_mismatch?: boolean
          created_at?: string
          created_by?: string | null
          final_caliber?: string | null
          id?: string
          offer_id?: string
          original_caliber?: string | null
          pallets?: number
          shipment_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_offer_shipment_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_offer_shipment_links_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_offer_shipment_links_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_offer_targets: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          offer_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          offer_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_offer_targets_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_offer_targets_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_offers: {
        Row: {
          caliber: string | null
          created_at: string
          created_by: string
          customs_override_by: string | null
          customs_override_confirmed_at: string | null
          customs_override_duty_usd: number | null
          expected_eta: string | null
          expires_at: string | null
          freight_amount: number | null
          freight_currency: string
          fx_rate_date: string | null
          fx_rate_snapshot: number | null
          id: string
          import_manager_id: string | null
          indicative_cost_usd: number | null
          invoice_cost_usd: number | null
          linked_shipment_id: string | null
          notes: string | null
          offered_pallets: number | null
          origin_country: string | null
          packaging: string | null
          pallet_weight: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          prev_expected_eta: string | null
          prev_indicative_cost_usd: number | null
          prev_invoice_cost_usd: number | null
          price_currency: string
          price_per_kg: number | null
          product_name: string
          specification: string | null
          status: Database["public"]["Enums"]["manager_offer_status"]
          target_mode: Database["public"]["Enums"]["manager_offer_target_mode"]
          updated_at: string
          variety: string | null
        }
        Insert: {
          caliber?: string | null
          created_at?: string
          created_by: string
          customs_override_by?: string | null
          customs_override_confirmed_at?: string | null
          customs_override_duty_usd?: number | null
          expected_eta?: string | null
          expires_at?: string | null
          freight_amount?: number | null
          freight_currency?: string
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          import_manager_id?: string | null
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          linked_shipment_id?: string | null
          notes?: string | null
          offered_pallets?: number | null
          origin_country?: string | null
          packaging?: string | null
          pallet_weight?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          prev_expected_eta?: string | null
          prev_indicative_cost_usd?: number | null
          prev_invoice_cost_usd?: number | null
          price_currency?: string
          price_per_kg?: number | null
          product_name: string
          specification?: string | null
          status?: Database["public"]["Enums"]["manager_offer_status"]
          target_mode?: Database["public"]["Enums"]["manager_offer_target_mode"]
          updated_at?: string
          variety?: string | null
        }
        Update: {
          caliber?: string | null
          created_at?: string
          created_by?: string
          customs_override_by?: string | null
          customs_override_confirmed_at?: string | null
          customs_override_duty_usd?: number | null
          expected_eta?: string | null
          expires_at?: string | null
          freight_amount?: number | null
          freight_currency?: string
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          import_manager_id?: string | null
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          linked_shipment_id?: string | null
          notes?: string | null
          offered_pallets?: number | null
          origin_country?: string | null
          packaging?: string | null
          pallet_weight?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          prev_expected_eta?: string | null
          prev_indicative_cost_usd?: number | null
          prev_invoice_cost_usd?: number | null
          price_currency?: string
          price_per_kg?: number | null
          product_name?: string
          specification?: string | null
          status?: Database["public"]["Enums"]["manager_offer_status"]
          target_mode?: Database["public"]["Enums"]["manager_offer_target_mode"]
          updated_at?: string
          variety?: string | null
        }
        Relationships: []
      }
      manager_vacations: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          import_manager_id: string
          mode: string
          notes: string | null
          replacement_manager_id: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          import_manager_id: string
          mode?: string
          notes?: string | null
          replacement_manager_id?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          import_manager_id?: string
          mode?: string
          notes?: string | null
          replacement_manager_id?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_vacations_import_manager_id_fkey"
            columns: ["import_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_vacations_replacement_manager_id_fkey"
            columns: ["replacement_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
        ]
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
      pallet_standards: {
        Row: {
          box_gross_kg: number | null
          box_net_kg: number | null
          boxes_per_pallet: number | null
          canonical_product_id: string | null
          check_note: string | null
          comment: string | null
          confidence: string | null
          country_en: string | null
          country_ru: string | null
          created_at: string
          id: string
          mapping_status: string
          needs_review: boolean
          package_used: string
          pallet_gross_kg: number | null
          pallet_net_kg: number | null
          pallet_size: string | null
          pallet_type: string | null
          product_label: string
          region: string | null
          source_basis: string | null
          updated_at: string
        }
        Insert: {
          box_gross_kg?: number | null
          box_net_kg?: number | null
          boxes_per_pallet?: number | null
          canonical_product_id?: string | null
          check_note?: string | null
          comment?: string | null
          confidence?: string | null
          country_en?: string | null
          country_ru?: string | null
          created_at?: string
          id?: string
          mapping_status?: string
          needs_review?: boolean
          package_used: string
          pallet_gross_kg?: number | null
          pallet_net_kg?: number | null
          pallet_size?: string | null
          pallet_type?: string | null
          product_label: string
          region?: string | null
          source_basis?: string | null
          updated_at?: string
        }
        Update: {
          box_gross_kg?: number | null
          box_net_kg?: number | null
          boxes_per_pallet?: number | null
          canonical_product_id?: string | null
          check_note?: string | null
          comment?: string | null
          confidence?: string | null
          country_en?: string | null
          country_ru?: string | null
          created_at?: string
          id?: string
          mapping_status?: string
          needs_review?: boolean
          package_used?: string
          pallet_gross_kg?: number | null
          pallet_net_kg?: number | null
          pallet_size?: string | null
          pallet_type?: string | null
          product_label?: string
          region?: string | null
          source_basis?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pallet_standards_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "product_dictionary"
            referencedColumns: ["canonical_product_id"]
          },
        ]
      }
      product_aliases: {
        Row: {
          alias: string
          alias_normalized: string
          canonical_product_id: string
          created_at: string
          id: string
          language_hint: string | null
          mapping_status: string
        }
        Insert: {
          alias: string
          alias_normalized: string
          canonical_product_id: string
          created_at?: string
          id?: string
          language_hint?: string | null
          mapping_status?: string
        }
        Update: {
          alias?: string
          alias_normalized?: string
          canonical_product_id?: string
          created_at?: string
          id?: string
          language_hint?: string | null
          mapping_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "product_dictionary"
            referencedColumns: ["canonical_product_id"]
          },
        ]
      }
      product_dictionary: {
        Row: {
          canonical_product_id: string
          created_at: string
          group_code: string | null
          group_name_en: string | null
          group_name_ua: string | null
          id: string
          is_working_assortment: boolean
          product_key: string
          product_name_en: string | null
          product_name_ua: string
          updated_at: string
        }
        Insert: {
          canonical_product_id: string
          created_at?: string
          group_code?: string | null
          group_name_en?: string | null
          group_name_ua?: string | null
          id?: string
          is_working_assortment?: boolean
          product_key: string
          product_name_en?: string | null
          product_name_ua: string
          updated_at?: string
        }
        Update: {
          canonical_product_id?: string
          created_at?: string
          group_code?: string | null
          group_name_en?: string | null
          group_name_ua?: string | null
          id?: string
          is_working_assortment?: boolean
          product_key?: string
          product_name_en?: string | null
          product_name_ua?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_varieties: {
        Row: {
          created_at: string
          group_name: string | null
          id: number
          product_name_en: string | null
          product_name_ua: string
          variety: string
          variety_normalized: string | null
        }
        Insert: {
          created_at?: string
          group_name?: string | null
          id?: number
          product_name_en?: string | null
          product_name_ua: string
          variety: string
          variety_normalized?: string | null
        }
        Update: {
          created_at?: string
          group_name?: string | null
          id?: number
          product_name_en?: string | null
          product_name_ua?: string
          variety?: string
          variety_normalized?: string | null
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
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
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
          brand: string | null
          caliber: string | null
          class: string | null
          cost_price_usd: number | null
          created_at: string
          customs_cost_indicative: number | null
          customs_cost_invoice: number | null
          customs_match_id: string | null
          customs_override_by: string | null
          customs_override_confirmed_at: string | null
          customs_override_duty_usd: number | null
          final_cost_indicative: number | null
          final_cost_invoice: number | null
          fx_rate_used: number | null
          gross_auto: boolean
          gross_weight_kg: number | null
          id: string
          indicative_price: number | null
          invoice_price: number | null
          linked_offer_id: string | null
          net_auto: boolean
          net_weight_kg: number | null
          origin_country: string | null
          package_used: string | null
          pallet_count: number | null
          pallet_weight: number | null
          price_currency: string
          product_name: string
          qty: number
          resolver_gross_per_pallet_kg: number | null
          resolver_net_per_pallet_kg: number | null
          shipment_id: string
          sku: string | null
          unit: string
          unit_price: number
          unit_price_usd: number | null
          variety: string | null
          weight_kg: number | null
        }
        Insert: {
          brand?: string | null
          caliber?: string | null
          class?: string | null
          cost_price_usd?: number | null
          created_at?: string
          customs_cost_indicative?: number | null
          customs_cost_invoice?: number | null
          customs_match_id?: string | null
          customs_override_by?: string | null
          customs_override_confirmed_at?: string | null
          customs_override_duty_usd?: number | null
          final_cost_indicative?: number | null
          final_cost_invoice?: number | null
          fx_rate_used?: number | null
          gross_auto?: boolean
          gross_weight_kg?: number | null
          id?: string
          indicative_price?: number | null
          invoice_price?: number | null
          linked_offer_id?: string | null
          net_auto?: boolean
          net_weight_kg?: number | null
          origin_country?: string | null
          package_used?: string | null
          pallet_count?: number | null
          pallet_weight?: number | null
          price_currency?: string
          product_name: string
          qty?: number
          resolver_gross_per_pallet_kg?: number | null
          resolver_net_per_pallet_kg?: number | null
          shipment_id: string
          sku?: string | null
          unit?: string
          unit_price?: number
          unit_price_usd?: number | null
          variety?: string | null
          weight_kg?: number | null
        }
        Update: {
          brand?: string | null
          caliber?: string | null
          class?: string | null
          cost_price_usd?: number | null
          created_at?: string
          customs_cost_indicative?: number | null
          customs_cost_invoice?: number | null
          customs_match_id?: string | null
          customs_override_by?: string | null
          customs_override_confirmed_at?: string | null
          customs_override_duty_usd?: number | null
          final_cost_indicative?: number | null
          final_cost_invoice?: number | null
          fx_rate_used?: number | null
          gross_auto?: boolean
          gross_weight_kg?: number | null
          id?: string
          indicative_price?: number | null
          invoice_price?: number | null
          linked_offer_id?: string | null
          net_auto?: boolean
          net_weight_kg?: number | null
          origin_country?: string | null
          package_used?: string | null
          pallet_count?: number | null
          pallet_weight?: number | null
          price_currency?: string
          product_name?: string
          qty?: number
          resolver_gross_per_pallet_kg?: number | null
          resolver_net_per_pallet_kg?: number | null
          shipment_id?: string
          sku?: string | null
          unit?: string
          unit_price?: number
          unit_price_usd?: number | null
          variety?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_linked_offer_id_fkey"
            columns: ["linked_offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          archive_due_at: string | null
          archived_at: string | null
          arrived_at: string | null
          at_customs_at: string | null
          at_warehouse_at: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          customs_cost: number | null
          driver_name: string | null
          driver_phone: string | null
          eta: string | null
          eur_usd_rate: number | null
          eur_usd_rate_date: string | null
          eur_usd_rate_manual: boolean
          eur_usd_rate_source: string | null
          final_freight_amount: number | null
          final_freight_currency: string | null
          final_freight_locked_at: string | null
          final_freight_payment: string | null
          fx_rate: number | null
          id: string
          import_manager_id: string | null
          left_customs_at: string | null
          loading_address: string | null
          loading_date: string | null
          loading_ended_at: string | null
          loading_reference: string | null
          loading_started_at: string | null
          logistics_comment: string | null
          logistics_cost: number | null
          logistics_cost_currency: string
          logistics_cost_usd: number | null
          logistics_days: number | null
          logistics_status: Database["public"]["Enums"]["logistics_status"]
          manual_status_override: boolean
          notes: string | null
          other_costs: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          status: Database["public"]["Enums"]["shipment_status"]
          supplier_id: string | null
          supplier_seq: number | null
          temperature_mode: string | null
          total_weight_kg: number | null
          tractor_plate: string | null
          trailer_plate: string | null
          unloaded_at: string | null
          updated_at: string
          vehicle_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          archive_due_at?: string | null
          archived_at?: string | null
          arrived_at?: string | null
          at_customs_at?: string | null
          at_warehouse_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customs_cost?: number | null
          driver_name?: string | null
          driver_phone?: string | null
          eta?: string | null
          eur_usd_rate?: number | null
          eur_usd_rate_date?: string | null
          eur_usd_rate_manual?: boolean
          eur_usd_rate_source?: string | null
          final_freight_amount?: number | null
          final_freight_currency?: string | null
          final_freight_locked_at?: string | null
          final_freight_payment?: string | null
          fx_rate?: number | null
          id?: string
          import_manager_id?: string | null
          left_customs_at?: string | null
          loading_address?: string | null
          loading_date?: string | null
          loading_ended_at?: string | null
          loading_reference?: string | null
          loading_started_at?: string | null
          logistics_comment?: string | null
          logistics_cost?: number | null
          logistics_cost_currency?: string
          logistics_cost_usd?: number | null
          logistics_days?: number | null
          logistics_status?: Database["public"]["Enums"]["logistics_status"]
          manual_status_override?: boolean
          notes?: string | null
          other_costs?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          supplier_seq?: number | null
          temperature_mode?: string | null
          total_weight_kg?: number | null
          tractor_plate?: string | null
          trailer_plate?: string | null
          unloaded_at?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          archive_due_at?: string | null
          archived_at?: string | null
          arrived_at?: string | null
          at_customs_at?: string | null
          at_warehouse_at?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          customs_cost?: number | null
          driver_name?: string | null
          driver_phone?: string | null
          eta?: string | null
          eur_usd_rate?: number | null
          eur_usd_rate_date?: string | null
          eur_usd_rate_manual?: boolean
          eur_usd_rate_source?: string | null
          final_freight_amount?: number | null
          final_freight_currency?: string | null
          final_freight_locked_at?: string | null
          final_freight_payment?: string | null
          fx_rate?: number | null
          id?: string
          import_manager_id?: string | null
          left_customs_at?: string | null
          loading_address?: string | null
          loading_date?: string | null
          loading_ended_at?: string | null
          loading_reference?: string | null
          loading_started_at?: string | null
          logistics_comment?: string | null
          logistics_cost?: number | null
          logistics_cost_currency?: string
          logistics_cost_usd?: number | null
          logistics_days?: number | null
          logistics_status?: Database["public"]["Enums"]["logistics_status"]
          manual_status_override?: boolean
          notes?: string | null
          other_costs?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          supplier_seq?: number | null
          temperature_mode?: string | null
          total_weight_kg?: number | null
          tractor_plate?: string | null
          trailer_plate?: string | null
          unloaded_at?: string | null
          updated_at?: string
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_import_manager_id_fkey"
            columns: ["import_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          alias: string | null
          code_base: string | null
          contact: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          import_manager_id: string | null
          is_active: boolean
          iso3: string | null
          name: string
          notes: string | null
          phone: string | null
          rating: number | null
        }
        Insert: {
          alias?: string | null
          code_base?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          import_manager_id?: string | null
          is_active?: boolean
          iso3?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
        }
        Update: {
          alias?: string | null
          code_base?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          import_manager_id?: string | null
          is_active?: boolean
          iso3?: string | null
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
      system_logs: {
        Row: {
          action: string | null
          branch_id: string | null
          context: Json | null
          created_at: string
          distribution_id: string | null
          id: string
          level: string
          message: string
          module: string | null
          offer_id: string | null
          shipment_id: string | null
          user_id: string | null
          user_role: string | null
          vehicle_id: string | null
        }
        Insert: {
          action?: string | null
          branch_id?: string | null
          context?: Json | null
          created_at?: string
          distribution_id?: string | null
          id?: string
          level?: string
          message: string
          module?: string | null
          offer_id?: string | null
          shipment_id?: string | null
          user_id?: string | null
          user_role?: string | null
          vehicle_id?: string | null
        }
        Update: {
          action?: string | null
          branch_id?: string | null
          context?: Json | null
          created_at?: string
          distribution_id?: string | null
          id?: string
          level?: string
          message?: string
          module?: string | null
          offer_id?: string | null
          shipment_id?: string | null
          user_id?: string | null
          user_role?: string | null
          vehicle_id?: string | null
        }
        Relationships: []
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
      vacation_supplier_assignments: {
        Row: {
          created_at: string
          id: string
          supplier_id: string
          temp_manager_id: string
          vacation_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          supplier_id: string
          temp_manager_id: string
          vacation_id: string
        }
        Update: {
          created_at?: string
          id?: string
          supplier_id?: string
          temp_manager_id?: string
          vacation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacation_supplier_assignments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_supplier_assignments_temp_manager_id_fkey"
            columns: ["temp_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_supplier_assignments_vacation_id_fkey"
            columns: ["vacation_id"]
            isOneToOne: false
            referencedRelation: "manager_vacations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          code: string
          country: string
          country_code: string
          created_at: string
          created_by: string | null
          eta: string | null
          id: string
          loading_date: string | null
          logistics_days: number | null
          sequence_no: number
          status: Database["public"]["Enums"]["vehicle_status"]
          total_pallets: number
          total_weight_kg: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          code: string
          country: string
          country_code: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          id?: string
          loading_date?: string | null
          logistics_days?: number | null
          sequence_no: number
          status?: Database["public"]["Enums"]["vehicle_status"]
          total_pallets?: number
          total_weight_kg?: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          code?: string
          country?: string
          country_code?: string
          created_at?: string
          created_by?: string | null
          eta?: string | null
          id?: string
          loading_date?: string | null
          logistics_days?: number | null
          sequence_no?: number
          status?: Database["public"]["Enums"]["vehicle_status"]
          total_pallets?: number
          total_weight_kg?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      shipment_items_branch: {
        Row: {
          caliber: string | null
          created_at: string | null
          final_cost_indicative: number | null
          final_cost_invoice: number | null
          free_pallets: number | null
          id: string | null
          origin_country: string | null
          pallet_count: number | null
          pallet_weight: number | null
          product_name: string | null
          qty: number | null
          shipment_id: string | null
          sku: string | null
          unit: string | null
          variety: string | null
          weight_kg: number | null
        }
        Insert: {
          caliber?: string | null
          created_at?: string | null
          final_cost_indicative?: number | null
          final_cost_invoice?: number | null
          free_pallets?: never
          id?: string | null
          origin_country?: string | null
          pallet_count?: number | null
          pallet_weight?: number | null
          product_name?: string | null
          qty?: number | null
          shipment_id?: string | null
          sku?: string | null
          unit?: string | null
          variety?: string | null
          weight_kg?: number | null
        }
        Update: {
          caliber?: string | null
          created_at?: string | null
          final_cost_indicative?: number | null
          final_cost_invoice?: number | null
          free_pallets?: never
          id?: string | null
          origin_country?: string | null
          pallet_count?: number | null
          pallet_weight?: number | null
          product_name?: string | null
          qty?: number | null
          shipment_id?: string | null
          sku?: string | null
          unit?: string | null
          variety?: string | null
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
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments_branch: {
        Row: {
          archived_at: string | null
          arrived_at: string | null
          cancelled_at: string | null
          code: string | null
          country: string | null
          created_at: string | null
          eta: string | null
          id: string | null
          import_manager_id: string | null
          import_manager_name: string | null
          loading_date: string | null
          status: Database["public"]["Enums"]["shipment_status"] | null
          unloaded_at: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_import_manager_id_fkey"
            columns: ["import_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _bvp_link: {
        Args: {
          p_branch_id: string
          p_distribution_id: string
          p_shipment_item_id: string
        }
        Returns: string
      }
      _bvp_propagate_shipment: {
        Args: {
          p_reason: string
          p_shipment_id: string
          p_shipment_item_id?: string
        }
        Returns: undefined
      }
      active_shipments_overview: {
        Args: never
        Returns: {
          caliber: string
          country: string
          eta: string
          final_cost_indicative: number
          final_cost_invoice: number
          manager_id: string
          manager_name: string
          pallet_count: number
          pallet_weight: number
          product_name: string
          shipment_code: string
          shipment_id: string
          shipment_item_id: string
          status: string
        }[]
      }
      add_hours_excl_sunday: {
        Args: { _from: string; _hours: number }
        Returns: string
      }
      archive_due_cancelled_shipments: { Args: never; Returns: number }
      archive_due_unloaded_shipments: { Args: never; Returns: number }
      auto_unload_shipments: { Args: never; Returns: number }
      branch_ack_changes: {
        Args: { p_distribution_id: string; p_shipment_item_id: string }
        Returns: undefined
      }
      can_access_manager_offer: {
        Args: { _branch_id: string; _offer_id: string }
        Returns: boolean
      }
      can_access_supplier: {
        Args: { _supplier_id: string; _user_id: string }
        Returns: boolean
      }
      can_close_vehicle: {
        Args: { _user_id: string; _vehicle_id: string }
        Returns: boolean
      }
      confirm_manager_offer_customs_override: {
        Args: { p_duty: number; p_offer_id: string }
        Returns: {
          caliber: string | null
          created_at: string
          created_by: string
          customs_override_by: string | null
          customs_override_confirmed_at: string | null
          customs_override_duty_usd: number | null
          expected_eta: string | null
          expires_at: string | null
          freight_amount: number | null
          freight_currency: string
          fx_rate_date: string | null
          fx_rate_snapshot: number | null
          id: string
          import_manager_id: string | null
          indicative_cost_usd: number | null
          invoice_cost_usd: number | null
          linked_shipment_id: string | null
          notes: string | null
          offered_pallets: number | null
          origin_country: string | null
          packaging: string | null
          pallet_weight: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          prev_expected_eta: string | null
          prev_indicative_cost_usd: number | null
          prev_invoice_cost_usd: number | null
          price_currency: string
          price_per_kg: number | null
          product_name: string
          specification: string | null
          status: Database["public"]["Enums"]["manager_offer_status"]
          target_mode: Database["public"]["Enums"]["manager_offer_target_mode"]
          updated_at: string
          variety: string | null
        }
        SetofOptions: {
          from: "*"
          to: "manager_offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_shipment_item_customs_override: {
        Args: { p_duty: number; p_item_id: string }
        Returns: {
          brand: string | null
          caliber: string | null
          class: string | null
          cost_price_usd: number | null
          created_at: string
          customs_cost_indicative: number | null
          customs_cost_invoice: number | null
          customs_match_id: string | null
          customs_override_by: string | null
          customs_override_confirmed_at: string | null
          customs_override_duty_usd: number | null
          final_cost_indicative: number | null
          final_cost_invoice: number | null
          fx_rate_used: number | null
          gross_auto: boolean
          gross_weight_kg: number | null
          id: string
          indicative_price: number | null
          invoice_price: number | null
          linked_offer_id: string | null
          net_auto: boolean
          net_weight_kg: number | null
          origin_country: string | null
          package_used: string | null
          pallet_count: number | null
          pallet_weight: number | null
          price_currency: string
          product_name: string
          qty: number
          resolver_gross_per_pallet_kg: number | null
          resolver_net_per_pallet_kg: number | null
          shipment_id: string
          sku: string | null
          unit: string
          unit_price: number
          unit_price_usd: number | null
          variety: string | null
          weight_kg: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipment_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_import_manager_id: { Args: never; Returns: string }
      effective_manager_ids: { Args: { _user_id: string }; Returns: string[] }
      ensure_shipment_fx_snapshot: {
        Args: { _shipment_id: string }
        Returns: number
      }
      expire_branch_transfer_offers: { Args: never; Returns: number }
      expire_manager_offers: { Args: never; Returns: number }
      fn_normalize_text: { Args: { p_in: string }; Returns: string }
      get_profile_names: {
        Args: { _ids: string[] }
        Returns: {
          full_name: string
          id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_calendar_active: { Args: { _user_id: string }; Returns: boolean }
      is_customs_red: {
        Args: { p_country: string; p_product: string }
        Returns: boolean
      }
      is_eu_country: { Args: { _country: string }; Returns: boolean }
      is_shipment_locked: { Args: { _shipment_id: string }; Returns: boolean }
      is_shipment_owner: {
        Args: { _shipment_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_vehicle_coloader: {
        Args: { _user_id: string; _vehicle_id: string }
        Returns: boolean
      }
      link_manager_offer_to_shipment_item: {
        Args: {
          p_allow_caliber_mismatch?: boolean
          p_offer_id: string
          p_pallets: number
          p_shipment_item_id: string
        }
        Returns: {
          link_id: string
          remaining_to_load: number
          shipment_id: string
          shipment_item_id: string
        }[]
      }
      link_offer_to_shipment_item_fifo: {
        Args: {
          p_allow_caliber_mismatch?: boolean
          p_max_pallets?: number
          p_notes?: string
          p_offer_id: string
          p_shipment_item_id: string
        }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          offer_id: string
          pallets: number
          response_id: string
          shipment_id: string | null
          shipment_item_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "manager_offer_allocation_parts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      link_response_to_shipment_item: {
        Args: {
          p_allow_caliber_mismatch?: boolean
          p_notes?: string
          p_pallets: number
          p_response_id: string
          p_shipment_item_id: string
        }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          offer_id: string
          pallets: number
          response_id: string
          shipment_id: string | null
          shipment_item_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "manager_offer_allocation_parts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      loading_plan_items: {
        Args: { _plan_id: string }
        Returns: {
          created_at: string
          origin_country: string
          pallet_count: number
          product_name: string
          shipment_code: string
          shipment_country: string
          shipment_created_at: string
          shipment_eta: string
          shipment_id: string
          supplier_name: string
          vehicle_code: string
          vehicle_eta: string
        }[]
      }
      loading_plan_loaded_totals: {
        Args: never
        Returns: {
          loaded: number
          plan_id: string
        }[]
      }
      lock_final_freight: {
        Args: {
          p_amount: number
          p_currency: string
          p_payment?: string
          p_shipment_id: string
        }
        Returns: undefined
      }
      next_calendar_username_seq: { Args: { _prefix: string }; Returns: number }
      next_supplier_sequence: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      next_vehicle_sequence: {
        Args: { p_country_code: string }
        Returns: number
      }
      owns_manager_offer: {
        Args: { _offer_id: string; _user_id: string }
        Returns: boolean
      }
      recompute_vehicle_item_costs: {
        Args: { _shipment_id: string; _vehicle_id: string }
        Returns: undefined
      }
      recompute_vehicle_totals_for: {
        Args: { _vehicle_id: string }
        Returns: undefined
      }
      rpc_pallet_standard_exact: {
        Args: {
          p_country: string
          p_dictionary_id: string
          p_package_used?: string
        }
        Returns: {
          candidate_count: number
          canonical_product_id: string
          mapping_status: string
          match_kind: string
          needs_review: boolean
          package_used: string
          pallet_footprint_text: string
          pallet_gross_kg: number
          pallet_net_kg: number
          pallet_standard_id: string
          selected_by: string
          status: string
        }[]
      }
      rpc_resolve_country: {
        Args: { p_input: string }
        Returns: {
          alias_normalized: string
          country_name: string
          iso3: string
          status: string
        }[]
      }
      rpc_resolve_offer_line_defaults: {
        Args: {
          p_country_query: string
          p_include_reserve?: boolean
          p_package_used?: string
          p_product_query: string
        }
        Returns: {
          canonical_product_id: string
          country_iso3: string
          country_match_status: string
          country_name: string
          needs_review: boolean
          package_used: string
          pallet_candidate_count: number
          pallet_footprint_text: string
          pallet_gross_kg: number
          pallet_net_kg: number
          pallet_selected_by: string
          pallet_standard_id: string
          product_candidate_count: number
          product_dictionary_id: string
          product_match_status: string
          product_name_ua: string
          review_reason: string
          status: string
        }[]
      }
      rpc_resolve_product_exact: {
        Args: { p_include_reserve?: boolean; p_query: string }
        Returns: {
          candidate_count: number
          canonical_product_id: string
          dictionary_id: string
          product_name_ua: string
          status: string
        }[]
      }
      rpc_resolve_product_search: {
        Args: { p_include_reserve?: boolean; p_limit?: number; p_query: string }
        Returns: {
          alias_normalized: string
          canonical_product_id: string
          dictionary_id: string
          is_working_assortment: boolean
          match_language: string
          match_rank: number
          match_type: string
          matched_alias: string
          product_key: string
          product_name_en: string
          product_name_ua: string
        }[]
      }
      shipment_has_free_pallets: {
        Args: { _shipment_id: string }
        Returns: boolean
      }
      shipment_item_free_pallets: {
        Args: { _item_id: string }
        Returns: number
      }
      sync_manager_offer_distribution: {
        Args: { _offer_id: string }
        Returns: undefined
      }
      tick_shipment_pipeline: { Args: never; Returns: undefined }
      tropik_calendar_aggregate: {
        Args: never
        Returns: {
          product_name: string
          shipment_count: number
          total_pallets: number
        }[]
      }
      tropik_calendar_shipments: {
        Args: { _product: string }
        Returns: {
          caliber: string
          eta: string
          final_cost_indicative: number
          final_cost_invoice: number
          manager_name: string
          origin_country: string
          pallets: number
          shipment_code: string
          shipment_id: string
          status: string
        }[]
      }
      unlink_manager_offer_from_shipment_item: {
        Args: { p_offer_id: string; p_shipment_item_id: string }
        Returns: {
          remaining_to_load: number
        }[]
      }
      user_branch_id: { Args: { _user_id: string }; Returns: string }
      user_calendar_branch: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "import_manager"
        | "branch"
        | "calendar_branch"
        | "calendar_tropik"
        | "logistics"
        | "broker"
      branch_offer_status:
        | "pending"
        | "partially_accepted"
        | "accepted"
        | "rejected"
        | "expired"
      branch_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "fulfilled"
        | "cancelled"
      distribution_status: "planned" | "dispatched" | "received" | "cancelled"
      logistics_status:
        | "pending_planning"
        | "planning"
        | "vehicle_assigned"
        | "ready_for_loading"
        | "loading"
        | "in_transit"
        | "at_customs"
        | "delayed"
        | "arrived"
      manager_offer_status:
        | "draft"
        | "active"
        | "in_work"
        | "confirmed"
        | "linked"
        | "closed"
        | "expired"
        | "deleted"
      manager_offer_target_mode: "all" | "selected"
      pipeline_status:
        | "proposed"
        | "processing"
        | "ordered"
        | "awaiting_loading"
        | "loading"
        | "in_transit"
        | "at_customs"
        | "left_customs"
        | "at_warehouse"
        | "awaiting_confirmation"
        | "rejected"
        | "confirmed"
        | "unloaded"
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
      vehicle_status: "open" | "closed"
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
      app_role: [
        "super_admin",
        "admin",
        "import_manager",
        "branch",
        "calendar_branch",
        "calendar_tropik",
        "logistics",
        "broker",
      ],
      branch_offer_status: [
        "pending",
        "partially_accepted",
        "accepted",
        "rejected",
        "expired",
      ],
      branch_request_status: [
        "pending",
        "approved",
        "rejected",
        "fulfilled",
        "cancelled",
      ],
      distribution_status: ["planned", "dispatched", "received", "cancelled"],
      logistics_status: [
        "pending_planning",
        "planning",
        "vehicle_assigned",
        "ready_for_loading",
        "loading",
        "in_transit",
        "at_customs",
        "delayed",
        "arrived",
      ],
      manager_offer_status: [
        "draft",
        "active",
        "in_work",
        "confirmed",
        "linked",
        "closed",
        "expired",
        "deleted",
      ],
      manager_offer_target_mode: ["all", "selected"],
      pipeline_status: [
        "proposed",
        "processing",
        "ordered",
        "awaiting_loading",
        "loading",
        "in_transit",
        "at_customs",
        "left_customs",
        "at_warehouse",
        "awaiting_confirmation",
        "rejected",
        "confirmed",
        "unloaded",
      ],
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
      vehicle_status: ["open", "closed"],
    },
  },
} as const
