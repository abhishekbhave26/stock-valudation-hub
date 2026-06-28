import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

const isValidUrl = (val: string | undefined): val is string =>
  !!val && val.startsWith('https://') && !val.includes('placeholder');

const isValidKey = (val: string | undefined): val is string =>
  !!val && val.length > 20 && !val.includes('placeholder');

export const isSupabaseConfigured = isValidUrl(rawUrl) && isValidKey(rawKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[Supabase] Missing or invalid env vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Set them in Netlify → Site settings → Environment variables, then redeploy.'
  );
}

export const supabase = createClient(
  rawUrl || PLACEHOLDER_URL,
  rawKey || PLACEHOLDER_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'supabase.auth.token'
    }
  }
);

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
      portfolio_snapshots: {
        Row: {
          id: string;
          user_email: string;
          snapshot_at: string;
          total_value: number;
          total_cost: number;
          total_return: number;
        };
        Insert: {
          id?: string;
          user_email: string;
          snapshot_at?: string;
          total_value: number;
          total_cost: number;
          total_return: number;
        };
        Update: {
          id?: string;
          user_email?: string;
          snapshot_at?: string;
          total_value?: number;
          total_cost?: number;
          total_return?: number;
        };
      };
      portfolio_snapshot_holdings: {
        Row: {
          id: string;
          snapshot_id: string;
          ticker: string;
          quantity: number;
          buy_price: number;
          current_price: number;
          total_value: number;
          total_cost: number;
          total_return: number;
          weight_percent: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          snapshot_id: string;
          ticker: string;
          quantity: number;
          buy_price: number;
          current_price: number;
          total_value: number;
          total_cost: number;
          total_return: number;
          weight_percent: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          snapshot_id?: string;
          ticker?: string;
          quantity?: number;
          buy_price?: number;
          current_price?: number;
          total_value?: number;
          total_cost?: number;
          total_return?: number;
          weight_percent?: number;
          created_at?: string;
        };
      };
    };
  };
};
