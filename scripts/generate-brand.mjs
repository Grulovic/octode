import { writeFileSync } from 'node:fs';

// Hand-traced from the supplied octopus reference. All brand variants share
// this geometry; colors come from Deep Ocean (see docs/THEME.md).
const geometry = `
  <g fill="none" stroke="PAINT" stroke-width="24" stroke-linejoin="round">
    <path d="M422 453V328a172 172 0 0 1 344 0v125Z" stroke-linejoin="miter"/>
    <circle cx="525" cy="364" r="29"/>
    <circle cx="663" cy="364" r="29"/>
    <path d="M339 389h-55q-30 0-30 30v39q0 35-20 47 20 12 20 47v44q0 30 30 30h105c70 0 108-73 119-146"/>
    <path d="M849 389h55q30 0 30 30v39q0 35 20 47-20 12-20 47v44q0 30-30 30H799c-70 0-108-73-119-146"/>
    <path d="M353 449h-8q-27 0-27 29v53q0 30 30 30h41c37 0 56-40 60-81"/>
    <path d="M835 449h8q27 0 27 29v53q0 30-30 30h-41c-37 0-56-40-60-81"/>
    <path d="M566 480v17c0 38-43 107-76 169h-43q-31 0-31 31v40"/>
    <path d="M622 480v17c0 38 43 107 76 169h43q31 0 31 31v40"/>
    <path d="M416 737v27q0 23 23 23h24M772 737v27q0 23-23 23h-22" opacity=".35" stroke-width="18"/>
    <path d="M551 620l24-47v182q0 44-44 44h-68v-24h68q20 0 20-20Z" fill="PAINT" stroke="none"/>
    <path d="M637 620l-24-47v182q0 44 44 44h70v-24h-70q-20 0-20-20Z" fill="PAINT" stroke="none"/>
  </g>
  <g fill="PAINT">
    <circle cx="339" cy="389" r="21"/><circle cx="849" cy="389" r="21"/>
    <circle cx="353" cy="449" r="21"/><circle cx="835" cy="449" r="21"/>
    <circle cx="416" cy="737" r="21"/><circle cx="772" cy="737" r="21"/>
    <circle cx="463" cy="787" r="21"/><circle cx="727" cy="787" r="21"/>
  </g>`;
const gradient = `<linearGradient id="ocean" gradientUnits="userSpaceOnUse" x1="222" y1="476" x2="966" y2="476"><stop stop-color="#68CAFF"/><stop offset="1" stop-color="#80CBC4"/></linearGradient>`;
const mark = geometry.replaceAll('PAINT', 'url(#ocean)');
const svg = (body, viewBox = '194 76 800 800') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}\n</svg>\n`;
writeFileSync('public/octode.svg', svg(`<title>Octode octopus</title><defs>${gradient}</defs>${mark}`));
writeFileSync('public/octode-mono.svg', svg(`<title>Octode octopus</title>${geometry.replaceAll('PAINT', 'currentColor')}`));
writeFileSync('public/octode-icon.svg', svg(`<title>Octode app icon</title><defs>${gradient}<linearGradient id="tile" x2="0" y2="1"><stop stop-color="#14242B"/><stop offset="1" stop-color="#091014"/></linearGradient></defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#tile)"/>
  <rect x="65" y="65" width="894" height="894" rx="199" fill="none" stroke="#1A2D34" stroke-width="2"/>
  <svg x="136" y="136" width="752" height="752" viewBox="194 76 800 800">${mark}</svg>`, '0 0 1024 1024'));
