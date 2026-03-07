class TikTokScraper extends BaseScraper {
    constructor(privacySetting = "HIDDEN_UNTIL_DONE", efficientScrolling = "Efficient") {
        super("TikTok");
        this.privacySetting = privacySetting;
        this.efficientScrolling = efficientScrolling;
        this.newLinksBuffer = new Set();
        this.observer = null;
        this.topUser = null;
        this.pendingInvalidItems = new Map(); // Track invalid thumbnails { href: { element, strikes } }
    }

    startObserver() {
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            // ELEMENT_NODE
                            if (node.tagName === "A") {
                                this.newLinksBuffer.add(node);
                            } else {
                                const anchors = node.querySelectorAll("a");
                                anchors.forEach((a) => this.newLinksBuffer.add(a));
                            }
                        }
                    });
                }
            }
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Also add existing links to the buffer on start
        document.querySelectorAll("a").forEach((a) => this.newLinksBuffer.add(a));
    }

    stopObserver() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.newLinksBuffer.clear();
    }

    /**
     * Extracts username from a URL
     * @param {string} url
     */
    getUsernameFromUrl(url) {
        try {
            const parts = url.split("/");
            const domainIndex = parts.findIndex((p) => p.includes("tiktok.com"));
            if (domainIndex === -1 || !parts[domainIndex + 1]) return "";

            const usernamePart = parts[domainIndex + 1];
            return usernamePart.split("?")[0].replace(/^@/, "");
        } catch (e) {
            console.error("Error extracting username:", e);
            return "";
        }
    }

    /**
     * Checks if a thumbnail URL is considered valid (not a base64 placeholder)
     * @param {string|null} url
     * @returns {boolean}
     */
    isValidThumbnail(url) {
        if (!url) return false;
        return !url.startsWith("data:image/");
    }

    /**
     * Main scrape execution context
     */
    async scrape() {
        if (this.isScraping) return;
        this.isScraping = true;

        this.setPrivacyOverlay(this.privacySetting);

        this.showNotification("Starting TikTok Scrape...", "info");
        console.log("Starting TikTok Scrape...");

        this.startObserver();

        try {
            // 1. Auto-scroll to load content
            // We pass a callback to extraction logic to run periodically if we wanted "EVERYLOOP" mode,
            // but typically we scroll first then extract, or extract incrementally.
            // For this implementation, we'll try to extract periodically to be safe against crashes.

            await this.autoScroll(
                200,
                2000,
                async () => {
                    await this.extractAndSave();

                    if (this.efficientScrolling === "Aggressive") {
                        const postItems = document.getElementById("user-post-item-list");
                        if (postItems && postItems.childNodes.length > 400) {
                            console.log(`Aggressive cleanup triggered... Current items: ${postItems.childNodes.length}`);

                            // Get a list of pending invalid hrefs for fast lookup
                            const pendingHrefs = new Set(this.pendingInvalidItems.keys());

                            let count = 0;
                            let i = 0;

                            while (count < 200 && i < postItems.childNodes.length) {
                                const node = postItems.childNodes[i];

                                // Rule A: Check if this node contains any pending invalid items
                                let skipDeletion = false;
                                if (node.nodeType === 1) {
                                    // ELEMENT_NODE
                                    const anchors = Array.from(node.querySelectorAll("a"));
                                    for (const a of anchors) {
                                        if (pendingHrefs.has(a.href)) {
                                            const pendingData = this.pendingInvalidItems.get(a.href);
                                            // Only save it if it hasn't completely struck out yet
                                            if (pendingData && pendingData.strikes < 3) {
                                                skipDeletion = true;
                                                break;
                                            }
                                        }
                                    }
                                }

                                if (skipDeletion) {
                                    // Skip this node, leave it in the DOM so it can load
                                    i++;
                                } else {
                                    // Safe to delete
                                    postItems.removeChild(node);
                                    count++;
                                }
                            }

                            // Wait for DOM to 'reload' or stabilize after massive deletion
                            await this.sleep(4000);
                            console.log("Aggressive cleanup finished.");
                            return "RESET_HEIGHT"; // Signal loop to adjust height tracking
                        }
                    }

                    return false; // Don't stop scrolling yet
                },
                this.efficientScrolling,
            );

            // Final pass - Force update of any data URIs
            await this.extractAndSave(true);
        } catch (err) {
            console.error("Scrape error:", err);
            this.showNotification("Scrape error occurred", "error");
        } finally {
            this.stopObserver();
            this.stop();

            if (this.privacySetting === "HIDDEN_UNTIL_DONE") {
                this.setPrivacyOverlay("OFF");
            } else if (this.privacySetting === "ALWAYS_HIDDEN") {
                this.updatePrivacyOverlayState("DONE");
            }

            this.showNotification("TikTok Scrape Complete!", "success");
            console.log("TikTok Scrape Complete.");
        }
    }

    /**
     * Extraction Logic
     */
    /**
     * Helper to find best thumbnail from an anchor element
     * Adapted from user provided logic
     */
    getThumbnailFromAnchor(a) {
        const picture = a.querySelector("picture");
        const source = picture ? picture.querySelector("source") : a.querySelector("source");
        if (!a.querySelector) return null; // Safety check
        const img = a.querySelector("img") || (picture && picture.querySelector("img"));

        let rawSrc = null;
        let srcset = null;

        // Prefer <source> type attribute if present
        if (source) {
            rawSrc = source.getAttribute("src") || source.getAttribute("srcset") || null;
            srcset = source.getAttribute("srcset") || null;
        }

        // Fallback to <img>
        if (!rawSrc && img) {
            rawSrc = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy") || null;
            srcset = img.getAttribute("srcset") || null;
        }

        if (!rawSrc && !srcset) return null;

        // If srcset exists, pick the highest density candidate
        if (srcset) {
            try {
                const candidates = srcset
                    .split(",")
                    .map((s) => s.trim())
                    .map((part) => {
                        const [url, descriptor] = part.split(/\s+/);
                        const value = descriptor ? parseFloat(descriptor) : 1;
                        return { url, value: isNaN(value) ? 1 : value };
                    });
                candidates.sort((a, b) => b.value - a.value);
                return candidates[0].url;
            } catch (e) {
                return rawSrc;
            }
        }

        return rawSrc;
    }

    async extractAndSave(forceScan = false) {
        // Cleanup map: remove items that are no longer in the DOM to prevent memory leaks
        for (const [href, data] of this.pendingInvalidItems.entries()) {
            if (!document.body.contains(data.element)) {
                this.pendingInvalidItems.delete(href);
            }
        }

        // Get all anchors
        let links;
        if (forceScan) {
            links = Array.from(document.querySelectorAll("a"));
        } else {
            // Merge newly observed links with still-pending invalid links
            links = Array.from(this.newLinksBuffer);
            this.newLinksBuffer.clear();

            for (const data of this.pendingInvalidItems.values()) {
                if (document.body.contains(data.element)) {
                    links.push(data.element);
                }
            }

            // Deduplicate the combined list
            links = [...new Set(links)];
        }

        if (links.length === 0) return;

        // Map to objects first so we keep the element reference
        const potentialItems = links
            .map((a) => ({
                element: a,
                href: a.href,
                user: this.getUsernameFromUrl(a.href),
            }))
            .filter((item) => item.href.includes("/video/") || item.href.includes("/photo/"));

        if (this.topUser === null) {
            const locationUser = this.getUsernameFromUrl(location.href);
            console.log(locationUser);
            if (locationUser != "") {
                this.topUser = locationUser;
            } else {
                // Identify Scraped User (Most frequent user in list based on full document scan once)
                let maxCount = 0;
                const userCounts = {};
                const allLinks = Array.from(document.querySelectorAll("a"));
                const allPotentialItems = allLinks.map((a) => ({ user: this.getUsernameFromUrl(a.href) })).filter((item) => item.user);

                allPotentialItems.forEach((item) => {
                    userCounts[item.user] = (userCounts[item.user] || 0) + 1;
                    if (userCounts[item.user] > maxCount) {
                        maxCount = userCounts[item.user];
                        this.topUser = item.user;
                    }
                });

                if (!this.topUser) this.topUser = "UNKNOWN";
            }
        }

        if (this.topUser === "UNKNOWN" || !this.topUser) return;

        const topUser = this.topUser;

        // Filter items belonging to the Top User
        const targetItems = potentialItems.filter((item) => item.user === topUser);

        let itemsToSave;

        if (forceScan) {
            // In forceScan mode, we process ALL items on the page to update potential data URIs
            // StorageUtils.saveAll will handle the logic to only update if we have a better thumbnail
            itemsToSave = targetItems;
            console.log(`[ForceScan] Checking ${itemsToSave.length} items for thumbnail updates...`);
            this.showNotification(`Finalizing: checking ${itemsToSave.length} items for better thumbnails...`, "info");
        } else {
            // Normal mode: check for invalid thumbnails and enforce strikes
            const validItems = [];

            for (const item of targetItems) {
                const thumbUrl = this.getThumbnailFromAnchor(item.element);
                const isValid = this.isValidThumbnail(thumbUrl);

                if (isValid) {
                    // It's valid now. If it was pending, remove it.
                    this.pendingInvalidItems.delete(item.href);
                    validItems.push(item);
                } else {
                    // Invalid (base64 or null). Apply 3-Strike Rule B
                    if (!this.pendingInvalidItems.has(item.href)) {
                        this.pendingInvalidItems.set(item.href, { element: item.element, strikes: 0 });
                    }

                    const pendingData = this.pendingInvalidItems.get(item.href);

                    // Only increment strikes in Aggressive Mode
                    if (this.efficientScrolling === "Aggressive") {
                        pendingData.strikes++;

                        if (pendingData.strikes >= 3) {
                            console.log(`[Strike 3] Removing element for invalid thumbnail: ${item.href}`);

                            // Try to remove the parent container if we can find it
                            // TikTok typically nests videos in divs within the user-post-item-list
                            let parent = item.element;
                            let removed = false;

                            // Traverse up to find the direct child of user-post-item-list
                            while (parent && parent !== document.body) {
                                if (parent.parentNode && parent.parentNode.id === "user-post-item-list") {
                                    parent.parentNode.removeChild(parent);
                                    removed = true;
                                    break;
                                }
                                parent = parent.parentNode;
                            }

                            // Fallback if structure is different
                            if (!removed && item.element.parentNode) {
                                item.element.parentNode.removeChild(item.element);
                            }

                            // Permanently drop from tracking map
                            this.pendingInvalidItems.delete(item.href);
                        }
                    }
                    // Do not push to validItems; skip saving for now
                }
            }

            // check if the *valid* items are actually new to the database
            const itemsWithThumbs = validItems.map((i) => ({
                id: i.href,
                thumbnailUrl: this.getThumbnailFromAnchor(i.element),
            }));
            const newItems = this.filterNewItems(itemsWithThumbs);
            if (newItems.length === 0) return;
            const newItemIds = newItems.map((i) => (typeof i === "object" ? i.id : i));
            itemsToSave = validItems.filter((item) => newItemIds.includes(item.href));
        }

        if (itemsToSave.length === 0) return;

        if (!forceScan) {
            // Only notify for "Found new items" in normal mode
            const msg = `Found ${itemsToSave.length} new items for ${topUser}`;
            console.log(msg);
            this.showNotification(msg, "success");
        }

        // Save Media Items with Thumbnails
        const mediaItems = itemsToSave.map((item) => {
            // Re-extract thumbnail (in case we waited and it loaded, OR just to get the current state)
            const thumbUrl = this.getThumbnailFromAnchor(item.element);

            return {
                id: item.href,
                userId: topUser,
                platform: "TikTok",
                originalUrl: item.href,
                thumbnailUrl: thumbUrl,
                scrapedAt: Date.now(),
                downloadStatus: "PENDING",
            };
        });

        chrome.runtime.sendMessage({
            action: "SAVE_BATCH",
            store: "media",
            data: mediaItems,
        });
        // Notify Background to Download?
        // User asked to "export urls" and "download videos".
        // We can trigger downloads here or let the user do it from Dashboard.
        // Given the requirement "It should be able to download", we'll might want to queue them.
        // For now, we just save. The Dashboard will handle the "Download All" action.
    }
}

// Auto-initialize if on correct page?
// Or wait for message from Popup?
// Typically we wait for a message.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SCRAPE_TIKTOK") {
        console.log("Received START_SCRAPE_TIKTOK", request);
        const scraper = new TikTokScraper(request.privacySetting, request.efficientScrolling);
        console.log("Created Scraper with privacySetting:", scraper.privacySetting, "efficientScrolling:", scraper.efficientScrolling);
        scraper.scrape().then(() => sendResponse({ status: "done" }));
        return true; // async response
    }
});
