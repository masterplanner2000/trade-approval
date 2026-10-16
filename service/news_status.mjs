import { join } from "node:path";
import { GlobalNewsJournal } from "./global_news_journal.mjs";
import { summarizeNewsShadowOutcomes } from "./news_shadow_outcomes.mjs";

const journal = new GlobalNewsJournal(process.env.GLOBAL_NEWS_DB_PATH ?? join(import.meta.dirname, "data", "global-news.sqlite3"));
const outcomes = journal.listShadowOutcomes({ limit: 10_000 });
console.log(JSON.stringify({ ...journal.status(), recent: journal.listRecent({ limit: 10 }), shadowSignals: journal.listShadowSignals({ limit: 10 }),
  shadowOutcomeSummary: summarizeNewsShadowOutcomes(outcomes) }, null, 2));
journal.close();
