/**
 * Stats Tab Logic
 */

let cachePopulateBtn = null;

export function initStats() {
    // Initial Render
    renderStats();

    // Setup Listeners if needed (mostly internal to renderStats which is called on tab switch)
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

    // Populate User Filter (Shared with other tabs, but managed here as it's part of stats loading usually)
    const userList = await window.socialDB.getUniqueUsers();

    // Helpers to populate selects in other tabs
    populateSelect("filter-user", userList);
    populateSelect("export-user", userList);
    populateSelect("delete-user", userList);

    setupCacheButtons();
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
    const btnPopulateVal = document.getElementById("btn-populate-cache");
    const btnClearVal = document.getElementById("btn-clear-cache");

    if (btnPopulateVal) {
        // Clone to remove old listeners
        cachePopulateBtn = btnPopulateVal.cloneNode(true);
        btnPopulateVal.parentNode.replaceChild(cachePopulateBtn, btnPopulateVal);

        cachePopulateBtn.addEventListener("click", () => {
            cachePopulateBtn.disabled = true;
            cachePopulateBtn.textContent = "Requesting...";

            chrome.runtime.sendMessage({ action: "START_CACHE_POPULATION" }, (response) => {
                if (chrome.runtime.lastError) {
                    cachePopulateBtn.textContent = "Failed";
                    cachePopulateBtn.disabled = false;
                    console.error(chrome.runtime.lastError);
                    setTimeout(() => {
                        cachePopulateBtn.textContent = "Populate Cache";
                    }, 2000);
                } else if (response && response.started) {
                    if (response.immediate) {
                        console.log("Cache population completed immediately.");
                        setTimeout(() => {
                            if (cachePopulateBtn.textContent === "Requesting...") {
                                cachePopulateBtn.textContent = "Populate Cache";
                                cachePopulateBtn.disabled = false;
                            }
                        }, 500);
                    } else {
                        cachePopulateBtn.textContent = "Starting...";
                    }
                } else {
                    cachePopulateBtn.textContent = "Error";
                    cachePopulateBtn.disabled = false;
                    if (response && response.error) {
                        alert("Error: " + response.error);
                    }
                }
            });
        });
    }

    if (btnClearVal) {
        const newBtn = btnClearVal.cloneNode(true);
        btnClearVal.parentNode.replaceChild(newBtn, btnClearVal);

        newBtn.addEventListener("click", async () => {
            alert("Functionality is currently disabled");
        });
    }
}

export function setupCacheProgressListener() {
    console.log("[Dashboard] Setting up cache progress listener");
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "CACHE_PROGRESS_UPDATE") {
            const { current, total, complete } = request;

            if (!cachePopulateBtn) {
                // If button isn't localized yet, try to find it
                const btn = document.getElementById("btn-populate-cache");
                if (btn) cachePopulateBtn = btn;
                else return;
            }

            if (complete) {
                cachePopulateBtn.textContent = "Populate Cache";
                cachePopulateBtn.disabled = false;
                renderStorageStats();
            } else {
                cachePopulateBtn.disabled = true;
                cachePopulateBtn.textContent = `Populating... (${current}/${total})`;
            }
        }
    });
}

export function checkCacheStatus() {
    if (!cachePopulateBtn) {
        const btn = document.getElementById("btn-populate-cache");
        if (btn) cachePopulateBtn = btn;
        else return;
    }

    chrome.runtime.sendMessage({ action: "GET_CACHE_STATUS" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.status === "RUNNING") {
            cachePopulateBtn.disabled = true;
            cachePopulateBtn.textContent = `Populating... (${response.progress}/${response.total})`;
        }
    });
}

export async function renderStorageStats() {
    try {
        const stats = await window.socialDB.getStorageUsage();

        const formatSize = (bytes) => {
            if (bytes === 0) return "0 B";
            const k = 1024;
            const sizes = ["B", "KB", "MB", "GB"];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
        };

        const set = (id, txt) => {
            const el = document.getElementById(id);
            if (el) el.textContent = txt;
        };

        set("stat-db-usage", formatSize(stats.totalSizeBytes));
        set("stat-thumb-usage", `Thumbnails: ${formatSize(stats.thumbnailSizeBytes)}`);
        set("stat-top-user", stats.topUser.userId !== "None" ? stats.topUser.userId : "-");
        set("stat-top-user-size", `Size: ${formatSize(stats.topUser.size)}`);
        set("stat-cache-count", stats.counts.cachedThumbnails);
        set("stat-cache-missing", stats.counts.videosNotCached);
        set("stat-cache-expired", stats.counts.expiredThumbnails);
        set("stat-cache-invalid", stats.counts.invalidThumbnails);
    } catch (err) {
        console.error("Error rendering storage stats:", err);
    }
}
