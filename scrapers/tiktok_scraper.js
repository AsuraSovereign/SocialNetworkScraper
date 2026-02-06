class TikTokScraper extends BaseScraper {
    constructor() {
        super('TikTok');
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
            return usernamePart.split("?")[0].replace(/^@/, '');
        } catch (e) {
            console.error("Error extracting username:", e);
            return "";
        }
    }

    /**
     * Main scrape execution context
     */
    async scrape() {
        if (this.isScraping) return;
        this.isScraping = true;
        console.log("Starting TikTok Scrape...");

        // 1. Auto-scroll to load content
        // We pass a callback to extraction logic to run periodically if we wanted "EVERYLOOP" mode,
        // but typically we scroll first then extract, or extract incrementally.
        // For this implementation, we'll try to extract periodically to be safe against crashes.

        await this.autoScroll(200, 2000, async () => {
            // Optional: Run extraction every scroll to save progress?
            // For now, let's just scroll then extract at the end for simplicity, 
            // but the user's original script supported "EVERYLOOP".
            // Let's implement incremental saving.
            await this.extractAndSave();
            return false; // Don't stop scrolling yet
        });

        // Final pass
        await this.extractAndSave();
        this.stop();
        console.log("TikTok Scrape Complete.");
    }

    /**
     * Extraction Logic
     */
    /**
     * Helper to find best thumbnail from an anchor element
     * Adapted from user provided logic
     */
    getThumbnailFromAnchor(a) {
        const picture = a.querySelector('picture');
        const source = picture ? picture.querySelector('source') : a.querySelector('source');
        if (!a.querySelector) return null; // Safety check
        const img = a.querySelector('img') || (picture && picture.querySelector('img'));

        let rawSrc = null;
        let srcset = null;

        // Prefer <source> type attribute if present
        if (source) {
            rawSrc = source.getAttribute('src') || source.getAttribute('srcset') || null;
            srcset = source.getAttribute('srcset') || null;
        }

        // Fallback to <img>
        if (!rawSrc && img) {
            rawSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy') || null;
            srcset = img.getAttribute('srcset') || null;
        }

        if (!rawSrc && !srcset) return null;

        // If srcset exists, pick the highest density candidate
        if (srcset) {
            try {
                const candidates = srcset.split(',').map(s => s.trim()).map(part => {
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

    async extractAndSave() {
        // Get all anchors
        const links = Array.from(document.querySelectorAll("a"));

        // Map to objects first so we keep the element reference
        const potentialItems = links.map(a => ({
            element: a,
            href: a.href,
            user: this.getUsernameFromUrl(a.href)
        })).filter(item => item.href.includes('/video/') || item.href.includes('/photo/'));

        // Identify Scraped User (Most frequent user in list)
        const userCounts = {};
        let topUser = "UNKNOWN";
        let maxCount = 0;

        potentialItems.forEach(item => {
            if (item.user) {
                userCounts[item.user] = (userCounts[item.user] || 0) + 1;
                if (userCounts[item.user] > maxCount) {
                    maxCount = userCounts[item.user];
                    topUser = item.user;
                }
            }
        });

        if (topUser === "UNKNOWN") return;

        // Filter items belonging to the Top User
        const targetItems = potentialItems.filter(item => item.user === topUser);

        // Filter out already scraped items (check ID/URL)
        const newItems = this.filterNewItems(targetItems.map(i => i.href));

        if (newItems.length === 0) return;

        // We need the original item objects for the new URLs to get elements
        const itemsToSave = targetItems.filter(item => newItems.includes(item.href));

        console.log(`Found ${itemsToSave.length} new items for ${topUser}`);

        // Save User if new
        chrome.runtime.sendMessage({
            action: 'SAVE_DATA',
            store: 'users',
            data: {
                id: topUser,
                username: topUser,
                platform: 'TikTok',
                lastScrapedAt: Date.now()
            }
        });

        // Save Media Items with Thumbnails
        const mediaItems = itemsToSave.map(item => {
            const thumbUrl = this.getThumbnailFromAnchor(item.element);

            return {
                id: item.href,
                userId: topUser,
                platform: 'TikTok',
                originalUrl: item.href,
                thumbnailUrl: thumbUrl,
                scrapedAt: Date.now(),
                downloadStatus: 'PENDING'
            };
        });

        chrome.runtime.sendMessage({
            action: 'SAVE_BATCH',
            store: 'media',
            data: mediaItems
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
        const scraper = new TikTokScraper();
        scraper.scrape().then(() => sendResponse({ status: 'done' }));
        return true; // async response
    }
});
