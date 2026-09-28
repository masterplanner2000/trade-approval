const SOURCE_KEY = "alpaca-benzinga-news-stream-v1";
const STREAM_URL = "wss://stream.data.alpaca.markets/v1beta1/news";

function clean(value, maximum = 1_000) { return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : ""; }

export function normalizeAlpacaNewsMessage(message, observedAt) {
  if (!message || message.T !== "n") throw new Error("alpaca_news_message_invalid");
  return {
    provider: "Alpaca", publisher: clean(message.source, 120) || "Benzinga", sourceTier: "LICENSED_WIRE",
    sourceRecordId: String(message.id ?? ""), headline: clean(message.headline), url: message.url,
    publishedAt: message.created_at, updatedAt: message.updated_at ?? message.created_at,
    firstSeenAt: observedAt, originalLanguage: "en", symbols: Array.isArray(message.symbols) ? message.symbols : [],
    verificationState: "DISCOVERED",
  };
}

export function createAlpacaNewsStream({ journal, WebSocketImpl = WebSocket, credentials = () => ({ key: process.env.APCA_API_KEY_ID, secret: process.env.APCA_API_SECRET_KEY }),
  clock = () => Date.now(), schedule = setTimeout, cancel = clearTimeout, baseReconnectMs = 1_000, maximumReconnectMs = 60_000 } = {}) {
  if (!journal) throw new Error("alpaca_news_journal_required");
  journal.registerSource({ sourceKey: SOURCE_KEY, provider: "Alpaca", publisher: "Benzinga", sourceTier: "LICENSED_WIRE", version: "v1beta1",
    configuration: { transport: "websocket", subscription: "all", contentStored: false, researchOnly: true } });
  let socket = null, timer = null, stopped = true, reconnectCount = 0;

  const connect = () => {
    const { key, secret } = credentials();
    if (!key || !secret) { journal.updateHealth(SOURCE_KEY, { status: "UNAVAILABLE", lastError: "credentials_missing", reconnectCount }); return; }
    journal.updateHealth(SOURCE_KEY, { status: reconnectCount ? "RECONNECTING" : "CONNECTING", reconnectCount });
    socket = new WebSocketImpl(STREAM_URL);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ action: "auth", key, secret })));
    socket.addEventListener("message", event => {
      let messages;
      try { messages = JSON.parse(String(event.data)); } catch { journal.updateHealth(SOURCE_KEY, { status: "DEGRADED", lastError: "invalid_json", reconnectCount }); return; }
      for (const message of Array.isArray(messages) ? messages : [messages]) {
        if (message.T === "success" && message.msg === "authenticated") socket.send(JSON.stringify({ action: "subscribe", news: ["*"] }));
        else if (message.T === "subscription") journal.updateHealth(SOURCE_KEY, { status: "CONNECTED", connectedAt: clock(), reconnectCount });
        else if (message.T === "n") {
          const observedAt = new Date(clock()).toISOString();
          try { journal.append(normalizeAlpacaNewsMessage(message, observedAt), observedAt); journal.updateHealth(SOURCE_KEY, { status: "CONNECTED", lastMessageAt: clock(), reconnectCount }); }
          catch { journal.updateHealth(SOURCE_KEY, { status: "DEGRADED", lastError: "message_rejected", reconnectCount }); }
        } else if (message.T === "error") journal.updateHealth(SOURCE_KEY, { status: "DEGRADED", lastError: `provider_${message.code ?? "error"}`, reconnectCount });
      }
    });
    const disconnected = () => {
      if (stopped || timer) return;
      reconnectCount++;
      journal.updateHealth(SOURCE_KEY, { status: "RECONNECTING", lastError: "stream_disconnected", reconnectCount });
      const delay = Math.min(maximumReconnectMs, baseReconnectMs * (2 ** Math.min(reconnectCount - 1, 6)));
      timer = schedule(() => { timer = null; if (!stopped) connect(); }, delay);
    };
    socket.addEventListener("close", disconnected);
    socket.addEventListener("error", disconnected);
  };
  return {
    start() { if (!stopped) return; stopped = false; connect(); },
    stop() { stopped = true; if (timer) cancel(timer); timer = null; try { socket?.close(); } catch {} journal.updateHealth(SOURCE_KEY, { status: "STOPPED", reconnectCount }); },
  };
}

export { SOURCE_KEY as ALPACA_NEWS_SOURCE_KEY };
