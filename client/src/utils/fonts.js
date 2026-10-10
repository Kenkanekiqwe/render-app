export const FONT_PRESETS = [
  {
    id: 'inter',
    labelKey: 'font_inter',
    stack: "'Inter', system-ui, sans-serif",
    google: 'Inter:wght@400;500;600;700',
  },
  {
    id: 'space-grotesk',
    labelKey: 'font_space',
    stack: "'Space Grotesk', system-ui, sans-serif",
    google: 'Space+Grotesk:wght@400;500;600;700',
  },
  {
    id: 'outfit',
    labelKey: 'font_outfit',
    stack: "'Outfit', system-ui, sans-serif",
    google: 'Outfit:wght@400;500;600;700',
  },
  {
    id: 'sora',
    labelKey: 'font_sora',
    stack: "'Sora', system-ui, sans-serif",
    google: 'Sora:wght@400;500;600;700',
  },
  {
    id: 'unbounded',
    labelKey: 'font_unbounded',
    stack: "'Unbounded', system-ui, sans-serif",
    google: 'Unbounded:wght@400;500;600;700',
  },
  {
    id: 'playfair',
    labelKey: 'font_playfair',
    stack: "'Playfair Display', Georgia, serif",
    google: 'Playfair+Display:wght@500;600;700',
  },
  {
    id: 'jetbrains',
    labelKey: 'font_jetbrains',
    stack: "'JetBrains Mono', ui-monospace, monospace",
    google: 'JetBrains+Mono:wght@400;500;600;700',
  },
  {
    id: 'manrope',
    labelKey: 'font_manrope',
    stack: "'Manrope', system-ui, sans-serif",
    google: 'Manrope:wght@400;500;600;700',
  },
  {
    id: 'dm-sans',
    labelKey: 'font_dm_sans',
    stack: "'DM Sans', system-ui, sans-serif",
    google: 'DM+Sans:wght@400;500;600;700',
  },
];

export function getFontPreset(id) {
  return FONT_PRESETS.find((font) => font.id === id) || FONT_PRESETS[0];
}

export function loadGoogleFont(preset) {
  const linkId = 'render-google-font';
  let link = document.getElementById(linkId);

  if (!link) {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  link.href = `https://fonts.googleapis.com/css2?family=${preset.google}&display=swap`;
}
