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
      archive_promise_snapshots: {
        Row: {
          branch_id: string
          caliber: string | null
          cost_indicative_usd_snapshot: number | null
          cost_invoice_usd_snapshot: number | null
          created_at: string
          notes: string | null
          packaging: string | null
          pallet_qty: number | null
          position_id: string
          product_id: string | null
          product_origin_country_id: string | null
          promise_eta_snapshot: string | null
          requested_qty: number
          requested_sale_currency_snapshot: string | null
          requested_sale_price_snapshot: number | null
          resolution:
            | Database["public"]["Enums"]["archive_snapshot_resolution"]
            | null
          resolved_at: string | null
          responsible_manager_id: string | null
          snapshot_id: string
          source: Database["public"]["Enums"]["archive_snapshot_source"]
          source_offer_id: string | null
          source_response_id: string | null
          source_shipment_id: string | null
          status: Database["public"]["Enums"]["archive_snapshot_status"]
          variety_id: number | null
          visible_archive_event_id: string | null
        }
        Insert: {
          branch_id: string
          caliber?: string | null
          cost_indicative_usd_snapshot?: number | null
          cost_invoice_usd_snapshot?: number | null
          created_at?: string
          notes?: string | null
          packaging?: string | null
          pallet_qty?: number | null
          position_id: string
          product_id?: string | null
          product_origin_country_id?: string | null
          promise_eta_snapshot?: string | null
          requested_qty: number
          requested_sale_currency_snapshot?: string | null
          requested_sale_price_snapshot?: number | null
          resolution?:
            | Database["public"]["Enums"]["archive_snapshot_resolution"]
            | null
          resolved_at?: string | null
          responsible_manager_id?: string | null
          snapshot_id?: string
          source: Database["public"]["Enums"]["archive_snapshot_source"]
          source_offer_id?: string | null
          source_response_id?: string | null
          source_shipment_id?: string | null
          status?: Database["public"]["Enums"]["archive_snapshot_status"]
          variety_id?: number | null
          visible_archive_event_id?: string | null
        }
        Update: {
          branch_id?: string
          caliber?: string | null
          cost_indicative_usd_snapshot?: number | null
          cost_invoice_usd_snapshot?: number | null
          created_at?: string
          notes?: string | null
          packaging?: string | null
          pallet_qty?: number | null
          position_id?: string
          product_id?: string | null
          product_origin_country_id?: string | null
          promise_eta_snapshot?: string | null
          requested_qty?: number
          requested_sale_currency_snapshot?: string | null
          requested_sale_price_snapshot?: number | null
          resolution?:
            | Database["public"]["Enums"]["archive_snapshot_resolution"]
            | null
          resolved_at?: string | null
          responsible_manager_id?: string | null
          snapshot_id?: string
          source?: Database["public"]["Enums"]["archive_snapshot_source"]
          source_offer_id?: string | null
          source_response_id?: string | null
          source_shipment_id?: string | null
          status?: Database["public"]["Enums"]["archive_snapshot_status"]
          variety_id?: number | null
          visible_archive_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "archive_promise_snapshots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archive_promise_snapshots_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "archive_promise_snapshots_visible_archive_event_id_fkey"
            columns: ["visible_archive_event_id"]
            isOneToOne: false
            referencedRelation: "branch_archive_results"
            referencedColumns: ["result_id"]
          },
          {
            foreignKeyName: "archive_promise_snapshots_visible_archive_event_id_fkey"
            columns: ["visible_archive_event_id"]
            isOneToOne: false
            referencedRelation: "branch_archive_results_admin"
            referencedColumns: ["result_id"]
          },
          {
            foreignKeyName: "archive_promise_snapshots_visible_archive_event_id_fkey"
            columns: ["visible_archive_event_id"]
            isOneToOne: false
            referencedRelation: "branch_archive_results_branch"
            referencedColumns: ["result_id"]
          },
          {
            foreignKeyName: "archive_promise_snapshots_visible_archive_event_id_fkey"
            columns: ["visible_archive_event_id"]
            isOneToOne: false
            referencedRelation: "branch_archive_results_manager"
            referencedColumns: ["result_id"]
          },
        ]
      }
      branch_archive_results: {
        Row: {
          actual_cost_indicative_usd: number | null
          actual_cost_invoice_usd: number | null
          actual_cost_landed_usd: number | null
          actual_eta: string | null
          branch_id: string
          created_at: string
          cut_qty: number | null
          delivered_qty: number | null
          event_qty: number | null
          event_type: Database["public"]["Enums"]["archive_visible_event_type"]
          is_split_shipment: boolean
          notes: string | null
          occurred_at: string
          position_id: string
          responsible_manager_id: string | null
          result_id: string
          shared_qty: number | null
          shipment_id: string | null
          snapshot_id: string
        }
        Insert: {
          actual_cost_indicative_usd?: number | null
          actual_cost_invoice_usd?: number | null
          actual_cost_landed_usd?: number | null
          actual_eta?: string | null
          branch_id: string
          created_at?: string
          cut_qty?: number | null
          delivered_qty?: number | null
          event_qty?: number | null
          event_type: Database["public"]["Enums"]["archive_visible_event_type"]
          is_split_shipment?: boolean
          notes?: string | null
          occurred_at?: string
          position_id: string
          responsible_manager_id?: string | null
          result_id?: string
          shared_qty?: number | null
          shipment_id?: string | null
          snapshot_id: string
        }
        Update: {
          actual_cost_indicative_usd?: number | null
          actual_cost_invoice_usd?: number | null
          actual_cost_landed_usd?: number | null
          actual_eta?: string | null
          branch_id?: string
          created_at?: string
          cut_qty?: number | null
          delivered_qty?: number | null
          event_qty?: number | null
          event_type?: Database["public"]["Enums"]["archive_visible_event_type"]
          is_split_shipment?: boolean
          notes?: string | null
          occurred_at?: string
          position_id?: string
          responsible_manager_id?: string | null
          result_id?: string
          shared_qty?: number | null
          shipment_id?: string | null
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_archive_results_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_archive_results_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "branch_archive_results_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "archive_promise_snapshots"
            referencedColumns: ["snapshot_id"]
          },
        ]
      }
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
          from_offer_id: string | null
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
          from_offer_id?: string | null
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
          from_offer_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "branch_requests_from_offer_id_fkey"
            columns: ["from_offer_id"]
            isOneToOne: false
            referencedRelation: "manager_offers"
            referencedColumns: ["id"]
          },
        ]
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
          refused_at: string | null
          refused_by: string | null
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
          refused_at?: string | null
          refused_by?: string | null
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
          refused_at?: string | null
          refused_by?: string | null
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
          pallet_gross_kg: number | null
          pallet_net_kg: number | null
          pallet_weight: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          position_id: string | null
          prev_expected_eta: string | null
          prev_indicative_cost_usd: number | null
          prev_invoice_cost_usd: number | null
          price_currency: string
          price_per_kg: number | null
          product_name: string
          share_token: string | null
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
          pallet_gross_kg?: number | null
          pallet_net_kg?: number | null
          pallet_weight?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          position_id?: string | null
          prev_expected_eta?: string | null
          prev_indicative_cost_usd?: number | null
          prev_invoice_cost_usd?: number | null
          price_currency?: string
          price_per_kg?: number | null
          product_name: string
          share_token?: string | null
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
          pallet_gross_kg?: number | null
          pallet_net_kg?: number | null
          pallet_weight?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          position_id?: string | null
          prev_expected_eta?: string | null
          prev_indicative_cost_usd?: number | null
          prev_invoice_cost_usd?: number | null
          price_currency?: string
          price_per_kg?: number | null
          product_name?: string
          share_token?: string | null
          specification?: string | null
          status?: Database["public"]["Enums"]["manager_offer_status"]
          target_mode?: Database["public"]["Enums"]["manager_offer_target_mode"]
          updated_at?: string
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manager_offers_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      manager_supplier_assignments: {
        Row: {
          created_at: string
          id: string
          manager_id: string
          source_code: string | null
          supplier_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id: string
          source_code?: string | null
          supplier_id: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string
          source_code?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_supplier_assignments_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_supplier_assignments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
      operational_positions: {
        Row: {
          caliber: string | null
          client_row_id: string | null
          created_at: string
          created_by: string | null
          current_status: string
          notes: string | null
          owner_user_id: string | null
          packaging: string | null
          pallet_qty: number | null
          position_id: string
          product_id: string
          product_origin_country_id: string
          source_context: string | null
          source_row_key: string | null
          supplier_id: string | null
          updated_at: string
          variety_id: number | null
        }
        Insert: {
          caliber?: string | null
          client_row_id?: string | null
          created_at?: string
          created_by?: string | null
          current_status?: string
          notes?: string | null
          owner_user_id?: string | null
          packaging?: string | null
          pallet_qty?: number | null
          position_id?: string
          product_id: string
          product_origin_country_id: string
          source_context?: string | null
          source_row_key?: string | null
          supplier_id?: string | null
          updated_at?: string
          variety_id?: number | null
        }
        Update: {
          caliber?: string | null
          client_row_id?: string | null
          created_at?: string
          created_by?: string | null
          current_status?: string
          notes?: string | null
          owner_user_id?: string | null
          packaging?: string | null
          pallet_qty?: number | null
          position_id?: string
          product_id?: string
          product_origin_country_id?: string
          source_context?: string | null
          source_row_key?: string | null
          supplier_id?: string | null
          updated_at?: string
          variety_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "operational_positions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_positions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_positions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_dictionary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_positions_product_origin_country_id_fkey"
            columns: ["product_origin_country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_positions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_positions_variety_id_fkey"
            columns: ["variety_id"]
            isOneToOne: false
            referencedRelation: "product_varieties"
            referencedColumns: ["id"]
          },
        ]
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
      position_branch_allocations: {
        Row: {
          approved_qty: number
          branch_id: string
          cancelled_qty: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_notes: string | null
          id: string
          ordered_qty: number
          position_id: string
          remaining_qty: number | null
          requested_qty: number
          status: string
          updated_at: string
        }
        Insert: {
          approved_qty?: number
          branch_id: string
          cancelled_qty?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          id?: string
          ordered_qty?: number
          position_id: string
          remaining_qty?: number | null
          requested_qty?: number
          status?: string
          updated_at?: string
        }
        Update: {
          approved_qty?: number
          branch_id?: string
          cancelled_qty?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          id?: string
          ordered_qty?: number
          position_id?: string
          remaining_qty?: number | null
          requested_qty?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_branch_allocations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_branch_allocations_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_branch_allocations_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      position_cost_current: {
        Row: {
          fx_rate_date: string | null
          fx_rate_snapshot: number | null
          indicative_cost_usd: number | null
          invoice_cost_usd: number | null
          position_id: string
          source_event_id: string | null
          updated_at: string
        }
        Insert: {
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          position_id: string
          source_event_id?: string | null
          updated_at?: string
        }
        Update: {
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          position_id?: string
          source_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_cost_current_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: true
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_cost_current_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "position_events"
            referencedColumns: ["id"]
          },
        ]
      }
      position_cost_history: {
        Row: {
          created_at: string
          fx_rate_date: string | null
          fx_rate_snapshot: number | null
          id: string
          indicative_cost_usd: number | null
          invoice_cost_usd: number | null
          position_id: string
          reason: string | null
          source_event_id: string | null
        }
        Insert: {
          created_at?: string
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          position_id: string
          reason?: string | null
          source_event_id?: string | null
        }
        Update: {
          created_at?: string
          fx_rate_date?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          indicative_cost_usd?: number | null
          invoice_cost_usd?: number | null
          position_id?: string
          reason?: string | null
          source_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "position_cost_history_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_cost_history_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "position_events"
            referencedColumns: ["id"]
          },
        ]
      }
      position_documents: {
        Row: {
          created_at: string
          doc_type: string
          external_url: string | null
          id: string
          notes: string | null
          position_id: string
          storage_path: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type: string
          external_url?: string | null
          id?: string
          notes?: string | null
          position_id: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          external_url?: string | null
          id?: string
          notes?: string | null
          position_id?: string
          storage_path?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "position_documents_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      position_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          position_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          position_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          position_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_events_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      position_logistics_legs: {
        Row: {
          actual_date: string | null
          actual_qty: number | null
          created_at: string
          id: string
          leg_number: number
          notes: string | null
          planned_date: string | null
          planned_qty: number | null
          position_id: string
          shipment_id: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          actual_date?: string | null
          actual_qty?: number | null
          created_at?: string
          id?: string
          leg_number: number
          notes?: string | null
          planned_date?: string | null
          planned_qty?: number | null
          position_id: string
          shipment_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          actual_date?: string | null
          actual_qty?: number | null
          created_at?: string
          id?: string
          leg_number?: number
          notes?: string | null
          planned_date?: string | null
          planned_qty?: number | null
          position_id?: string
          shipment_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "position_logistics_legs_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_logistics_legs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_logistics_legs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_logistics_legs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_capacity_v"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "position_logistics_legs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      position_shipment_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          pallet_qty_linked: number
          position_id: string
          shipment_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          pallet_qty_linked: number
          position_id: string
          shipment_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          pallet_qty_linked?: number
          position_id?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_shipment_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_shipment_links_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_shipment_links_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_shipment_links_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments_branch"
            referencedColumns: ["id"]
          },
        ]
      }
      position_split_links: {
        Row: {
          child_position_id: string
          created_at: string
          created_by: string | null
          id: string
          parent_position_id: string
          split_reason: string | null
        }
        Insert: {
          child_position_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_position_id: string
          split_reason?: string | null
        }
        Update: {
          child_position_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_position_id?: string
          split_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "position_split_links_child_position_id_fkey"
            columns: ["child_position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "position_split_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_split_links_parent_position_id_fkey"
            columns: ["parent_position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      position_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          position_id: string
          reason: string | null
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          position_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          position_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_status_history_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
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
          display_name: string | null
          full_name: string | null
          id: string
          is_active: boolean
          job_title: string | null
          phone: string | null
          updated_at: string
          visual_mark: string | null
        }
        Insert: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          updated_at?: string
          visual_mark?: string | null
        }
        Update: {
          avatar_url?: string | null
          branch_id?: string | null
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          phone?: string | null
          updated_at?: string
          visual_mark?: string | null
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
      shipment_changes: {
        Row: {
          actor_id: string | null
          actor_roles: string[]
          changed_fields: string[]
          client_action: string | null
          client_request_id: string | null
          client_route: string | null
          client_source: string | null
          created_at: string
          id: number
          new_values: Json | null
          old_values: Json | null
          op: string
          request_method: string | null
          request_path: string | null
          request_role: string | null
          shipment_id: string
          txid: number
        }
        Insert: {
          actor_id?: string | null
          actor_roles?: string[]
          changed_fields?: string[]
          client_action?: string | null
          client_request_id?: string | null
          client_route?: string | null
          client_source?: string | null
          created_at?: string
          id?: number
          new_values?: Json | null
          old_values?: Json | null
          op: string
          request_method?: string | null
          request_path?: string | null
          request_role?: string | null
          shipment_id: string
          txid?: number
        }
        Update: {
          actor_id?: string | null
          actor_roles?: string[]
          changed_fields?: string[]
          client_action?: string | null
          client_request_id?: string | null
          client_route?: string | null
          client_source?: string | null
          created_at?: string
          id?: number
          new_values?: Json | null
          old_values?: Json | null
          op?: string
          request_method?: string | null
          request_path?: string | null
          request_role?: string | null
          shipment_id?: string
          txid?: number
        }
        Relationships: []
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
          position_id: string | null
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
          position_id?: string | null
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
          position_id?: string | null
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
            foreignKeyName: "shipment_items_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
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
      shipment_readiness_checks: {
        Row: {
          check_type: string
          checked_at: string | null
          checked_by: string | null
          created_at: string
          id: string
          notes: string | null
          shipment_id: string
          status: string
          updated_at: string
        }
        Insert: {
          check_type: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          shipment_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          check_type?: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          shipment_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_readiness_checks_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_readiness_checks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_readiness_checks_shipment_id_fkey"
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
            referencedRelation: "vehicle_capacity_v"
            referencedColumns: ["vehicle_id"]
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
      user_activity_sessions: {
        Row: {
          app_version: string | null
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          heartbeat_count: number
          id: string
          last_path: string | null
          last_seen_at: string
          platform: string | null
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          heartbeat_count?: number
          id?: string
          last_path?: string | null
          last_seen_at?: string
          platform?: string | null
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          heartbeat_count?: number
          id?: string
          last_path?: string | null
          last_seen_at?: string
          platform?: string | null
          started_at?: string
          user_agent?: string | null
          user_id?: string
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
      vehicle_reserves: {
        Row: {
          closed_at: string | null
          created_at: string
          gross_kg: number
          id: string
          note: string | null
          owner_user_id: string
          pallets: number
          status: Database["public"]["Enums"]["reserve_status"]
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          gross_kg: number
          id?: string
          note?: string | null
          owner_user_id: string
          pallets: number
          status?: Database["public"]["Enums"]["reserve_status"]
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          gross_kg?: number
          id?: string
          note?: string | null
          owner_user_id?: string
          pallets?: number
          status?: Database["public"]["Enums"]["reserve_status"]
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_reserves_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_capacity_v"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "vehicle_reserves_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
      branch_archive_results_admin: {
        Row: {
          actual_cost_indicative_usd: number | null
          actual_cost_invoice_usd: number | null
          actual_cost_landed_usd: number | null
          actual_eta: string | null
          branch_id: string | null
          branch_name: string | null
          caliber: string | null
          cost_indicative_usd_snapshot: number | null
          cost_invoice_usd_snapshot: number | null
          cut_qty: number | null
          delivered_qty: number | null
          event_qty: number | null
          event_type:
            | Database["public"]["Enums"]["archive_visible_event_type"]
            | null
          is_split_shipment: boolean | null
          notes: string | null
          occurred_at: string | null
          origin_country_name: string | null
          packaging: string | null
          pallet_qty: number | null
          position_id: string | null
          product_id: string | null
          product_name: string | null
          product_origin_country_id: string | null
          promise_eta_snapshot: string | null
          promise_source:
            | Database["public"]["Enums"]["archive_snapshot_source"]
            | null
          requested_qty: number | null
          requested_sale_currency_snapshot: string | null
          requested_sale_price_snapshot: number | null
          responsible_manager_id: string | null
          responsible_manager_name: string | null
          result_id: string | null
          shared_qty: number | null
          shipment_code: string | null
          shipment_id: string | null
          variety_id: number | null
          variety_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_archive_results_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_archive_results_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      branch_archive_results_branch: {
        Row: {
          actual_cost_indicative_usd: number | null
          actual_cost_invoice_usd: number | null
          actual_cost_landed_usd: number | null
          actual_eta: string | null
          branch_id: string | null
          branch_name: string | null
          caliber: string | null
          cost_indicative_usd_snapshot: number | null
          cost_invoice_usd_snapshot: number | null
          cut_qty: number | null
          delivered_qty: number | null
          event_qty: number | null
          event_type:
            | Database["public"]["Enums"]["archive_visible_event_type"]
            | null
          is_split_shipment: boolean | null
          notes: string | null
          occurred_at: string | null
          origin_country_name: string | null
          packaging: string | null
          pallet_qty: number | null
          position_id: string | null
          product_id: string | null
          product_name: string | null
          product_origin_country_id: string | null
          promise_eta_snapshot: string | null
          promise_source:
            | Database["public"]["Enums"]["archive_snapshot_source"]
            | null
          requested_qty: number | null
          requested_sale_currency_snapshot: string | null
          requested_sale_price_snapshot: number | null
          responsible_manager_id: string | null
          responsible_manager_name: string | null
          result_id: string | null
          shared_qty: number | null
          shipment_code: string | null
          shipment_id: string | null
          variety_id: number | null
          variety_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_archive_results_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_archive_results_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      branch_archive_results_manager: {
        Row: {
          actual_cost_indicative_usd: number | null
          actual_cost_invoice_usd: number | null
          actual_cost_landed_usd: number | null
          actual_eta: string | null
          branch_id: string | null
          branch_name: string | null
          caliber: string | null
          cost_indicative_usd_snapshot: number | null
          cost_invoice_usd_snapshot: number | null
          cut_qty: number | null
          delivered_qty: number | null
          event_qty: number | null
          event_type:
            | Database["public"]["Enums"]["archive_visible_event_type"]
            | null
          is_split_shipment: boolean | null
          notes: string | null
          occurred_at: string | null
          origin_country_name: string | null
          packaging: string | null
          pallet_qty: number | null
          position_id: string | null
          product_id: string | null
          product_name: string | null
          product_origin_country_id: string | null
          promise_eta_snapshot: string | null
          promise_source:
            | Database["public"]["Enums"]["archive_snapshot_source"]
            | null
          requested_qty: number | null
          requested_sale_currency_snapshot: string | null
          requested_sale_price_snapshot: number | null
          responsible_manager_id: string | null
          responsible_manager_name: string | null
          result_id: string | null
          shared_qty: number | null
          shipment_code: string | null
          shipment_id: string | null
          variety_id: number | null
          variety_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_archive_results_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_archive_results_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "operational_positions"
            referencedColumns: ["position_id"]
          },
        ]
      }
      shipment_items_branch: {
        Row: {
          brand: string | null
          caliber: string | null
          class: string | null
          created_at: string | null
          final_cost_indicative: number | null
          final_cost_invoice: number | null
          free_pallets: number | null
          id: string | null
          import_manager_id: string | null
          import_manager_name: string | null
          linked_offer_id: string | null
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
          {
            foreignKeyName: "shipments_import_manager_id_fkey"
            columns: ["import_manager_id"]
            isOneToOne: false
            referencedRelation: "import_managers"
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
          pipeline_status: Database["public"]["Enums"]["pipeline_status"] | null
          status: Database["public"]["Enums"]["shipment_status"] | null
          temperature_mode: string | null
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
      vehicle_capacity_v: {
        Row: {
          fact_gross_kg: number | null
          fact_pallets: number | null
          free_gross_kg: number | null
          free_pallets: number | null
          max_gross_kg: number | null
          max_pallets: number | null
          reserved_gross_kg: number | null
          reserved_pallets: number | null
          vehicle_id: string | null
        }
        Relationships: []
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
      _trim_allocation_parts_to_capacity: {
        Args: {
          p_cap: number
          p_only_offer_id?: string
          p_shipment_item_id: string
        }
        Returns: string[]
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
      archive_cancel_manager_offer: {
        Args: { p_offer_id: string; p_reason?: string }
        Returns: {
          action: string
          detail: string
          response_id: string
          snapshot_id: string
        }[]
      }
      archive_due_cancelled_shipments: { Args: never; Returns: number }
      archive_due_unloaded_shipments: { Args: never; Returns: number }
      archive_resolver_cancelled_pass: {
        Args: { p_snapshot_id?: string }
        Returns: {
          action: string
          detail: string
          snapshot_id: string
        }[]
      }
      archive_resolver_run: {
        Args: { p_run_date: string; p_snapshot_id?: string }
        Returns: {
          action: string
          detail: string
          snapshot_id: string
        }[]
      }
      archive_write_cancelled_for_shipment: {
        Args: { p_reason?: string; p_shipment_id: string }
        Returns: {
          action: string
          detail: string
          snapshot_id: string
        }[]
      }
      archive_write_cancelled_for_snapshot: {
        Args: { p_reason?: string; p_snapshot_id: string }
        Returns: {
          action: string
          detail: string
          snapshot_id: string
        }[]
      }
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
      close_vehicle_reserves: {
        Args: { p_vehicle_id: string }
        Returns: number
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
          pallet_gross_kg: number | null
          pallet_net_kg: number | null
          pallet_weight: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          position_id: string | null
          prev_expected_eta: string | null
          prev_indicative_cost_usd: number | null
          prev_invoice_cost_usd: number | null
          price_currency: string
          price_per_kg: number | null
          product_name: string
          share_token: string | null
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
          position_id: string | null
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
      create_vehicle_reserve: {
        Args: {
          p_gross_kg: number
          p_note?: string
          p_pallets: number
          p_vehicle_id: string
        }
        Returns: string
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
      rebalance_offer_allocation_for_item: {
        Args: { p_offer_id: string; p_shipment_item_id: string }
        Returns: {
          new_allocated: number
          old_allocated: number
          reduced_by: number
          remaining: number
        }[]
      }
      recompute_vehicle_item_costs: {
        Args: { _shipment_id: string; _vehicle_id: string }
        Returns: undefined
      }
      recompute_vehicle_totals_for: {
        Args: { _vehicle_id: string }
        Returns: undefined
      }
      release_vehicle_reserve: {
        Args: { p_reserve_id: string }
        Returns: undefined
      }
      rpc_activity_close_stale: { Args: never; Returns: number }
      rpc_activity_end_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      rpc_activity_heartbeat: {
        Args: { p_last_path?: string; p_session_id: string }
        Returns: undefined
      }
      rpc_activity_start_session: {
        Args: {
          p_app_version?: string
          p_last_path?: string
          p_platform?: string
          p_user_agent?: string
        }
        Returns: string
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
      rpc_pallet_standard_resolve: {
        Args: { p_country: string; p_dictionary_id: string }
        Returns: {
          canonical_product_id: string
          country_name: string
          fallback_explanation: string
          is_fallback: boolean
          match_type: string
          options: Json
          product_dictionary_id: string
          product_name_ua: string
          selected_package_used: string
          selected_pallet_gross_kg: number
          selected_pallet_net_kg: number
          selected_pallet_standard_id: string
        }[]
      }
      rpc_position_assign_responsible_manager: {
        Args: {
          p_position_id: string
          p_reason?: string
          p_responsible_manager_id: string
        }
        Returns: Json
      }
      rpc_position_attach_offer: {
        Args: {
          p_offer_id: string
          p_position_id: string
          p_responsible_manager_id?: string
        }
        Returns: Json
      }
      rpc_position_attach_shipment: {
        Args: {
          p_pallet_qty_linked?: number
          p_position_id: string
          p_shipment_item_id: string
        }
        Returns: Json
      }
      rpc_position_create_draft: {
        Args: {
          p_caliber?: string
          p_client_row_id?: string
          p_free_description?: string
          p_package_used?: string
          p_pallet_qty?: number
          p_product_id: string
          p_product_origin_country_id: string
          p_responsible_manager_id?: string
          p_source_context?: string
          p_source_row_key?: string
          p_supplier_id?: string
          p_variety_id?: number
        }
        Returns: {
          created: boolean
          created_by: string
          current_status: string
          idempotency_status: string
          owner_user_id: string
          position_id: string
        }[]
      }
      rpc_position_rollback_birth: {
        Args: { p_position_id: string }
        Returns: {
          reason: string
          rolled_back: boolean
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
        | "owner"
      archive_snapshot_resolution:
        | "delivered"
        | "not_fulfilled"
        | "cancelled"
        | "superseded"
        | "shared"
      archive_snapshot_source:
        | "branch_response"
        | "manager_confirm"
        | "shipment_link"
        | "branch_stock_request"
      archive_snapshot_status:
        | "pending"
        | "resolved"
        | "superseded"
        | "cancelled"
      archive_visible_event_type:
        | "delivered"
        | "not_fulfilled"
        | "cancelled"
        | "refused"
        | "shared"
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
      reserve_status: "active" | "consumed" | "released" | "closed"
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
        "owner",
      ],
      archive_snapshot_resolution: [
        "delivered",
        "not_fulfilled",
        "cancelled",
        "superseded",
        "shared",
      ],
      archive_snapshot_source: [
        "branch_response",
        "manager_confirm",
        "shipment_link",
        "branch_stock_request",
      ],
      archive_snapshot_status: [
        "pending",
        "resolved",
        "superseded",
        "cancelled",
      ],
      archive_visible_event_type: [
        "delivered",
        "not_fulfilled",
        "cancelled",
        "refused",
        "shared",
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
      reserve_status: ["active", "consumed", "released", "closed"],
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
