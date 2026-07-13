const state = {
  status: null,
  episodes: [],
  currentEpisode: null,
  solana: null,
  isGenerating: false,
  speechUtterance: null,
};

const fallbackTopics = [
  "AI filmmaking",
  "space exploration",
  "women's football tactics",
  "climate robotics",
  "afrobeats production",
  "urban gardening",
  "Formula 1 engineering",
  "open source hardware",
  "street photography",
  "deep sea exploration",
];

const pipelineSteps = [
  ["radar", "Live source sweep", "News, Reddit, and forum signals"],
  ["brain-circuit", "Gemini script", "Structured 5-minute episode JSON"],
  ["audio-lines", "ElevenLabs render", "MP3 voiceover saved locally"],
  ["database", "Vault write", "Local JSON and optional Snowflake"],
  ["wallet-cards", "Premium pass", "Solana devnet unlock ready"],
];

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function titleCase(value = "") {
  const acronyms = new Set(["ai", "api", "nasa", "nft", "ml", "vr", "ar"]);
  return value
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lowered = word.toLowerCase();
      return acronyms.has(lowered) ? lowered.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function toast(message) {
  const el = qs("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => el.classList.remove("show"), 3000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = typeof data.details === "string" ? ` ${data.details}` : "";
    throw new Error(`${data.error || "Request failed."}${details}`);
  }
  return data;
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderWaveform() {
  const waveform = qs("#waveform");
  waveform.innerHTML = "";
  for (let index = 0; index < 42; index += 1) {
    const bar = document.createElement("span");
    const height = 18 + ((index * 17) % 38);
    bar.className = "bar";
    bar.style.setProperty("--h", `${height}px`);
    bar.style.setProperty("--d", `${(index % 9) * 48}ms`);
    waveform.appendChild(bar);
  }
}

function setServiceChip(id, ready, label) {
  const el = qs(id);
  const wrapper = el.closest("span");
  el.textContent = `${label} live`;
  el.classList.toggle("ready", ready);
  wrapper.hidden = !ready;
}

function renderStatus() {
  const services = state.status?.services || {};
  setServiceChip("#statusGemini", services.gemini, "Gemini");
  setServiceChip("#statusEleven", services.elevenLabs, "ElevenLabs");
  setServiceChip("#statusSolana", services.solana, "Solana");
  setServiceChip("#statusSnowflake", services.snowflake, "Snowflake");
  qs("#liveMode").textContent = "Live!";
  qs("#serviceMetrics").hidden = !Object.values(services).some(Boolean);
  renderVoiceOptions(state.status?.voices || []);

  const cards = [
    ["Gemini", services.gemini, "Script generation"],
    ["ElevenLabs", services.elevenLabs, "MP3 voice generation"],
    ["Solana", services.solana, "Premium devnet unlock"],
    ["Snowflake", services.snowflake, "Warehouse persistence"],
  ];

  qs("#setupGrid").innerHTML = cards
    .map(
      ([name, ready, detail]) => `
        <article class="setup-card ${ready ? "ready" : "pending"}">
          <strong>${name}: ${ready ? "Connected" : "Not connected"}</strong>
          <span>${detail}</span>
        </article>
      `,
    )
    .join("");
}

function renderVoiceOptions(voices) {
  const select = qs("#voiceSelect");
  const current = select.value || "studio";
  const options = voices.length
    ? voices
    : [
        { id: "studio", label: "Studio Host", gender: "neutral" },
        { id: "female", label: "Female Host", gender: "female" },
        { id: "warm", label: "Warm Female", gender: "female" },
        { id: "male", label: "Male Analyst", gender: "male" },
      ];
  select.innerHTML = options
    .map((voice) => {
      const suffix = voice.gender ? ` (${voice.gender})` : "";
      return `<option value="${voice.id}">${voice.label}${suffix}</option>`;
    })
    .join("");
  select.value = options.some((voice) => voice.id === current) ? current : "studio";
}

function renderPipeline(activeIndex = -1) {
  qs("#pipeline").innerHTML = pipelineSteps
    .map(([icon, title, detail], index) => {
      const stateClass = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
      const label = index < activeIndex ? "Done" : index === activeIndex ? "Live" : "Wait";
      return `
        <div class="pipeline-step ${stateClass}">
          <span class="icon"><i data-lucide="${icon}"></i></span>
          <span><strong>${title}</strong><small>${detail}</small></span>
          <span class="state">${label}</span>
        </div>
      `;
    })
    .join("");
  renderIcons();
}

function animatePipeline() {
  let index = 0;
  renderPipeline(index);
  clearInterval(animatePipeline.timer);
  animatePipeline.timer = setInterval(() => {
    if (!state.isGenerating) {
      renderPipeline(5);
      clearInterval(animatePipeline.timer);
      return;
    }
    index = Math.min(index + 1, pipelineSteps.length - 1);
    renderPipeline(index);
  }, 1200);
}

function renderEpisode(episode = state.currentEpisode) {
  const audio = qs("#audioPlayer");
  const download = qs("#downloadEpisode");
  if (!episode) {
    qs("#episodeTitle").textContent = "Waiting for first live generation";
    qs("#episodeSummary").textContent = "Enter any topic, choose live sources, then generate.";
    qs("#scriptList").innerHTML = "";
    qs("#sourceList").innerHTML = "";
    qs("#premiumList").innerHTML = "";
    qs("#sourceCount").textContent = "0 hits";
    qs("#episodeStatus").textContent = "Idle";
    qs("#passTopic").textContent = "NO EPISODE";
    qs("#passPrice").textContent = "Optional";
    qs("#premiumStatus").textContent = "Locked";
    qs("#paySolana").hidden = true;
    audio.removeAttribute("src");
    download.href = "#";
    download.classList.add("disabled");
    download.setAttribute("aria-disabled", "true");
    return;
  }

  qs("#heroTitle").textContent = `${episode.displayTopic}, broadcast daily.`;
  qs("#episodeTitle").textContent = episode.title;
  qs("#episodeSummary").textContent = episode.summary;
  qs("#episodeStatus").textContent = episode.audioUrl ? "MP3 ready" : "Script ready";
  qs("#sourceCount").textContent = `${episode.sources.length} hits`;
  qs("#passTopic").textContent = episode.displayTopic.toUpperCase();
  const price = Number(episode.premiumPriceSol || 0);
  qs("#passPrice").textContent = price > 0 ? `${price.toFixed(3)} SOL` : "Free";
  qs("#premiumStatus").textContent = episode.premiumUnlocked || price === 0 ? "Open" : "Locked";
  qs("#paySolana").hidden = price === 0;

  if (episode.audioUrl) {
    audio.src = `${episode.audioUrl}?v=${encodeURIComponent(episode.id)}`;
    audio.style.display = "block";
    download.href = episode.audioUrl;
    download.download = `${episode.displayTopic || "episode"}-${episode.id}.mp3`;
    download.classList.remove("disabled");
    download.removeAttribute("aria-disabled");
  } else {
    audio.removeAttribute("src");
    audio.style.display = "none";
    download.href = "#";
    download.classList.add("disabled");
    download.setAttribute("aria-disabled", "true");
  }

  qs("#scriptList").innerHTML = episode.script
    .map(
      (segment) => `
        <article class="script-line">
          <div class="script-meta"><span>${segment.time}</span><span>${segment.speaker}</span></div>
          <p>${segment.line}</p>
        </article>
      `,
    )
    .join("");

  qs("#sourceList").innerHTML = episode.sources
    .map(
      (source) => `
        <article class="source-row">
          <span class="source-type">${source.type}</span>
          <span class="heat-score">${source.heat}% heat</span>
          <h3>${source.url ? `<a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a>` : source.title}</h3>
          <p>${source.detail || ""}</p>
          <div class="source-meta"><span>${source.age}</span><span>${episode.sourceMode}</span></div>
        </article>
      `,
    )
    .join("");

  qs("#premiumList").innerHTML = episode.premium
    .map(
      (item) => `
        <article class="premium-row ${episode.premiumUnlocked || price === 0 ? "" : "locked"}">
          <h3>${item.title}</h3>
          <p>${item.detail}</p>
          <div class="premium-meta"><span>${item.minutes}</span><span>${episode.premiumUnlocked || price === 0 ? "Open access" : "Payment required"}</span></div>
        </article>
      `,
    )
    .join("");
}

function renderVault() {
  const rows = state.episodes || [];
  qs("#vaultEpisodes").textContent = rows.length;
  qs("#vaultSources").textContent = rows.reduce((sum, episode) => sum + (episode.sources?.length || 0), 0);
  qs("#vaultAudio").textContent = rows.filter((episode) => episode.audioUrl).length;
  qs("#vaultRows").innerHTML = rows
    .map(
      (episode) => `
        <tr>
          <td>${episode.title}</td>
          <td>${episode.displayTopic || titleCase(episode.topic)}</td>
          <td>${episode.audioProvider || "none"}</td>
          <td>${episode.sourceMode || "live"}</td>
        </tr>
      `,
    )
    .join("");
}

async function refreshStatus() {
  state.status = await api("/api/status");
  state.solana = state.status.solana;
  renderStatus();
  renderIcons();
}

async function refreshEpisodes() {
  const data = await api("/api/episodes");
  state.episodes = data.episodes || [];
  if (!state.currentEpisode && state.episodes.length) {
    state.currentEpisode = state.episodes[0];
  }
  renderEpisode();
  renderVault();
}

function selectedSources() {
  const values = qsa("input[name='source']:checked").map((input) => input.value);
  return values.length ? values : ["News"];
}

async function generateEpisode(event) {
  event.preventDefault();
  const topic = qs("#topicInput").value.trim();
  if (!topic) {
    toast("Enter a topic first.");
    return;
  }

  state.isGenerating = true;
  qs("#generateBtn").disabled = true;
  qs("#episodeStatus").textContent = "Generating";
  qs("#waveform").classList.add("playing");
  animatePipeline();

  try {
    const data = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        topic,
        sources: selectedSources(),
        deliveryTime: qs("#deliveryTime").value,
        voiceId: qs("#voiceSelect").value,
        premiumPriceSol: qs("#premiumPrice").value.trim(),
      }),
    });

    state.currentEpisode = data.episode;
    state.episodes = [data.episode, ...state.episodes.filter((item) => item.id !== data.episode.id)];
    renderEpisode();
    renderVault();
    toast(data.episode.audioUrl ? "Live episode and MP3 generated." : "Live script generated. Add ElevenLabs key for MP3.");
  } catch (error) {
    toast(error.message);
    qs("#episodeStatus").textContent = "Error";
  } finally {
    state.isGenerating = false;
    qs("#generateBtn").disabled = false;
    qs("#waveform").classList.remove("playing");
    renderPipeline(5);
    renderIcons();
  }
}

