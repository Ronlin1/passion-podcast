import serverless from "serverless-http";
import { app, initializeApp } from "../../src/app.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initializeApp();
    initialized = true;
  }
}

const expressHandler = serverless(app);

export async function handler(event, context) {
  await ensureInitialized();
  return expressHandler(event, context);
}
