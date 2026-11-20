/** Download rows as a real .xlsx workbook (bold header row). The library loads only when someone exports. */
export async function downloadXlsx(filename: string, headers: string[], rows: (string | number | null | undefined)[][], sheet = 'Report') {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = headers.map((value) => ({ value, fontWeight: 'bold' as const }));
  const body = rows.map((r) => r.map((v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? { value: v } : { value: String(v) })));
  await writeXlsxFile([{ data: [head, ...body], sheet: sheet.slice(0, 31) }]).toFile(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
