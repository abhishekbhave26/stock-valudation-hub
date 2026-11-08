// Stock regions: a stock can have several, except "Global", which is
// exclusive — a stock with Global has no other region (enforced in the
// multi-select and in the manager's merge/rename flows).
//
// This is the seed list offered in the add/edit form multi-select, alongside
// a "create new" input for anything outside it. The list is mixed
// granularity on purpose: whole-world and continents first, then the
// specific countries the user tracks most. It is the fallback list — once
// migration 20251108000000_stock_taxonomies is applied, the stock_taxonomies
// registry is the source of truth for the dropdowns (see
// src/services/taxonomyService.ts), and this list only stands in when the
// registry is empty or the table does not exist yet. Stored per stock as an
// array in `region` inside the saved row's dcf_inputs JSONB, parallel to
// dcf_inputs.category — no schema change beyond the registry table.
export const STOCK_REGIONS: string[] = [
  'Global',
  'North America',
  'South America',
  'Europe',
  'Asia',
  'Africa',
  'Oceania',
  'United States',
  'Canada',
  'India',
  'China',
  'Japan',
  'United Kingdom',
  'Germany',
  'France',
  'Taiwan',
  'South Korea',
  'Netherlands',
  'Israel',
  'Brazil'
];
