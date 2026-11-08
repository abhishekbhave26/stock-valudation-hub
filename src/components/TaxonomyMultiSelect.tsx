import React, { useMemo, useState } from 'react';

// Multi-select for one taxonomy field (categories or regions) in the
// add/edit forms: a checkbox list of the offered names plus a "create new"
// text input, in the same bordered style as the other form inputs.
//
// Selecting "Global" (regions only, via exclusiveValue) clears every other
// region, and selecting any specific region clears "Global" — Global is
// exclusive by definition. The same rule is enforced in the manager's
// merge/rename flows.
interface TaxonomyMultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  createPlaceholder: string;
  /** A value that may not coexist with any other (regions: "Global"). */
  exclusiveValue?: string;
}

export default function TaxonomyMultiSelect({
  label,
  options,
  selected,
  onChange,
  createPlaceholder,
  exclusiveValue
}: TaxonomyMultiSelectProps) {
  const [customName, setCustomName] = useState('');
  const [localAdded, setLocalAdded] = useState<string[]>([]);

  // Offered names plus anything typed in here (a name typed in this form
  // is saved on the stock, so it joins the options from the watchlist
  // onward) plus anything already selected (a legacy custom value must
  // always render checked, never vanish).
  const allOptions = useMemo(
    () =>
      [...new Set([...options, ...localAdded, ...selected])].sort((a, b) =>
        a.localeCompare(b)
      ),
    [options, localAdded, selected]
  );

  // What the selection becomes when `value` is turned ON, with the
  // exclusivity rule applied.
  const turnOn = (value: string): string[] => {
    if (exclusiveValue && value === exclusiveValue) return [exclusiveValue];
    if (exclusiveValue && selected.includes(exclusiveValue)) {
      return [...selected.filter(item => item !== exclusiveValue), value];
    }
    return [...selected, value];
  };

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(item => item !== value));
    } else {
      onChange(turnOn(value));
    }
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    // A name that already exists (any spelling) just gets selected instead
    // of duplicating the list.
    const existing = allOptions.find(opt => opt.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!selected.includes(existing)) onChange(turnOn(existing));
    } else {
      setLocalAdded(prev => [...prev, name]);
      onChange(turnOn(name));
    }
    setCustomName('');
  };

  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <div className="max-h-40 overflow-y-auto border border-gray-300 rounded focus-within:ring-2 focus-within:ring-blue-500">
        {allOptions.length === 0 && (
          <p className="px-3 py-2 text-sm text-gray-500">No {label.toLowerCase()}s yet — add one below.</p>
        )}
        {allOptions.map(option => (
          <label
            key={option}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={createPlaceholder}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customName.trim()}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          Add
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {selected.length === 0
          ? `No ${label.toLowerCase()} selected — pick one or more above.`
          : `Selected: ${selected.join(', ')}`}
      </p>
    </div>
  );
}
