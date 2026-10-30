import fs from "node:fs";
import path from "node:path";
import os from "node:os";
/**
 * Returns standard token file path for Antigravity OAuth credentials:
 * ~/.gemini/antigravity-acp/acp_token.json
 */
export function getAntigravityTokenPath() {
    const geminiHome = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini");
    return path.join(geminiHome, "antigravity-acp", "acp_token.json");
}
/**
 * Checks whether user has valid local Antigravity OAuth credentials.
 */
export function hasLocalCredentials() {
    const tokenPath = getAntigravityTokenPath();
    if (!fs.existsSync(tokenPath)) {
        return false;
    }
    try {
        const raw = fs.readFileSync(tokenPath, "utf-8");
        const json = JSON.parse(raw);
        return Boolean(json && (json.access_token || json.refresh_token));
    }
    catch {
        return false;
    }
}
/**
 * Clears local Antigravity credentials (logout).
 */
export function clearLocalCredentials() {
    const tokenPath = getAntigravityTokenPath();
    if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
    }
}
//# sourceMappingURL=auth.js.map