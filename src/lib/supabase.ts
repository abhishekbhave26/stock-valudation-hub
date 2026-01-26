import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

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
      saved_stocks: {
        Row: {
          id: string;
          ticker: string;
          current_price: number;
          fair_value: number;
          expected_return: number;
          cagr: number;
          buy_target: number;
          dcf_inputs: any;
          created_at: string;
          updated_at: string;
          notes: string;
          is_favorite: boolean;
        };
        Insert: {
          id?: string;
          ticker: string;
          current_price: number;
          fair_value: number;
          expected_return: number;
          cagr: number;
          buy_target: number;
          dcf_inputs: any;
          created_at?: string;
          updated_at?: string;
          notes?: string;
          is_favorite?: boolean;
        };
        Update: {
          id?: string;
          ticker?: string;
          current_price?: number;
          fair_value?: number;
          expected_return?: number;
          cagr?: number;
          buy_target?: number;
          dcf_inputs?: any;
          created_at?: string;
          updated_at?: string;
          notes?: string;
          is_favorite?: boolean;
        };
      };
      portfolio_stocks: {
        Row: {
          id: string;
          ticker: string;
          quantity: number;
          buy_price: number;
          purchase_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticker: string;
          quantity: number;
          buy_price: number;
          purchase_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticker?: string;
          quantity?: number;
          buy_price?: number;
          purchase_date?: string;
          created_at?: string;
        };
      };
    };
  };
};
