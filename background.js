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
