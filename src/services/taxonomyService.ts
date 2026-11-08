import { supabase } from '../lib/supabase';

// The stock_taxonomies registry: the canonical list of category and region
// names offered in the add/edit form dropdowns and managed on the
// Categories | Regions page. A stock's own value is still stored per stock
// as `category` / `region` inside its dcf_inputs JSONB — this table only
// holds the list of available names, so a rename, merge or remove can
// retire a name from the dropdowns for good (a merged-away name is deleted
// here AND cleared from every stock, so it cannot reappear).
//
// The table exists only once migration 20251108000000_stock_taxonomies is
// applied. Until then every read reports tableAvailable: false and the
// caller falls back to the hardcoded seed lists (src/utils/categories.ts,
// src/utils/regions.ts); the manager's row operations (rename/merge/remove
// on stocks) still work, but adding a standalone name with no stocks yet
// needs the table. Nothing here uses localStorage — the registry is shared
// server-side, so it sticks across browsers and sessions.

export type TaxonomyKind = 'category' | 'region';

export const TAXONOMY_LABEL: Record<TaxonomyKind, string> = {
  category: 'Category',
  region: 'Region'
};

/** Registry names for one kind, in creation order. tableAvailable is false
 *  when the stock_taxonomies table does not exist yet (migration not
 *  applied) — any other read error is reported the same way so the UI can
 *  fall back instead of breaking the watchlist. */
export async function fetchTaxonomyNames(
  kind: TaxonomyKind,
  userEmail: string
): Promise<{ names: string[]; tableAvailable: boolean }> {
  const { data, error } = await supabase
    .from('stock_taxonomies')
    .select('name')
    .eq('user_email', userEmail)
    .eq('kind', kind)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn(`Taxonomy registry unavailable (${kind}):`, error.message);
    return { names: [], tableAvailable: false };
  }
  return { names: (data ?? []).map(row => row.name as string), tableAvailable: true };
}

/** Add a standalone name to the registry (no stocks attached yet). */
export async function addTaxonomyName(
  kind: TaxonomyKind,
  userEmail: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from('stock_taxonomies')
    .insert([{ user_email: userEmail, kind, name }]);
  if (error) throw error;
}

/** Register a name if it is not already in the registry (no-op on conflict).
 *  Used after a rename/merge so the new/target name is in the list even
 *  when it previously only existed on stocks. */
export async function upsertTaxonomyName(
  kind: TaxonomyKind,
  userEmail: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from('stock_taxonomies')
    .upsert([{ user_email: userEmail, kind, name }], {
      onConflict: 'user_email,kind,name',
      ignoreDuplicates: true
    });
  if (error) throw error;
}

/** Retire a name from the registry. Delete-then-insert (in rename) keeps
 *  this exact without depending on the update's affected-row count. */
export async function renameTaxonomyName(
  kind: TaxonomyKind,
  userEmail: string,
  oldName: string,
  newName: string
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('stock_taxonomies')
    .delete()
    .eq('user_email', userEmail)
    .eq('kind', kind)
    .eq('name', oldName);
  if (deleteError) throw deleteError;
  await upsertTaxonomyName(kind, userEmail, newName);
}

/** Remove a name from the registry. Callers also clear it from every stock
 *  that had it, so the name is gone from dropdowns and filters entirely. */
export async function deleteTaxonomyName(
  kind: TaxonomyKind,
  userEmail: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from('stock_taxonomies')
    .delete()
    .eq('user_email', userEmail)
    .eq('kind', kind)
    .eq('name', name);
  if (error) throw error;
}
