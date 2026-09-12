import React, { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, TextInput } from "react-native";
import { AppText as Text, Box as View, type AppPalette, typeRamp } from "../design-system";
import { ActionButton } from "./ui";

type News = {
  symbol: string; status: "available" | "empty" | "partial" | "unavailable";
  retrievedAt: string | null; partial: boolean;
  articles: Array<{ id: string; headline: string; source: string; url: string; publishedAt: string; updatedAt: string }>;
};

export function StockNews({ symbol, preview, apiUrl, appToken, colors, onLinkError }: {
  symbol: string; preview: boolean; apiUrl: string; appToken: string; colors: AppPalette; onLinkError: () => void;
}) {
  const [news, setNews] = useState<News | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState(symbol);
  const [query, setQuery] = useState(symbol);
  const normalizedQuery = query.trim().toUpperCase();
  const validQuery = /^[A-Z][A-Z0-9.-]{0,14}$/.test(normalizedQuery);
  const search = () => { if (validQuery) { setSelectedSymbol(normalizedQuery); setRefresh(value => value + 1); } };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state === "active") setRefresh(value => value + 1); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setNews(null);
    if (preview) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    fetch(`${apiUrl}/research/news?symbol=${encodeURIComponent(selectedSymbol)}`, { headers: { "x-app-token": appToken }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("news_unavailable");
        const value = await response.json() as News;
        if (value.symbol !== selectedSymbol || !Array.isArray(value.articles)) throw new Error("news_invalid");
        if (active) setNews(value);
      })
      .catch(() => { if (active) setNews(null); })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    const poll = setInterval(() => { if (AppState.currentState !== "background") setRefresh(value => value + 1); }, 60_000);
    return () => { active = false; clearTimeout(timeout); clearInterval(poll); controller.abort(); };
  }, [selectedSymbol, preview, apiUrl, appToken, refresh]);

  const body = { color: colors.text, ...typeRamp.body };
  const muted = { color: colors.muted, ...typeRamp.body };
  if (preview) return <Text style={muted}>Preview mode · External news is not loaded. Turn off Preview Mode to read sourced stock headlines.</Text>;
  return <View style={{ gap: 16 }}>
    <Text style={{ color: colors.ink, ...typeRamp.heading }}>{selectedSymbol} · Recent headlines</Text>
    <View style={{ gap: 8 }}>
      <Text style={muted}>Search another stock symbol</Text>
      <TextInput accessibilityLabel="Stock symbol for news" value={query} onChangeText={setQuery} autoCapitalize="characters"
        autoCorrect={false} maxLength={15} returnKeyType="search" onSubmitEditing={search}
        style={{ color: colors.ink, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, ...typeRamp.body }} />
      <ActionButton label="Find news" tone="secondary" disabled={!validQuery} onPress={search} />
    </View>
    <Text style={muted}>Benzinga via Alpaca · Past 7 days. Feed delay is not verified. Headlines provide context and do not determine this trade.</Text>
    {loading ? <View accessibilityLiveRegion="polite" style={{ gap: 8 }}><ActivityIndicator color={colors.ink} /><Text style={muted}>Loading news…</Text></View>
      : !news ? <Text accessibilityRole="alert" style={body}>News is unavailable. Check your connection and try again.</Text>
      : <>
        <Text style={muted}>Checked {new Date(news.retrievedAt!).toLocaleString()}</Text>
        {news.partial && <Text style={muted}>Coverage is partial. This is a selection of recent articles, not a complete news feed.</Text>}
        {news.articles.length === 0 && <Text accessibilityLiveRegion="polite" style={body}>{news.partial ? "No displayable headlines were returned in this partial result." : "No matching headlines were returned for the past 7 days."}</Text>}
        {news.articles.map(article => <Pressable key={article.id} accessibilityRole="link"
          accessibilityLabel={`${article.headline}. ${article.source}. Opens original article in your browser.`}
          onPress={() => {
            try {
              const url = new URL(article.url);
              if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "benzinga.com" || url.hostname.endsWith(".benzinga.com"))) throw new Error("invalid_link");
              void Linking.openURL(url.href).catch(onLinkError);
            } catch { onLinkError(); }
          }}
          style={({ pressed }) => ({ paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.border, opacity: pressed ? 0.65 : 1, gap: 8 })}>
          <Text style={{ color: colors.ink, ...typeRamp.heading }}>{article.headline}</Text>
          <Text style={muted}>{article.source} · Published {new Date(article.publishedAt).toLocaleString()}</Text>
          {article.updatedAt !== article.publishedAt && <Text style={muted}>Updated {new Date(article.updatedAt).toLocaleString()}</Text>}
          <Text style={{ color: colors.ink, ...typeRamp.body, textDecorationLine: "underline" }}>Read original article ↗</Text>
        </Pressable>)}
      </>}
    <ActionButton label="Refresh news" tone="secondary" disabled={loading} onPress={() => setRefresh(value => value + 1)} />
  </View>;
}
