import { synthesizeEpisodeAudio } from "../../src/services/elevenlabs.js";
import { updateEpisodeAudio } from "../../src/services/store.js";

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    return {};
  }
}

export async function handler(event) {
  const body = parseBody(event);
  if (!body.episodeId || !Array.isArray(body.script)) {
    console.warn("Audio background render skipped: invalid payload");
    return;
  }

  try {
    const audio = await synthesizeEpisodeAudio({
      episodeId: body.episodeId,
      script: body.script,
      voiceId: body.voiceId || "studio",
    });
    await updateEpisodeAudio(body.episodeId, audio);
  } catch (error) {
    await updateEpisodeAudio(body.episodeId, {
      audioUrl: "",
      provider: "browser-speech-fallback",
      bytes: 0,
      audioNote:
        error.statusCode === 402
          ? "ElevenLabs rejected this voice for the current plan. Choose another voice or use a paid voice-enabled plan."
          : error.message,
      voice: error.details?.voice,
    });
  }
}
