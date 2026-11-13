/**
 * Open a printable table in a new window; the browser's print dialog offers "Save as PDF".
 * Call `openPrintWindow` synchronously in the click handler (popup blockers), then `writeTable` once data is ready.
 */
export function openPrintWindow() {
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font-family:sans-serif;padding:24px">Preparing PDF…</p>');
  return win;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function writeTable(win: Window, { title, subtitle, headers, rows, landscape }: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  landscape?: boolean;
}) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f172a; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p { font-size: 11px; color: #475569; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  tr { break-inside: avoid; }
</style></head><body>
<h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<script>window.onload = () => setTimeout(() => window.print(), 150);</script>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
