import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
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