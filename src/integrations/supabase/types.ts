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
      customers: {
        Row: {
          created_at: string
          current_step_id: string | null
          email: string
          firm_name: string
          first_name: string
          id: string
          notes: string | null
          paused: boolean
          sequence_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_step_id?: string | null
          email: string
          firm_name: string
          first_name: string
          id?: string
          notes?: string | null
          paused?: boolean
          sequence_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_step_id?: string | null
          email?: string
          firm_name?: string
          first_name?: string
          id?: string
          notes?: string | null
          paused?: boolean
          sequence_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          body: string
          created_at: string
          customer_id: string
          id: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          step_id: string | null
          subject: string
          template_id: string
        }
        Insert: {
          body: string
          created_at?: string
          customer_id: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
          subject: string
          template_id: string
        }
        Update: {
          body?: string
          created_at?: string
          customer_id?: string
          id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          step_id?: string | null
          subject?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          stage: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          name: string
          stage?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          stage?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_sends: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          processed: boolean
          scheduled_for: string
          step_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          processed?: boolean
          scheduled_for: string
          step_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          processed?: boolean
          scheduled_for?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_sends_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_sends_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          created_at: string
          delay_days: number
          delay_hours: number
          id: string
          parent_step_id: string | null
          sequence_id: string
          step_order: number
          template_id: string
          trigger_type: string
        }
        Insert: {
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          parent_step_id?: string | null
          sequence_id: string
          step_order?: number
          template_id: string
          trigger_type?: string
        }
        Update: {
          created_at?: string
          delay_days?: number
          delay_hours?: number
          id?: string
          parent_step_id?: string | null
          sequence_id?: string
          step_order?: number
          template_id?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
