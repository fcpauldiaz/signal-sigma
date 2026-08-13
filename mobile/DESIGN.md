# Signal Sigma mobile design

Physical scene: phone in a dim room, often Wednesday around the Coolify window, glancing equity and whether orders are ready.

Color strategy: full palette for data (phosphor / loss red / live amber) on tinted near-black paper.

## Theme

Terminal (Hallmark). Macrostructure: Workbench. IBM Plex Sans + IBM Plex Mono.

## Tokens (OKLCH → hex for React Native)

- paper: oklch(12% 0.015 150) → #0c1410
- surface: oklch(16% 0.018 150) → #141c18
- elevated: oklch(20% 0.02 150) → #1b2520
- ink: oklch(92% 0.02 145) → #e4eee6
- muted: oklch(68% 0.02 145) → #9aada0
- faint: oklch(45% 0.015 145) → #66756b
- rule: oklch(28% 0.02 150) → #2a3830
- accent / positive: oklch(78% 0.18 145) → #5ee08a
- negative: oklch(65% 0.18 25) → #e06a52
- warning: oklch(78% 0.12 85) → #e0c04a

Spacing: 4pt scale. Radius 4 / 8 / pill. Motion: transform + opacity only, 140ms.

## Components

- Instrument bar: σ wordmark, paper/live switch, lock
- Overview: giant equity, ticker strip, job log, chart
- Lists: hairline rows in FlatList, not nested card grids
- Actions: mono tool-strip buttons with press scale + haptic