async function suggestTopicIdeas() {
  qs("#suggestBtn").disabled = true;
  try {
    const data = await api("/api/topic-suggestions", {
      method: "POST",
      body: JSON.stringify({ seed: qs("#topicInput").value }),
    });
    const topics = data.topics || [];
    const pool = topics.length ? topics : fallbackTopics;
    const randomTopic = pool[Math.floor(Math.random() * pool.length)];
    qs("#topicInput").value = randomTopic;
    qs("#topicChips").innerHTML = pool
      .slice(0, 6)
      .map(
        (topic) =>
          `<button class="topic-chip ${topic === randomTopic ? "active" : ""}" type="button" data-topic="${topic}">${topic}</button>`,
      )
      .join("");
    bindTopicChips();
    toast(`Random topic loaded: ${randomTopic}.`);
  } catch (error) {
    const randomTopic = fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)];
    qs("#topicInput").value = randomTopic;
    toast(`Random topic loaded: ${randomTopic}.`);
  } finally {
    qs("#suggestBtn").disabled = false;
  }
}

function playBrowserSpeech() {
  if (!state.currentEpisode) {
    toast("Generate an episode first.");
    return;
  }
  if (Number(state.currentEpisode.premiumPriceSol || 0) === 0) {
    state.currentEpisode = { ...state.currentEpisode, premiumUnlocked: true };
    renderEpisode();
    toast("Premium is free for this episode.");
    return;
  }
  const audio = qs("#audioPlayer");
  if (state.currentEpisode.audioUrl) {
    audio.play();
    return;
  }
  if (!("speechSynthesis" in window)) {
    toast("Browser speech is not available.");
    return;
  }
  window.speechSynthesis.cancel();
  state.speechUtterance = new SpeechSynthesisUtterance(
    state.currentEpisode.script.map((segment) => segment.line).join(" "),
  );
  state.speechUtterance.rate = 1.02;
  window.speechSynthesis.speak(state.speechUtterance);
}

