import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getBlobStore, isNetlifyRuntime } from "./blobs.js";

const episodesFile = path.join(config.dataDir, "episodes.json");
const episodesKey = "episodes.json";

async function blobStore() {
  return getBlobStore("passion-podcast-data");
}

async function ensureStore() {
  if (isNetlifyRuntime()) return;
  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    await fs.access(episodesFile);
  } catch {
    await fs.writeFile(episodesFile, "[]\n", "utf8");
  }
}

export async function listEpisodes() {
  if (isNetlifyRuntime()) {
    const store = await blobStore();
    const episodes = await store.get(episodesKey, { type: "json" });
    return Array.isArray(episodes) ? episodes : [];
  }

  await ensureStore();
  const raw = await fs.readFile(episodesFile, "utf8");
  try {
    const episodes = JSON.parse(raw);
    return Array.isArray(episodes) ? episodes : [];
  } catch {
    return [];
  }
}

export async function saveEpisode(episode) {
  const episodes = await listEpisodes();
  const next = [episode, ...episodes.filter((item) => item.id !== episode.id)].slice(0, 50);
  if (isNetlifyRuntime()) {
    const store = await blobStore();
    await store.setJSON(episodesKey, next);
    return episode;
  }

  await fs.writeFile(episodesFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return episode;
}

export async function markEpisodeUnlocked(episodeId, payment) {
  const episodes = await listEpisodes();
  const next = episodes.map((episode) =>
    episode.id === episodeId
      ? {
          ...episode,
          premiumUnlocked: true,
          payment,
        }
      : episode,
  );
  if (isNetlifyRuntime()) {
    const store = await blobStore();
    await store.setJSON(episodesKey, next);
    return next.find((episode) => episode.id === episodeId) || null;
  }

  await fs.writeFile(episodesFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next.find((episode) => episode.id === episodeId) || null;
}
