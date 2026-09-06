import React, { ReactNode, useEffect } from "react";
import { useTheme } from "@shopify/restyle";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { CheckCircleIcon, InfoIcon, MinusIcon, PlusIcon, WarningCircleIcon, XIcon } from "phosphor-react-native";
import { Box, AppText, type Theme, typeRamp } from "../design-system";

type BadgeProps = {
  label: string;
  tone?: "accent" | "success" | "warning" | "danger";
};

const badgeColors = {
  accent: { background: "accentSoft", foreground: "accentDark", dot: "accent" },
  success: { background: "successSoft", foreground: "success", dot: "success" },
  warning: { background: "warningSoft", foreground: "warning", dot: "warning" },
  danger: { background: "dangerSoft", foreground: "danger", dot: "danger" },
} as const;

export function Badge({ label, tone = "accent" }: BadgeProps) {
  const theme = useTheme<Theme>();
  const colors = badgeColors[tone];
  return (
    <Box flexDirection="row" alignItems="center" gap="xs" backgroundColor={colors.background} borderRadius="pill" paddingHorizontal="s" paddingVertical="xs">
      <Box width={6} height={6} borderRadius="pill" style={{ backgroundColor: theme.colors[colors.dot] }} />
      <AppText color={colors.foreground} fontSize={9} fontWeight="900" letterSpacing={0.9}>{label}</AppText>
    </Box>
  );
}

type ActionButtonProps = {
  label: string;
  tone: "primary" | "secondary";
  disabled?: boolean;
  pending?: boolean;
  onPress: () => void;
};

export function ActionButton({ label, tone, disabled, pending = false, onPress }: ActionButtonProps) {
  const theme = useTheme<Theme>();
  const primary = tone === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: pending }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, opacity: disabled && !pending ? 0.35 : pressed ? 0.72 : 1 }]}
    >
      <Box
        height={56}
        flexDirection="row"
        gap="xs"
        alignItems="center"
        justifyContent="center"
        borderRadius="pill"
        borderWidth={1}
        borderColor={primary ? "actionApprove" : "actionDeny"}
        backgroundColor={primary ? "actionApprove" : "surface"}
      >
        {pending ? <ActivityIndicator size="small" color={primary ? theme.colors.actionApproveText : theme.colors.actionDeny} /> : null}
        <AppText color={primary ? "actionApproveText" : "actionDeny"} {...typeRamp.label} fontSize={16} lineHeight={22} fontWeight="400">{label}</AppText>
      </Box>
    </Pressable>
  );
}

type ToastProps = {
  title: string;
  message?: string;
  tone?: "info" | "success" | "danger";
  loading?: boolean;
  onDismiss: () => void;
  duration?: number;
};

export function Toast({ title, message, tone = "info", loading = false, onDismiss, duration = 5500 }: ToastProps) {
  const theme = useTheme<Theme>();
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss, title, message]);

  const background = "ink";
  const foreground = tone === "success" ? theme.colors.success : tone === "danger" ? theme.colors.danger : theme.colors.surface;
  const Icon = tone === "success" ? CheckCircleIcon : tone === "danger" ? WarningCircleIcon : InfoIcon;

  return (
    <Box
      flexDirection="row"
      alignItems="flex-start"
      gap="s"
      backgroundColor={background}
      borderColor="ink"
      borderWidth={1}
      borderRadius="l"
      padding="m"
      style={styles.toast}
    >
      {loading
        ? <ActivityIndicator size="small" color={theme.colors.surface} />
        : <Icon size={22} color={foreground} weight="fill" />}
      <Box flex={1}>
        <AppText color="surface" {...typeRamp.label} fontWeight="400">{title}</AppText>
        {message ? <AppText color="surface" {...typeRamp.caption} marginTop="xs" style={styles.toastMessageDark}>{message}</AppText> : null}
      </Box>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={10} onPress={onDismiss}>
        <XIcon size={18} color="#A3A3A3" weight="regular" />
      </Pressable>
    </Box>
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
  const theme = useTheme<Theme>();
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onPress}>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" borderBottomWidth={StyleSheet.hairlineWidth} borderColor="border" paddingVertical="m" marginTop="s">
          <Box>
            <AppText color="ink" {...typeRamp.label} fontWeight="800">{title}</AppText>
            <AppText variant="caption" marginTop="none">{hint}</AppText>
          </Box>
          {open
            ? <MinusIcon size={22} color={theme.colors.accent} weight="regular" />
            : <PlusIcon size={22} color={theme.colors.accent} weight="regular" />}
        </Box>
      </Pressable>
      {open ? children : null}
    </>
  );
}

const styles = StyleSheet.create({
  toast: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },
  toastMessageDark: { opacity: 0.78 },
});
