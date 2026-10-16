export class ConnectionSupervisor {
  constructor({ failureThreshold = 3, clock = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.clock = clock;
    this.state = "checking";
    this.consecutiveFailures = 0;
    this.lastCheckedAt = null;
    this.lastConnectedAt = null;
    this.lastDisconnectedAt = null;
    this.lastError = null;
  }

  success(at = this.clock()) {
    const previous = this.state;
    this.state = "connected";
    this.consecutiveFailures = 0;
    this.lastCheckedAt = at;
    this.lastConnectedAt = at;
    this.lastError = null;
    return previous !== this.state ? { from: previous, to: this.state, at } : null;
  }

  failure(error = "broker_unavailable", at = this.clock()) {
    const previous = this.state;
    this.consecutiveFailures += 1;
    this.lastCheckedAt = at;
    this.lastError = error;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "disconnected";
      if (previous !== "disconnected") this.lastDisconnectedAt = at;
    }
    return previous !== this.state ? { from: previous, to: this.state, at } : null;
  }

  snapshot() {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      lastCheckedAt: this.lastCheckedAt,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      newOrdersAllowed: this.state === "connected",
    };
  }
}
