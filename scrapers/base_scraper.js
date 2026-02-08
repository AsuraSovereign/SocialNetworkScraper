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

    /**
     * Sets the privacy overlay based on mode
     * @param {string} mode - 'HIDDEN_UNTIL_DONE', 'ALWAYS_HIDDEN', 'OFF'
     */
    setPrivacyOverlay(mode) {
        const id = 'social-scraper-privacy-overlay';
        let overlay = document.getElementById(id);

        if (mode === 'OFF') {
            if (overlay) overlay.remove();
            return;
        }

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = id;
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                zIndex: '999990',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontFamily: 'system-ui, sans-serif',
                transition: 'background-color 0.3s'
            });

            // Inner container for content
            const content = document.createElement('div');
            Object.assign(content.style, {
                backgroundColor: 'rgba(0,0,0,0.85)',
                padding: '40px',
                borderRadius: '16px',
                textAlign: 'center',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.1)'
            });

            content.innerHTML = `
                <div style="font-size: 32px; margin-bottom: 16px;">🔒</div>
                <div style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">Privacy Mode Active</div>
                <div style="font-size: 14px; color: #ccc; margin-bottom: 24px;">Content is hidden while scraping</div>
                
                <div style="display: flex; gap: 12px; justify-content: center; align-items: center;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; background: rgba(255,255,255,0.1); padding: 8px 16px; borderRadius: 8px; user-select: none;">
                        <input type="checkbox" id="privacy-peek-toggle" style="width: 16px; height: 16px; cursor: pointer;">
                        <span>Show Content (Peek)</span>
                    </label>
                </div>

                <button id="privacy-dismiss-btn" style="
                    display: none; 
                    margin-top: 24px; 
                    background: #fff; 
                    color: #000; 
                    border: none; 
                    padding: 10px 24px; 
                    border-radius: 8px; 
                    font-weight: bold; 
                    cursor: pointer;
                    transition: transform 0.1s;
                ">Dismiss Overlay</button>
            `;

            overlay.appendChild(content);

            // Background masker
            const masker = document.createElement('div');
            masker.id = 'privacy-masker';
            Object.assign(masker.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                backgroundColor: '#000',
                zIndex: '-1'
            });
            overlay.appendChild(masker);

            document.body.appendChild(overlay);

            // Event Listeners
            const peekToggle = overlay.querySelector('#privacy-peek-toggle');
            peekToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    masker.style.opacity = '0';
                    overlay.style.pointerEvents = 'none'; // Click-through when peeking
                    content.style.pointerEvents = 'auto'; // Keep controls interactive
                    content.style.opacity = '0.7';
                } else {
                    masker.style.opacity = '1';
                    overlay.style.pointerEvents = 'auto';
                    content.style.opacity = '1';
                }
            });

            const dismissBtn = overlay.querySelector('#privacy-dismiss-btn');
            dismissBtn.addEventListener('click', () => {
                overlay.remove();
            });
        }
    }

    /**
     * Updates the overlay state (e.g. show dismiss button)
     */
    updatePrivacyOverlayState(state) {
        const dismissBtn = document.getElementById('privacy-dismiss-btn');
        if (dismissBtn) {
            if (state === 'DONE') {
                dismissBtn.textContent = 'Scraping Complete - Dismiss';
                dismissBtn.style.display = 'block';
            }
        }
    }
}
