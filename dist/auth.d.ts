/**
 * Returns standard token file path for Antigravity OAuth credentials:
 * ~/.gemini/antigravity-acp/acp_token.json
 */
export declare function getAntigravityTokenPath(): string;
/**
 * Checks whether user has valid local Antigravity OAuth credentials.
 */
export declare function hasLocalCredentials(): boolean;
/**
 * Retrieves or refreshes a valid Google OAuth access token.
 */
export declare function getFreshAccessToken(): Promise<string | null>;
/**
 * Clears local Antigravity credentials (logout).
 */
export declare function clearLocalCredentials(): void;
//# sourceMappingURL=auth.d.ts.map