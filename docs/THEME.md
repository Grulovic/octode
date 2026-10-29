# Deep Ocean

Octode's default palette adapts Kostya Safonov's [DeepOceanTheme](https://github.com/KostyaSafonov/DeepOceanTheme).

Editor source: `themes/DeepOcean.xml`, revision `b1ba5a539b43d1aee82ba5aed28d242fa995a6b9`. The extracted colors and attribute rules are recorded in `src/editor/deepOceanSource.json`; the Monaco and terminal mappings are in `src/editor/deepOcean.ts`. The app palette follows `DeepOcean.theme.json` (background #091014, foreground #C6CCD3, accent #80CBC4, borders #1A2D34, selection #324753). The code surface follows the scheme's TEXT background #0E1D24 and foreground #CDD3DE.

PHP uses the scheme's #DCA9DC keywords, #FB9551 variables, #98D792 strings, #FF9E60 numbers, #4D6470 italic comments, #68CAFF functions and #E7D175 class identifiers. The syntax grammar adds lexical function/class tokens, without completion or a language server. Generic syntax tokens, SQL, HTML/CSS, JSON, terminal ANSI colors, selection, gutter, diff colors, and input states use the corresponding scheme colors.

JetBrains semantic categories and IDE-specific effects without an equivalent in Monaco's syntax tokens cannot be reproduced exactly; the source rules are retained for extending the mapping. This is a color adaptation, not a claim that Monaco supplies PHPStorm's semantic highlighting.

## Octopus brand assets

The octopus is a hand-traced vector recreation of the supplied reference, without
its wordmark, blueprint grid, dimensions, or annotations. Its shared geometry
preserves the domed head, ring eyes, bracket arms, and circuit nodes. The gradient
uses Deep Ocean `#68CAFF` and `#80CBC4`; the app tile uses `#14242B`, `#091014`,
and `#1A2D34`.

- `public/octode.svg`: transparent primary mark, used in the title bar,
  welcome screen, and browser favicon.
- `public/octode-mono.svg`: single-color mark using `currentColor` when inline.
- `public/octode-icon.svg`: padded dark app tile for desktop icon generation.
- `src-tauri/icons`: generated macOS ICNS, Windows ICO, PNG sizes and mobile assets.

Regenerate the SVGs with `node scripts/generate-brand.mjs`, then the platform
icons with `npm run tauri -- icon public/octode-icon.svg --output src-tauri/icons`.
Generate the touch icon with `sips -z 180 180 src-tauri/icons/icon.png --out public/octode-touch.png`.
