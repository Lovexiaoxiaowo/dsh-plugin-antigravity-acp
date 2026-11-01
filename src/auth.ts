import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns standard token file path for Antigravity OAuth credentials:
 * ~/.gemini/antigravity-acp/acp_token.json
 */
export function getAntigravityTokenPath(): string {
  const geminiHome = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
  return path.join(geminiHome, "antigravity-acp", "acp_token.json");
}

/**
 * Returns standard cache file path for Antigravity supported models:
 * ~/.gemini/antigravity-acp/acp_models_cache.json
 */
export function getAntigravityModelsCachePath(): string {
  const geminiHome = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
  return path.join(geminiHome, "antigravity-acp", "acp_models_cache.json");
}

/**
 * Checks whether user has valid local Antigravity OAuth credentials.
 */
export function hasLocalCredentials(): boolean {
  const tokenPath = getAntigravityTokenPath();
  if (!fs.existsSync(tokenPath)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(tokenPath, "utf-8");
    const json = JSON.parse(raw);
    return Boolean(json && (json.access_token || json.refresh_token));
  } catch {
    return false;
  }
}

/**
 * Retrieves or refreshes a valid Google OAuth access token.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const tokenPath = getAntigravityTokenPath();
  if (!fs.existsSync(tokenPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(tokenPath, "utf-8");
    const json = JSON.parse(raw);

    // If access_token exists and not expired (with 60s buffer)
    if (json.access_token && json.expires_at && Date.now() < json.expires_at - 60_000) {
      return json.access_token;
    }

    if (!json.refresh_token) {
      return json.access_token || null;
    }

    // Refresh token via OAuth endpoint
    const tokenUri = json.token_uri || "https://oauth2.googleapis.com/token";
    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: json.client_id,
        client_secret: json.client_secret,
        refresh_token: json.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      return json.access_token || null;
    }

    const refreshed = await res.json();
    if (refreshed.access_token) {
      json.access_token = refreshed.access_token;
      json.expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
      fs.writeFileSync(tokenPath, JSON.stringify(json, null, 2), "utf-8");
      return refreshed.access_token;
    }

    return json.access_token || null;
  } catch (err) {
    console.error("[antigravity-acp] failed to refresh access token:", err);
    return null;
  }
}

/**
 * Clears local Antigravity credentials (logout).
 */
export function clearLocalCredentials(): void {
  const tokenPath = getAntigravityTokenPath();
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
  const geminiHome = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
  const settingsPath = path.join(geminiHome, "antigravity-acp", "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      delete settings.auth;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    } catch {
      // ignore
    }
  }
}
