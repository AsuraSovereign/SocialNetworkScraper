// Background Service Worker
importScripts("utils/storage.js");

// Listen for messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender, sendResponse);
    return true; // Return true to indicate async response for DB ops
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

    if (state.status === "RUNNING") {
        console.log("[Background] Resuming interrupted cache population from state:", state);
        startCachePopulation(true);
    } else {
        console.log("[Background] Startup check initiated.");
        startCachePopulation(true);
    }
}

chrome.runtime.onStartup.addListener(() => checkAndResume());
chrome.runtime.onInstalled.addListener(() => checkAndResume());

async function startCachePopulation(silent = false) {
    if (isPopulating) {
        console.log("[Background] Cache population already in progress.");
        return { started: true, immediate: false };
    }

    try {
        isPopulating = true;
        await socialDB.init();

        const allMedia = await socialDB.getAll("media");
        const now = Date.now();
        const itemsToProcess = [];

        for (const media of allMedia) {
            if (!media.thumbnailUrl || media.thumbnailUrl.startsWith("data:")) continue;

            const cached = await socialDB.getThumbnail(media.thumbnailUrl);
            let needsCache = !cached;

            if (cached) {
                if (cached.error && now < cached.ttl) needsCache = false;
                else if (now >= cached.ttl) needsCache = true;
            }

            if (needsCache) itemsToProcess.push(media);
        }

        const total = itemsToProcess.length;
        console.log(`[Background] Found ${total} items needing cache update.`);

        await setPersistedState(total > 0 ? "RUNNING" : "IDLE", 0, total);

        if (total === 0) {
            console.log("[Background] 0 items to cache. Sending completion.");

            // Wait briefly to ensure UI is ready to receive the message if this was a manual click
            setTimeout(async () => {
                await broadcastProgress(0, 0, true);
            }, 100);

            isPopulating = false;
            await setPersistedState("IDLE", 0, 0);
            return { started: true, immediate: true };
        }

        // Process Queue Asynchronously
        processQueue(itemsToProcess).then(async () => {
            console.log("[Background] Queue processing finished.");

            // Set state to IDLE before broadcast so any immediate UI checks return IDLE
            isPopulating = false;
            await setPersistedState("IDLE", 0, 0);

            await new Promise((r) => setTimeout(r, 500)); // UI Debounce
            await broadcastProgress(total, total, true);
        });

        return { started: true, immediate: false };
    } catch (err) {
        console.error("[Background] Cache population error:", err);
        isPopulating = false;
        await setPersistedState("IDLE", 0, 0);
        setTimeout(() => broadcastProgress(0, 0, true), 100);
        throw err;
    }
}

async function processQueue(items) {
    let processed = 0;
    const total = items.length;

    for (const media of items) {
        if (!isPopulating) break;

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
    try {
        await chrome.runtime.sendMessage({
            action: "CACHE_PROGRESS_UPDATE",
            current,
            total,
            complete,
        });
    } catch (e) {
        // Expected if dashboard is closed
    }
}

async function handleMessage(request, sender, sendResponse) {
    // Ensure DB is ready before any operation
    try {
        await socialDB.init();
    } catch (err) {
        console.error("[Background] DB init failed in handler:", err);
        sendResponse({ success: false, error: "DB initialization failed" });
        return;
    }

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
        return true;
    } else if (request.action === "GET_CACHE_STATUS") {
        if (isPopulating) {
            getPersistedState().then((state) => {
                sendResponse({ status: "RUNNING", progress: state.progress, total: state.total });
            });
        } else {
            sendResponse({ status: "IDLE" });
        }
        return true;
    } else if (request.action === "CALCULATE_STATS") {
        socialDB
            .calculateDetailedStats()
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                console.error("[Background] Stats calculation failed:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
}

function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("ui/dashboard.html") });
}

function downloadMedia(payload) {
    if (!payload || !payload.url) return;
    chrome.downloads.download({ url: payload.url, saveAs: false });
}
