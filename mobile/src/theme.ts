/* Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4
 * Hallmark · macrostructure: Workbench · tone: technical · theme: Terminal
 * nav: N8 compact instrument bar · footer: none (tab bar)
 * audience: creator · use: glance book + fire jobs · anchor hue: phosphor ~145
 * OKLCH source lives in DESIGN.md; RN consumes named hex tokens only.
 */

export const colors = {
  paper: "#0c1410",
  surface: "#141c18",
  elevated: "#1b2520",
  ink: "#e4eee6",
  muted: "#9aada0",
  faint: "#66756b",
  rule: "#2a3830",
  accent: "#5ee08a",
  positive: "#5ee08a",
  negative: "#e06a52",
  warning: "#e0c04a",
  accentMuted: "rgba(94, 224, 138, 0.12)",
  warningMuted: "rgba(224, 192, 74, 0.12)",
  overlay: "rgba(6, 10, 8, 0.72)",
} as const;

export const fonts = {
  sans: "IBMPlexSans_400Regular",
  sansMedium: "IBMPlexSans_500Medium",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  monoSemi: "IBMPlexMono_600SemiBold",
} as const;

export const space = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
  48: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  pill: 999,
} as const;

export const motion = {
  press: 0.97,
  dur: 140,
} as const;
