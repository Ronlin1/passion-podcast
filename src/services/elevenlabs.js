import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { fetchWithTimeout } from "../lib/fetch.js";
import { isNetlifyRuntime } from "./blobs.js";

function scriptToSpeechText(script) {
  return script
    .map((segment) => {
      const speaker = segment.speaker && segment.speaker !== "Host" ? `${segment.speaker}: ` : "";
      return `${speaker}${segment.line}`;
    })
    .join("\n\n")
    .slice(0, 9500);
}

export function resolveVoice(voiceIdOrPreset) {
  const requested = String(voiceIdOrPreset || "").trim();
  const matched = config.elevenLabs.voices.find(
    (voice) => voice.id === requested || voice.voiceId === requested,
  );
  return matched || config.elevenLabs.voices[0];
}

export async function synthesizeEpisodeAudio({ episodeId, script, voiceId }) {
  const voice = resolveVoice(voiceId);
  if (!config.elevenLabs.apiKey) {
    return {
      audioUrl: "",
      provider: "browser-speech-fallback",
      voice,
      skippedReason: "ELEVENLABS_API_KEY is not configured. Add it to .env to create real MP3 files.",
    };
  }

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}`);
  url.searchParams.set("output_format", config.elevenLabs.outputFormat);

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabs.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: scriptToSpeechText(script),
        model_id: config.elevenLabs.modelId,
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.78,
          style: 0.32,
          use_speaker_boost: true,
        },
      }),
    },
    60000,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AppError("ElevenLabs audio generation failed.", response.status, {
      voice,
      detail: body.slice(0, 1000),
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = `${episodeId}.mp3`;

  if (isNetlifyRuntime()) {
    return {
      audioUrl: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      provider: "elevenlabs",
      voice,
      bytes: buffer.length,
    };
  }

  await fs.mkdir(config.audioDir, { recursive: true });
  const filePath = path.join(config.audioDir, filename);
  await fs.writeFile(filePath, buffer);

  return {
    audioUrl: `/audio/${filename}`,
    provider: "elevenlabs",
    voice,
    bytes: buffer.length,
  };
}
