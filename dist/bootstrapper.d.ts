import type { TrustedRuntimeManifest } from "./types.js";
/**
 * Resolves current host OS and architecture into standard manifest platform key.
 */
export declare function resolvePlatformKey(): string;
/**
 * Gets the standard storage directory for Antigravity runtime in DSH:
 * ~/.dsh/runtimes/antigravity/
 */
export declare function getDshRuntimeDir(): string;
/**
 * Reads local bundled runtime-manifest.json
 */
export declare function getBundledManifest(projectRoot: string): TrustedRuntimeManifest;
/**
 * Ensures that the official Google Antigravity binary is installed locally.
 * If not present, downloads it directly from dl.google.com and extracts it.
 */
export declare function ensureAntigravityServer(projectRoot: string, onProgress?: (status: string, percent?: number) => void): Promise<{
    serverPath: string;
    harnessPath?: string;
    args: string[];
}>;
//# sourceMappingURL=bootstrapper.d.ts.map