async function payWithSolana() {
  if (!state.currentEpisode) {
    toast("Generate an episode first.");
    return;
  }
  if (!state.solana?.enabled) {
    toast("Add SOLANA_RECEIVER_ADDRESS to .env and restart the server.");
    return;
  }
  if (!window.solana?.isPhantom || !window.solanaWeb3) {
    toast("Phantom wallet with devnet enabled is required for real Solana payment.");
    return;
  }

  try {
    const provider = window.solana;
    const web3 = window.solanaWeb3;
    const connectResult = await provider.connect();
    const fromPubkey = new web3.PublicKey(connectResult.publicKey.toString());
    const toPubkey = new web3.PublicKey(state.solana.receiverAddress);
    const connection = new web3.Connection(state.solana.rpcUrl, "confirmed");
    const lamports = Math.floor(Number(state.currentEpisode.premiumPriceSol) * web3.LAMPORTS_PER_SOL);
    const transaction = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      }),
    );
    transaction.feePayer = fromPubkey;
    const latest = await connection.getLatestBlockhash();
    transaction.recentBlockhash = latest.blockhash;

    let signature;
    if (typeof provider.signAndSendTransaction === "function") {
      const result = await provider.signAndSendTransaction(transaction);
      signature = result.signature;
    } else {
      const signed = await provider.signTransaction(transaction);
      signature = await connection.sendRawTransaction(signed.serialize());
    }

    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );

    const data = await api("/api/solana/verify", {
      method: "POST",
      body: JSON.stringify({
        episodeId: state.currentEpisode.id,
        signature,
        expectedSol: state.currentEpisode.premiumPriceSol,
      }),
    });

    state.currentEpisode = data.episode || { ...state.currentEpisode, premiumUnlocked: true };
    state.episodes = state.episodes.map((episode) =>
      episode.id === state.currentEpisode.id ? state.currentEpisode : episode,
    );
    renderEpisode();
    renderVault();
    toast("Solana payment verified. Premium unlocked.");
  } catch (error) {
    toast(error.message);
  }
}

function bindTopicChips() {
  qsa(".topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      qsa(".topic-chip").forEach((item) => item.classList.remove("active"));
      chip.classList.add("active");
      qs("#topicInput").value = chip.dataset.topic;
    });
  });
}

function bindEvents() {
  qs("#episodeForm").addEventListener("submit", generateEpisode);
  qs("#suggestBtn").addEventListener("click", suggestTopicIdeas);
  qs("#playEpisode").addEventListener("click", playBrowserSpeech);
  qs("#paySolana").addEventListener("click", payWithSolana);
  qs("#refreshStatus").addEventListener("click", () => refreshStatus().catch((error) => toast(error.message)));

  qsa(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      qsa(".nav-tab").forEach((item) => item.classList.remove("active"));
      qsa(".view").forEach((view) => view.classList.remove("active"));
      tab.classList.add("active");
      qs(`#${tab.dataset.view}`).classList.add("active");
    });
  });

  bindTopicChips();
}

document.addEventListener("DOMContentLoaded", async () => {
  renderWaveform();
  renderPipeline();
  bindEvents();
  renderIcons();
  try {
    await refreshStatus();
    await refreshEpisodes();
  } catch (error) {
    toast(error.message);
  }
});
