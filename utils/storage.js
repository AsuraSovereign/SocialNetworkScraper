/**
 * Storage Utility (IndexedDB Wrapper)
 */
const DB_NAME = 'SocialScraperDB';
const DB_VERSION = 1;

class StorageUtils {
    constructor() {
        this.db = null;
    }

    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Users Store
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: 'id' });
                }

                // Media Store
                if (!db.objectStoreNames.contains('media')) {
                    const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
                    mediaStore.createIndex('platform', 'platform', { unique: false });
                    mediaStore.createIndex('userId', 'userId', { unique: false });
                }

                // Settings Store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
        });
    }

    /**
     * Generic Add/Put
     */
    async save(storeName, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save multiple items at once
     */
    async saveAll(storeName, items) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);

            items.forEach(item => {
                // Conditional Update Logic for Media with Data URIs
                if (storeName === 'media' && item.thumbnailUrl && item.thumbnailUrl.startsWith('data:')) {
                    // Check if item exists
                    const request = store.get(item.id);
                    request.onsuccess = () => {
                        const existing = request.result;
                        // If exists and has a VALID thumbnail (not data URI), do NOT overwrite
                        if (existing && existing.thumbnailUrl && !existing.thumbnailUrl.startsWith('data:')) {
                            console.log(`[Storage] Skipping overwrite of ${item.id} (Preserving existing valid thumbnail)`);
                        } else {
                            // Overwrite if it didn't exist OR if existing was also a data URI
                            store.put(item);
                        }
                    };
                    request.onerror = () => {
                        console.error(`[Storage] Error checking existence for ${item.id}, attempting save anyway.`);
                        store.put(item);
                    };
                } else {
                    // Normal save (new valid URL will overwrite old data URI or old valid URL)
                    store.put(item);
                }
            });
        });
    }

    /**
     * Get all items from a store
     */
    async getAll(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    /**
     * Delete a single item
     */
    async delete(storeName, key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete multiple items
     */
    async deleteBatch(storeName, keys) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            keys.forEach(key => store.delete(key));
        });
    }
}

// Global instance for Contexts (Window or Service Worker)
(typeof self !== 'undefined' ? self : window).socialDB = new StorageUtils();
