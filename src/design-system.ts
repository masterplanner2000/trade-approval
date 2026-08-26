import { createBox, createText, createTheme } from "@shopify/restyle";

export const palette = {
  canvas: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F3F3",
  ink: "#171717",
  text: "#404040",
  muted: "#737373",
  border: "#E5E5E5",
  accent: "#171717",
  accentDark: "#171717",
  accentSoft: "#F3F3F3",
  success: "#404040",
  successSoft: "#F3F3F3",
  warning: "#525252",
  warningSoft: "#F3F3F3",
  danger: "#404040",
  dangerSoft: "#F3F3F3",
} as const;

export const radius = {
  small: 8,
  medium: 12,
  large: 18,
  pill: 999,
} as const;

export const spacing = {
  xsmall: 6,
  small: 10,
  medium: 16,
  large: 24,
} as const;

export const typeRamp = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "800" as const, letterSpacing: -0.8 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "800" as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "800" as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
} as const;

export const theme = createTheme({
  colors: {
    canvas: palette.canvas,
    surface: palette.surface,
    surfaceMuted: palette.surfaceMuted,
    ink: palette.ink,
    text: palette.text,
    muted: palette.muted,
    border: palette.border,
    accent: palette.accent,
    accentDark: palette.accentDark,
    accentSoft: palette.accentSoft,
    success: palette.success,
    successSoft: palette.successSoft,
    warning: palette.warning,
    warningSoft: palette.warningSoft,
    danger: palette.danger,
    dangerSoft: palette.dangerSoft,
    transparent: "transparent",
  },
  spacing: {
    none: 0,
    xs: spacing.xsmall,
    s: spacing.small,
    m: spacing.medium,
    l: spacing.large,
    xl: 32,
    xxl: 48,
  },
  borderRadii: {
    none: 0,
    s: radius.small,
    m: radius.medium,
    l: radius.large,
    pill: radius.pill,
  },
  breakpoints: {
    phone: 0,
    tablet: 768,
  },
  textVariants: {
    defaults: { color: "text", ...typeRamp.body },
    display: { color: "ink", ...typeRamp.display },
    title: { color: "ink", ...typeRamp.title },
    heading: { color: "ink", ...typeRamp.heading },
    body: { color: "text", ...typeRamp.body },
    label: { color: "ink", ...typeRamp.label },
    caption: { color: "muted", ...typeRamp.caption },
  },
  cardVariants: {
    defaults: {
      backgroundColor: "surface",
      borderColor: "border",
      borderWidth: 1,
      borderRadius: "l",
      padding: "l",
    },
    inset: {
      backgroundColor: "surfaceMuted",
      borderRadius: "m",
      padding: "m",
    },
    accent: {
      backgroundColor: "accentSoft",
      borderRadius: "m",
      padding: "m",
    },
    inverse: {
      backgroundColor: "ink",
      borderRadius: "m",
      padding: "m",
    },
  },
});

export type Theme = typeof theme;
export const Box = createBox<Theme>();
export const AppText = createText<Theme>();
