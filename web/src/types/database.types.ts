// Generated from the live Supabase schema via `supabase gen types typescript`.
// To regenerate: `pnpm types:db` (script defined in package.json) — or call
// the Supabase MCP tool. Do not edit by hand.

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
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          plan: string
          sessions_used: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          plan?: string
          sessions_used?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          plan?: string
          sessions_used?: number
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
    }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
