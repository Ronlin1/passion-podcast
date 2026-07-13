import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { nanoid } from "nanoid";
import { config, serviceStatus } from "./config.js";
import { AppError, toPublicError } from "./lib/errors.js";
import { slugify, titleCase } from "./lib/text.js";
import { resolveVoice, synthesizeEpisodeAudio } from "./services/elevenlabs.js";
import { generateEpisodeDraft, suggestTopics } from "./services/gemini.js";
import { gatherSources, fallbackSources } from "./services/sources.js";
import { listEpisodes, markEpisodeUnlocked, saveEpisode } from "./services/store.js";
import { initSnowflake, insertEpisodeIntoSnowflake, snowflakeEnabled } from "./services/snowflake.js";
import { solanaClientConfig, verifySolanaPayment } from "./services/solana.js";
import { getBlobStore, isNetlifyRuntime } from "./services/blobs.js";

export const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(config.publicDir));

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function queueAudioRender(req, episode) {
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host");
  if (!host) return;

  const url = `${protocol}://${host}/.netlify/functions/render-audio-background`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      episodeId: episode.id,
      script: episode.script,
      voiceId: episode.voice?.id || "studio",
    }),
  }).catch((error) => {
    console.warn(`Audio background queue failed: ${error.message}`);
  });
}

async function queueEpisodeGeneration(req, payload) {
  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host");
  if (!host) return;

  const url = `${protocol}://${host}/.netlify/functions/generate-episode-background`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.warn(`Episode background queue failed: ${error.message}`);
  });
}

app.get("/vendor/solana-web3.js", async (_req, res) => {
  const filePath = path.join(config.appRoot, "node_modules", "@solana", "web3.js", "lib", "index.iife.min.js");
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch {
    res.status(404).type("text/plain").send("Install dependencies with npm install first.");
  }
});

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    services: serviceStatus(),
    geminiModel: config.gemini.model,
    elevenLabsModel: config.elevenLabs.modelId,
    voices: config.elevenLabs.voices.map(({ id, label, gender }) => ({ id, label, gender })),
    snowflakeEnabled: snowflakeEnabled(),
    solana: solanaClientConfig(),
  });
});

app.get("/api/episodes", async (_req, res, next) => {
  try {
    res.json({ episodes: await listEpisodes() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/audio/:filename", async (req, res, next) => {
  try {
    const filename = String(req.params.filename || "");
    if (!/^[a-z0-9-]+\.mp3$/i.test(filename)) {
      throw new AppError("Invalid audio file.", 400);
    }

    if (isNetlifyRuntime()) {
      const store = await getBlobStore("passion-podcast-audio");
      const audio = await store.get(filename, { type: "arrayBuffer" });
      if (!audio) {
        throw new AppError("Audio file not found.", 404);
      }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.from(audio));
      return;
    }

    res.sendFile(path.join(config.audioDir, filename));
  } catch (error) {
    next(error);
  }
});

app.post("/api/topic-suggestions", async (req, res, next) => {
  try {
    const body = requestBody(req);
    const topics = await suggestTopics(body.seed || "");
    res.json({ topics });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const body = requestBody(req);
    const topic = String(body.topic || "").trim();
    if (!topic) {
      throw new AppError("Enter any topic or subject first.", 400);
    }
    if (!config.gemini.apiKey) {
      throw new AppError("GEMINI_API_KEY is not configured. Add it to .env and restart the server.", 400);
    }

    const selectedSources =
      Array.isArray(body.sources) && body.sources.length
        ? body.sources
        : ["News", "Reddit", "Forums"];
    const deliveryTime = String(body.deliveryTime || "07:30");
    const voiceId = String(body.voiceId || "studio");
    const requestedPrice = body.premiumPriceSol;
    const premiumPriceSol =
      requestedPrice === "" || requestedPrice === null || requestedPrice === undefined
        ? 0
        : Math.max(0, Number(requestedPrice) || 0);
    const episodeId = `${slugify(topic)}-${nanoid(8)}`;

    if (isNetlifyRuntime()) {
      const pendingEpisode = {
        id: episodeId,
        topic,
        displayTopic: titleCase(topic),
        title: `Preparing ${titleCase(topic)}`,
        summary: "Researching live sources and preparing your AI-generated episode.",
        createdAt: new Date().toISOString(),
        deliveryTime,
        duration: "05:00",
        runtimeSeconds: 300,
        freshnessScore: 0,
        premiumPriceSol,
        voice: resolveVoice(voiceId),
        sourceMode: "pending",
        sourceErrors: [],
        sources: [],
        sourceInsights: [],
        script: [],
        premium: [],
        audioUrl: "",
        audioProvider: "episode-pending",
        audioBytes: 0,
        audioNote: "Episode is generating in the background.",
        premiumUnlocked: false,
        listens: 0,
        generationMs: Date.now() - startedAt,
      };

      await saveEpisode(pendingEpisode);
      await queueEpisodeGeneration(req, {
        episodeId,
        topic,
        selectedSources,
        deliveryTime,
        premiumPriceSol,
        voiceId,
        createdAt: pendingEpisode.createdAt,
      });
      res.json({ episode: pendingEpisode, snowflake: { skipped: true, reason: "Pending background generation" } });
      return;
    }

    const gathered = await gatherSources(topic, selectedSources, 4);
    const sourceRows = gathered.items.length ? gathered.items : fallbackSources(titleCase(topic));
    const sourceMode = gathered.items.length ? "live" : "fallback";

    const draft = await generateEpisodeDraft({
      topic,
      sources: sourceRows,
      deliveryTime,
      premiumPriceSol,
    });

    let audio = {
      audioUrl: "",
      provider: "elevenlabs-pending",
      bytes: 0,
      voice: resolveVoice(voiceId),
      skippedReason: "Audio is rendering in the background.",
    };

    if (!isNetlifyRuntime()) {
      try {
        audio = await synthesizeEpisodeAudio({
          episodeId,
          script: draft.script,
          voiceId,
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
    }

    const episode = {
      id: episodeId,
      topic,
      displayTopic: titleCase(topic),
      title: draft.title,
      summary: draft.summary,
      createdAt: new Date().toISOString(),
      deliveryTime,
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
    if (isNetlifyRuntime()) {
      await queueAudioRender(req, episode);
    }
    let snowflake = { skipped: true, reason: "Snowflake disabled" };
    try {
      snowflake = await insertEpisodeIntoSnowflake(episode);
    } catch (error) {
      snowflake = { skipped: true, reason: error.message };
    }

    res.json({ episode, snowflake });
  } catch (error) {
    next(error);
  }
});

app.get("/api/solana/config", (_req, res) => {
  res.json(solanaClientConfig());
});

app.post("/api/solana/verify", async (req, res, next) => {
  try {
    const body = requestBody(req);
    const episodeId = String(body.episodeId || "");
    const payment = await verifySolanaPayment({
      signature: body.signature,
      expectedSol: Number(body.expectedSol || config.solana.premiumSol),
    });
    const episode = episodeId ? await markEpisodeUnlocked(episodeId, payment) : null;
    res.json({ payment, episode });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "API route not found" });
    return;
  }
  res.sendFile(path.join(config.publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  const publicError = toPublicError(error);
  res.status(publicError.statusCode).json({ error: publicError.message, details: publicError.details });
});

export async function initializeApp() {
  await fs.mkdir(config.audioDir, { recursive: true });
  await fs.mkdir(config.dataDir, { recursive: true });
  initSnowflake().catch((error) => {
    console.warn(`Snowflake init skipped: ${error.message}`);
  });
}
