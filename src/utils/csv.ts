type CsvValue = string | number | boolean | null | undefined;
type CsvRow = Record<string, CsvValue>;

const escapeCsvValue = (value: CsvValue) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

export const buildCsvContent = (rows: CsvRow[], headers?: string[]) => {
  if (rows.length === 0) return '';
  const resolvedHeaders = headers ?? Object.keys(rows[0]);
  const headerLine = resolvedHeaders.map(escapeCsvValue).join(',');
  const lines = rows.map(row =>
    resolvedHeaders.map(header => escapeCsvValue(row[header])).join(',')
  );
  return [headerLine, ...lines].join('\n');
};

export const downloadCsv = (filename: string, rows: CsvRow[], headers?: string[]) => {
  if (rows.length === 0) return;
  const csvContent = buildCsvContent(rows, headers);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
