import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTaxonomy } from '../hooks/useTaxonomy';
import {
  TaxonomyKind,
  addTaxonomyName,
  deleteTaxonomyName,
  renameTaxonomyName,
  upsertTaxonomyName
} from '../services/taxonomyService';
import { normalizeStringList } from '../utils/taxonomy';

// Manage categories and regions: add, rename, merge and remove names.
//
// Reached in one click from the watchlist ("Manage categories & regions"
// next to the category filter) and back again — there is no settings
// submenu to dig through. Every destructive action (rename, merge,
// remove) asks first and says exactly what will change ("3 stocks will
// move from AI Semiconductors to Semiconductors"); nothing happens
// silently, and no stock is ever deleted — only its category/region value
// changes.
//
// How merges stick: a stock's value lives in its dcf_inputs JSONB, and
// the list of available names lives in the stock_taxonomies registry
// (migration 20251108000000_stock_taxonomies). A rename/merge/remove
// updates BOTH — the affected stocks and the registry row — so the old
// name is gone from the dropdowns and filters for good. Until that
// migration is applied the registry is unavailable: the row operations
// below still work on your stocks, but adding a standalone name is
// disabled and a merged-away seed name may keep showing in the dropdowns.

interface TaxonomyManagerProps {
  stocks: SavedStock[];
  /** Bumped by the parent after any change, so every useTaxonomy instance
   *  (this page, the watchlist dropdowns, the add form) re-reads. */
  refreshKey: number;
  onBack: () => void;
  /** Reload the watchlist rows after a change (counts and badges move). */
  onChanged: () => void;
}

type DialogState =
  | { type: 'rename'; name: string; newName: string }
  | { type: 'merge'; name: string; target: string }
  | { type: 'remove'; name: string }
  | null;

const fieldOf = (kind: TaxonomyKind): 'category' | 'region' =>
  kind === 'category' ? 'category' : 'region';

const valuesOf = (stock: SavedStock, kind: TaxonomyKind): string[] =>
  kind === 'category' ? stock.categories : stock.regions;

const KIND_LABEL: Record<TaxonomyKind, string> = {
  category: 'category',
  region: 'region'
};

const KIND_LABEL_PLURAL: Record<TaxonomyKind, string> = {
  category: 'Categories',
  region: 'Regions'
};

