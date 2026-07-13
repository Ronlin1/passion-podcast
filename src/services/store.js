import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { isNetlifyRuntime } from "./blobs.js";

const episodesFile = path.join(config.dataDir, "episodes.json");

function memoryEpisodes() {
  globalThis.__passionPodcastEpisodes ||= [];
  return globalThis.__passionPodcastEpisodes;
}

function setMemoryEpisodes(episodes) {
  globalThis.__passionPodcastEpisodes = episodes;
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
    return memoryEpisodes();
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
  const maxEpisodes = isNetlifyRuntime() ? 8 : 50;
  const next = [episode, ...episodes.filter((item) => item.id !== episode.id)].slice(0, maxEpisodes);
  if (isNetlifyRuntime()) {
    setMemoryEpisodes(next);
    return episode;
  }

  await fs.writeFile(episodesFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return episode;
}

export async function updateEpisodeAudio(episodeId, audio) {
  const episodes = await listEpisodes();
  const next = episodes.map((episode) =>
    episode.id === episodeId
      ? {
          ...episode,
          audioUrl: audio.audioUrl || episode.audioUrl || "",
          audioProvider: audio.provider || episode.audioProvider,
          audioBytes: audio.bytes || 0,
          audioNote: audio.skippedReason || audio.audioNote || "",
          voice: audio.voice || episode.voice,
        }
      : episode,
  );

  if (isNetlifyRuntime()) {
    setMemoryEpisodes(next);
  } else {
    await fs.writeFile(episodesFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  return next.find((episode) => episode.id === episodeId) || null;
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
    setMemoryEpisodes(next);
    return next.find((episode) => episode.id === episodeId) || null;
  }

  await fs.writeFile(episodesFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next.find((episode) => episode.id === episodeId) || null;
}
