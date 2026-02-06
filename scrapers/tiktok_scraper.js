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

        await this.autoScroll(200, 800, async () => {
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
    async extractAndSave() {
        const links = Array.from(document.querySelectorAll("a"));
        const hrefs = links.map(a => a.href);

        // Filter for ./video/ or ./photo/
        const mediaUrls = hrefs.filter(href => href.includes('/video/') || href.includes('/photo/'));
        const uniqueUrls = [...new Set(mediaUrls)];

        // Identify Scraped User (Most frequent user in list)
        // This logic comes from the original script to identify "Video Owner" vs "Commenters"
        const userCounts = {};
        let topUser = "UNKNOWN";
        let maxCount = 0;

        uniqueUrls.forEach(url => {
            const user = this.getUsernameFromUrl(url);
            if (user) {
                userCounts[user] = (userCounts[user] || 0) + 1;
                if (userCounts[user] > maxCount) {
                    maxCount = userCounts[user];
                    topUser = user;
                }
            }
        });

        if (topUser === "UNKNOWN") return;

        // Filter URLs belonging to the Top User
        const targetUrls = uniqueUrls.filter(url => this.getUsernameFromUrl(url) === topUser);

        // Filter out already scraped items
        const newUrls = this.filterNewItems(targetUrls);

        if (newUrls.length === 0) return;

        console.log(`Found ${newUrls.length} new items for ${topUser}`);

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

        // Save Media Items
        const mediaItems = newUrls.map(url => ({
            id: url, // URL as ID involves risk if URL changes, but works for unique posts
            userId: topUser,
            platform: 'TikTok',
            originalUrl: url,
            scrapedAt: Date.now(),
            downloadStatus: 'PENDING'
        }));

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
