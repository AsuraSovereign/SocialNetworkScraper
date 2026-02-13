// Background Service Worker
importScripts('utils/storage.js');

// Listen for messages from Content Scripts and Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Return true to indicate async response for DB ops
    handleMessage(request, sender, sendResponse);
    return true;
});

async function handleMessage(request, sender, sendResponse) {
    if (request.action === "SAVE_DATA") {
        await socialDB.save(request.store, request.data);
        console.log(`Saved to ${request.store}`);
        sendResponse({ success: true });
    }
    else if (request.action === "SAVE_BATCH") {
        await socialDB.saveAll(request.store, request.data);
        console.log(`Saved batch to ${request.store}`);
        sendResponse({ success: true });
    }
    else if (request.action === "OPEN_DASHBOARD") {
        openDashboard();
    }
    else if (request.action === "DOWNLOAD_MEDIA") {
        downloadMedia(request.payload);
    }
    else if (request.action === "START_CACHE_POPULATION") {
        startCachePopulation()
            .then(() => sendResponse({ started: true }))
            .catch(err => sendResponse({ started: false, error: err.message }));
        return true; // Keep channel open
    }
    else {
        // console.log("Unknown action:", request.action);
    }
}


/**
 * Opens the main Dashboard UI in a new tab
 */
function openDashboard() {
    const url = chrome.runtime.getURL("ui/dashboard.html");
    chrome.tabs.create({ url });
}

/**
 * Handles downloading of media files
 * @param {Object} mediaItem - { url, filename }
 */
function downloadMedia(mediaItem) {
    if (!mediaItem.url) {
        console.error("No URL provided for download");
        return;
    }

    chrome.downloads.download({
        url: mediaItem.url,
        filename: mediaItem.filename || `download_${Date.now()}.mp4`,
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("Download failed:", chrome.runtime.lastError);
        } else {
            console.log("Download started, ID:", downloadId);
        }
    });
}

// --- Background Cache Population ---

let isPopulating = false;

// Auto-start on extension load (browser startup / reload)
chrome.runtime.onStartup.addListener(() => {
    console.log("[Background] Startup: Checking cache status...");
    startCachePopulation(true); // silent mode
});

// Also check when installed/updated
chrome.runtime.onInstalled.addListener(() => {
    console.log("[Background] Installed: Checking cache status...");
    startCachePopulation(true);
});

async function startCachePopulation(silent = false) {
    if (isPopulating) {
        console.log("[Background] Cache population already in progress.");
        return;
    }

    try {
        isPopulating = true;
        // broadcastState('STARTING'); 

        // 1. Get Data
        await socialDB.init();
        const allMedia = await socialDB.getAll('media');
        const allThumbnails = await socialDB.getAll('thumbnails');

        // 2. Map Existing Cache
        const cachedMap = new Map();
        allThumbnails.forEach(t => cachedMap.set(t.url, t.ttl));

        const now = Date.now();
        const itemsToProcess = [];

        // 3. Identify Missing/Expired
        for (const media of allMedia) {
            if (media.thumbnailUrl && !media.thumbnailUrl.startsWith('data:')) {
                const ttl = cachedMap.get(media.thumbnailUrl);
                if (ttl === undefined || now > ttl) {
                    itemsToProcess.push(media);
                }
            }
        }

        const total = itemsToProcess.length;
        console.log(`[Background] Found ${total} items needing cache update.`);

        if (total === 0) {
            isPopulating = false;
            broadcastProgress(0, 0, true); // Complete
            return;
        }

        // 4. Process Queue (Throttled)
        let processed = 0;

        for (const media of itemsToProcess) {
            // Check if stop requested? (Not implemented yet, but good practice)

            try {
                await fetchAndCache(media.thumbnailUrl);
                processed++;
            } catch (e) {
                console.warn(`[Background] Failed to cache ${media.thumbnailUrl}`, e);
            }

            // Throttle: 200ms delay between requests to avoid blocking network/UI
            await new Promise(r => setTimeout(r, 200));

            // Broadcast Progress every 5 items or on completion
            if (processed % 5 === 0 || processed === total) {
                broadcastProgress(processed, total, processed === total);
            }
        }

    } catch (err) {
        console.error("[Background] Cache population error:", err);
    } finally {
        isPopulating = false;
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
            error: false
        });
    } catch (err) {
        // console.warn("Fetch error", err);
        // Negative Caching
        await socialDB.saveThumbnail({
            url: url,
            blob: null,
            ttl: Date.now() + ERROR_TTL,
            error: true
        });
        throw err;
    }
}

function broadcastProgress(current, total, complete = false) {
    try {
        chrome.runtime.sendMessage({
            action: "CACHE_PROGRESS_UPDATE",
            current,
            total,
            complete
        }).catch(() => {
            // Ignore error if no listeners (e.g. dashboard closed)
        });
    } catch (e) { /* safe */ }
}
