# Brand — Peguei

Single source of truth for visual identity and voice. Code should reference `src/theme/colors.ts` and `src/theme/typography.ts` rather than hardcoding hex values or font sizes — if you're about to write a new color literal in a screen, it belongs here first.

## Palette

Derived from the app icon (fishhook + camera shutter): petroleum teal as the dominant hue, aqua/water-blue as a secondary, warm orange as the accent. All pairs below were checked for WCAG AA contrast (4.5:1 for body text, 3:1 for large text/icons) against their intended background.

| Token | Hex | Use |
|---|---|---|
| `primary` | `#0B4F4F` | Brand color: headers, primary icons/buttons on light backgrounds |
| `primaryLight` | `#3FA79A` | Primary tint for use on dark backgrounds (camera preview, dark surfaces) — `#0B4F4F` itself is too low-contrast against near-black |
| `secondary` | `#1C7EA6` | Secondary actions, links, "water blue" accents |
| `accent` | `#F5A623` | Primary CTA color, active/selected states, highlights |
| `accentAlt` | `#FFD166` | Secondary highlight (rare use — e.g. a tip banner), kept visually distinct from `error` |
| `success` | `#2FBF71` | Confirmations, "buffer active" indicator, save-confirmed flash |
| `error` | `#E5484D` | Error banners, record button idle state (record-red), destructive actions |
| `backgroundLight` | `#F5F7F7` | Light-mode screen background |
| `surfaceLight` | `#FFFFFF` | Light-mode cards/sheets |
| `textLight` | `#0B1F1F` | Light-mode body text |
| `backgroundDark` | `#0A1414` | Dark-mode / camera-adjacent screen background |
| `surfaceDark` | `#14201F` | Dark-mode cards/sheets (Settings rows, Gallery list items) |
| `textDark` | `#F2F5F5` | Dark-mode body text |

**Dark mode scope note:** the app already reads as dark-themed on every screen (camera preview is inherently black; Settings/Gallery/Permissions already used near-black backgrounds before this pass). This pass consolidates all of those into the tokens above and applies them consistently, but does **not** add a runtime light/dark switcher (`useColorScheme` + theme provider) — no screen currently opts into light mode, and building that switcher is a separate scope increase from "define and consistently apply a palette that includes light-mode values for later." The light tokens exist and are ready for that future work. See `DECISIONS.md`.

## Typography

**Typeface: Inter** (SIL Open Font License, free/no licensing cost) for both headings and body text.

**Implementation status:** this pass defines the type scale below and applies it via `src/theme/typography.ts`, but renders on the OS system font (San Francisco / Roboto) rather than bundling actual Inter `.ttf` files — the project has no existing custom-font pipeline (no `assets/fonts/`, no `Info.plist` `UIAppFonts` entry, no Android font asset wiring), and standing that up is a separate, self-contained piece of native work. Swapping in real Inter later only requires: dropping the `.ttf` files into `assets/fonts/` (Android picks them up automatically) + adding an `Info.plist` `UIAppFonts` array entry and an Xcode resource reference (iOS) + setting `fontFamily: 'Inter'` in `src/theme/typography.ts`. See `DECISIONS.md`.

| Token | Size | Weight | Use |
|---|---|---|---|
| `display` | 28 | 700 | Onboarding headlines |
| `title` | 20 | 700 | Screen titles, section headers |
| `body` | 15 | 400 | Default body text |
| `bodyStrong` | 15 | 700 | Emphasized body text |
| `caption` | 12 | 500 | Secondary/meta text (timestamps, hints) |

## Tone of voice

Direto, informal-mas-competente. Uma pitada de vocabulário de pesca onde encaixa naturalmente ("Boa pescaria!" em vez de "Sucesso!", "fisgou" como sinônimo informal de "salvou"), mas sem travar o app para quem usa em outro esporte ao ar livre — nunca usar jargão de pesca em um lugar onde a alternativa neutra ("Salvo!", "Tudo certo") comunicaria a mesma coisa com mais clareza pra esse público. Regras práticas:

- Erros e instruções técnicas (permissões, armazenamento cheio, câmera ocupada): sempre neutro e claro, zero jargão — não é hora de ser espirituoso.
- Confirmações de sucesso (clipe salvo, onboarding, telas de boas-vindas): espaço natural pra uma pitada de vocabulário de pesca.
- Nunca usar gírias regionais que só fazem sentido pra pesca esportiva de água doce/salgada especificamente — manter genérico o suficiente pra "esportes ao ar livre" em geral.

## Applying this

Every screen (`CameraScreen`, `SettingsScreen`, `PermissionsScreen`, `GalleryScreen`, onboarding) and shared component (`RecordButton`, `BufferIndicator`, `ClipThumbnail`) pulls colors from `src/theme/colors.ts` — no new hardcoded hex values outside that file and `BRAND.md`.
