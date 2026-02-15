/**
 * Storage Utility (IndexedDB Wrapper)
 */
const DB_NAME = "SocialScraperDB";
const DB_VERSION = 2;

class StorageUtils {
    constructor() {
        this.db = null;
        this._CACHE_KEY = "socialScraper_stats_data";
        this._DIRTY_KEY = "socialScraper_stats_dirty";
    }

    /**
     * Mark the stats cache as stale. Called on every write operation.
     */
    _invalidateCache() {
        try {
            localStorage.setItem(this._DIRTY_KEY, "true");
        } catch (_) {
            /* localStorage unavailable (service worker) — no-op */
        }
    }

    /**
     * Compute SHA-256 hex digest of a Blob.
     * Returns null if hashing is unavailable or blob is falsy.
     */
    async _computeContentHash(blob) {
        if (!blob || !blob.arrayBuffer || typeof crypto === "undefined" || !crypto.subtle) return null;
        try {
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        } catch (_) {
            return null;
        }
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

                // Media Store
                if (!db.objectStoreNames.contains("media")) {
                    const mediaStore = db.createObjectStore("media", { keyPath: "id" });
                    mediaStore.createIndex("platform", "platform", { unique: false });
                    mediaStore.createIndex("userId", "userId", { unique: false });
                }

                // Thumbnail Cache Store
                if (!db.objectStoreNames.contains("thumbnails")) {
                    db.createObjectStore("thumbnails", { keyPath: "url" });
                }

                // Thumbnail Cache Store
                if (!db.objectStoreNames.contains("thumbnails")) {
                    db.createObjectStore("thumbnails", { keyPath: "url" });
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
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => {
                this._invalidateCache();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save multiple items at once
     */
    async saveAll(storeName, items) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => {
                this._invalidateCache();
                resolve();
            };
            transaction.onerror = (event) => reject(event.target.error);

            items.forEach((item) => {
                // Conditional Update Logic for Media with Data URIs
                if (storeName === "media" && item.thumbnailUrl && item.thumbnailUrl.startsWith("data:")) {
                    // Check if item exists
                    const request = store.get(item.id);
                    request.onsuccess = () => {
                        const existing = request.result;
                        // If exists and has a VALID thumbnail (not data URI), do NOT overwrite
                        if (existing && existing.thumbnailUrl && !existing.thumbnailUrl.startsWith("data:")) {
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
            const transaction = this.db.transaction([storeName], "readonly");
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
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => {
                this._invalidateCache();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete multiple items
     */
    async deleteBatch(storeName, keys) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => {
                this._invalidateCache();
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);

            keys.forEach((key) => store.delete(key));
        });
    }

    /**
     * Clear a specific store
     */
    async clearStore(storeName) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => {
                this._invalidateCache();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Thumbnail Cache Methods
     */
    async getThumbnail(url) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["thumbnails"], "readonly");
            const store = transaction.objectStore("thumbnails");
            const request = store.get(url);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveThumbnail(data) {
        await this.init();

        // Smart Compression Strategy
        if (data.blob && data.blob.size > 0) {
            try {
                const compressed = await this.compressImage(data.blob);
                if (compressed.size < data.blob.size) {
                    data.blob = compressed;
                }
            } catch (e) {
                console.warn("[Storage] Compression skipped:", e);
            }
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["thumbnails"], "readwrite");
            const store = transaction.objectStore("thumbnails");
            const request = store.put(data); // { url, blob, ttl }

            request.onsuccess = () => {
                this._invalidateCache();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Smart Compression using OffscreenCanvas
     * Tries to convert to WebP high quality. Returns original if new is larger or error.
     */
    async compressImage(blob) {
        // Feature detection
        if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
            return blob;
        }

        try {
            const bitmap = await createImageBitmap(blob);
            const { width, height } = bitmap;
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);

            // Encode to WebP at 95% quality (Visual Lossless)
            const compressedBlob = await canvas.convertToBlob({
                type: "image/webp",
                quality: 1,
            });

            // Clean up
            bitmap.close();

            // Only use if smaller
            if (compressedBlob.size < blob.size) {
                return compressedBlob;
            }
            return blob;
        } catch (err) {
            return blob;
        }
    }

    async deleteThumbnail(url) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["thumbnails"], "readwrite");
            const store = transaction.objectStore("thumbnails");
            const request = store.delete(url);

            request.onsuccess = () => {
                this._invalidateCache();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Metrics Calculation (Smart Cached + Integrity Scan)
     * Uses localStorage to cache results. Cache is invalidated on any write.
     */
    async getStorageUsage(forceRefresh = false) {
        await this.init();

        // 1. Check Cache
        if (!forceRefresh) {
            try {
                const dirty = localStorage.getItem(this._DIRTY_KEY);
                if (dirty === "false") {
                    const cached = localStorage.getItem(this._CACHE_KEY);
                    if (cached) return JSON.parse(cached);
                }
            } catch (_) {
                /* localStorage unavailable */
            }
        }

        // 2. Full Scan Required
        const getSize = (obj) => JSON.stringify(obj).length * 2;

        const result = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["media", "thumbnails"], "readonly");
            const mediaStore = transaction.objectStore("media");
            const thumbStore = transaction.objectStore("thumbnails");

            let mediaSize = 0;
            let thumbSize = 0;
            let invalidThumbCount = 0;
            let cachedThumbCount = 0;
            let expiredThumbCount = 0;
            let orphanedCount = 0;
            let orphanedSize = 0;
            const userUsage = {};
            let totalMediaCount = 0;

            const uniqueUsers = new Set();
            let lastScrapeTime = 0;
            const now = Date.now();

            // Phase 1: Build reference set of active thumbnail URLs from media
            const activeThumbnailUrls = new Set();
            const mediaCursorRequest = mediaStore.openCursor();

            mediaCursorRequest.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const m = cursor.value;
                    totalMediaCount++;

                    if (m.userId) {
                        uniqueUsers.add(m.userId);
                        const size = getSize(m);
                        mediaSize += size;
                        userUsage[m.userId] = (userUsage[m.userId] || 0) + size;
                    }

                    if (m.scrapedAt && m.scrapedAt > lastScrapeTime) {
                        lastScrapeTime = m.scrapedAt;
                    }

                    if (!m.thumbnailUrl || m.thumbnailUrl.startsWith("data:")) {
                        invalidThumbCount++;
                    } else {
                        activeThumbnailUrls.add(m.thumbnailUrl);
                    }

                    cursor.continue();
                } else {
                    // Phase 2: Scan thumbnails
                    processThumbnails();
                }
            };

            mediaCursorRequest.onerror = () => reject(mediaCursorRequest.error);

            function processThumbnails() {
                const seenHashes = new Map(); // hash -> first URL
                let duplicateCount = 0;
                let duplicateSize = 0;
                const thumbsToHash = []; // collect for async hashing after cursor

                const thumbCursorRequest = thumbStore.openCursor();

                thumbCursorRequest.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const t = cursor.value;
                        cachedThumbCount++;

                        const blobSize = t.blob && t.blob.size ? t.blob.size : getSize(t);

                        if (t.ttl && t.ttl < now) {
                            expiredThumbCount++;
                        }

                        thumbSize += blobSize;

                        // Orphan check: thumbnail URL not referenced by any media
                        if (!activeThumbnailUrls.has(t.url)) {
                            orphanedCount++;
                            orphanedSize += blobSize;
                        }

                        // Collect blob for duplicate hashing
                        if (t.blob && t.blob.size) {
                            thumbsToHash.push({ url: t.url, blob: t.blob, size: blobSize });
                        }

                        cursor.continue();
                    } else {
                        // Cursor done — run async duplicate detection
                        detectDuplicates(thumbsToHash, seenHashes, duplicateCount, duplicateSize);
                    }
                };

                thumbCursorRequest.onerror = () => reject(thumbCursorRequest.error);

                async function detectDuplicates(thumbs, seen, dupCount, dupSize) {
                    try {
                        const instance = (typeof self !== "undefined" ? self : window).socialDB;
                        for (const t of thumbs) {
                            const hash = await instance._computeContentHash(t.blob);
                            if (hash) {
                                if (seen.has(hash)) {
                                    dupCount++;
                                    dupSize += t.size;
                                } else {
                                    seen.set(hash, t.url);
                                }
                            }
                        }
                    } catch (_) {
                        /* hashing unavailable */
                    }

                    finalize(dupCount, dupSize);
                }
            }

            function finalize(duplicateCount, duplicateSize) {
                let topUser = { userId: "None", size: 0 };
                for (const [userId, size] of Object.entries(userUsage)) {
                    if (size > topUser.size) {
                        topUser = { userId, size };
                    }
                }

                resolve({
                    totalSizeBytes: mediaSize + thumbSize,
                    thumbnailSizeBytes: thumbSize,
                    topUser: topUser,
                    counts: {
                        totalVideos: totalMediaCount,
                        totalUsers: uniqueUsers.size,
                        lastScraped: lastScrapeTime,
                        cachedThumbnails: cachedThumbCount,
                        invalidThumbnails: invalidThumbCount,
                        expiredThumbnails: expiredThumbCount,
                        videosNotCached: Math.max(0, totalMediaCount - cachedThumbCount),
                        orphanedThumbnails: orphanedCount,
                        orphanedSize: orphanedSize,
                        duplicateThumbnails: duplicateCount,
                        duplicateSize: duplicateSize,
                    },
                });
            }
        });

