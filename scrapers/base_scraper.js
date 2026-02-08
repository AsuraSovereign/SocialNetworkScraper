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

    /**
     * Displays a toast notification on the page
     * @param {string} message - Message to display
     * @param {string} type - 'success', 'error', 'info'
     */
    showNotification(message, type = 'info') {
        const id = 'social-scraper-notification';
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.id = id;

        // Dynamic Styles
        const bgColor = type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6';
        const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '999999',
            backgroundColor: '#1F2937', // Dark gray
            color: '#F9FAFB', // White
            padding: '12px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            fontSize: '14px',
            fontWeight: '500',
            borderLeft: `4px solid ${bgColor}`,
            transform: 'translateX(100%)',
            opacity: '0',
            transition: 'all 0.3s ease-in-out'
        });

        notification.innerHTML = `
            <span style="color: ${bgColor}; font-size: 18px;">${icon}</span>
            <span>${message}</span>
        `;

        document.body.appendChild(notification);

        // Animate In
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        });

        // Auto-remove
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
}
