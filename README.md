# The Passion Podcast Live

Live AI-generated daily podcasts for any topic.

## What is real

- Live source gathering from Google News RSS, Reddit search JSON, and Hacker News/Algolia.
- Gemini generates the episode title, summary, timed podcast script, source insights, and premium deep-dive outline.
- ElevenLabs turns the generated script into a real MP3 and saves it in `public/audio`.
- Episodes are stored locally in `data/episodes.json`.
- Snowflake storage is available when enabled in `.env`.
- Solana devnet premium unlock is available through Phantom when `SOLANA_RECEIVER_ADDRESS` is set.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`.

3. Put your keys in `.env`:

```bash
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key
```

Optional ElevenLabs voice overrides:

```bash
ELEVENLABS_VOICE_ID=default_or_neutral_voice_id
ELEVENLABS_FEMALE_VOICE_ID=female_voice_id
ELEVENLABS_WARM_FEMALE_VOICE_ID=another_female_voice_id
ELEVENLABS_MALE_VOICE_ID=male_voice_id
```

4. Start the app:

```bash
npm start
```

5. Open:

```text
http://localhost:8787
```

## Optional Solana

Use devnet first.

```bash
SOLANA_CLUSTER=devnet
SOLANA_RECEIVER_ADDRESS=your_devnet_receiver_public_key
SOLANA_PREMIUM_SOL=0
```

In Phantom, switch to devnet and make sure the paying wallet has devnet SOL.
Leaving the premium price blank in the UI makes the deep dive free for now.

## Optional Snowflake

```bash
SNOWFLAKE_ENABLED=true
SNOWFLAKE_ACCOUNT=your_account
SNOWFLAKE_USERNAME=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_WAREHOUSE=your_warehouse
SNOWFLAKE_DATABASE=your_database
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_ROLE=your_role
SNOWFLAKE_TABLE=PASSION_EPISODES
```

The server creates the episode table automatically if it has permission.

## Notes

- API keys are used only by the backend. They are never exposed to the browser.
- If `ELEVENLABS_API_KEY` is not configured yet, the app can still generate scripts with Gemini and preview with browser speech.
- If source APIs rate-limit or fail, the app records the source error and still asks Gemini to generate from fallback context.
