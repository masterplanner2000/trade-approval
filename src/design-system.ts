import { createBox, createText, createTheme } from "@shopify/restyle";

export type AppPalette = {
  canvas: string;
  surface: string;
  surfaceMuted: string;
  ink: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
};

export const palette: AppPalette = {
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
};

export const darkPalette: AppPalette = {
  canvas: "#0B0B0C",
  surface: "#161618",
  surfaceMuted: "#242427",
  ink: "#F7F7F8",
  text: "#D4D4D8",
  muted: "#A1A1AA",
  border: "#343438",
  accent: "#F5F5F5",
  accentDark: "#F5F5F5",
  accentSoft: "#29292D",
  success: "#86D49B",
  successSoft: "#193522",
  warning: "#F2C66D",
  warningSoft: "#352B17",
  danger: "#FF8F88",
  dangerSoft: "#3A1E1D",
};

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

const createAppTheme = (colors: AppPalette) => createTheme({
  colors: {
    canvas: colors.canvas,
    surface: colors.surface,
    surfaceMuted: colors.surfaceMuted,
    ink: colors.ink,
    text: colors.text,
    muted: colors.muted,
    border: colors.border,
    accent: colors.accent,
    accentDark: colors.accentDark,
    accentSoft: colors.accentSoft,
    success: colors.success,
    successSoft: colors.successSoft,
    warning: colors.warning,
    warningSoft: colors.warningSoft,
    danger: colors.danger,
    dangerSoft: colors.dangerSoft,
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

export const theme = createAppTheme(palette);
export const darkTheme = createAppTheme(darkPalette);

export type Theme = typeof theme;
export const Box = createBox<Theme>();
export const AppText = createText<Theme>();