export default function TaxonomyManager({
  stocks,
  refreshKey,
  onBack,
  onChanged
}: TaxonomyManagerProps) {
  const { user } = useAuth();
  const userEmail = user?.email ?? '';
  const [activeKind, setActiveKind] = useState<TaxonomyKind>('category');
  const [newName, setNewName] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const inUseNames = useMemo(
    () => stocks.flatMap(stock => valuesOf(stock, activeKind)),
    [stocks, activeKind]
  );
  const { options, tableAvailable, refresh } = useTaxonomy(activeKind, inUseNames, refreshKey);

  const entries = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; tickers: string[] }>();
    options.forEach(name => byName.set(name, { name, count: 0, tickers: [] }));
    stocks.forEach(stock => {
      valuesOf(stock, activeKind).forEach(value => {
        const entry = byName.get(value) ?? { name: value, count: 0, tickers: [] };
        entry.count += 1;
        entry.tickers.push(stock.ticker);
        byName.set(value, entry);
      });
    });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [options, stocks, activeKind]);

  const uncategorized = useMemo(
    () => stocks.filter(stock => valuesOf(stock, activeKind).length === 0),
    [stocks, activeKind]
  );

  const label = KIND_LABEL[activeKind];

  const isDuplicate = (name: string, exclude?: string) =>
    options.some(
      opt =>
        opt.toLowerCase() === name.trim().toLowerCase() &&
        opt.toLowerCase() !== (exclude ?? '').toLowerCase()
    );

  // Rewrite one field on every stock whose list contains oldValue: the
  // value is replaced with newValue (or dropped when newValue is ''), and
  // the stock's other values are left untouched. Duplicates that would
  // result from the replacement are deduped. For regions, merging or
  // renaming into "Global" drops the stock's other regions — Global is
  // exclusive. The rest of the row's dcf_inputs is spread through
  // untouched, exactly like the edit form's save — and like that save,
  // updated_at is bumped, so a renamed stock's "Last updated" clock
  // restarts.
  const updateStocksField = async (
    kind: TaxonomyKind,
    oldValue: string,
    newValue: string
  ): Promise<number> => {
    const field = fieldOf(kind);
    const affected = stocks.filter(
      stock => valuesOf(stock, kind).includes(oldValue) && stock.id
    );
    await Promise.all(
      affected.map(async stock => {
        const current = valuesOf(stock, kind);
        let next: string[];
        if (newValue === '') {
          next = current.filter(value => value !== oldValue);
        } else {
          next = current.map(value => (value === oldValue ? newValue : value));
          if (kind === 'region' && newValue === 'Global') next = ['Global'];
          next = normalizeStringList(next);
        }
        const { error } = await supabase
          .from('saved_stocks')
          .update({
            dcf_inputs: { ...(stock.dcf_inputs ?? {}), [field]: next },
            updated_at: new Date().toISOString()
          })
          .eq('id', stock.id);
        if (error) throw error;
      })
    );
    return affected.length;
  };

  const finishChange = (text: string) => {
    setMessage({ tone: 'success', text });
    setDialog(null);
    setNewName('');
    refresh();
    onChanged();
  };

  const failChange = (action: string, err: unknown) => {
    setMessage({
      tone: 'error',
      text: `Could not ${action}: ${err instanceof Error ? err.message : 'unknown error'}`
    });
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || !userEmail) return;
    if (isDuplicate(name)) {
      setMessage({ tone: 'error', text: `"${name}" already exists — pick a different name.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await addTaxonomyName(activeKind, userEmail, name);
      finishChange(`Added ${label} "${name}". It is now available in the add/edit forms.`);
    } catch (err) {
      failChange('add', err);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRename = async () => {
    if (!dialog || dialog.type !== 'rename' || !userEmail) return;
    const newName = dialog.newName.trim();
    if (!newName) return;
    if (newName.toLowerCase() === dialog.name.toLowerCase()) {
      setMessage({ tone: 'error', text: 'That is the same name — type a different one.' });
      return;
    }
    if (isDuplicate(newName, dialog.name)) {
      setMessage({
        tone: 'error',
        text: `"${newName}" already exists — merge into it instead of renaming.`
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const count = await updateStocksField(activeKind, dialog.name, newName);
      if (tableAvailable) {
        await renameTaxonomyName(activeKind, userEmail, dialog.name, newName);
      }
      finishChange(
        `Renamed ${label} "${dialog.name}" to "${newName}" — ${count} stock${count === 1 ? '' : 's'} updated.`
      );
    } catch (err) {
      failChange('rename', err);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmMerge = async () => {
    if (!dialog || dialog.type !== 'merge' || !userEmail) return;
    if (!dialog.target || dialog.target === dialog.name) return;
    setBusy(true);
    setMessage(null);
    try {
      const count = await updateStocksField(activeKind, dialog.name, dialog.target);
      if (tableAvailable) {
        await deleteTaxonomyName(activeKind, userEmail, dialog.name);
        await upsertTaxonomyName(activeKind, userEmail, dialog.target);
      }
      finishChange(
        `Merged ${label} "${dialog.name}" into "${dialog.target}" — ${count} stock${count === 1 ? '' : 's'} updated.`
      );
    } catch (err) {
      failChange('merge', err);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!dialog || dialog.type !== 'remove' || !userEmail) return;
    setBusy(true);
    setMessage(null);
    try {
      const count = await updateStocksField(activeKind, dialog.name, '');
      if (tableAvailable) {
        await deleteTaxonomyName(activeKind, userEmail, dialog.name);
      }
      finishChange(
        `Removed ${label} "${dialog.name}" from ${count} stock${count === 1 ? '' : 's'}. No stocks were deleted.`
      );
    } catch (err) {
      failChange('remove', err);
    } finally {
      setBusy(false);
    }
  };

  const dialogCount = dialog
    ? (entries.find(entry => entry.name === dialog.name)?.count ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Manage Categories &amp; Regions</h2>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to watchlist
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Add, rename, merge or remove the names offered in the add/edit forms.
        Renaming or merging replaces that name inside every stock that has
        it — a stock&apos;s other {KIND_LABEL_PLURAL[activeKind].toLowerCase()} stay
        as they are. Removing a {label} deletes it from every stock&apos;s
        list; no stock is ever deleted.
      </p>

      {!tableAvailable && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3" role="status">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">The saved name list isn&apos;t available yet.</p>
            <p>
              The stock_taxonomies table (migration 20251108000000) hasn&apos;t been
              applied, so names added here can&apos;t be saved and a merged-away
              seed name may keep showing in the dropdowns. Renaming, merging
              and removing still update your stocks below.
            </p>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`rounded-xl p-4 flex items-start gap-3 ${
            message.tone === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
          role="status"
        >
          {message.tone === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden" role="tablist" aria-label="Manage categories or regions">
        {(['category', 'region'] as const).map(kind => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            onClick={() => {
              setActiveKind(kind);
              setDialog(null);
              setNewName('');
              setMessage(null);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeKind === kind
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {KIND_LABEL_PLURAL[kind]}
          </button>
        ))}
      </div>

      {/* Add */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleAdd();
            }}
            placeholder={`New ${label} name`}
            disabled={!tableAvailable || busy}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!tableAvailable || busy || !newName.trim()}
            title={!tableAvailable ? 'Needs the stock_taxonomies table (migration 20251108000000)' : `Add this ${label}`}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add {label}
          </button>
        </div>
        {!tableAvailable && (
          <p className="text-xs text-gray-500 mt-2">
            Adding a standalone {label} needs the saved name list — apply
            migration 20251108000000 first. You can still create a {label} from
            an add/edit form, where it is saved on that stock right away.
          </p>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
        {entries.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-500">
            No {label.toLowerCase()}s yet — add one above, or set one on a stock.
          </p>
        )}
        {entries.map(entry => (
          <div key={entry.name} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{entry.name}</span>
                <span className="text-xs text-gray-500">
                  {entry.count} stock{entry.count === 1 ? '' : 's'}
                </span>
              </div>
              {entry.tickers.length > 0 && (
                <p className="text-xs text-gray-500 truncate" title={entry.tickers.join(', ')}>
                  {entry.tickers.join(', ')}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setDialog({ type: 'rename', name: entry.name, newName: entry.name })}
                disabled={busy}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() =>
                  setDialog({
                    type: 'merge',
                    name: entry.name,
                    target: options.find(opt => opt !== entry.name) ?? ''
                  })
                }
                disabled={busy || options.filter(opt => opt !== entry.name).length === 0}
                title={
                  options.filter(opt => opt !== entry.name).length === 0
                    ? `Add another ${label} first — there is nothing to merge into`
                    : `Move this ${label}'s stocks into another ${label}`
                }
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Merge
              </button>
              <button
                type="button"
                onClick={() => setDialog({ type: 'remove', name: entry.name })}
                disabled={busy}
                className="px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {uncategorized.length > 0 && (
          <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-gray-50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-500">No {label.toLowerCase()}</span>
                <span className="text-xs text-gray-500">
                  {uncategorized.length} stock{uncategorized.length === 1 ? '' : 's'}
                </span>
              </div>
              <p
                className="text-xs text-gray-500 truncate"
                title={uncategorized.map(stock => stock.ticker).join(', ')}
              >
                {uncategorized.map(stock => stock.ticker).join(', ')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation dialogs */}
      {dialog?.type === 'rename' && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label={`Rename ${label}`}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Rename {label}</h3>
            <p className="text-sm text-gray-600 mb-4">
              {dialogCount > 0 ? (
                <>
                  {dialogCount} stock{dialogCount === 1 ? '' : 's'} will have
                  &ldquo;{dialog.name}&rdquo; replaced with the new name (their
                  other {KIND_LABEL_PLURAL[activeKind].toLowerCase()} stay as
                  they are), and &ldquo;{dialog.name}&rdquo; will no longer
                  appear in the dropdowns or filters.
                </>
              ) : (
                <>
                  No stocks use &ldquo;{dialog.name}&rdquo; yet — only the name
                  itself will change.
                </>
              )}
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">New name</label>
            <input
              type="text"
              value={dialog.newName}
              onChange={e => setDialog({ ...dialog, newName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
            />
            {!tableAvailable && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                The saved name list isn&apos;t available yet (migration
                20251108000000 not applied) — your stocks will still be renamed,
                but the old name may keep showing in the dropdowns until then.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRename()}
                disabled={busy || !dialog.newName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.type === 'merge' && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label={`Merge ${label}`}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Merge {label}</h3>
            <p className="text-sm text-gray-600 mb-4">
              {dialogCount} stock{dialogCount === 1 ? '' : 's'} will have
              &ldquo;{dialog.name}&rdquo; replaced with the {label} you pick
              (their other {KIND_LABEL_PLURAL[activeKind].toLowerCase()} stay
              as they are). &ldquo;{dialog.name}&rdquo; will be removed and will
              no longer appear in the dropdowns or filters.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Move into</label>
            <select
              value={dialog.target}
              onChange={e => setDialog({ ...dialog, target: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 mb-4"
            >
              {options
                .filter(opt => opt !== dialog.name)
                .map(opt => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
            </select>
            {!tableAvailable && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                The saved name list isn&apos;t available yet (migration
                20251108000000 not applied) — your stocks will still move, but
                the old name may keep showing in the dropdowns until then.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMerge()}
                disabled={busy || !dialog.target || dialog.target === dialog.name}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Merging…' : `Merge ${dialogCount} stock${dialogCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.type === 'remove' && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label={`Remove ${label}`}>
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove {label}</h3>
            <p className="text-sm text-gray-600 mb-4">
              &ldquo;{dialog.name}&rdquo; will be deleted from {dialogCount} stock
              {dialogCount === 1 ? '' : 's'} (their other{' '}
              {KIND_LABEL_PLURAL[activeKind].toLowerCase()} stay as they are).
              &ldquo;{dialog.name}&rdquo; will be removed. No stocks will be
              deleted.
            </p>
            {activeKind === 'category' ? (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
                Stocks left with no category at all will show &ldquo;Needs:
                Category&rdquo; in the watchlist until a category is set on them.
              </p>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-4">
                Stocks left with no region at all will simply show no region.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRemove()}
                disabled={busy}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
