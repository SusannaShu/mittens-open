/**
 * gmailService.ts -- Gmail integration stub for open-source version.
 * No Gmail OAuth available in local-only mode.
 */

export async function connectGmail(): Promise<boolean> {
  console.log('[mittens-open] Gmail integration not available in local-only mode');
  return false;
}

export async function isGmailConnected(): Promise<boolean> {
  return false;
}

export async function getGmailAccessToken(): Promise<string | null> {
  return null;
}

export async function disconnectGmail(): Promise<void> {
  // no-op
}
