import { AppError } from "./errors.js";

export async function fetchJson(url, options = {}, timeoutMs = 9000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AppError(`Request failed: ${response.status} ${response.statusText}`, response.status, body);
  }
  return response.json();
}

export async function fetchText(url, options = {}, timeoutMs = 9000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AppError(`Request failed: ${response.status} ${response.statusText}`, response.status, body);
  }
  return response.text();
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
