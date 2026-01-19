import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://placeholder.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Keep sessions for 7 days (604800 seconds)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Set session expiry to 7 days
    storage: window.localStorage,
    storageKey: 'supabase.auth.token'
  }
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          created_at: string;
          email: string | null;
          goal_amount: number;
        };
        Insert: {
          id: string;
          created_at?: string;
          email?: string | null;
          goal_amount?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          email?: string | null;
          goal_amount?: number;
        };
      };
      snapshots: {
        Row: {
          id: string;
          user_id: string;
          created_at: string;
          as_of_date: string;
          my_robinhood_portfolio: number;
          girlfriend_robinhood_portfolio: number;
          girlfriend_bank_account: number;
          my_savings_account: number;
          my_meta_stock_value: number;
          miscellaneous_assets: number;
          total_saved: number;
          goal_amount: number;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          created_at?: string;
          as_of_date: string;
          my_robinhood_portfolio?: number;
          girlfriend_robinhood_portfolio?: number;
          girlfriend_bank_account?: number;
          my_savings_account?: number;
          my_meta_stock_value?: number;
          miscellaneous_assets?: number;
          total_saved: number;
          goal_amount: number;
          notes?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          created_at?: string;
          as_of_date?: string;
          my_robinhood_portfolio?: number;
          girlfriend_robinhood_portfolio?: number;
          girlfriend_bank_account?: number;
          my_savings_account?: number;
          my_meta_stock_value?: number;
          miscellaneous_assets?: number;
          total_saved?: number;
          goal_amount?: number;
          notes?: string | null;
        };
      };
    };
  };
};
