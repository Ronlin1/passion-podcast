import snowflake from "snowflake-sdk";
import { config } from "../config.js";

let connectionPromise;
let initialized = false;

function enabled() {
  const sf = config.snowflake;
  return Boolean(
    sf.enabled && sf.account && sf.username && sf.password && sf.warehouse && sf.database && sf.schema,
  );
}

function quoteIdentifier(identifier) {
  const cleaned = String(identifier || "")
    .split(".")
    .map((part) => part.replace(/[^a-zA-Z0-9_]/g, ""))
    .filter(Boolean)
    .join(".");
  return cleaned || "PASSION_EPISODES";
}

function tableName() {
  return quoteIdentifier(config.snowflake.table);
}

async function getConnection() {
  if (!enabled()) return null;
  if (!connectionPromise) {
    const sf = config.snowflake;
    const connection = snowflake.createConnection({
      account: sf.account,
      username: sf.username,
      password: sf.password,
      warehouse: sf.warehouse,
      database: sf.database,
      schema: sf.schema,
      role: sf.role || undefined,
    });

    connectionPromise = new Promise((resolve, reject) => {
      connection.connect((error, conn) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(conn);
      });
    });
  }

  return connectionPromise;
}

async function execute(sqlText, binds = []) {
  const connection = await getConnection();
  if (!connection) return null;

  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete(error, statement, rows) {
        if (error) {
          reject(error);
          return;
        }
        resolve({ statement, rows });
      },
    });
  });
}

export async function initSnowflake() {
  if (!enabled() || initialized) return { enabled: enabled(), initialized };

  await execute(`
    CREATE TABLE IF NOT EXISTS ${tableName()} (
      EPISODE_ID STRING,
      TOPIC STRING,
      TITLE STRING,
      CREATED_AT TIMESTAMP_NTZ,
      TRANSCRIPT STRING,
      AUDIO_URL STRING,
      SOURCE_JSON VARIANT,
      PREMIUM_JSON VARIANT,
      PAYMENT_JSON VARIANT,
      LISTENS NUMBER
    )
  `);
  initialized = true;
  return { enabled: true, initialized: true };
}

export async function insertEpisodeIntoSnowflake(episode) {
  if (!enabled()) return { skipped: true, reason: "Snowflake disabled" };

  await initSnowflake();
  const transcript = episode.script.map((segment) => `${segment.time} ${segment.speaker}: ${segment.line}`).join("\n");
  await execute(
    `
      INSERT INTO ${tableName()}
      (EPISODE_ID, TOPIC, TITLE, CREATED_AT, TRANSCRIPT, AUDIO_URL, SOURCE_JSON, PREMIUM_JSON, PAYMENT_JSON, LISTENS)
      SELECT ?, ?, ?, CURRENT_TIMESTAMP(), ?, ?, PARSE_JSON(?), PARSE_JSON(?), PARSE_JSON(?), ?
    `,
    [
      episode.id,
      episode.topic,
      episode.title,
      transcript,
      episode.audioUrl || "",
      JSON.stringify(episode.sources || []),
      JSON.stringify(episode.premium || []),
      JSON.stringify(episode.payment || null),
      episode.listens || 0,
    ],
  );

  return { skipped: false };
}

export function snowflakeEnabled() {
  return enabled();
}
