import { config } from "../../src/config.js";
import { titleCase } from "../../src/lib/text.js";
import { synthesizeEpisodeAudio } from "../../src/services/elevenlabs.js";
import { generateEpisodeDraft } from "../../src/services/gemini.js";
import { insertEpisodeIntoSnowflake } from "../../src/services/snowflake.js";
import { fallbackSources, gatherSources } from "../../src/services/sources.js";
import { saveEpisode } from "../../src/services/store.js";

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    return {};
  }
}

export async function handler(event) {
  const startedAt = Date.now();
  const body = parseBody(event);
  if (!body.episodeId || !body.topic) {
    console.warn("Episode background generation skipped: invalid payload");
    return;
  }

  const selectedSources = Array.isArray(body.selectedSources) && body.selectedSources.length
    ? body.selectedSources
    : ["News", "Reddit", "Forums"];
  const premiumPriceSol = Number(body.premiumPriceSol || 0);

  try {
    const gathered = await gatherSources(body.topic, selectedSources, 4);
    const sourceRows = gathered.items.length ? gathered.items : fallbackSources(titleCase(body.topic));
    const sourceMode = gathered.items.length ? "live" : "fallback";
    const draft = await generateEpisodeDraft({
      topic: body.topic,
      sources: sourceRows,
      deliveryTime: body.deliveryTime || "07:30",
      premiumPriceSol,
    });

    let audio;
    try {
      audio = await synthesizeEpisodeAudio({
        episodeId: body.episodeId,
        script: draft.script,
        voiceId: body.voiceId || "studio",
      });
    } catch (error) {
      audio = {
        audioUrl: "",
        provider: "browser-speech-fallback",
        bytes: 0,
        voice: error.details?.voice || config.elevenLabs.voices[0],
        skippedReason:
          error.statusCode === 402
            ? "ElevenLabs rejected this voice for the current plan. Choose another voice or use a paid voice-enabled plan."
            : error.message,
      };
    }

    const episode = {
      id: body.episodeId,
      topic: body.topic,
      displayTopic: titleCase(body.topic),
      title: draft.title,
      summary: draft.summary,
      createdAt: body.createdAt || new Date().toISOString(),
      deliveryTime: body.deliveryTime || "07:30",
      duration: "05:00",
      runtimeSeconds: draft.runtimeSeconds,
      freshnessScore: draft.freshnessScore,
      premiumPriceSol,
      voice: audio.voice,
      sourceMode,
      sourceErrors: gathered.errors,
      sources: sourceRows,
      sourceInsights: draft.sourceInsights,
      script: draft.script,
      premium: draft.premium,
      audioUrl: audio.audioUrl,
      audioProvider: audio.provider,
      audioBytes: audio.bytes || 0,
      audioNote: audio.skippedReason || "",
      premiumUnlocked: false,
      listens: 0,
      generationMs: Date.now() - startedAt,
    };

    await saveEpisode(episode);
    await insertEpisodeIntoSnowflake(episode).catch((error) => {
      console.warn(`Snowflake insert skipped: ${error.message}`);
    });
  } catch (error) {
    await saveEpisode({
      id: body.episodeId,
      topic: body.topic,
      displayTopic: titleCase(body.topic),
      title: `Could not generate ${titleCase(body.topic)}`,
      summary: error.message,
      createdAt: body.createdAt || new Date().toISOString(),
      deliveryTime: body.deliveryTime || "07:30",
      duration: "00:00",
      runtimeSeconds: 0,
      freshnessScore: 0,
      premiumPriceSol,
      voice: config.elevenLabs.voices[0],
      sourceMode: "error",
      sourceErrors: [error.message],
      sources: [],
      sourceInsights: [],
      script: [],
      premium: [],
      audioUrl: "",
      audioProvider: "error",
      audioBytes: 0,
      audioNote: error.message,
      premiumUnlocked: false,
      listens: 0,
      generationMs: Date.now() - startedAt,
    });
  }
}
