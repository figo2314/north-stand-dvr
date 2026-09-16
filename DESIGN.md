# Design System

## Direction

A quiet overnight recording console that opens into a bright morning library. The visual split mirrors the use case: a deep navy rail belongs to the machine working at night; the main surface is for a person scanning quickly in daylight.

## Color

- Canvas: `oklch(0.982 0.004 25)`
- Surface: `oklch(1 0 0)`
- Surface muted: `oklch(0.952 0.008 25)`
- Ink: `oklch(0.205 0.022 260)`
- Ink muted: `oklch(0.45 0.025 260)`
- Night rail: `oklch(0.205 0.04 258)`
- Night rail ink: `oklch(0.94 0.012 255)`
- Arsenal-inspired red: `oklch(0.53 0.205 27)`
- Recording amber: `oklch(0.79 0.14 78)`
- Success green: `oklch(0.59 0.13 153)`
- Danger red: `oklch(0.57 0.2 27)`

Red is reserved for primary action, active navigation, and the north-stand mark. Amber communicates recording state. Semantic colors are always paired with text or icons.

## Typography

One system sans across the product. Chinese text uses the user's platform Chinese sans; Latin fallbacks prefer Segoe UI. Display sizes are fixed rem values, not viewport fluid. Body copy stays under 75 characters per line.

## Layout

- Desktop: fixed 228px navigation rail plus a flexible workspace.
- Main workspace: recordings lead; recording health sits in a 312px support column.
- Tablet: rail collapses to a top bar and the support column moves below the library.
- Mobile: one column with recording controls kept above secondary health information.

Cards are restricted to individual recordings and operational panels. Lists stay attached to the page surface.

## Components

- Primary button: solid brand red, white text, 10px radius.
- Secondary button: white surface, one solid neutral border.
- Status chip: icon plus label, 999px radius.
- Fixture row: compact timeline marker, teams, kickoff, schedule status.
- Recording tile: real video still with a censored metadata band; no score in accessible text.
- Player shield: configurable rectangular mask with adjustable position and dimensions.
- Dialog: native dialog element, 14px radius, maximum 640px.

## Motion

Transitions are 160-220ms with an ease-out curve. Recording status may pulse once per cycle. All nonessential motion is removed under `prefers-reduced-motion`.
