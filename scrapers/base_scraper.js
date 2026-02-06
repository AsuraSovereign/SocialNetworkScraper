/**
 * Base Scraper Class
 * Provides common utility methods for social media scraping.
 */
class BaseScraper {
    constructor(platformName) {
        this.platformName = platformName;
        this.scrapedItems = new Set();
        this.isScraping = false;
    }

    /**
     * Sleep utility
     * @param {number} ms 
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Auto-scrolls the page to load more content (Infinite Scroll)
     * @param {number} maxScrolls - Safety limit
     * @param {number} interval - Time between scrolls
     * @param {Function} checkStopCondition - Optional callback to stop early
     */
    async autoScroll(maxScrolls = 100, interval = 1000, checkStopCondition = null) {
        console.log(`[${this.platformName}] Starting auto-scroll...`);
        let currentScroll = 0;
        let lastHeight = document.body.scrollHeight;
        let noChangeCount = 0;

        while (currentScroll < maxScrolls && this.isScraping) {
            window.scrollTo(0, document.body.scrollHeight);
            await this.sleep(interval);

            let newHeight = document.body.scrollHeight;
            if (newHeight === lastHeight) {
                noChangeCount++;
                if (noChangeCount >= 3) {
                    console.log(`[${this.platformName}] Reached bottom or stuck.`);
                    break;
                }
            } else {
                noChangeCount = 0;
                lastHeight = newHeight;
            }

            if (checkStopCondition && await checkStopCondition()) {
                console.log(`[${this.platformName}] Stop condition met.`);
                break;
            }

            currentScroll++;
        }
        console.log(`[${this.platformName}] Scroll finished.`);
    }

    /**
     * Abstract method to be implemented by child classes
     */
    async scrape() {
        throw new Error("Method 'scrape()' must be implemented.");
    }

    /**
     * Filters new items against already scraped ones
     * @param {Array} items - List of strings or objects with 'id'
     * @returns {Array} - List of new items
     */
    filterNewItems(items) {
        return items.filter(item => {
            const key = typeof item === 'string' ? item : item.id;
            if (this.scrapedItems.has(key)) return false;
            this.scrapedItems.add(key);
            return true;
        });
    }

    stop() {
        this.isScraping = false;
    }
}
