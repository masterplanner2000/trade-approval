import { createBox, createText, createTheme } from "@shopify/restyle";

export const palette = {
  canvas: "#F6F9FC",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F5F9",
  ink: "#0A2540",
  text: "#425466",
  muted: "#697386",
  border: "#E3E8EE",
  accent: "#635BFF",
  accentDark: "#4F46E5",
  accentSoft: "#EEECFF",
  success: "#087E6A",
  successSoft: "#E6F6F2",
  warning: "#9A6700",
  warningSoft: "#FFF4D6",
  danger: "#C24156",
  dangerSoft: "#FCE8EC",
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
    defaults: { color: "text", fontSize: 14, lineHeight: 20 },
    eyebrow: { color: "accent", fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
    pageTitle: { color: "ink", fontSize: 30, fontWeight: "800", letterSpacing: -1 },
    cardTitle: { color: "ink", fontSize: 40, lineHeight: 44, fontWeight: "800", letterSpacing: -1.4 },
    heading: { color: "ink", fontSize: 17, lineHeight: 22, fontWeight: "800" },
    body: { color: "text", fontSize: 13, lineHeight: 19 },
    caption: { color: "muted", fontSize: 10, lineHeight: 14 },
    button: { color: "surface", fontSize: 16, fontWeight: "800" },
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
