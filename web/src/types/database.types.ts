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
        Relationships: [
          {
            foreignKeyName: "ai_reports_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "session_summaries"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "ai_reports_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ai_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          resend_id: string | null
          scheduled_for: string
          sent_at: string | null
          speech_id: string | null
          status: string
          subject_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          resend_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          speech_id?: string | null
          status?: string
          subject_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          resend_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          speech_id?: string | null
          status?: string
          subject_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "email_sends_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "email_sends_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          attribution: Json | null
          created_at: string
          current_period_end: string | null
          display_name: string | null
          email: string
          email_bounced_at: string | null
          email_unsubscribed_at: string | null
          id: string
          one_shot_speech_id: string | null
          plan: string
          sessions_used: number
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          timezone: string | null
          unsubscribe_token: string
          updated_at: string
        }
        Insert: {
          attribution?: Json | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          email: string
          email_bounced_at?: string | null
          email_unsubscribed_at?: string | null
          id: string
          one_shot_speech_id?: string | null
          plan?: string
          sessions_used?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          timezone?: string | null
          unsubscribe_token?: string
          updated_at?: string
        }
        Update: {
          attribution?: Json | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          email?: string
          email_bounced_at?: string | null
          email_unsubscribed_at?: string | null
          id?: string
          one_shot_speech_id?: string | null
          plan?: string
          sessions_used?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          timezone?: string | null
          unsubscribe_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "script_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["script_version_id"]
          },
          {
            foreignKeyName: "script_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "script_versions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "script_versions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "script_versions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "section_metrics_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["section_id"]
          },
          {
            foreignKeyName: "section_metrics_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_metrics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "session_summaries"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "section_metrics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "section_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "sections_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["script_version_id"]
          },
          {
            foreignKeyName: "sections_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          audio_bytes: number | null
          audio_mime: string | null
          audio_path: string | null
          created_at: string
          debited_at: string | null
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
          debited_at?: string | null
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
          debited_at?: string | null
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
        Relationships: [
          {
            foreignKeyName: "sessions_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["script_version_id"]
          },
          {
            foreignKeyName: "sessions_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      speeches: {
        Row: {
          created_at: string
          current_version: number
          event_date: string | null
          id: string
          occasion: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          event_date?: string | null
          id?: string
          occasion?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_version?: number
          event_date?: string | null
          id?: string
          occasion?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "session_summaries"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcripts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "transcripts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Insert: {
          current_period_end?: string | null
          free_sessions_remaining?: never
          is_entitled?: never
          one_shot_speech_id?: string | null
          plan?: string | null
          sessions_used?: number | null
          subscription_status?: string | null
          user_id?: string | null
        }
        Update: {
          current_period_end?: string | null
          free_sessions_remaining?: never
          is_entitled?: never
          one_shot_speech_id?: string | null
          plan?: string | null
          sessions_used?: number | null
          subscription_status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "profiles_one_shot_speech_id_fkey"
            columns: ["one_shot_speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_speech_nudges: {
        Row: {
          current_version: number | null
          display_name: string | null
          email: string | null
          event_date: string | null
          last_session_at: string | null
          occasion: string | null
          speech_id: string | null
          timezone: string | null
          title: string | null
          unsubscribe_token: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "speeches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "sessions_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["script_version_id"]
          },
          {
            foreignKeyName: "sessions_script_version_id_fkey"
            columns: ["script_version_id"]
            isOneToOne: false
            referencedRelation: "script_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "current_script"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "pending_speech_nudges"
            referencedColumns: ["speech_id"]
          },
          {
            foreignKeyName: "sessions_speech_id_fkey"
            columns: ["speech_id"]
            isOneToOne: false
            referencedRelation: "speeches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      reap_stuck_sessions: {
        Args: never
        Returns: {
          reaped_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
