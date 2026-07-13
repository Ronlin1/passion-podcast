export function isNetlifyRuntime() {
  return Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function getBlobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  return getStore(name, { consistency: "strong" });
}
