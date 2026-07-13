import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { fetchJson } from "../lib/fetch.js";
import { clamp, cleanText, titleCase } from "../lib/text.js";

function episodePrompt({ topic, sources, deliveryTime, premiumPriceSol }) {
  return `
You are the editorial engine for "The Passion Podcast", a daily AI-generated podcast for a listener's favorite topic.

Topic: ${topic}
Delivery time: ${deliveryTime}
Premium deep-dive price: ${premiumPriceSol} SOL

Live source rows:
${JSON.stringify(sources, null, 2)}

Create a polished 5-minute podcast episode. Use the source rows as current context. If a source is weak, say so indirectly by focusing on higher-confidence patterns. Do not invent exact facts, quotes, URLs, or named claims that are not supported by the source rows.

Return strict JSON only. No markdown. No commentary.

Schema:
{
  "title": "short episode title",
  "summary": "one-sentence editorial summary",
  "freshnessScore": 0-100,
  "runtimeSeconds": 300,
  "script": [
    {"time": "00:00", "speaker": "Host", "line": "spoken line"},
    {"time": "00:40", "speaker": "Gemini", "line": "spoken line"}
  ],
  "sourceInsights": [
    {"title": "source title", "type": "News|Reddit|Forums", "whyItMatters": "short reason", "heat": 0-100}
  ],
  "premium": [
    {"title": "premium segment title", "detail": "what unlocks", "minutes": "12 min"}
  ]
}

Script requirements:
- 6 to 8 timed segments.
- Around 650 to 800 spoken words total.
- Energetic, intelligent, and cinematic, but useful.
- Include a clear "why it matters" beat.
- Include one "what to watch next" beat.
- End with an invitation to unlock the premium deep dive.
`;
}

function extractGeminiText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  if (typeof data?.outputText === "string") return data.outputText;
  if (typeof data?.text === "string") return data.text;
  if (typeof data?.candidates?.[0]?.content?.parts?.[0]?.text === "string") {
    return data.candidates[0].content.parts[0].text;
  }
  if (Array.isArray(data?.output)) {
    return data.output
      .map((item) => item?.content || item?.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseJsonFromText(text) {
  const trimmed = cleanText(text);
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new AppError("Gemini returned text that did not contain JSON.", 502, trimmed.slice(0, 500));
    }
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      throw new AppError("Gemini JSON could not be parsed.", 502, {
        parseError: error.message,
        sample: match[0].slice(0, 500),
      });
    }
  }
}

async function callInteractions(prompt) {
  const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
  const data = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": config.gemini.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.gemini.model,
        input: prompt,
      }),
    },
    30000,
  );
  return extractGeminiText(data);
}

async function callGenerateContent(prompt) {
  const model = encodeURIComponent(config.gemini.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    config.gemini.apiKey,
  )}`;
  const data = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
    30000,
  );
  return extractGeminiText(data);
}

function normalizeScript(topic, script) {
  const fallback = [
    {
      time: "00:00",
      speaker: "Host",
      line: `Welcome to The Passion Podcast. Today's topic is ${titleCase(topic)}, and the signal is moving fast.`,
    },
  ];

  const rows = Array.isArray(script) && script.length ? script : fallback;
  return rows.slice(0, 8).map((row, index) => ({
    time: cleanText(row.time || `0${Math.floor(index / 2)}:${index % 2 ? "35" : "00"}`),
    speaker: cleanText(row.speaker || (index % 2 ? "Gemini" : "Host")),
    line: cleanText(row.line || row.text || ""),
  }));
}

export async function generateEpisodeDraft({ topic, sources, deliveryTime, premiumPriceSol }) {
  if (!config.gemini.apiKey) {
    throw new AppError("GEMINI_API_KEY is not configured. Add it to .env and restart the server.", 400);
  }

  const prompt = episodePrompt({ topic, sources, deliveryTime, premiumPriceSol });
  let text = "";
  let firstError;

  try {
    text = await callInteractions(prompt);
  } catch (error) {
    firstError = error;
  }

  if (!text) {
    try {
      text = await callGenerateContent(prompt);
    } catch (error) {
      throw new AppError("Gemini generation failed.", error.statusCode || 502, {
        interactionsError: firstError?.message,
        generateContentError: error.message,
      });
    }
  }

  const parsed = parseJsonFromText(text);
  const sourceInsights =
    Array.isArray(parsed.sourceInsights) && parsed.sourceInsights.length
      ? parsed.sourceInsights
      : sources.slice(0, 6).map((source) => ({
          title: source.title,
          type: source.type,
          whyItMatters: source.detail,
          heat: source.heat,
        }));

  return {
    title: cleanText(parsed.title || `Today's ${titleCase(topic)} signal`),
    summary: cleanText(parsed.summary || `A fast daily brief on what changed in ${titleCase(topic)}.`),
    freshnessScore: clamp(Number(parsed.freshnessScore || 88), 1, 100),
    runtimeSeconds: clamp(Number(parsed.runtimeSeconds || 300), 60, 600),
    script: normalizeScript(topic, parsed.script),
    sourceInsights: sourceInsights.slice(0, 8).map((insight) => ({
      title: cleanText(insight.title),
      type: cleanText(insight.type || "Signal"),
      whyItMatters: cleanText(insight.whyItMatters || insight.detail || ""),
      heat: clamp(Number(insight.heat || 80), 1, 100),
    })),
    premium:
      Array.isArray(parsed.premium) && parsed.premium.length
        ? parsed.premium.slice(0, 4).map((item) => ({
            title: cleanText(item.title),
            detail: cleanText(item.detail),
            minutes: cleanText(item.minutes || "12 min"),
          }))
        : [
            {
              title: `${titleCase(topic)} source dossier`,
              detail: "Ranked links, debate clusters, and practical next moves.",
              minutes: "12 min",
            },
          ],
    rawModelText: text,
  };
}

export async function suggestTopics(seed = "") {
  if (!config.gemini.apiKey) {
    return [
      "AI filmmaking",
      "football tactics",
      "climate robotics",
      "space exploration",
      "afrobeats production",
      "urban farming",
    ];
  }

  const prompt = `Return strict JSON only: {"topics":["six punchy podcast topic ideas"]}. The user is interested in: ${
    seed || "surprising passions, tech, culture, sports, science"
  }.`;
  let text = "";
  try {
    text = await callInteractions(prompt);
  } catch {
    text = await callGenerateContent(prompt);
  }
  const parsed = parseJsonFromText(text);
  return Array.isArray(parsed.topics) ? parsed.topics.map(cleanText).filter(Boolean).slice(0, 8) : [];
}
