/**
 * Release boundary for the BG MVP.
 *
 * Only the explicitly provisioned SANDBOX runtime is supported. A different,
 * missing, or malformed mode must never silently enable financial operations.
 * This predicate does NOT authorize real-money production.
 */
export function sandboxRuntimePermitted(mode: unknown): mode is "SANDBOX" {
  return mode === "SANDBOX";
}
