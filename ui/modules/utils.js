/**
 * Utility Functions
 */

export function formatColumnName(col) {
    const map = {
        originalUrl: "Video URL",
        scrapedAt: "Date Scraped",
        userId: "Username",
        platform: "Platform",
        videoId: "Video ID",
        thumbnailUrl: "Thumbnail URL",
    };
    return map[col] || col;
}

export function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function generateExportFilename(extension, platform, user) {
    const p = platform === "ALL" ? "AllPlatforms" : platform;
    const u = user === "ALL" ? "AllUsers" : user;
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const type = extension === "txt" ? "URLs" : "Data";
    return `SocialScraper_${p}_${u}_${type}_${date}.${extension}`;
}

export function showPlaceholder(thumbDiv, media, msg = null) {
    const parts = media.originalUrl ? media.originalUrl.split("/") : ["Unknown"];
    const videoId = parts[parts.length - 1].split("?")[0] || "Unknown";

    thumbDiv.classList.add("placeholder");
    thumbDiv.classList.remove("loading");
    thumbDiv.innerHTML = `
        <div style="flex-direction: column; padding: 10px; text-align: center;">
            <span style="font-size: 0.8rem; color: #888; margin-bottom: 5px;">ID: ${videoId}</span>
            ${msg ? `<span style="font-size: 0.7rem; color: #ff0050;">${msg}</span>` : ""}
        </div>
    `;
}

/**
 * Sanitize a string for use as a filename.
 * Removes characters that are invalid in Windows/Mac/Linux filenames.
 */
export function sanitizeFilename(str) {
    if (!str) return "unknown";
    return (
        str
            .replace(/[\/\\:*?"<>|]/g, "_")
            .replace(/\s+/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "") || "unknown"
    );
}
