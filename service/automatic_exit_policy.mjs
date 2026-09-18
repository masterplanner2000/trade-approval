export const AUTOMATIC_EXIT_POLICY_VERSION = "paper-two-day-signal-exit-v1";
const REQUIRED_CHECKS = new Set(["history", "liquidity", "trend", "momentum", "rsi", "volatility"]);

// Conservative weekday expectation, not an exchange calendar. A holiday or
// unexpected closure produces no automatic exit when the bar date disagrees.
export function expectedPriorSessionDate(at = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(at)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const today = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if ([0, 6].includes(today.getUTCDay()) || minuteOfDay < 570 || minuteOfDay >= 960) return null;
  do today.setUTCDate(today.getUTCDate() - 1); while ([0, 6].includes(today.getUTCDay()));
  return today.toISOString().slice(0, 10).replaceAll("-", "");
}

function completeEvaluation(evaluation, signalDate) {
  if (!evaluation || evaluation.error || evaluation.signalDate !== signalDate || evaluation.eligible !== false && evaluation.eligible !== true) return false;
  if (!Array.isArray(evaluation.checks)) return false;
  const checks = new Map(evaluation.checks.map((check) => [check.id, check.passed]));
  return [...REQUIRED_CHECKS].every((id) => typeof checks.get(id) === "boolean");
}

export function evaluateAutomaticExits({ scan = {}, snapshot = {}, prior = {}, requiredFailures = 2, at = Date.now() } = {}) {
  const signalDate = expectedPriorSessionDate(at);
  if (!scan.ok || !signalDate) return { state: prior, exits: [], signalDate: null };
  const evaluations = new Map((scan.evaluations ?? []).map((item) => [item.symbol, item]));
  const observations = { ...(prior.observations ?? {}) };
  const submitted = { ...(prior.submitted ?? {}) };
  const exits = [];
  for (const position of snapshot.positions ?? []) {
    const symbol = position.symbol;
    const evaluation = evaluations.get(symbol);
    if (!completeEvaluation(evaluation, signalDate)) continue;
    const failed = evaluation.eligible === false;
    const existing = Array.isArray(observations[symbol]) ? observations[symbol] : [];
    // Distinct observed failures are not necessarily consecutive sessions.
    // The market-data record must identify the immediately preceding completed bar.
    const previousDate = evaluation.previousSignalDate;
    const consecutive = typeof previousDate === "string" && existing.at(-1) === previousDate;
    observations[symbol] = failed ? (consecutive ? [...existing, signalDate] : [signalDate]).slice(-requiredFailures) : [];
    if (failed && observations[symbol].length >= requiredFailures && submitted[symbol] !== signalDate) {
      exits.push({
        symbol,
        quantity: Math.abs(Number(position.quantity ?? 0)),
        signalDate,
        failedSignalDates: observations[symbol],
        reason: `Failed the strategy scan on ${requiredFailures} consecutive completed trading days`,
      });
    }
  }
  return {
    signalDate,
    exits,
    state: { version: AUTOMATIC_EXIT_POLICY_VERSION, requiredFailures, observations, submitted },
  };
}
