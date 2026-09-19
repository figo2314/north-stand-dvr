# Design System

## Direction

North Stand is a cinematic matchday console that becomes a bright, quiet
library at breakfast. Full-bleed Arsenal photography carries the emotional
side of the product; navigation, status, and media controls use the precision
of a professional broadcast tool.

The two reference qualities are Apple's image-led restraint and Linear's
operational precision. The product should feel composed, protective, and
personal rather than like a sports news portal.

## Color

- Canvas: `oklch(0.982 0.004 25)`
- Surface: `oklch(1 0 0)`
- Surface muted: `oklch(0.952 0.008 25)`
- Ink: `oklch(0.205 0.022 260)`
- Ink muted: `oklch(0.45 0.025 260)`
- Night rail: `oklch(0.15 0.035 258)`
- Night raised: `oklch(0.245 0.045 258)`
- Night ink: `oklch(0.94 0.012 255)`
- North Stand red: `oklch(0.53 0.205 27)`
- Deep red: `oklch(0.43 0.17 27)`
- Recording amber: `oklch(0.79 0.14 78)`
- Success green: `oklch(0.59 0.13 153)`
- Danger red: `oklch(0.57 0.2 27)`

Red is a signal, not decoration. It identifies the primary action, active
navigation, live state, and the North Stand mark. Amber means recording.
Green means ready or healthy. Every semantic color is paired with an icon or
text label.

## Typography

Use one system sans throughout. Chinese text prefers the platform Chinese
sans; Latin fallbacks prefer Segoe UI. Product headings use fixed rem sizes,
not viewport-scaled display type.

- Page title: `2.15rem / 1.08`
- Section title: `1rem / 1.3`
- Card title: `0.9-1.05rem / 1.3`
- Body: `0.86-0.92rem / 1.55`
- Metadata: `0.68-0.76rem / 1.4`

Display letter spacing stays at or above `-0.03em`. Long prose stays under
75 characters per line. Headings use balanced wrapping; prose uses pretty
wrapping.

## Layout

- Main app desktop: fixed `228px` night rail plus a flexible workspace.
- Media apps: a `68px` sticky night header with centered navigation and a
  right-side source health pill.
- Desktop content width: up to `1450px`, with `42-60px` horizontal padding.
- Tablet: collapse navigation into the mobile header before content becomes
  cramped.
- Mobile: one column, content padding `16-20px`, bottom navigation kept above
  the safe area.
- The Home background image remains the primary atmospheric surface. Controls
  sit over it in a lower control deck and retain enough image space above.

## Navigation

- Use the same nouns everywhere: `看球`, `比赛雷达`, `足球直播`,
  `电视直播`, `录制日程`, `运行日志`, `遮罩与设置`.
- Desktop navigation uses a dark rail; media pages use a dark sticky header.
- Active navigation uses a solid North Stand red surface.
- Mobile navigation uses five items with a red top indicator on the active
  item.

## Components

- Primary button: solid red, white text, 10px radius, 44px minimum height.
- Secondary button: white surface, one neutral border, 10px radius.
- Status pill: icon plus label, 999px radius, solid tinted background.
- Media surface: 13-14px radius, one border, no paired wide decorative shadow.
- Recording row: real thumbnail, spoiler-safe metadata, and one aligned action
  dock.
- Live/recording player: one control row containing restart, play, forward,
  time, mask, volume, picture-in-picture, cast, and fullscreen when supported.
- Empty state: icon, plain explanation, one recovery action.

## Depth

Use surface color and borders before shadows. Standard elevation is a single
subtle 1-2px shadow. Dialogs may use one larger shadow because they truly
float above the application. Avoid translucent card stacks and decorative
glass effects.

## Motion

- State transitions: `150-220ms` with `cubic-bezier(0.22, 1, 0.36, 1)`.
- Hover movement: at most 2px, with no bounce or elastic easing.
- Progress bars animate transform, not width.
- Home background photography may crossfade slowly.
- All nonessential motion is removed under `prefers-reduced-motion`.

## Responsive Behavior

- Touch targets are at least `44px` where the control can accommodate it.
- Headers and bottom navigation respect safe-area insets.
- No horizontal scrolling at `320px`, `768px`, `1024px`, or `1440px`.
- Long match titles wrap; controls align to a stable grid and never cover
  navigation.
- Player controls compress by reducing gaps before hiding functional actions.

## Do And Don't

- Do preserve the Arsenal background imagery on Home.
- Do keep result data hidden until explicitly revealed.
- Do use one action dock per recording card.
- Do use icons from Lucide with an accessible label.
- Don't turn Home into a wall of unrelated cards.
- Don't use gradients as text or decoration.
- Don't animate layout widths or heights.
- Don't introduce a second visual language for settings, logs, or media pages.
