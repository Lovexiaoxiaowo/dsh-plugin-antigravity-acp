import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
/**
 * Resolves current host OS and architecture into standard manifest platform key.
 */
export function resolvePlatformKey() {
    const platform = process.platform;
    const arch = process.arch;
    let osStr = "";
    if (platform === "win32")
        osStr = "windows";
    else if (platform === "darwin")
        osStr = "darwin";
    else if (platform === "linux")
        osStr = "linux";
    else
        throw new Error(`Unsupported operating system platform: ${platform}`);
    let archStr = "";
    if (arch === "x64")
        archStr = "x86_64";
    else if (arch === "arm64")
        archStr = "aarch64";
    else
        throw new Error(`Unsupported system architecture: ${arch}`);
    return `${osStr}-${archStr}`;
}
/**
 * Gets the standard storage directory for Antigravity runtime in DSH:
 * ~/.dsh/runtimes/antigravity/
 */
export function getDshRuntimeDir() {
    return path.join(os.homedir(), ".dsh", "runtimes", "antigravity");
}
/**
 * Reads local bundled runtime-manifest.json
 */
export function getBundledManifest(projectRoot) {
    const manifestPath = path.resolve(projectRoot, "runtime-manifest.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`runtime-manifest.json not found at ${manifestPath}`);
    }
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content);
}
/**
 * Ensures that the official Google Antigravity binary is installed locally.
 * If not present, downloads it directly from dl.google.com and extracts it.
 */
export async function ensureAntigravityServer(projectRoot, onProgress) {
    const platformKey = resolvePlatformKey();
    const runtimeDir = getDshRuntimeDir();
    const manifest = getBundledManifest(projectRoot);
    // Take the latest release
    const latestRelease = manifest.releases[manifest.releases.length - 1];
    const asset = latestRelease.platforms[platformKey];
    if (!asset) {
        throw new Error(`Platform ${platformKey} is not supported in Antigravity manifest.`);
    }
    const binaryPath = path.join(runtimeDir, asset.binaryName);
    const harnessPath = path.join(runtimeDir, asset.harnessName);
    // Check if both files exist and sizes match reasonably
    if (fs.existsSync(binaryPath)) {
        return {
            serverPath: binaryPath,
            harnessPath: fs.existsSync(harnessPath) ? harnessPath : undefined,
            args: asset.args,
        };
    }
    onProgress?.(`Starting Antigravity ACP runtime download (${latestRelease.version})...`, 0);
    fs.mkdirSync(runtimeDir, { recursive: true });
    const tempZipPath = path.join(runtimeDir, "temp_runtime.zip");
    // Step 1: Download
    await downloadFile(asset.archive, tempZipPath, (downloaded, total) => {
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : undefined;
        onProgress?.(`Downloading Antigravity runtime from Google CDN...`, percent);
    });
    // Step 2: Verify SHA256 checksum
    onProgress?.(`Verifying binary integrity checksum...`);
    const fileHash = await computeFileSha256(tempZipPath);
    if (fileHash.toLowerCase() !== asset.archiveSha256.toLowerCase()) {
        fs.unlinkSync(tempZipPath);
        throw new Error(`Checksum mismatch! Expected: ${asset.archiveSha256}, Got: ${fileHash}. Download may be corrupted.`);
    }
    // Step 3: Extract archive (using system native unpacker for high speed and zero extra dependencies)
    onProgress?.(`Extracting runtime archive to ${runtimeDir}...`);
    extractZip(tempZipPath, runtimeDir);
    fs.unlinkSync(tempZipPath);
    // Step 4: Fix permissions for non-Windows systems
    if (process.platform !== "win32") {
        if (fs.existsSync(binaryPath))
            fs.chmodSync(binaryPath, 0o755);
        if (fs.existsSync(harnessPath))
            fs.chmodSync(harnessPath, 0o755);
    }
    onProgress?.(`Antigravity ACP runtime successfully installed!`, 100);
    return {
        serverPath: binaryPath,
        harnessPath: fs.existsSync(harnessPath) ? harnessPath : undefined,
        args: asset.args,
    };
}
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https
            .get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (!redirectUrl)
                    return reject(new Error("Redirect location missing"));
                downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download: HTTP status ${response.statusCode}`));
            }
            const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
            let downloadedBytes = 0;
            response.on("data", (chunk) => {
                downloadedBytes += chunk.length;
                onProgress?.(downloadedBytes, totalBytes);
            });
            response.pipe(file);
            file.on("finish", () => {
                file.close();
                resolve();
            });
        })
            .on("error", (err) => {
            fs.unlinkSync(destPath);
            reject(err);
        });
    });
}
function computeFileSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (data) => hash.update(data));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}
function extractZip(zipFilePath, targetDir) {
    if (process.platform === "win32") {
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipFilePath}' -DestinationPath '${targetDir}' -Force"`, { stdio: "ignore" });
    }
    else {
        execSync(`unzip -o -q "${zipFilePath}" -d "${targetDir}"`, { stdio: "ignore" });
    }
}
//# sourceMappingURL=bootstrapper.js.map