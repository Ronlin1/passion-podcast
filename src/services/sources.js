import { XMLParser } from "fast-xml-parser";
import { config } from "../config.js";
import { fetchJson, fetchText } from "../lib/fetch.js";
import { clamp, cleanText } from "../lib/text.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

function sourceAge(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "fresh";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function heatFrom(index, base = 88) {
  return clamp(base - index * 4 + Math.round(Math.random() * 5), 62, 99);
}

async function gatherNews(topic, limit) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", topic);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const xml = await fetchText(url, {}, config.sourceFetchTimeoutMs);
  const feed = parser.parse(xml);
  const items = feed?.rss?.channel?.item;
  const normalized = Array.isArray(items) ? items : items ? [items] : [];

  return normalized.slice(0, limit).map((item, index) => ({
    id: `news-${index}-${item.guid || item.link}`,
    type: "News",
    title: cleanText(item.title),
    detail: cleanText(item.description || "Fresh news signal from Google News."),
    url: item.link,
    age: sourceAge(item.pubDate),
    heat: heatFrom(index, 94),
    publishedAt: item.pubDate || null,
  }));
}

async function gatherReddit(topic, limit) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", topic);
  url.searchParams.set("sort", "new");
  url.searchParams.set("t", "day");
  url.searchParams.set("limit", String(limit));

  const json = await fetchJson(
    url,
    {
      headers: {
        "User-Agent": config.redditUserAgent,
        Accept: "application/json",
      },
    },
    config.sourceFetchTimeoutMs,
  );

  return (json?.data?.children || []).slice(0, limit).map((child, index) => {
    const data = child.data || {};
    return {
      id: `reddit-${data.id || index}`,
      type: "Reddit",
      title: cleanText(data.title),
      detail: cleanText(data.selftext || `${data.num_comments || 0} comments in r/${data.subreddit}`),
      url: data.permalink ? `https://www.reddit.com${data.permalink}` : "https://www.reddit.com/search/",
      age: sourceAge((data.created_utc || 0) * 1000),
      heat: clamp(72 + Math.round((data.score || 0) / 4) + index, 60, 98),
      publishedAt: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
    };
  });
}

async function gatherForums(topic, limit) {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", topic);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(limit));

  const json = await fetchJson(url, {}, config.sourceFetchTimeoutMs);
  return (json?.hits || []).slice(0, limit).map((hit, index) => ({
    id: `forum-${hit.objectID || index}`,
    type: "Forums",
    title: cleanText(hit.title || hit.story_title || "Forum discussion"),
    detail: cleanText(`${hit.points || 0} points, ${hit.num_comments || 0} comments`),
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    age: sourceAge(hit.created_at),
    heat: clamp(70 + Math.round((hit.points || 0) / 8), 58, 96),
    publishedAt: hit.created_at || null,
  }));
}

const gatherers = {
  News: gatherNews,
  Reddit: gatherReddit,
  Forums: gatherForums,
};

export async function gatherSources(topic, selectedSources = ["News", "Reddit", "Forums"], limitPerSource = 4) {
  const uniqueSources = [...new Set(selectedSources)].filter((source) => gatherers[source]);
  const settled = await Promise.allSettled(
    uniqueSources.map(async (source) => ({
      source,
      items: await gatherers[source](topic, limitPerSource),
    })),
  );

  const items = [];
  const errors = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
    } else {
      errors.push(result.reason?.message || "Source failed");
    }
  }

  return {
    items: items
      .filter((item) => item.title)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 12),
    errors,
  };
}

export function fallbackSources(topic) {
  return ["News", "Reddit", "Forums"].flatMap((type, index) => [
    {
      id: `${type.toLowerCase()}-fallback-${index}`,
      type,
      title: `${topic} signal ${index + 1}`,
      detail: "Fallback source placeholder used because live source fetching returned no rows.",
      url: "",
      age: "fresh",
      heat: 72 - index,
      publishedAt: null,
    },
  ]);
}
