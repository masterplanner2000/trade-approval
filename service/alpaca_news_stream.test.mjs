import assert from "node:assert/strict";
import test from "node:test";
import { createAlpacaNewsStream } from "./alpaca_news_stream.mjs";
import { GlobalNewsJournal } from "./global_news_journal.mjs";

class FakeSocket {
  static instances = [];
  constructor() { this.listeners = new Map(); this.sent = []; FakeSocket.instances.push(this); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  send(message) { this.sent.push(JSON.parse(message)); }
  emit(name, data = {}) { this.listeners.get(name)?.(name === "message" ? { data: JSON.stringify(data) } : data); }
  close() {}
}

test("authenticates, subscribes to all news, persists and deduplicates", () => {
  FakeSocket.instances = [];
  const journal = new GlobalNewsJournal(":memory:", { clock: () => Date.parse("2026-09-24T14:00:02Z") });
  const stream = createAlpacaNewsStream({ journal, WebSocketImpl: FakeSocket, credentials: () => ({ key: "k", secret: "s" }), clock: () => Date.parse("2026-09-24T14:00:02Z") });
  stream.start(); const socket = FakeSocket.instances[0]; socket.emit("open");
  assert.deepEqual(socket.sent[0], { action: "auth", key: "k", secret: "s" });
  socket.emit("message", [{ T: "success", msg: "authenticated" }]);
  assert.deepEqual(socket.sent[1], { action: "subscribe", news: ["*"] });
  socket.emit("message", [{ T: "subscription", news: ["*"] }]);
  const item = { T: "n", id: 42, headline: "Example announces results", url: "https://www.benzinga.com/news/42", source: "Benzinga",
    created_at: "2026-09-24T14:00:00Z", updated_at: "2026-09-24T14:00:00Z", symbols: ["EXM"] };
  socket.emit("message", [item]); socket.emit("message", [item]);
  assert.equal(journal.status().eventCount, 1); assert.equal(journal.status().sources[0].status, "CONNECTED");
  stream.stop(); journal.close();
});
