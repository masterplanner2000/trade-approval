import React, { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Box, AppText, palette, typeRamp } from "../design-system";

type BadgeProps = {
  label: string;
  tone?: "accent" | "success" | "warning" | "danger";
};

const badgeColors = {
  accent: { background: "accentSoft", foreground: "accentDark", dot: palette.accent },
  success: { background: "successSoft", foreground: "success", dot: palette.success },
  warning: { background: "warningSoft", foreground: "warning", dot: palette.warning },
  danger: { background: "dangerSoft", foreground: "danger", dot: palette.danger },
} as const;

export function Badge({ label, tone = "accent" }: BadgeProps) {
  const colors = badgeColors[tone];
  return (
    <Box flexDirection="row" alignItems="center" gap="xs" backgroundColor={colors.background} borderRadius="pill" paddingHorizontal="s" paddingVertical="xs">
      <Box width={6} height={6} borderRadius="pill" style={{ backgroundColor: colors.dot }} />
      <AppText color={colors.foreground} fontSize={9} fontWeight="900" letterSpacing={0.9}>{label}</AppText>
    </Box>
  );
}

type ActionButtonProps = {
  label: string;
  tone: "primary" | "secondary";
  disabled?: boolean;
  onPress: () => void;
  flex?: number;
};

export function ActionButton({ label, tone, disabled, onPress, flex = 1 }: ActionButtonProps) {
  const primary = tone === "primary";
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [{ flex, opacity: disabled ? 0.35 : pressed ? 0.72 : 1 }]}>
      <Box
        height={56}
        alignItems="center"
        justifyContent="center"
        borderRadius="m"
        borderWidth={1}
        borderColor={primary ? "accent" : "border"}
        backgroundColor={primary ? "accent" : "surface"}
      >
        <AppText color={primary ? "surface" : "ink"} {...typeRamp.label} fontWeight="800">{label}</AppText>
      </Box>
    </Pressable>
  );
}

type DisclosureProps = {
  title: string;
  hint: string;
  open: boolean;
  onPress: () => void;
  children: ReactNode;
};

export function Disclosure({ title, hint, open, onPress, children }: DisclosureProps) {
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" borderBottomWidth={StyleSheet.hairlineWidth} borderColor="border" paddingVertical="m" marginTop="s">
          <Box>
            <AppText color="ink" {...typeRamp.label} fontWeight="800">{title}</AppText>
            <AppText variant="caption" marginTop="none">{hint}</AppText>
          </Box>
          <AppText color="accent" fontSize={24} lineHeight={26}>{open ? "−" : "+"}</AppText>
        </Box>
      </Pressable>
      {open ? children : null}
    </>
  );
}
