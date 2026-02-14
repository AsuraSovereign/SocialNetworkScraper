// Background Service Worker
importScripts("utils/storage.js");

// Listen for messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Return true to indicate async response for DB ops
    handleMessage(request, sender, sendResponse);
    return true;
});

// --- Background Cache Population ---

let isPopulating = false;
const CACHE_STATE_KEY = "cache_population_state";

// State helper
async function getPersistedState() {
    return new Promise((resolve) => {
        chrome.storage.local.get([CACHE_STATE_KEY], (result) => {
            resolve(result[CACHE_STATE_KEY] || { status: "IDLE", progress: 0, total: 0 });
        });
    });
}

async function setPersistedState(status, progress, total) {
    const state = { status, progress, total, lastUpdated: Date.now() };
    return new Promise((resolve) => {
        chrome.storage.local.set({ [CACHE_STATE_KEY]: state }, resolve);
    });
}

// Auto-start or Resume logic
async function checkAndResume() {
    console.log("[Background] Checking for interrupted cache population...");
    const state = await getPersistedState();

    // Resume if it was running
    if (state.status === "RUNNING") {
        console.log("[Background] Resuming interrupted cache population from state:", state);
        startCachePopulation(true); // silent start
    } else {
        // Also check if we should auto-start on fresh install/startup logic?
        // Original code had auto-start on every startup.
        // Let's keep that but maybe be smarter.
        // If IDLE, we can do a quick check?
        // For now, preserving original behavior: run on startup.
        console.log("[Background] Startup check initiated.");
        startCachePopulation(true);
    }
}

// Auto-start on extension load (browser startup / reload)
chrome.runtime.onStartup.addListener(() => {
    checkAndResume();
});

// Also check when installed/updated
chrome.runtime.onInstalled.addListener(() => {
    checkAndResume();
});

async function startCachePopulation(silent = false) {
    if (isPopulating) {
        console.log("[Background] Cache population already in progress.");
        // If start request comes in while running, we accept it.
        return { started: true, immediate: false };
    }

    try {
        isPopulating = true;

        // 1. Get Data
        await socialDB.init();

        // Optimize: Use getAllKeys if possible in future.
        const allMedia = await socialDB.getAll("media");
        let processed = 0;

        const totalCandidates = allMedia.length;
        let queued = 0;
        const now = Date.now();

        // We need to identify items to process to know if we are done immediately.
        // Doing this scan requires iterating.

        const itemsToProcess = [];

        for (const media of allMedia) {
            if (!media.thumbnailUrl || media.thumbnailUrl.startsWith("data:")) continue;

            // Check Cache
            const cached = await socialDB.getThumbnail(media.thumbnailUrl);

            let needsCache = false;
            if (!cached) {
                needsCache = true;
            } else if (cached.error && now < cached.ttl) {
                needsCache = false;
            } else if (now >= cached.ttl) {
                needsCache = true;
            }

            if (needsCache) itemsToProcess.push(media);
        }

        const total = itemsToProcess.length;
        console.log(`[Background] Found ${total} items needing cache update.`);

        await setPersistedState(total > 0 ? "RUNNING" : "IDLE", 0, total);

        if (total === 0) {
            // isPopulating = false; // WAIT! Keep true until we broadcast complete.
            // Actually, for immediate return, we can set false BUT we must ensure UI gets the message.

            console.log("[Background] 0 items to cache. Sending completion immediately.");

            // Broadcast complete immediately
            await broadcastProgress(0, 0, true);

            isPopulating = false;
            await setPersistedState("IDLE", 0, 0);

            return { started: true, immediate: true };
        }

        // 4. Process Queue (Async - do not await loop for return)
        processQueue(itemsToProcess).then(async () => {
            console.log("[Background] Queue processing finished.");
            // Wait a moment before broadcasting completion to ensure UI has received all progress updates
            // and to prevents race conditions where 'complete' arrives before 'progress'
            await new Promise((r) => setTimeout(r, 500));

            await broadcastProgress(total, total, true);
            isPopulating = false;
            await setPersistedState("IDLE", 0, 0);
        });

        return { started: true, immediate: false };
    } catch (err) {
        console.error("[Background] Cache population error:", err);
        // Ensure we reset state and notify UI of error/completion even on failure
        isPopulating = false;
        await setPersistedState("IDLE", 0, 0);

        // Broadcast completion with error state implicitly (complete=true resets UI)
        setTimeout(() => broadcastProgress(0, 0, true), 100);
        throw err;
    }
}

async function processQueue(items) {
    let processed = 0;
    const total = items.length;

    for (const media of items) {
        if (!isPopulating) break; // Check for cancellation if we implement it

        try {
            await fetchAndCache(media.thumbnailUrl);
            processed++;
        } catch (e) {
            console.warn(`[Background] Failed to cache ${media.thumbnailUrl}`, e);
        }

        await new Promise((r) => setTimeout(r, 200)); // Throttle

        await broadcastProgress(processed, total, processed === total);
        await setPersistedState("RUNNING", processed, total);
    }
}

async function fetchAndCache(url) {
    const TTL = 7 * 24 * 60 * 60 * 1000; // 7 Days
    const ERROR_TTL = 24 * 60 * 60 * 1000; // 24 Hours

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();

        await socialDB.saveThumbnail({
            url: url,
            blob: blob,
            ttl: Date.now() + TTL,
            error: false,
        });
    } catch (err) {
        // console.warn("Fetch error", err);
        // Negative Caching
        await socialDB.saveThumbnail({
            url: url,
            blob: null,
            ttl: Date.now() + ERROR_TTL,
            error: true,
        });
        throw err;
    }
}

async function broadcastProgress(current, total, complete = false) {
    // console.log(`[Background] Broadcasting progress: ${current}/${total}, complete: ${complete}`);
    try {
        await chrome.runtime.sendMessage({
            action: "CACHE_PROGRESS_UPDATE",
            current,
            total,
            complete,
        });
    } catch (e) {
        // This is expected if dashboard is closed
        // console.log(`[Background] No listeners for progress update`);
    }
}

async function handleMessage(request, sender, sendResponse) {
    if (request.action === "SAVE_DATA") {
        await socialDB.save(request.store, request.data);
        console.log(`Saved to ${request.store}`);
        sendResponse({ success: true });
    } else if (request.action === "SAVE_BATCH") {
        await socialDB.saveAll(request.store, request.data);
        console.log(`Saved batch to ${request.store}`);
        sendResponse({ success: true });
    } else if (request.action === "OPEN_DASHBOARD") {
        openDashboard();
    } else if (request.action === "DOWNLOAD_MEDIA") {
        downloadMedia(request.payload);
    } else if (request.action === "START_CACHE_POPULATION") {
        startCachePopulation()
            .then(() => sendResponse({ started: true }))
            .catch((err) => sendResponse({ started: false, error: err.message }));
        return true; // Keep channel open
    } else if (request.action === "GET_CACHE_STATUS") {
        // Return current state (from memory or storage)
        if (isPopulating) {
            // If running, we can just return a generic "Running" or fetch latest calling getPersistedState
            getPersistedState().then((state) => {
                sendResponse({ status: "RUNNING", progress: state.progress, total: state.total });
            });
        } else {
            sendResponse({ status: "IDLE" });
        }
        return true;
    } else {
        // console.log("Unknown action:", request.action);
    }
}

function downloadMedia(payload) {
    if (!payload || !payload.url) return;

    chrome.downloads.download(
        {
            url: payload.url,
            saveAs: false, // Download immediately
        },
        (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError);
            } else {
                console.log("Download started:", downloadId);
            }
        },
    );
}
