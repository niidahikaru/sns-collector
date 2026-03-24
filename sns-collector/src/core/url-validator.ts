/**
 * Validate a GAS deployment URL.
 * Must be: https://script.google.com/macros/s/{deployment-id}/exec
 */
export function isValidGasUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'script.google.com' &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
