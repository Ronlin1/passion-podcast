import "dotenv/config";
import path from "node:path";

const appRoot = process.cwd();

function bool(value) {
  return String(value || "").toLowerCase() === "true";
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  appRoot,
  dataDir: path.join(appRoot, "data"),
  publicDir: path.join(appRoot, "public"),
  audioDir: path.join(appRoot, "public", "audio"),
  port: number(process.env.PORT, 8787),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:8787",
  sourceFetchTimeoutMs: number(process.env.SOURCE_FETCH_TIMEOUT_MS, 9000),
  redditUserAgent: process.env.REDDIT_USER_AGENT || "PassionPodcastHackathon/1.0",
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
    voices: [
      {
        id: "studio",
        label: "Studio Host",
        gender: "neutral",
        voiceId: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
      },
      {
        id: "female",
        label: "Female Host",
        gender: "female",
        voiceId: process.env.ELEVENLABS_FEMALE_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
      },
      {
        id: "warm",
        label: "Warm Female",
        gender: "female",
        voiceId: process.env.ELEVENLABS_WARM_FEMALE_VOICE_ID || "XrExE9yKIg1WjnnlVkGX",
      },
      {
        id: "male",
        label: "Male Analyst",
        gender: "male",
        voiceId: process.env.ELEVENLABS_MALE_VOICE_ID || "CwhRBWXzGAHq8TQ4Fs17",
      },
    ],
    modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
    outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
  },
  solana: {
    cluster: process.env.SOLANA_CLUSTER || "devnet",
    rpcUrl: process.env.SOLANA_RPC_URL || "",
    receiverAddress: process.env.SOLANA_RECEIVER_ADDRESS || "",
    premiumSol: number(process.env.SOLANA_PREMIUM_SOL, 0.08),
  },
  snowflake: {
    enabled: bool(process.env.SNOWFLAKE_ENABLED),
    account: process.env.SNOWFLAKE_ACCOUNT || "",
    username: process.env.SNOWFLAKE_USERNAME || "",
    password: process.env.SNOWFLAKE_PASSWORD || "",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "",
    database: process.env.SNOWFLAKE_DATABASE || "",
    schema: process.env.SNOWFLAKE_SCHEMA || "PUBLIC",
    role: process.env.SNOWFLAKE_ROLE || "",
    table: process.env.SNOWFLAKE_TABLE || "PASSION_EPISODES",
  },
};

export function serviceStatus() {
  return {
    gemini: Boolean(config.gemini.apiKey),
    elevenLabs: Boolean(config.elevenLabs.apiKey),
    snowflake:
      config.snowflake.enabled &&
      Boolean(
        config.snowflake.account &&
          config.snowflake.username &&
          config.snowflake.password &&
          config.snowflake.warehouse &&
          config.snowflake.database,
      ),
    solana: Boolean(config.solana.receiverAddress),
  };
}
