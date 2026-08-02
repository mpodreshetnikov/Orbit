export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      allowed_users: {
        Row: {
          added_at: string
          auth_user_id: string | null
          email: string
          id: string
        }
        Insert: {
          added_at?: string
          auth_user_id?: string | null
          email: string
          id?: string
        }
        Update: {
          added_at?: string
          auth_user_id?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      body_site_catalog: {
        Row: {
          created_at: string
          id: string
          name_en: string
          name_ru: string
          notes: string | null
          parent_site_code: string | null
          site_code: string
          synonyms_en: string[]
          synonyms_ru: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name_en: string
          name_ru: string
          notes?: string | null
          parent_site_code?: string | null
          site_code: string
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name_en?: string
          name_ru?: string
          notes?: string | null
          parent_site_code?: string | null
          site_code?: string
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "body_site_catalog_parent_site_code_fkey"
            columns: ["parent_site_code"]
            isOneToOne: false
            referencedRelation: "body_site_catalog"
            referencedColumns: ["site_code"]
          },
        ]
      }
      checkup_completions: {
        Row: {
          checkup_item_id: string
          created_at: string
          done_at: string
          evidence_record_id: string | null
          id: string
          note: string | null
        }
        Insert: {
          checkup_item_id: string
          created_at?: string
          done_at: string
          evidence_record_id?: string | null
          id?: string
          note?: string | null
        }
        Update: {
          checkup_item_id?: string
          created_at?: string
          done_at?: string
          evidence_record_id?: string | null
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkup_completions_checkup_item_id_fkey"
            columns: ["checkup_item_id"]
            isOneToOne: false
            referencedRelation: "checkup_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkup_completions_evidence_record_id_fkey"
            columns: ["evidence_record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      checkup_items: {
        Row: {
          category: Database["public"]["Enums"]["checkup_category"]
          created_at: string
          id: string
          next_due_at: string | null
          notes: string | null
          person_id: string
          planned_on: string | null
          reminder_days_before: number[]
          schedule: Json
          status: Database["public"]["Enums"]["checkup_item_status"]
          title: string
          updated_at: string
          why_links: Json | null
          why_text: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["checkup_category"]
          created_at?: string
          id?: string
          next_due_at?: string | null
          notes?: string | null
          person_id: string
          planned_on?: string | null
          reminder_days_before?: number[]
          schedule: Json
          status?: Database["public"]["Enums"]["checkup_item_status"]
          title: string
          updated_at?: string
          why_links?: Json | null
          why_text?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["checkup_category"]
          created_at?: string
          id?: string
          next_due_at?: string | null
          notes?: string | null
          person_id?: string
          planned_on?: string | null
          reminder_days_before?: number[]
          schedule?: Json
          status?: Database["public"]["Enums"]["checkup_item_status"]
          title?: string
          updated_at?: string
          why_links?: Json | null
          why_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkup_items_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_records: {
        Row: {
          condition_id: string
          confidence: number | null
          created_at: string
          id: string
          is_llm_extracted: boolean
          is_user_verified: boolean
          record_id: string
          source_anchor: string | null
          status_in_record: string
        }
        Insert: {
          condition_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          record_id: string
          source_anchor?: string | null
          status_in_record: string
        }
        Update: {
          condition_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          record_id?: string
          source_anchor?: string | null
          status_in_record?: string
        }
        Relationships: [
          {
            foreignKeyName: "condition_records_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "conditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_records_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      conditions: {
        Row: {
          code: string | null
          created_at: string
          current_status: string
          deleted_at: string | null
          icd_name_en: string | null
          icd_name_ru: string | null
          id: string
          name: string
          notes: string | null
          onset_date: string | null
          person_id: string
          resolved_date: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          current_status?: string
          deleted_at?: string | null
          icd_name_en?: string | null
          icd_name_ru?: string | null
          id?: string
          name: string
          notes?: string | null
          onset_date?: string | null
          person_id: string
          resolved_date?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          current_status?: string
          deleted_at?: string | null
          icd_name_en?: string | null
          icd_name_ru?: string | null
          id?: string
          name?: string
          notes?: string | null
          onset_date?: string | null
          person_id?: string
          resolved_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conditions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      db_deploy_log: {
        Row: {
          deployed_at: string | null
          deployer: string | null
          git_sha: string | null
          id: number
        }
        Insert: {
          deployed_at?: string | null
          deployer?: string | null
          git_sha?: string | null
          id?: number
        }
        Update: {
          deployed_at?: string | null
          deployer?: string | null
          git_sha?: string | null
          id?: number
        }
        Relationships: []
      }
      finding_type_catalog: {
        Row: {
          created_at: string
          finding_code: string
          id: string
          name_en: string
          name_ru: string
          notes: string | null
          synonyms_en: string[]
          synonyms_ru: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          finding_code: string
          id?: string
          name_en: string
          name_ru: string
          notes?: string | null
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          finding_code?: string
          id?: string
          name_en?: string
          name_ru?: string
          notes?: string | null
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      measurement_catalog: {
        Row: {
          category: string
          code: string
          created_at: string
          id: string
          name_en: string
          name_ru: string
          sort_order: number
          unit_en: string
          unit_ru: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          id?: string
          name_en: string
          name_ru: string
          sort_order?: number
          unit_en: string
          unit_ru: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          id?: string
          name_en?: string
          name_ru?: string
          sort_order?: number
          unit_en?: string
          unit_ru?: string
          updated_at?: string
        }
        Relationships: []
      }
      measurements: {
        Row: {
          catalog_id: string
          created_at: string
          created_by_user_id: string
          id: string
          measured_at: string
          notes: string | null
          person_id: string
          updated_at: string
          value: number
        }
        Insert: {
          catalog_id: string
          created_at?: string
          created_by_user_id: string
          id?: string
          measured_at?: string
          notes?: string | null
          person_id: string
          updated_at?: string
          value: number
        }
        Update: {
          catalog_id?: string
          created_at?: string
          created_by_user_id?: string
          id?: string
          measured_at?: string
          notes?: string | null
          person_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "measurements_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "measurement_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurements_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      med_dose_events: {
        Row: {
          actual_at: string
          created_at: string
          deleted_at: string | null
          id: string
          note: string | null
          person_id: string
          planned_intake: Json
          regimen_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["med_dose_event_status"]
          taken_at: string | null
          updated_at: string
        }
        Insert: {
          actual_at: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string | null
          person_id: string
          planned_intake: Json
          regimen_id: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["med_dose_event_status"]
          taken_at?: string | null
          updated_at?: string
        }
        Update: {
          actual_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string | null
          person_id?: string
          planned_intake?: Json
          regimen_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["med_dose_event_status"]
          taken_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "med_dose_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_dose_events_regimen_id_fkey"
            columns: ["regimen_id"]
            isOneToOne: false
            referencedRelation: "med_regimens"
            referencedColumns: ["id"]
          },
        ]
      }
      med_inventory_transactions: {
        Row: {
          amount: number
          created_at: string
          event_id: string | null
          id: string
          note: string | null
          regimen_id: string
          type: Database["public"]["Enums"]["med_inventory_transaction_type"]
          unit: string
        }
        Insert: {
          amount: number
          created_at?: string
          event_id?: string | null
          id?: string
          note?: string | null
          regimen_id: string
          type: Database["public"]["Enums"]["med_inventory_transaction_type"]
          unit: string
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string | null
          id?: string
          note?: string | null
          regimen_id?: string
          type?: Database["public"]["Enums"]["med_inventory_transaction_type"]
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "med_inventory_transactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "med_dose_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "med_inventory_transactions_regimen_id_fkey"
            columns: ["regimen_id"]
            isOneToOne: false
            referencedRelation: "med_regimens"
            referencedColumns: ["id"]
          },
        ]
      }
      med_regimens: {
        Row: {
          created_at: string
          custom_name: string
          deleted_at: string | null
          dose_definition: Json | null
          duration: Json
          id: string
          intake_advice_text: string | null
          intake_advice_type:
            | Database["public"]["Enums"]["med_intake_advice_type"]
            | null
          intake_unit: Database["public"]["Enums"]["medication_unit"]
          inventory: Json | null
          notes: string | null
          person_id: string
          reminder_prefs: Json | null
          schedule: Json
          status: Database["public"]["Enums"]["medication_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_name: string
          deleted_at?: string | null
          dose_definition?: Json | null
          duration: Json
          id?: string
          intake_advice_text?: string | null
          intake_advice_type?:
            | Database["public"]["Enums"]["med_intake_advice_type"]
            | null
          intake_unit?: Database["public"]["Enums"]["medication_unit"]
          inventory?: Json | null
          notes?: string | null
          person_id: string
          reminder_prefs?: Json | null
          schedule: Json
          status?: Database["public"]["Enums"]["medication_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_name?: string
          deleted_at?: string | null
          dose_definition?: Json | null
          duration?: Json
          id?: string
          intake_advice_text?: string | null
          intake_advice_type?:
            | Database["public"]["Enums"]["med_intake_advice_type"]
            | null
          intake_unit?: Database["public"]["Enums"]["medication_unit"]
          inventory?: Json | null
          notes?: string | null
          person_id?: string
          reminder_prefs?: Json | null
          schedule?: Json
          status?: Database["public"]["Enums"]["medication_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "med_regimens_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_records: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          llm_keywords: string[] | null
          llm_suggested_checkup_completions: Json | null
          llm_summary: string | null
          notes: string | null
          ocr_error: string | null
          ocr_text: string | null
          person_id: string
          record_date: string | null
          record_type: Database["public"]["Enums"]["record_type"]
          removed_at: string | null
          search_vector: unknown
          status: Database["public"]["Enums"]["record_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          llm_keywords?: string[] | null
          llm_suggested_checkup_completions?: Json | null
          llm_summary?: string | null
          notes?: string | null
          ocr_error?: string | null
          ocr_text?: string | null
          person_id: string
          record_date?: string | null
          record_type?: Database["public"]["Enums"]["record_type"]
          removed_at?: string | null
          search_vector?: unknown
          status?: Database["public"]["Enums"]["record_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          llm_keywords?: string[] | null
          llm_suggested_checkup_completions?: Json | null
          llm_summary?: string | null
          notes?: string | null
          ocr_error?: string | null
          ocr_text?: string | null
          person_id?: string
          record_date?: string | null
          record_type?: Database["public"]["Enums"]["record_type"]
          removed_at?: string | null
          search_vector?: unknown
          status?: Database["public"]["Enums"]["record_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_records_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_refill_snoozes: {
        Row: {
          created_at: string
          id: string
          recipient_user_id: string
          regimen_id: string
          snooze_until: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_user_id: string
          regimen_id: string
          snooze_until: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_user_id?: string
          regimen_id?: string
          snooze_until?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_refill_snoozes_regimen_id_fkey"
            columns: ["regimen_id"]
            isOneToOne: false
            referencedRelation: "med_regimens"
            referencedColumns: ["id"]
          },
        ]
      }
      money_accounts: {
        Row: {
          account_kind: string
          account_label: string
          created_at: string
          currency: string
          external_account_id: string | null
          id: string
          is_active: boolean
          owner_person_id: string
          source: string
          updated_at: string
        }
        Insert: {
          account_kind: string
          account_label: string
          created_at?: string
          currency: string
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          owner_person_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          account_kind?: string
          account_label?: string
          created_at?: string
          currency?: string
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          owner_person_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_accounts_owner_person_id_fkey"
            columns: ["owner_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      money_cards: {
        Row: {
          account_id: string
          card_label: string | null
          created_at: string
          id: string
          last4: string
          updated_at: string
        }
        Insert: {
          account_id: string
          card_label?: string | null
          created_at?: string
          id?: string
          last4: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          card_label?: string | null
          created_at?: string
          id?: string
          last4?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_cards_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "money_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      money_categories: {
        Row: {
          archived_at: string | null
          canonical_category_id: string
          category_kind: Database["public"]["Enums"]["money_category_kind"]
          created_at: string
          created_by: string | null
          depth: number
          id: string
          name_en: string
          name_ru: string
          parent_id: string | null
          slug: string
          sort_order: number
          system_key: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          canonical_category_id: string
          category_kind?: Database["public"]["Enums"]["money_category_kind"]
          created_at?: string
          created_by?: string | null
          depth: number
          id?: string
          name_en: string
          name_ru: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          system_key?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          canonical_category_id?: string
          category_kind?: Database["public"]["Enums"]["money_category_kind"]
          created_at?: string
          created_by?: string | null
          depth?: number
          id?: string
          name_en?: string
          name_ru?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          system_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_categories_canonical_category_id_fkey"
            columns: ["canonical_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      money_category_rule_run_steps: {
        Row: {
          changed_category: boolean
          created_at: string
          debug_payload: Json
          decision_reason: string
          id: string
          matched: boolean
          next_category_id: string | null
          previous_category_id: string | null
          rule_id: string | null
          rule_kind: Database["public"]["Enums"]["money_rule_kind"] | null
          rule_name: string | null
          rule_run_id: string
          sort_order: number
        }
        Insert: {
          changed_category?: boolean
          created_at?: string
          debug_payload?: Json
          decision_reason: string
          id?: string
          matched?: boolean
          next_category_id?: string | null
          previous_category_id?: string | null
          rule_id?: string | null
          rule_kind?: Database["public"]["Enums"]["money_rule_kind"] | null
          rule_name?: string | null
          rule_run_id: string
          sort_order: number
        }
        Update: {
          changed_category?: boolean
          created_at?: string
          debug_payload?: Json
          decision_reason?: string
          id?: string
          matched?: boolean
          next_category_id?: string | null
          previous_category_id?: string | null
          rule_id?: string | null
          rule_kind?: Database["public"]["Enums"]["money_rule_kind"] | null
          rule_name?: string | null
          rule_run_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "money_category_rule_run_steps_next_category_id_fkey"
            columns: ["next_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_run_steps_previous_category_id_fkey"
            columns: ["previous_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_run_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "money_category_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_run_steps_rule_run_id_fkey"
            columns: ["rule_run_id"]
            isOneToOne: false
            referencedRelation: "money_category_rule_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      money_category_rule_runs: {
        Row: {
          created_at: string
          final_category_id: string | null
          id: string
          line_item_id: string
          llm_tokens_completion: number | null
          llm_tokens_prompt: number | null
          person_id: string
          saved: boolean
          starting_category_id: string | null
          transaction_id: string
          trigger_source: string
          triggered_by_user_id: string | null
        }
        Insert: {
          created_at?: string
          final_category_id?: string | null
          id?: string
          line_item_id: string
          llm_tokens_completion?: number | null
          llm_tokens_prompt?: number | null
          person_id: string
          saved?: boolean
          starting_category_id?: string | null
          transaction_id: string
          trigger_source: string
          triggered_by_user_id?: string | null
        }
        Update: {
          created_at?: string
          final_category_id?: string | null
          id?: string
          line_item_id?: string
          llm_tokens_completion?: number | null
          llm_tokens_prompt?: number | null
          person_id?: string
          saved?: boolean
          starting_category_id?: string | null
          transaction_id?: string
          trigger_source?: string
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_category_rule_runs_final_category_id_fkey"
            columns: ["final_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_runs_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "money_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_runs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_runs_starting_category_id_fkey"
            columns: ["starting_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rule_runs_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "money_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      money_category_rules: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          filters: Json
          id: string
          match_mode: string
          name: string
          person_id: string
          rule_kind: Database["public"]["Enums"]["money_rule_kind"]
          scope_filter: string
          sort_order: number
          stop_processing: boolean
          target_category_id: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          filters?: Json
          id?: string
          match_mode?: string
          name: string
          person_id: string
          rule_kind: Database["public"]["Enums"]["money_rule_kind"]
          scope_filter?: string
          sort_order: number
          stop_processing?: boolean
          target_category_id?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          filters?: Json
          id?: string
          match_mode?: string
          name?: string
          person_id?: string
          rule_kind?: Database["public"]["Enums"]["money_rule_kind"]
          scope_filter?: string
          sort_order?: number
          stop_processing?: boolean
          target_category_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_category_rules_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_category_rules_target_category_id_fkey"
            columns: ["target_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      money_import_batch_brand_resolutions: {
        Row: {
          base_color: string | null
          base_text_color: string | null
          batch_id: string
          created_at: string
          id: string
          logo_url: string | null
          selected_action: string
          selected_brand_id: string | null
          source: string
          source_key: string
          source_name: string
          suggested_brand_id: string | null
          suggested_confidence: number
          suggested_reason: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          base_color?: string | null
          base_text_color?: string | null
          batch_id: string
          created_at?: string
          id?: string
          logo_url?: string | null
          selected_action: string
          selected_brand_id?: string | null
          source: string
          source_key: string
          source_name: string
          suggested_brand_id?: string | null
          suggested_confidence?: number
          suggested_reason?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          base_color?: string | null
          base_text_color?: string | null
          batch_id?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          selected_action?: string
          selected_brand_id?: string | null
          source?: string
          source_key?: string
          source_name?: string
          suggested_brand_id?: string | null
          suggested_confidence?: number
          suggested_reason?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_import_batch_brand_resolutions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "money_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batch_brand_resolutions_selected_brand_id_fkey"
            columns: ["selected_brand_id"]
            isOneToOne: false
            referencedRelation: "money_transaction_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batch_brand_resolutions_suggested_brand_id_fkey"
            columns: ["suggested_brand_id"]
            isOneToOne: false
            referencedRelation: "money_transaction_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      money_import_batch_rows: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          line_item_id: string | null
          message: string | null
          parent_row_id: string | null
          payload: Json | null
          receipt_enrichment_status: string | null
          receipt_request_key: string | null
          row_kind: string
          source_line_index: number | null
          source_row_index: number
          status: string
          transaction_id: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          line_item_id?: string | null
          message?: string | null
          parent_row_id?: string | null
          payload?: Json | null
          receipt_enrichment_status?: string | null
          receipt_request_key?: string | null
          row_kind: string
          source_line_index?: number | null
          source_row_index: number
          status: string
          transaction_id?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          line_item_id?: string | null
          message?: string | null
          parent_row_id?: string | null
          payload?: Json | null
          receipt_enrichment_status?: string | null
          receipt_request_key?: string | null
          row_kind?: string
          source_line_index?: number | null
          source_row_index?: number
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_import_batch_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "money_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batch_rows_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "money_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batch_rows_parent_row_id_fkey"
            columns: ["parent_row_id"]
            isOneToOne: false
            referencedRelation: "money_import_batch_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batch_rows_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "money_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      money_import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          error_count: number
          file_path: string | null
          id: string
          import_type: string
          inserted_count: number
          meta: Json | null
          parsed_through_at: string | null
          parsed_transactions_count: number
          payer_person_id: string
          session_id: string | null
          skipped_count: number
          source: string
          status: string
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_count?: number
          file_path?: string | null
          id?: string
          import_type?: string
          inserted_count?: number
          meta?: Json | null
          parsed_through_at?: string | null
          parsed_transactions_count?: number
          payer_person_id: string
          session_id?: string | null
          skipped_count?: number
          source: string
          status?: string
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_count?: number
          file_path?: string | null
          id?: string
          import_type?: string
          inserted_count?: number
          meta?: Json | null
          parsed_through_at?: string | null
          parsed_transactions_count?: number
          payer_person_id?: string
          session_id?: string | null
          skipped_count?: number
          source?: string
          status?: string
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_import_batches_payer_person_id_fkey"
            columns: ["payer_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_batches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "money_import_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      money_import_sessions: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by_auth_user_id: string
          expires_at: string
          id: string
          meta: Json | null
          payer_person_id: string
          revoked_at: string | null
          source: string
          status: string
          token_hash: string
          updated_at: string
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by_auth_user_id: string
          expires_at: string
          id?: string
          meta?: Json | null
          payer_person_id: string
          revoked_at?: string | null
          source: string
          status?: string
          token_hash: string
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by_auth_user_id?: string
          expires_at?: string
          id?: string
          meta?: Json | null
          payer_person_id?: string
          revoked_at?: string | null
          source?: string
          status?: string
          token_hash?: string
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_import_sessions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "money_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_import_sessions_payer_person_id_fkey"
            columns: ["payer_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      money_line_items: {
        Row: {
          amount: number
          assignment_confidence: number | null
          assignment_method: Database["public"]["Enums"]["money_assignment_method"]
          assignment_rule_id: string | null
          beneficiary_person_id: string | null
          category_assigned_at: string | null
          category_id: string | null
          category_locked_by_user: boolean
          created_at: string
          id: string
          import_hash: string | null
          last_category_rule_id: string | null
          last_category_rule_run_id: string | null
          line_status: Database["public"]["Enums"]["money_line_status"]
          quantity: number | null
          raw_payload: Json | null
          related_line_item_id: string | null
          title: string
          transaction_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          assignment_confidence?: number | null
          assignment_method?: Database["public"]["Enums"]["money_assignment_method"]
          assignment_rule_id?: string | null
          beneficiary_person_id?: string | null
          category_assigned_at?: string | null
          category_id?: string | null
          category_locked_by_user?: boolean
          created_at?: string
          id?: string
          import_hash?: string | null
          last_category_rule_id?: string | null
          last_category_rule_run_id?: string | null
          line_status?: Database["public"]["Enums"]["money_line_status"]
          quantity?: number | null
          raw_payload?: Json | null
          related_line_item_id?: string | null
          title: string
          transaction_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          assignment_confidence?: number | null
          assignment_method?: Database["public"]["Enums"]["money_assignment_method"]
          assignment_rule_id?: string | null
          beneficiary_person_id?: string | null
          category_assigned_at?: string | null
          category_id?: string | null
          category_locked_by_user?: boolean
          created_at?: string
          id?: string
          import_hash?: string | null
          last_category_rule_id?: string | null
          last_category_rule_run_id?: string | null
          line_status?: Database["public"]["Enums"]["money_line_status"]
          quantity?: number | null
          raw_payload?: Json | null
          related_line_item_id?: string | null
          title?: string
          transaction_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_line_items_beneficiary_person_id_fkey"
            columns: ["beneficiary_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_line_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_line_items_last_category_rule_id_fkey"
            columns: ["last_category_rule_id"]
            isOneToOne: false
            referencedRelation: "money_category_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_line_items_last_category_rule_run_id_fkey"
            columns: ["last_category_rule_run_id"]
            isOneToOne: false
            referencedRelation: "money_category_rule_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_line_items_related_line_item_id_fkey"
            columns: ["related_line_item_id"]
            isOneToOne: false
            referencedRelation: "money_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_line_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "money_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      money_mcc_canonical_category_map: {
        Row: {
          canonical_category_id: string | null
          canonical_system_key: string
          created_at: string
          description: string | null
          mcc: string
        }
        Insert: {
          canonical_category_id?: string | null
          canonical_system_key: string
          created_at?: string
          description?: string | null
          mcc: string
        }
        Update: {
          canonical_category_id?: string | null
          canonical_system_key?: string
          created_at?: string
          description?: string | null
          mcc?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_mcc_canonical_category_map_canonical_category_id_fkey"
            columns: ["canonical_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      money_transaction_brand_aliases: {
        Row: {
          base_color: string | null
          base_text_color: string | null
          brand_id: string
          created_at: string
          id: string
          logo_url: string | null
          source: string
          source_key: string
          source_name: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          base_color?: string | null
          base_text_color?: string | null
          brand_id: string
          created_at?: string
          id?: string
          logo_url?: string | null
          source: string
          source_key: string
          source_name: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          base_color?: string | null
          base_text_color?: string | null
          brand_id?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          source?: string
          source_key?: string
          source_name?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_transaction_brand_aliases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "money_transaction_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      money_transaction_brands: {
        Row: {
          base_color: string | null
          base_text_color: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          base_color?: string | null
          base_text_color?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          base_color?: string | null
          base_text_color?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      money_transaction_edit_audits: {
        Row: {
          after_snapshot: Json
          before_snapshot: Json
          created_at: string
          edited_by_auth_user_id: string | null
          entity_id: string
          entity_kind: string
          id: string
          transaction_id: string
        }
        Insert: {
          after_snapshot: Json
          before_snapshot: Json
          created_at?: string
          edited_by_auth_user_id?: string | null
          entity_id: string
          entity_kind: string
          id?: string
          transaction_id: string
        }
        Update: {
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          edited_by_auth_user_id?: string | null
          entity_id?: string
          entity_kind?: string
          id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_transaction_edit_audits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "money_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      money_transactions: {
        Row: {
          account_id: string
          amount: number
          brand_id: string | null
          card_id: string | null
          cashback_amount: number | null
          cashback_currency: string | null
          comment: string | null
          created_at: string
          currency: string
          dedupe_hash: string | null
          external_id: string | null
          id: string
          is_transfer: boolean
          mcc: string | null
          merchant_name: string | null
          operation_icon_url: string | null
          payer_person_id: string
          posted_at: string
          raw_payload: Json | null
          receipt_enrichment_status: string | null
          receipt_request_key: string | null
          source: string
          source_category_id: string | null
          source_category_name: string | null
          source_comment: string | null
          status: Database["public"]["Enums"]["money_transaction_status"]
          transaction_type: Database["public"]["Enums"]["money_transaction_type"]
          transfer_group_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          brand_id?: string | null
          card_id?: string | null
          cashback_amount?: number | null
          cashback_currency?: string | null
          comment?: string | null
          created_at?: string
          currency: string
          dedupe_hash?: string | null
          external_id?: string | null
          id?: string
          is_transfer?: boolean
          mcc?: string | null
          merchant_name?: string | null
          operation_icon_url?: string | null
          payer_person_id: string
          posted_at: string
          raw_payload?: Json | null
          receipt_enrichment_status?: string | null
          receipt_request_key?: string | null
          source?: string
          source_category_id?: string | null
          source_category_name?: string | null
          source_comment?: string | null
          status?: Database["public"]["Enums"]["money_transaction_status"]
          transaction_type: Database["public"]["Enums"]["money_transaction_type"]
          transfer_group_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          brand_id?: string | null
          card_id?: string | null
          cashback_amount?: number | null
          cashback_currency?: string | null
          comment?: string | null
          created_at?: string
          currency?: string
          dedupe_hash?: string | null
          external_id?: string | null
          id?: string
          is_transfer?: boolean
          mcc?: string | null
          merchant_name?: string | null
          operation_icon_url?: string | null
          payer_person_id?: string
          posted_at?: string
          raw_payload?: Json | null
          receipt_enrichment_status?: string | null
          receipt_request_key?: string | null
          source?: string
          source_category_id?: string | null
          source_category_name?: string | null
          source_comment?: string | null
          status?: Database["public"]["Enums"]["money_transaction_status"]
          transaction_type?: Database["public"]["Enums"]["money_transaction_type"]
          transfer_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "money_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_transactions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "money_transaction_brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_transactions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "money_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_transactions_payer_person_id_fkey"
            columns: ["payer_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_digests: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          payload_json: Json
          person_id: string | null
          scheduled_at: string
          sent_at: string | null
          type: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          payload_json: Json
          person_id?: string | null
          scheduled_at: string
          sent_at?: string | null
          type: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          payload_json?: Json
          person_id?: string | null
          scheduled_at?: string
          sent_at?: string | null
          type?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_digests_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_routing: {
        Row: {
          created_at: string
          custom_prefix: string | null
          enabled: boolean
          id: string
          person_id: string
          recipient_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_prefix?: string | null
          enabled?: boolean
          id?: string
          person_id: string
          recipient_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_prefix?: string | null
          enabled?: boolean
          id?: string
          person_id?: string
          recipient_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_routing_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      observation_catalog: {
        Row: {
          accepted_units: Json
          canonical_unit: string
          created_at: string
          default_ref_high: number | null
          default_ref_low: number | null
          id: string
          name_en: string
          name_ru: string
          notes: string | null
          obs_code: string
          synonyms_en: string[]
          synonyms_ru: string[]
          updated_at: string
        }
        Insert: {
          accepted_units?: Json
          canonical_unit: string
          created_at?: string
          default_ref_high?: number | null
          default_ref_low?: number | null
          id?: string
          name_en: string
          name_ru: string
          notes?: string | null
          obs_code: string
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Update: {
          accepted_units?: Json
          canonical_unit?: string
          created_at?: string
          default_ref_high?: number | null
          default_ref_low?: number | null
          id?: string
          name_en?: string
          name_ru?: string
          notes?: string | null
          obs_code?: string
          synonyms_en?: string[]
          synonyms_ru?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      persons: {
        Row: {
          auth_user_id: string | null
          birthday: string | null
          breed: string | null
          created_at: string
          id: string
          kind: string
          name: string
          notes: string | null
          sex: string | null
          species: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          birthday?: string | null
          breed?: string | null
          created_at?: string
          id?: string
          kind: string
          name: string
          notes?: string | null
          sex?: string | null
          species?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          birthday?: string | null
          breed?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          sex?: string | null
          species?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          auth_user_id: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
        }
        Insert: {
          auth: string
          auth_user_id: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
        }
        Update: {
          auth?: string
          auth_user_id?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
        }
        Relationships: []
      }
      record_attachments: {
        Row: {
          created_at: string
          file_size: number | null
          id: string
          mime_type: string
          original_filename: string
          record_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          file_size?: number | null
          id?: string
          mime_type: string
          original_filename: string
          record_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          file_size?: number | null
          id?: string
          mime_type?: string
          original_filename?: string
          record_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_attachments_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      record_findings: {
        Row: {
          body_site_id: string | null
          body_site_text: string | null
          confidence: number | null
          count: number | null
          created_at: string
          description: string | null
          finding_code: string | null
          finding_date: string | null
          finding_type_id: string | null
          finding_type_text: string
          histology: string | null
          id: string
          is_llm_extracted: boolean
          is_user_verified: boolean
          laterality: string
          morphology: string | null
          person_id: string
          record_id: string
          severity: string
          site_code: string | null
          size_mm: number | null
          source_anchor: string
          updated_at: string
        }
        Insert: {
          body_site_id?: string | null
          body_site_text?: string | null
          confidence?: number | null
          count?: number | null
          created_at?: string
          description?: string | null
          finding_code?: string | null
          finding_date?: string | null
          finding_type_id?: string | null
          finding_type_text: string
          histology?: string | null
          id?: string
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          laterality?: string
          morphology?: string | null
          person_id: string
          record_id: string
          severity?: string
          site_code?: string | null
          size_mm?: number | null
          source_anchor: string
          updated_at?: string
        }
        Update: {
          body_site_id?: string | null
          body_site_text?: string | null
          confidence?: number | null
          count?: number | null
          created_at?: string
          description?: string | null
          finding_code?: string | null
          finding_date?: string | null
          finding_type_id?: string | null
          finding_type_text?: string
          histology?: string | null
          id?: string
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          laterality?: string
          morphology?: string | null
          person_id?: string
          record_id?: string
          severity?: string
          site_code?: string | null
          size_mm?: number | null
          source_anchor?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_findings_body_site_id_fkey"
            columns: ["body_site_id"]
            isOneToOne: false
            referencedRelation: "body_site_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_findings_finding_type_id_fkey"
            columns: ["finding_type_id"]
            isOneToOne: false
            referencedRelation: "finding_type_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_findings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_findings_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      record_observations: {
        Row: {
          catalog_id: string | null
          confidence: number | null
          created_at: string
          id: string
          is_applied: boolean
          is_llm_extracted: boolean
          is_user_verified: boolean
          obs_code: string | null
          obs_name: string
          record_id: string
          ref_range_high: number | null
          ref_range_high_canonical: number | null
          ref_range_low: number | null
          ref_range_low_canonical: number | null
          ref_range_text: string | null
          status: string | null
          unit: string | null
          unit_canonical: string | null
          updated_at: string
          value_canonical: number | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          catalog_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          is_applied?: boolean
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          obs_code?: string | null
          obs_name: string
          record_id: string
          ref_range_high?: number | null
          ref_range_high_canonical?: number | null
          ref_range_low?: number | null
          ref_range_low_canonical?: number | null
          ref_range_text?: string | null
          status?: string | null
          unit?: string | null
          unit_canonical?: string | null
          updated_at?: string
          value_canonical?: number | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          catalog_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          is_applied?: boolean
          is_llm_extracted?: boolean
          is_user_verified?: boolean
          obs_code?: string | null
          obs_name?: string
          record_id?: string
          ref_range_high?: number | null
          ref_range_high_canonical?: number | null
          ref_range_low?: number | null
          ref_range_low_canonical?: number | null
          ref_range_text?: string | null
          status?: string | null
          unit?: string | null
          unit_canonical?: string | null
          updated_at?: string
          value_canonical?: number | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "record_observations_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "observation_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "record_observations_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "medical_records"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          auth_user_id: string
          checkup_notification_time: string
          checkup_notification_timezone: string | null
          created_at: string
          hidden_measurement_codes: Json
          overdue_reminder_interval_minutes: number
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          checkup_notification_time?: string
          checkup_notification_timezone?: string | null
          created_at?: string
          hidden_measurement_codes?: Json
          overdue_reminder_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          checkup_notification_time?: string
          checkup_notification_timezone?: string | null
          created_at?: string
          hidden_measurement_codes?: Json
          overdue_reminder_interval_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      checkup_compute_next_due: {
        Args: { p_base_date: string; p_schedule: Json }
        Returns: string
      }
      checkup_recompute_next_due_for_item: {
        Args: { p_checkup_item_id: string }
        Returns: undefined
      }
      clear_future_med_dose_events: {
        Args: { p_auth_user_id: string; p_horizon_days?: number }
        Returns: number
      }
      clear_future_med_dose_events_for_person: {
        Args: { p_horizon_days?: number; p_person_id: string }
        Returns: number
      }
      convert_to_canonical_unit: {
        Args: { p_obs_code: string; p_unit: string; p_value: number }
        Returns: number
      }
      create_medication_refill_digests: {
        Args: { p_auth_user_id: string }
        Returns: number
      }
      create_medication_reminder_digests: {
        Args: { p_now_timestamptz?: string }
        Returns: undefined
      }
      find_body_site_by_text: {
        Args: { p_lang?: string; p_text: string }
        Returns: {
          id: string
          site_code: string
        }[]
      }
      find_finding_type_by_text: {
        Args: { p_lang?: string; p_text: string }
        Returns: {
          finding_code: string
          id: string
        }[]
      }
      find_observation_by_synonym: {
        Args: { p_lang?: string; p_text: string }
        Returns: string
      }
      generate_med_dose_events_for_horizon: {
        Args: {
          p_auth_user_id: string
          p_horizon_days?: number
          p_timezone: string
        }
        Returns: number
      }
      generate_med_dose_events_for_horizon_for_person: {
        Args: {
          p_horizon_days?: number
          p_person_id: string
          p_timezone: string
        }
        Returns: number
      }
      generate_med_dose_events_for_person_ids: {
        Args: {
          p_horizon_days?: number
          p_person_ids: string[]
          p_timezone: string
        }
        Returns: number
      }
      get_checkup_notification_payload_for_person: {
        Args: {
          p_date: string
          p_notification_time: string
          p_person_id: string
          p_timezone: string
        }
        Returns: {
          body: string
          person_id: string
          scheduled_at: string
          title: string
          url: string
          window_end: string
          window_start: string
        }[]
      }
      get_checkups_for_condition: {
        Args: { p_condition_id: string }
        Returns: {
          category: Database["public"]["Enums"]["checkup_category"]
          created_at: string
          id: string
          next_due_at: string | null
          notes: string | null
          person_id: string
          planned_on: string | null
          reminder_days_before: number[]
          schedule: Json
          status: Database["public"]["Enums"]["checkup_item_status"]
          title: string
          updated_at: string
          why_links: Json | null
          why_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "checkup_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_medication_dose_reminder_payload_for_person: {
        Args: {
          p_now_timestamptz: string
          p_person_id: string
          p_timezone?: string
        }
        Returns: {
          amount: string
          body: string
          dose_event_id: string
          medication_name: string
          scheduled_at: string
          time_str: string
          title: string
          unit: string
          url: string
          window_end: string
          window_start: string
        }[]
      }
      get_medication_refill_snooze: {
        Args: { p_regimen_id: string }
        Returns: string
      }
      get_money_merchant_default_categories: {
        Args: { p_payer_person_id: string }
        Returns: {
          category_id: string
          merchant_name: string
        }[]
      }
      get_person_conditions_with_history: {
        Args: { p_person_id: string }
        Returns: {
          code: string
          created_at: string
          current_status: string
          first_mentioned_date: string
          icd_name_en: string
          icd_name_ru: string
          id: string
          last_mentioned_date: string
          mention_count: number
          name: string
          notes: string
          onset_date: string
          person_id: string
          resolved_date: string
          updated_at: string
        }[]
      }
      get_record_conditions: {
        Args: { p_record_id: string }
        Returns: {
          condition_code: string
          condition_current_status: string
          condition_icd_name_en: string
          condition_icd_name_ru: string
          condition_id: string
          condition_name: string
          condition_notes: string
          condition_onset_date: string
          condition_resolved_date: string
          confidence: number
          created_at: string
          id: string
          is_llm_extracted: boolean
          is_user_verified: boolean
          record_id: string
          source_anchor: string
          status_in_record: string
        }[]
      }
      get_record_findings: {
        Args: { p_record_id: string }
        Returns: {
          body_site_id: string
          body_site_text: string
          catalog_finding_name_en: string
          catalog_finding_name_ru: string
          catalog_site_name_en: string
          catalog_site_name_ru: string
          confidence: number
          count: number
          created_at: string
          description: string
          finding_code: string
          finding_date: string
          finding_type_id: string
          finding_type_text: string
          histology: string
          id: string
          is_llm_extracted: boolean
          is_user_verified: boolean
          laterality: string
          morphology: string
          person_id: string
          record_id: string
          severity: string
          site_code: string
          size_mm: number
          source_anchor: string
        }[]
      }
      get_record_observations: {
        Args: { p_record_id: string }
        Returns: {
          catalog_canonical_unit: string
          catalog_id: string
          catalog_name_en: string
          catalog_name_ru: string
          confidence: number
          created_at: string
          default_ref_high: number
          default_ref_low: number
          id: string
          is_applied: boolean
          is_llm_extracted: boolean
          is_user_verified: boolean
          obs_code: string
          obs_name: string
          record_id: string
          ref_range_high: number
          ref_range_low: number
          ref_range_text: string
          status: string
          unit: string
          unit_canonical: string
          value_canonical: number
          value_numeric: number
          value_text: string
        }[]
      }
      get_routed_persons_for_recipient: {
        Args: { p_recipient_user_id: string }
        Returns: {
          custom_prefix: string
          person_id: string
          person_name: string
          person_owner_user_id: string
        }[]
      }
      is_allowed_user: { Args: never; Returns: boolean }
      is_owner_of_person: { Args: { p_person_id: string }; Returns: boolean }
      mark_dose_skipped: {
        Args: { p_dose_event_id: string; p_note?: string }
        Returns: undefined
      }
      mark_dose_taken: {
        Args: { p_dose_event_id: string; p_note?: string; p_taken_at?: string }
        Returns: undefined
      }
      money_apply_category_rule_pipeline: {
        Args: {
          p_force_overwrite_locked?: boolean
          p_line_item_ids: string[]
          p_person_id?: string
          p_trigger_source?: string
        }
        Returns: Json
      }
      money_apply_category_rule_pipeline_for_date_range: {
        Args: {
          p_force_overwrite_locked?: boolean
          p_from: string
          p_person_id: string
          p_to: string
        }
        Returns: Json
      }
      money_apply_category_rule_pipeline_for_transaction: {
        Args: {
          p_force_overwrite_locked?: boolean
          p_person_id?: string
          p_transaction_id: string
        }
        Returns: Json
      }
      money_evaluate_category_rule_filter: {
        Args: {
          p_context: Json
          p_current_canonical_system_key: string
          p_current_category_id: string
          p_filter: Json
        }
        Returns: boolean
      }
      money_get_category_rule_context: {
        Args: { p_line_item_id: string; p_person_id?: string }
        Returns: Json
      }
      money_get_category_rule_debug: {
        Args: { p_limit?: number; p_line_item_id: string }
        Returns: Json
      }
      money_list_transactions_feed: {
        Args: {
          p_account_ids?: string[]
          p_amount_sign?: string
          p_category_ids?: string[]
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_payer_person_id: string
          p_search?: string
          p_statuses?: Database["public"]["Enums"]["money_transaction_status"][]
          p_to?: string
          p_transaction_types?: Database["public"]["Enums"]["money_transaction_type"][]
          p_transfer_filter?: string
        }
        Returns: {
          account_id: string
          account_kind: string
          account_label: string
          amount: number
          brand_id: string
          card_id: string
          card_label: string
          card_last4: string
          cashback_amount: number
          cashback_currency: string
          category_ids: string[]
          comment: string
          created_at: string
          currency: string
          external_id: string
          id: string
          is_transfer: boolean
          line_item_count: number
          line_item_titles: string[]
          line_items: Json
          merchant_name: string
          money_cards: Json
          operation_icon_url: string
          payer_person_id: string
          posted_at: string
          raw_payload: Json
          receipt_enrichment_status: string
          receipt_request_key: string
          source: string
          source_category_id: string
          source_category_name: string
          source_comment: string
          status: Database["public"]["Enums"]["money_transaction_status"]
          total_count: number
          transaction_type: Database["public"]["Enums"]["money_transaction_type"]
          transfer_group_id: string
        }[]
      }
      money_preview_category_rule_pipeline: {
        Args: {
          p_line_item_id: string
          p_person_id?: string
          p_rule_ids?: string[]
        }
        Returns: Json
      }
      money_reassign_card_account: {
        Args: { p_card_id: string; p_target_account_id: string }
        Returns: {
          merged: boolean
          moved_transactions_count: number
          resulting_card_id: string
        }[]
      }
      money_run_category_rule_pipeline_internal: {
        Args: {
          p_force_overwrite_locked?: boolean
          p_line_item_id: string
          p_person_id?: string
          p_rule_ids?: string[]
          p_save?: boolean
          p_trigger_source?: string
        }
        Returns: Json
      }
      money_seed_canonical_categories: { Args: never; Returns: undefined }
      money_seed_category_rule_mappings: { Args: never; Returns: undefined }
      money_upsert_transactions_batch: {
        Args: { p_batch_id: string; p_payer_person_id: string; p_rows: Json }
        Returns: Json
      }
      run_med_event_generation_for_all_users: {
        Args: { p_horizon_days?: number }
        Returns: {
          auth_user_id: string
          events_generated: number
          refill_digests_created: number
        }[]
      }
      run_notifications_cron_http: { Args: never; Returns: undefined }
      search_medical_records: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_person_id?: string
          p_record_type?: Database["public"]["Enums"]["record_type"]
          p_status?: Database["public"]["Enums"]["record_status"]
          p_statuses?: string[]
          search_query?: string
        }
        Returns: {
          attachment_count: number
          created_at: string
          created_by_user_id: string
          id: string
          llm_keywords: string[]
          llm_summary: string
          notes: string
          ocr_text: string
          person_id: string
          record_date: string
          record_type: Database["public"]["Enums"]["record_type"]
          removed_at: string
          search_rank: number
          status: Database["public"]["Enums"]["record_status"]
          title: string
          updated_at: string
        }[]
      }
      set_medication_refill_snooze: {
        Args: { p_regimen_id: string; p_snooze_until: string }
        Returns: string
      }
      snooze_dose: {
        Args: {
          p_auth_user_id: string
          p_dose_event_id: string
          p_minutes_from_now?: number
        }
        Returns: undefined
      }
      undo_dose_intake: {
        Args: { p_dose_event_id: string }
        Returns: undefined
      }
      update_dose_event_resolution_details: {
        Args: {
          p_amount_taken?: number
          p_dose_event_id: string
          p_note?: string
          p_taken_at?: string
        }
        Returns: undefined
      }
      update_regimen_inventory: {
        Args: {
          p_amount: number
          p_note?: string
          p_regimen_id: string
          p_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      checkup_category:
        | "lab"
        | "imaging"
        | "visit"
        | "vaccination"
        | "dental"
        | "other"
      checkup_item_status: "active" | "paused" | "completed" | "archived"
      med_dose_event_status:
        | "scheduled"
        | "sent"
        | "taken"
        | "skipped"
        | "snoozed"
        | "missed"
        | "cancelled"
      med_intake_advice_type:
        | "before_meal"
        | "with_meal"
        | "after_meal"
        | "before_bed"
        | "morning_fasting"
        | "custom"
        | "none"
      med_inventory_transaction_type:
        | "decrement"
        | "refill"
        | "set_absolute"
        | "correction"
      medication_status: "active" | "paused" | "completed" | "archived"
      medication_unit:
        | "pill"
        | "ml"
        | "drops"
        | "inhalation"
        | "patch"
        | "other"
        | "iu"
        | "ampoule"
        | "capsule"
        | "application"
        | "gram"
        | "injection"
        | "milligram"
        | "spray"
        | "portion"
        | "tablespoon"
        | "teaspoon"
        | "unit"
        | "suppository"
      money_assignment_method: "import" | "rule" | "llm" | "manual"
      money_category_kind: "canonical" | "custom"
      money_line_status: "final" | "returned" | "cancelled"
      money_rule_kind:
        | "direct"
        | "mcc_map"
        | "llm_categorization"
        | "fallback_uncategorized"
      money_transaction_status: "posted" | "pending" | "cancelled"
      money_transaction_type:
        | "expense"
        | "income"
        | "transfer"
        | "refund"
        | "fee"
        | "adjustment"
      record_status:
        | "draft"
        | "ocr_processing"
        | "ocr_failed"
        | "ocr_review"
        | "structuring"
        | "structure_review"
        | "processing"
        | "active"
        | "removed"
      record_type:
        | "lab"
        | "visit"
        | "imaging"
        | "prescription"
        | "vaccination"
        | "vet"
        | "other"
        | "procedure"
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
      checkup_category: [
        "lab",
        "imaging",
        "visit",
        "vaccination",
        "dental",
        "other",
      ],
      checkup_item_status: ["active", "paused", "completed", "archived"],
      med_dose_event_status: [
        "scheduled",
        "sent",
        "taken",
        "skipped",
        "snoozed",
        "missed",
        "cancelled",
      ],
      med_intake_advice_type: [
        "before_meal",
        "with_meal",
        "after_meal",
        "before_bed",
        "morning_fasting",
        "custom",
        "none",
      ],
      med_inventory_transaction_type: [
        "decrement",
        "refill",
        "set_absolute",
        "correction",
      ],
      medication_status: ["active", "paused", "completed", "archived"],
      medication_unit: [
        "pill",
        "ml",
        "drops",
        "inhalation",
        "patch",
        "other",
        "iu",
        "ampoule",
        "capsule",
        "application",
        "gram",
        "injection",
        "milligram",
        "spray",
        "portion",
        "tablespoon",
        "teaspoon",
        "unit",
        "suppository",
      ],
      money_assignment_method: ["import", "rule", "llm", "manual"],
      money_category_kind: ["canonical", "custom"],
      money_line_status: ["final", "returned", "cancelled"],
      money_rule_kind: [
        "direct",
        "mcc_map",
        "llm_categorization",
        "fallback_uncategorized",
      ],
      money_transaction_status: ["posted", "pending", "cancelled"],
      money_transaction_type: [
        "expense",
        "income",
        "transfer",
        "refund",
        "fee",
        "adjustment",
      ],
      record_status: [
        "draft",
        "ocr_processing",
        "ocr_failed",
        "ocr_review",
        "structuring",
        "structure_review",
        "processing",
        "active",
        "removed",
      ],
      record_type: [
        "lab",
        "visit",
        "imaging",
        "prescription",
        "vaccination",
        "vet",
        "other",
        "procedure",
      ],
    },
  },
} as const