        // 3. Persist to cache
        try {
            localStorage.setItem(this._CACHE_KEY, JSON.stringify(result));
            localStorage.setItem(this._DIRTY_KEY, "false");
        } catch (_) {
            /* localStorage unavailable or quota exceeded */
        }

        return result;
    }

    /**
     * Query Media Items (Paginated / Filtered)
     * Criteria: { platform, userId, newOnly }
     */
    async queryMedia(criteria = {}, offset = 0, limit = 50) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["media"], "readonly");
            const store = transaction.objectStore("media");

            let request;
            let indexName = null;

            // Optimization: Use Index if possible
            if (criteria.platform && criteria.platform !== "ALL") {
                request = store.index("platform").openCursor(IDBKeyRange.only(criteria.platform));
                indexName = "platform";
            } else if (criteria.userId && criteria.userId !== "ALL") {
                request = store.index("userId").openCursor(IDBKeyRange.only(criteria.userId));
                indexName = "userId";
            } else {
                request = store.openCursor(); // Full scan
            }

            const results = [];
            let skipped = 0;
            let hasMore = false;

            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const m = cursor.value;

                    // Filter Logic
                    let match = true;

                    // If we didn't use an index for these, check them manually
                    if (criteria.platform && criteria.platform !== "ALL" && indexName !== "platform") {
                        if (m.platform !== criteria.platform) match = false;
                    }
                    if (criteria.userId && criteria.userId !== "ALL" && indexName !== "userId") {
                        if (m.userId !== criteria.userId) match = false;
                    }

                    // Date Filter
                    if (match && criteria.startDate) {
                        if (!m.scrapedAt || m.scrapedAt < criteria.startDate) match = false;
                    }
                    if (match && criteria.endDate) {
                        // End date should be inclusive, so we might need to exact end of day or just compare timestamp
                        // Assuming caller passes timestamp or we handle it.
                        if (!m.scrapedAt || m.scrapedAt > criteria.endDate) match = false;
                    }

                    // 'New' means NOT exported
                    if (match && criteria.newOnly) {
                        // Resolve Flags
                        let flags = m.exportFlags || 0;
                        if (m.exported === true) flags |= StorageUtils.ExportFlags.ALL_EXPORT;

                        const mask = criteria.excludeMask || 0;
                        if ((flags & mask) !== 0) match = false;
                    }

                    if (match) {
                        if (skipped < offset) {
                            skipped++;
                        } else {
                            if (results.length < limit) {
                                results.push(m);
                            } else {
                                hasMore = true;
                                resolve({ items: results, hasMore: true });
                                return; // Stop iterating
                            }
                        }
                    }

                    cursor.continue();
                } else {
                    // End of store
                    resolve({ items: results, hasMore: false });
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get list of unique users (for filters)
     */
    async getUniqueUsers(criteria = {}) {
        await this.init();
        // criteria can be string (platform) or object { platform, startDate, endDate }
        // Backward compatibility
        let platform = null;
        let startDate = null;
        let endDate = null;

        if (typeof criteria === "string") {
            platform = criteria;
        } else {
            platform = criteria.platform;
            startDate = criteria.startDate;
            endDate = criteria.endDate;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["media"], "readonly");
            const store = transaction.objectStore("media");
            const users = new Set();

            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const m = cursor.value;
                    if (m.userId) {
                        let match = true;
                        if (platform && platform !== "ALL" && m.platform !== platform) match = false;
                        if (startDate && (!m.scrapedAt || m.scrapedAt < startDate)) match = false;
                        if (endDate && (!m.scrapedAt || m.scrapedAt > endDate)) match = false;

                        if (match && criteria.newOnly) {
                            let flags = m.exportFlags || 0;
                            if (m.exported === true) flags |= StorageUtils.ExportFlags.ALL_EXPORT;
                            const mask = criteria.excludeMask || 0;
                            if ((flags & mask) !== 0) match = false;
                        }

                        if (match) {
                            users.add(m.userId);
                        }
                    }
                    cursor.continue();
                } else {
                    resolve(Array.from(users).sort());
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Count items matching criteria
     */
    async countMedia(criteria = {}) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["media"], "readonly");
            const store = transaction.objectStore("media");
            let count = 0;

            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const m = cursor.value;
                    let match = true;
                    if (criteria.platform && criteria.platform !== "ALL" && m.platform !== criteria.platform) match = false;
                    if (criteria.userId && criteria.userId !== "ALL" && m.userId !== criteria.userId) match = false;

                    if (criteria.newOnly) {
                        // Resolve Flags
                        let flags = m.exportFlags || 0;
                        if (m.exported === true) flags |= StorageUtils.ExportFlags.ALL_EXPORT; // Legacy fallback

                        // Check mask
                        const mask = criteria.excludeMask || 0; // Default to 0 if not provided (though newOnly implies we care)
                        if ((flags & mask) !== 0) match = false;
                    }

                    if (match) count++;
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Export Store Data (Chunked)
     */
    async exportStore(storeName, offset = 0, limit = 1000) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], "readonly");
            const store = transaction.objectStore(storeName);
            const items = [];
            let advanced = false;
            let counter = 0;

            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) {
                    resolve({ items, hasMore: false });
                    return;
                }

                if (!advanced && offset > 0) {
                    advanced = true;
                    cursor.advance(offset);
                    return;
                }

                items.push(cursor.value);
                counter++;

                if (counter >= limit) {
                    resolve({ items, hasMore: true });
                } else {
                    cursor.continue();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Import Data
     * mode: 'overwrite' | 'merge' | 'skip'
     */
    async importData(storeName, data, mode = "skip") {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);

            let successCount = 0;
            let errorCount = 0;

            // Helper to put data
            const putItem = (item) => {
                try {
                    store.put(item);
                    successCount++;
                } catch (e) {
                    errorCount++;
                }
            };

            const processItem = (item) => {
                if (mode === "overwrite") {
                    putItem(item);
                } else {
                    // Check existence (Async check inside loop is tricky with simple forEach)
                    // Better to just PUT for merge, or use add() for skip?
                    // store.add() fails if key exists.
                    if (mode === "skip") {
                        const req = store.add(item);
                        req.onsuccess = () => successCount++;
                        req.onerror = (e) => {
                            e.preventDefault(); // Prevent transaction abort
                            e.stopPropagation();
                            // errorCount++; // Duplicate is not strictly an error in skip mode
                        };
                    } else if (mode === "merge") {
                        putItem(item); // Put overwrites, efficiently merging
                    }
                }
            };

            // Transaction-based loop
            data.forEach((item) => processItem(item));

            transaction.oncomplete = () => {
                this._invalidateCache();
                resolve({ success: successCount, errors: errorCount });
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Mark items as exported with flags
     * flags: Integer bitmask
     */
    async markAsExported(ids, flags) {
        if (!flags) return; // No flags to set

        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(["media"], "readwrite");
            const store = transaction.objectStore("media");

            ids.forEach((id) => {
                const req = store.get(id);
                req.onsuccess = () => {
                    const item = req.result;
                    if (item) {
                        // Initialize if undefined
                        if (typeof item.exportFlags === "undefined") item.exportFlags = 0;

                        // Legacy Migration: If previously 'exported' is true, set ALL flags (or specific set)
                        // For safety, let's treat legacy 'exported=true' as 'ALL_EXPORT' to avoid re-exporting old stuff unexpectedly
                        if (item.exported === true) {
                            item.exportFlags |= StorageUtils.ExportFlags.ALL_EXPORT;
                            delete item.exported; // Cleanup legacy field
                        }

                        // Apply new flags
                        item.exportFlags |= flags;

                        store.put(item);
                    }
                };
            });

            transaction.oncomplete = () => {
                this._invalidateCache();
                resolve();
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }
}

// Export Flags Constants
StorageUtils.ExportFlags = {
    VIEWED: 1 << 0, // 1
    URLS: 1 << 1, // 2
    USERS: 1 << 2, // 4
    THUMBNAILS: 1 << 3, // 8
    CSV: 1 << 4, // 16
    DB: 1 << 5, // 32
};
// Helper for "All Export Modes" (excluding VIEWED)
StorageUtils.ExportFlags.ALL_EXPORT = StorageUtils.ExportFlags.URLS | StorageUtils.ExportFlags.USERS | StorageUtils.ExportFlags.THUMBNAILS | StorageUtils.ExportFlags.CSV | StorageUtils.ExportFlags.DB;

// Global instance for Contexts (Window or Service Worker)
(typeof self !== "undefined" ? self : window).socialDB = new StorageUtils();
