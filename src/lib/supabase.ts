import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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