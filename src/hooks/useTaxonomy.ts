import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { fetchTaxonomyNames, TaxonomyKind } from '../services/taxonomyService';
import { STOCK_CATEGORIES } from '../utils/categories';
import { STOCK_REGIONS } from '../utils/regions';

// The dropdown options for one kind (category or region), sorted
// alphabetically.
//
// Source of truth, once migration 20251108000000_stock_taxonomies is
// applied, is the stock_taxonomies registry: options are the registry
// names plus any name actually in use on the loaded rows (covers custom
// names created in a form before the registry existed). When the registry
// is empty — or the table does not exist yet — the hardcoded seed list
// stands in, so the forms never render an empty dropdown. That fallback is
// also why a merged-away seed name can linger in the dropdowns until the
// migration is applied; after it, the registry is authoritative and a
// deleted name is gone for good.
//
// tableAvailable tells the manager whether bare adds (a name with no stocks
// yet) can persist. refresh() re-reads the registry after the manager
// changes it; refreshKey lets the parent force a re-read too.
export function useTaxonomy(
  kind: TaxonomyKind,
  inUseNames: string[],
  refreshKey = 0
) {
  const { user } = useAuth();
  const [registryNames, setRegistryNames] = useState<string[]>([]);
  const [tableAvailable, setTableAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const userEmail = user?.email ?? '';

  // Stable key for the in-use names: the fetch does not depend on them
  // (they only join the options below), so a new array identity per render
  // must not trigger a refetch.
  const inUseKey = useMemo(
    () =>
      [...new Set(inUseNames.map(name => name.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .join('\n'),
    [inUseNames]
  );

  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;
    setLoading(true);
    fetchTaxonomyNames(kind, userEmail)
      .then(({ names, tableAvailable: available }) => {
        if (cancelled) return;
        setRegistryNames(names);
        setTableAvailable(available);
      })
      .catch(() => {
        if (cancelled) return;
        setRegistryNames([]);
        setTableAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, userEmail, version, refreshKey]);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  const options = useMemo(() => {
    const seedList = kind === 'category' ? STOCK_CATEGORIES : STOCK_REGIONS;
    // An empty registry means "not seeded yet", not "user deleted
    // everything" — the seed list stands in so the dropdowns stay useful.
    const base = registryNames.length > 0 ? registryNames : seedList;
    const inUse = inUseKey ? inUseKey.split('\n') : [];
    return [...new Set([...base, ...inUse])].sort((a, b) => a.localeCompare(b));
  }, [kind, registryNames, inUseKey]);

  return { options, tableAvailable, loading, refresh };
}
