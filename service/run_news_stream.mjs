import { join } from "node:path";
import { createAlpacaNewsStream } from "./alpaca_news_stream.mjs";
import { backfillAlpacaNews } from "./alpaca_news_backfill.mjs";
import { GlobalNewsJournal } from "./global_news_journal.mjs";
import { createOfficialNewsPoller } from "./official_news_pollers.mjs";
import { captureNewsShadowSignals } from "./news_shadow_capture.mjs";
import { measureNewsShadowOutcomes } from "./news_shadow_outcomes.mjs";

const databasePath = process.env.GLOBAL_NEWS_DB_PATH ?? join(import.meta.dirname, "data", "global-news.sqlite3");
const journal = new GlobalNewsJournal(databasePath);
const stream = createAlpacaNewsStream({ journal });
const pollOfficial = createOfficialNewsPoller({ journal });
let officialTimer = null;
const stop = () => { if (officialTimer) clearInterval(officialTimer); stream.stop(); journal.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const backfill = await backfillAlpacaNews(journal);
  console.log(JSON.stringify({ status: "backfill_complete", ...backfill }));
} catch (error) {
  journal.updateHealth("alpaca-benzinga-news-stream-v1", { status: "DEGRADED", lastError: error.message });
  console.error(JSON.stringify({ status: "backfill_failed", error: error.message }));
}
stream.start();
const initialOfficial = await pollOfficial();
console.log(JSON.stringify({ status: "official_poll_complete", ...initialOfficial }));
console.log(JSON.stringify({ status: "shadow_capture_complete", ...captureNewsShadowSignals(journal) }));
try { console.log(JSON.stringify({ status: "shadow_outcomes_complete", ...(await measureNewsShadowOutcomes(journal)) })); }
catch (error) { console.error(JSON.stringify({ status: "shadow_outcomes_failed", error: error.message })); }
officialTimer = setInterval(async () => {
  console.log(JSON.stringify({ status: "official_poll_complete", ...(await pollOfficial()) }));
  console.log(JSON.stringify({ status: "shadow_capture_complete", ...captureNewsShadowSignals(journal) }));
  try { console.log(JSON.stringify({ status: "shadow_outcomes_complete", ...(await measureNewsShadowOutcomes(journal)) })); }
  catch (error) { console.error(JSON.stringify({ status: "shadow_outcomes_failed", error: error.message })); }
}, 60_000);
console.log(JSON.stringify({ status: "starting", source: "alpaca-benzinga-news-stream-v1", databasePath }));
