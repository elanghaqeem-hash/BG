/**
 * Canonical, environment-controlled QR verification URL.
 *
 * Never use Host, X-Forwarded-Host or browser-supplied Origin to choose the
 * verification destination. A deployment variable, not a caller header,
 * pins the public BG portal domain. Existing Worker URLs remain the fallback
 * for a private sandbox without a configured public portal.
 */
export function publicVerificationUrl(
  configuredOrigin: string | undefined,
  workerOrigin: string,
  token: string,
): string {
  const origin = new URL(configuredOrigin?.trim() || workerOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !origin.hostname
  ) {
    throw new Error("BG_VERIFY_ORIGIN_INVALID");
  }
  if (!token || token.length > 200) {
    throw new Error("BG_VERIFY_TOKEN_INVALID");
  }
  return new URL("/verify/" + encodeURIComponent(token), origin).toString();
}
