/**
 * Light-touch Rayfin look for OHIF: Fira Sans and the Rayfin orange accent on top of OHIF's own dark clinical theme.
 * OHIF's Tailwind theme reads HSL triplets from CSS variables, so overriding the variables restyles every component.
 */
const ORANGE = '21 89% 52%'; // #f26419
const ORANGE_LIGHT = '21 95% 62%';

const WEIGHTS = [400, 500, 600];

export function injectTheme() {
  if (document.getElementById('rayfin-theme')) {
    return;
  }
  const base = (window as unknown as { PUBLIC_URL?: string }).PUBLIC_URL || '/';
  const fonts = WEIGHTS.map(
    w => `@font-face{font-family:'Fira Sans';font-style:normal;font-weight:${w};font-display:swap;src:url('${base}fonts/fira-sans-latin-${w}-normal.woff2') format('woff2');}`
  ).join('\n');
  const style = document.createElement('style');
  style.id = 'rayfin-theme';
  style.textContent = `${fonts}
:root {
  --primary: ${ORANGE};
  --ring: ${ORANGE};
  --highlight: ${ORANGE_LIGHT};
}
html, body, button, input, select, textarea { font-family: 'Fira Sans', 'Inter', system-ui, sans-serif !important; }
`;
  document.head.appendChild(style);
}
