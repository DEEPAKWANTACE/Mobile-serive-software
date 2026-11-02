import { useEffect, useRef, useState } from 'react';
import { Check, Palette, X } from 'lucide-react';
import { useTheme } from './theme-context';
import { THEMES, type ThemeMode } from './themes';

const GROUPS: readonly { mode: ThemeMode; label: string }[] = [
  { mode: 'dark', label: 'Dark themes' },
  { mode: 'light', label: 'Light themes' },
];

export function ThemePicker() {
  const { theme, setTheme, glass, setGlass } = useTheme();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="theme-trigger"
        onClick={() => setOpen(true)}
        aria-label={`Choose theme. Current theme: ${theme.name}`}
        title={`Theme: ${theme.name}`}
      >
        <Palette className="size-4" aria-hidden />
      </button>
      <dialog
        ref={dialogRef}
        className="theme-dialog"
        aria-labelledby="theme-dialog-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="theme-dialog__head">
          <div>
            <h2 id="theme-dialog-title">Choose theme</h2>
            <p>Themes by <span>Preetham Hegade</span> and <span>PSD</span></p>
          </div>
          <button
            type="button"
            className="theme-signature"
            onClick={() => {
              setTheme('steel-blue');
              setGlass(true);
            }}
          >
            Signature preset
          </button>
          <button type="button" className="theme-close" onClick={() => setOpen(false)} aria-label="Close theme picker">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={glass}
          className="glass-toggle"
          onClick={() => setGlass(!glass)}
        >
          <span><b>Glassmorphism effect</b><small>Frosted translucency and backdrop blur across every theme</small></span>
          <i className="theme-switch" aria-hidden />
        </button>

        {GROUPS.map((group) => (
          <section key={group.mode} aria-labelledby={`theme-group-${group.mode}`}>
            <h3 id={`theme-group-${group.mode}`} className="theme-group">{group.label}</h3>
            <div className="theme-grid">
              {THEMES.filter((item) => item.mode === group.mode).map((item) => {
                const selected = theme.id === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className="theme-card"
                    aria-pressed={selected}
                    aria-describedby={`theme-description-${item.id}`}
                    onClick={() => setTheme(item.id)}
                  >
                    <span className="theme-card__swatches" aria-hidden>
                      {[item.colors[0], item.colors[3], item.colors[5], item.colors[4]].map((color, index) => (
                        <i key={`${color}-${index}`} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <b>{item.name}{item.signature && <em>Signature</em>}</b>
                    <small id={`theme-description-${item.id}`}>{item.description}</small>
                    {selected && <span className="theme-card__check" aria-hidden><Check className="size-3" /></span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <p className="theme-credit">Palettes copied from the LSUV theme collection and Midnight Tunershop.</p>
      </dialog>
    </>
  );
}
