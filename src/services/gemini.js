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

Create a polished short podcast episode. Use the source rows as current context. If a source is weak, say so indirectly by focusing on higher-confidence patterns. Do not invent exact facts, quotes, URLs, or named claims that are not supported by the source rows.

Return strict JSON only. No markdown. No commentary.

Schema:
{
  "title": "short episode title",
  "summary": "one-sentence editorial summary",
  "freshnessScore": 0-100,
  "runtimeSeconds": 120,
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
- 4 to 5 timed segments.
- Around 230 to 320 spoken words total.
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

function candidateModels() {
  return [...new Set([config.gemini.model, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"].filter(Boolean))];
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

async function callGenerateContentWithModel(prompt, modelName) {
  const model = encodeURIComponent(modelName);
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
        generationConfig: {
          temperature: 0.82,
          maxOutputTokens: 2600,
          responseMimeType: "application/json",
        },
      }),
    },
    18000,
  );
  return extractGeminiText(data);
}

async function callGenerateContent(prompt) {
  let lastError;
  for (const modelName of candidateModels()) {
    try {
      const text = await callGenerateContentWithModel(prompt, modelName);
      if (text) return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new AppError("Gemini generation returned no text.", 502);
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
  return rows.slice(0, 5).map((row, index) => ({
    time: cleanText(row.time || `0${Math.floor(index / 2)}:${index % 2 ? "35" : "00"}`),
    speaker: cleanText(row.speaker || (index % 2 ? "Gemini" : "Host")),
    line: cleanText(row.line || row.text || ""),
  }));
}

function fallbackDraft({ topic, sources, premiumPriceSol, text }) {
  const displayTopic = titleCase(topic);
  const topSources = sources.slice(0, 3);
  const sourceText = topSources
    .map((source, index) => `${index + 1}. ${source.title}: ${source.detail}`)
    .join(" ");
  const premiumLabel = Number(premiumPriceSol || 0) > 0 ? `${premiumPriceSol} SOL` : "free";

  return {
    title: `${displayTopic} signal brief`,
    summary: `A fast live brief on the strongest current signals around ${displayTopic}.`,
    freshnessScore: 82,
    runtimeSeconds: 120,
    script: normalizeScript(topic, [
      {
        time: "00:00",
        speaker: "Host",
        line: `Welcome to The Passion Podcast. Today's focus is ${displayTopic}, and the live signal is already moving.`,
      },
      {
        time: "00:25",
        speaker: "Gemini",
        line: sourceText || `The strongest pattern is that ${displayTopic} is attracting fresh attention across public conversations and news sources.`,
      },
      {
        time: "00:55",
        speaker: "Host",
        line: `Why it matters: when a passion starts showing up across multiple channels at once, it usually means the topic is becoming more useful, more debatable, or more urgent.`,
      },
      {
        time: "01:20",
        speaker: "Gemini",
        line: `What to watch next: look for repeated names, new launches, and community arguments that keep resurfacing. Those are the clues that separate noise from momentum.`,
      },
      {
        time: "01:45",
        speaker: "Host",
        line: `Your premium deep dive is ${premiumLabel} today, with ranked links, source notes, and the next questions worth tracking.`,
      },
    ]),
    sourceInsights: topSources.map((source) => ({
      title: cleanText(source.title),
      type: cleanText(source.type || "Signal"),
      whyItMatters: cleanText(source.detail || "Live source signal."),
      heat: clamp(Number(source.heat || 80), 1, 100),
    })),
    premium: [
      {
        title: `${displayTopic} source dossier`,
        detail: "Ranked links, debate clusters, and practical next moves.",
        minutes: "12 min",
      },
    ],
    rawModelText: text,
  };
}

export async function generateEpisodeDraft({ topic, sources, deliveryTime, premiumPriceSol }) {
  if (!config.gemini.apiKey) {
    throw new AppError("GEMINI_API_KEY is not configured. Add it to .env and restart the server.", 400);
  }

  const prompt = episodePrompt({ topic, sources, deliveryTime, premiumPriceSol });
  let text = "";
  let firstError;

  try {
    text = await callGenerateContent(prompt);
  } catch (error) {
    firstError = error;
  }

  if (!text) {
    try {
      text = await callInteractions(prompt);
    } catch (error) {
      throw new AppError("Gemini generation failed.", error.statusCode || 502, {
        generateContentError: firstError?.message,
        interactionsError: error.message,
      });
    }
  }

  let parsed;
  try {
    parsed = parseJsonFromText(text);
  } catch {
    return fallbackDraft({ topic, sources, premiumPriceSol, text });
  }
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
    runtimeSeconds: clamp(Number(parsed.runtimeSeconds || 120), 60, 300),
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
    text = await callGenerateContent(prompt);
  } catch {
    text = await callInteractions(prompt);
  }
  const parsed = parseJsonFromText(text);
  return Array.isArray(parsed.topics) ? parsed.topics.map(cleanText).filter(Boolean).slice(0, 8) : [];
}
