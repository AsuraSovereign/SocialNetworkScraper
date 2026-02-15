/**
 * Stats Tab Logic
 */

export function initStats() {
    // Run setup once when the app initializes
    setupCacheButtons();
    setupCacheProgressListener();
    renderStats();
}

export async function renderStats() {
    const elVideos = document.getElementById("stat-total-videos");
    if (!elVideos) return;

    // Use optimized getStorageUsage
    const stats = await window.socialDB.getStorageUsage();

    const totalVideos = stats.counts.totalVideos;
    const users = stats.counts.totalUsers;
    const lastScrape = stats.counts.lastScraped > 0 ? new Date(stats.counts.lastScraped).toLocaleString() : "Never";

    elVideos.textContent = totalVideos;
    document.getElementById("stat-total-users").textContent = users;
    document.getElementById("stat-last-active").textContent = lastScrape;

    // Populate User Filter
    const userList = await window.socialDB.getUniqueUsers();
    populateSelect("filter-user", userList);
    populateSelect("export-user", userList);
    populateSelect("delete-user", userList);

    // Sync button state with current background process
    checkCacheStatus();
    renderStorageStats();
}

function populateSelect(id, userList) {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="ALL">All Users</option>';
    userList.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
    });
    if (current && (userList.includes(current) || current === "ALL")) select.value = current;
}

function setupCacheButtons() {
    const btn = document.getElementById("btn-populate-cache");
    if (!btn) return;

    // Direct listener attachment (no cloning needed as this runs once)
    btn.addEventListener("click", () => {
        // 1. Immediate Feedback
        updateButtonState("REQUESTING");

        // 2. Send Command
        chrome.runtime.sendMessage({ action: "START_CACHE_POPULATION" }, (response) => {
            // 3. Handle Communication Errors ONLY
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                updateButtonState("ERROR");
                return;
            }

            if (response && response.error) {
                alert("Error: " + response.error);
                updateButtonState("ERROR");
                return;
            }

            // 4. On Success: Do NOTHING.
            // We rely on the "CACHE_PROGRESS_UPDATE" message to update the UI.
            // This prevents race conditions between this callback and the broadcast.
        });
    });
}

export function setupCacheProgressListener() {
    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "CACHE_PROGRESS_UPDATE") {
            const { current, total, complete } = request;

            if (complete) {
                updateButtonState("IDLE");
                renderStorageStats(); // Refresh stats when done
            } else {
                updateButtonState("RUNNING", { current, total });
            }
        }
    });
}

export function checkCacheStatus() {
    chrome.runtime.sendMessage({ action: "GET_CACHE_STATUS" }, (response) => {
        if (chrome.runtime.lastError) return;

        if (response && response.status === "RUNNING") {
            updateButtonState("RUNNING", { current: response.progress, total: response.total });
        } else {
            // Only force IDLE if we are sure it's not requesting
            const btn = document.getElementById("btn-populate-cache");
            if (btn && btn.textContent !== "Requesting...") {
                updateButtonState("IDLE");
            }
        }
    });
}

/**
 * Centralized Button State Manager
 */
function updateButtonState(state, data = {}) {
    const btn = document.getElementById("btn-populate-cache");
    if (!btn) return;

    switch (state) {
        case "IDLE":
            btn.textContent = "Populate Cache";
            btn.disabled = false;
            break;
        case "REQUESTING":
            btn.textContent = "Requesting...";
            btn.disabled = true;
            break;
        case "RUNNING":
            btn.textContent = `Populating... (${data.current}/${data.total})`;
            btn.disabled = true;
            break;
        case "ERROR":
            btn.textContent = "Failed (Retry)";
            btn.disabled = false;
            break;
    }
}

export async function renderStorageStats() {
    try {
        const stats = await window.socialDB.getStorageUsage();
        const formatSize = (bytes) => {
            if (bytes == null || bytes === 0) return "N/A";
            const k = 1024;
            const sizes = ["B", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
        };

        const set = (id, txt) => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
        };

        set("stat-db-usage", stats.totalSizeBytes != null ? formatSize(stats.totalSizeBytes) : `${stats.counts.totalVideos} items`);
        set("stat-thumb-usage", stats.thumbnailSizeBytes != null ? `Thumbnails: ${formatSize(stats.thumbnailSizeBytes)}` : `Thumbnails: ${stats.counts.totalThumbnails || 0} cached`);
        set("stat-top-user", stats.topUser.userId !== "None" ? stats.topUser.userId : "-");
        set("stat-top-user-size", stats.topUser.count != null ? `Items: ${stats.topUser.count}` : stats.topUser.size != null ? `Size: ${formatSize(stats.topUser.size)}` : "");
        set("stat-cache-count", stats.counts.cachedThumbnails);
        set("stat-cache-missing", stats.counts.videosNotCached);
        set("stat-cache-expired", stats.counts.expiredThumbnails);
        set("stat-cache-failed", stats.counts.failedThumbnails);
        set("stat-cache-invalid", stats.counts.invalidThumbnails);
        set("stat-cache-orphaned", stats.counts.orphanedThumbnails > 0 ? `${stats.counts.orphanedThumbnails}` : "0");
        set("stat-cache-duplicates", stats.counts.duplicateThumbnails != null && stats.counts.duplicateThumbnails > 0 ? `${stats.counts.duplicateThumbnails}` : "0");
    } catch (err) {
        console.error("Error rendering storage stats:", err);
    }
}
