// Generated from the live Supabase schema via the Supabase MCP
// `generate_typescript_types` tool. To regenerate after a migration: call
// the MCP tool again and replace this file's body. Do not edit by hand.
//
// EXCEPTION (2026-07-14): the `events` table and `profiles.attribution`
// column were hand-added to match the not-yet-applied migration
// 20260714000100_events_and_attribution.sql. Regenerate this file once that
// migration is applied and this note disappears on its own.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_reports: {
        Row: {
          cached_input_tokens: number | null
          created_at: string
          headline: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          per_section: Json
          prompt_version: number
          provider: string
          raw: Json | null
          session_id: string
          suggested_edits: Json
          summary: string
          user_id: string
        }
        Insert: {
          cached_input_tokens?: number | null
          created_at?: string
          headline?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          per_section?: Json
          prompt_version?: number
          provider?: string
          raw?: Json | null
          session_id: string
          suggested_edits?: Json
          summary?: string
          user_id: string
        }
        Update: {
          cached_input_tokens?: number | null
          created_at?: string
          headline?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          per_section?: Json
          prompt_version?: number
          provider?: string
          raw?: Json | null
          session_id?: string
          suggested_edits?: Json
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          anon_id: string | null
          created_at: string
          id: string
          name: string
          props: Json
          user_id: string | null
        }
        Insert: {
          anon_id?: string | null
          created_at?: string
          id?: string
          name: string
          props?: Json
          user_id?: string | null
        }
        Update: {
          anon_id?: string | null
          created_at?: string
          id?: string
          name?: string
          props?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          attribution: Json | null
          created_at: string
          current_period_end: string | null
          display_name: string | null
          email: string
          id: string
          one_shot_speech_id: string | null
          plan: string
          sessions_used: number
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string
        }
        Insert: {
          attribution?: Json | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          email: string
          id: string
          one_shot_speech_id?: string | null
          plan?: string
          sessions_used?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Update: {
          attribution?: Json | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          email?: string
          id?: string
          one_shot_speech_id?: string | null
          plan?: string
          sessions_used?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      script_versions: {
        Row: {
          created_at: string
          id: string
          parent_version_id: string | null
          speech_id: string
          summary: string | null
          v: number
        }
        Insert: {
          created_at?: string
          id?: string
          parent_version_id?: string | null
          speech_id: string
          summary?: string | null
          v: number
        }
        Update: {
          created_at?: string
          id?: string
          parent_version_id?: string | null
          speech_id?: string
          summary?: string | null
          v?: number
        }
        Relationships: []
      }
      sections: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          position: number
          script_version_id: string
          target_seconds: number
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          position: number
          script_version_id: string
          target_seconds?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          script_version_id?: string
          target_seconds?: number
        }
        Relationships: []
      }
      section_metrics: {
        Row: {
          actual_seconds: number
          created_at: string
          delta_seconds: number
          filler_count: number
          id: string
          pause_ms_total: number
          position: number
          section_id: string
          session_id: string
          target_seconds: number
          user_id: string
          word_end_idx: number | null
          word_start_idx: number | null
          wpm: number | null
        }
        Insert: {
          actual_seconds: number
          created_at?: string
          delta_seconds: number
          filler_count?: number
          id?: string
          pause_ms_total?: number
          position: number
          section_id: string
          session_id: string
          target_seconds: number
          user_id: string
          word_end_idx?: number | null
          word_start_idx?: number | null
          wpm?: number | null
        }
        Update: {
          actual_seconds?: number
          created_at?: string
          delta_seconds?: number
          filler_count?: number
          id?: string
          pause_ms_total?: number
          position?: number
          section_id?: string
          session_id?: string
          target_seconds?: number
          user_id?: string
          word_end_idx?: number | null
          word_start_idx?: number | null
          wpm?: number | null
        }
        Relationships: []
      }
      sessions: {
        Row: {
          audio_bytes: number | null
          audio_mime: string | null
          audio_path: string | null
          created_at: string
          duration_ms: number | null
          id: string
          mode: string
          script_version_id: string
          speech_id: string
          status: string
          tags: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_bytes?: number | null
          audio_mime?: string | null
          audio_path?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          mode?: string
          script_version_id: string
          speech_id: string
          status?: string
          tags?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_bytes?: number | null
          audio_mime?: string | null
          audio_path?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          mode?: string
          script_version_id?: string
          speech_id?: string
          status?: string
          tags?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      speeches: {
        Row: {
          created_at: string
          current_version: number
          id: string
          occasion: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          id?: string
          occasion?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_version?: number
          id?: string
          occasion?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          created_at: string
          filler_count: number
          id: string
          language: string | null
          model: string | null
          pause_count: number
          provider: string
          raw: Json | null
          session_id: string
          text: string
          user_id: string
          words: Json
        }
        Insert: {
          created_at?: string
          filler_count?: number
          id?: string
          language?: string | null
          model?: string | null
          pause_count?: number
          provider?: string
          raw?: Json | null
          session_id: string
          text?: string
          user_id: string
          words?: Json
        }
        Update: {
          created_at?: string
          filler_count?: number
          id?: string
          language?: string | null
          model?: string | null
          pause_count?: number
          provider?: string
          raw?: Json | null
          session_id?: string
          text?: string
          user_id?: string
          words?: Json
        }
        Relationships: []
      }
    }
    Views: {
      current_script: {
        Row: {
          body: string | null
          current_version: number | null
          occasion: string | null
          position: number | null
          script_version_id: string | null
          section_id: string | null
          section_name: string | null
          speech_id: string | null
          target_seconds: number | null
          title: string | null
          user_id: string | null
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          current_period_end: string | null
          free_sessions_remaining: number | null
          is_entitled: boolean | null
          one_shot_speech_id: string | null
          plan: string | null
          sessions_used: number | null
          subscription_status: string | null
          user_id: string | null
        }
        Relationships: []
      }
      session_summaries: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          mode: string | null
          script_version_id: string | null
          session_id: string | null
          speech_id: string | null
          status: string | null
          total_actual_seconds: number | null
          total_filler_count: number | null
          total_target_seconds: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
