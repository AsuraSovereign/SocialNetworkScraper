/**
 * Storage Utility (IndexedDB Wrapper)
 */
const DB_NAME = "SocialScraperDB";
const DB_VERSION = 2;

class StorageUtils {
    constructor() {
        this.db = null;
        this._initPromise = null;
        this._isCalculating = false;
        this._CACHE_KEY = "socialScraper_stats_data";
        this._DIRTY_KEY = "socialScraper_stats_dirty";
        this._STATS_KEY = "socialScraper_detailed_stats";
        this._CALC_STATUS_KEY = "socialScraper_calc_status";
        this._CACHE_TTL = 5 * 60 * 1000; // 5 minutes
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
        // Note: We intentionally do NOT invalidate chrome.storage.local detailed stats here.
        // Detailed stats have their own TTL and are recalculated on demand.
        // Setting dirty in chrome.storage.local on every write caused a race condition
        // where cache population writes prevented detailed stats from ever being used.
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

        // Singleton promise: if init is already in-flight, return the same promise
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                this._initPromise = null; // Allow retry on failure
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
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
        });

        return this._initPromise;
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

        // Guard: only attempt compression on image blobs
        if (!blob.type || !blob.type.startsWith("image/")) {
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
     * Metrics Calculation (Estimated Stats - O(1) Counts)
     * Returns fast counts immediately. Detailed size stats are calculated
     * asynchronously in the background and merged when available.
     */
    async getStorageUsage(forceRefresh = false) {
        await this.init();

        // 1. Check localStorage cache (dirty flag + 5-min TTL)
        if (!forceRefresh) {
            try {
                const dirty = localStorage.getItem(this._DIRTY_KEY);
                if (dirty === "false") {
                    const cached = localStorage.getItem(this._CACHE_KEY);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        if (parsed._cachedAt && Date.now() - parsed._cachedAt < this._CACHE_TTL) {
                            return parsed;
                        }
                    }
                }
            } catch (_) {
                /* localStorage unavailable */
            }
        }

        // 2. Fast O(1) counts + instant storage estimate (parallel)
        const idbCount = (store) =>
            new Promise((resolve, reject) => {
                const req = store.count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

        // navigator.storage.estimate() gives instant IDB usage without iteration
        let estimatedTotalBytes = null;
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                estimatedTotalBytes = est.usage || null;
            }
        } catch (_) {
            /* estimate unavailable */
        }

        const transaction = this.db.transaction(["media", "thumbnails"], "readonly");
        const mediaStore = transaction.objectStore("media");
        const thumbStore = transaction.objectStore("thumbnails");

        const [totalMediaCount, totalThumbCount] = await Promise.all([idbCount(mediaStore), idbCount(thumbStore)]);

        // 3. Lightweight cursor for user stats and cache health
        const result = await new Promise((resolve, reject) => {
            const uniqueUsers = new Set();
            const userItemCounts = {};
            let lastScrapeTime = 0;
            let invalidThumbCount = 0;
            const now = Date.now();
            const urlRefCounts = new Map();

            const mediaCursorReq = mediaStore.openCursor();

            mediaCursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const m = cursor.value;

                    if (m.userId) {
                        uniqueUsers.add(m.userId);
                        userItemCounts[m.userId] = (userItemCounts[m.userId] || 0) + 1;
                    }

                    if (m.scrapedAt && m.scrapedAt > lastScrapeTime) {
                        lastScrapeTime = m.scrapedAt;
                    }

                    if (!m.thumbnailUrl || m.thumbnailUrl.startsWith("data:")) {
                        invalidThumbCount++;
                    } else {
                        urlRefCounts.set(m.thumbnailUrl, (urlRefCounts.get(m.thumbnailUrl) || 0) + 1);
                    }

                    cursor.continue();
                } else {
                    scanThumbnails();
                }
            };

            mediaCursorReq.onerror = () => reject(mediaCursorReq.error);

            function scanThumbnails() {
                let cachedMediaCount = 0;
                let expiredMediaCount = 0;
                let failedMediaCount = 0;
                let orphanedCount = 0;

                const thumbCursorReq = thumbStore.openCursor();

                thumbCursorReq.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const t = cursor.value;
                        const refCount = urlRefCounts.get(t.url);

                        if (refCount) {
                            if (t.error) {
                                if (t.ttl && t.ttl < now) {
                                    expiredMediaCount += refCount;
                                } else {
                                    failedMediaCount += refCount;
                                }
                            } else {
                                if (t.ttl && t.ttl < now) {
                                    expiredMediaCount += refCount;
                                } else {
                                    cachedMediaCount += refCount;
                                }
                            }
                        } else {
                            orphanedCount++;
                        }

                        cursor.continue();
                    } else {
                        let topUser = { userId: "None", count: 0 };
                        for (const [userId, count] of Object.entries(userItemCounts)) {
                            if (count > topUser.count) {
                                topUser = { userId, count };
                            }
                        }

                        const videosMissing = Math.max(0, totalMediaCount - invalidThumbCount - cachedMediaCount - expiredMediaCount - failedMediaCount);

                        resolve({
                            totalSizeBytes: null, // Populated async by calculateDetailedStats
                            thumbnailSizeBytes: null,
                            estimatedTotalBytes: estimatedTotalBytes, // Instant estimate from navigator.storage
                            topUser: topUser,
                            counts: {
                                totalVideos: totalMediaCount,
                                totalUsers: uniqueUsers.size,
                                totalThumbnails: totalThumbCount,
                                lastScraped: lastScrapeTime,
                                cachedThumbnails: cachedMediaCount,
                                invalidThumbnails: invalidThumbCount,
                                expiredThumbnails: expiredMediaCount,
                                failedThumbnails: failedMediaCount,
                                videosNotCached: videosMissing,
                                orphanedThumbnails: orphanedCount,
                            },
                        });
                    }
                };

                thumbCursorReq.onerror = () => reject(thumbCursorReq.error);
            }
        });

        // 4. Merge any previously calculated detailed stats from chrome.storage.local
        // Note: Detailed stats have their own TTL via _cachedAt, independent of dirty flag.
        // The dirty flag is for the fast localStorage cache only.
        try {
            const stored = await new Promise((r) => chrome.storage.local.get([this._STATS_KEY], (res) => r(res)));
            const detailed = stored[this._STATS_KEY];

            if (detailed && detailed._cachedAt && Date.now() - detailed._cachedAt < this._CACHE_TTL) {
                // Merge sizes into current fast result
                result.totalSizeBytes = detailed.totalSizeBytes;
                result.thumbnailSizeBytes = detailed.thumbnailSizeBytes;
                // Merge per-user size if available
                if (detailed.topUser) {
                    result.topUser.size = detailed.topUser.size;
                }
                console.log("[Storage] Merged cached detailed stats into result.");
            } else {
                // Fire-and-forget: ask background to calculate sizes
                console.log("[Storage] Detailed stats missing or stale, requesting background calculation...");
                try {
                    chrome.runtime.sendMessage({ action: "CALCULATE_STATS" }, () => {
                        void chrome.runtime.lastError; // Suppress channel closed error
                    });
                } catch (_) {
                    /* background unavailable */
                }
            }
        } catch (_) {
            /* chrome.storage unavailable (e.g. content script context) */
        }

        // 5. Persist fast results to localStorage cache
        try {
            result._cachedAt = Date.now();
            localStorage.setItem(this._CACHE_KEY, JSON.stringify(result));
            localStorage.setItem(this._DIRTY_KEY, "false");
        } catch (_) {
            /* localStorage unavailable or quota exceeded */
        }

        return result;
    }

    /**
     * Detailed Size Calculation (Chunked, Non-Blocking)
     * Runs in the background service worker. Iterates all records in chunks,
     * yielding between chunks to prevent blocking the event loop.
     * Reports progress every 5% via chrome.storage.local and console.
     * Results are written to chrome.storage.local for reactive UI pickup.
     *
     * Performance: Uses fast property-walking heuristic instead of JSON.stringify
     * for size estimation. JSON.stringify on every record was the root cause of
     * the multi-minute freeze — it serializes blobs and deep objects.
     */
    async calculateDetailedStats() {
        if (this._isCalculating) return;
        this._isCalculating = true;

        const setStatus = (state, progress) => {
            try {
                chrome.storage.local.set({ [this._CALC_STATUS_KEY]: { state, progress } });
            } catch (_) {
                /* no-op */
            }
        };

        try {
            await this.init();

            const CHUNK_SIZE = 500;
            const YIELD_MS = 10;

            /**
             * Fast size estimation via property walking.
             * Avoids JSON.stringify which is O(n) per object and chokes on blobs.
             * Estimates: 8 bytes per number, string.length*2 for strings,
             * blob.size for blobs, 4 bytes for booleans, recurse for objects.
             */
            const estimateObjectSize = (obj, depth = 0) => {
                if (obj == null) return 4;
                if (depth > 3) return 32; // Safety: don't recurse too deep
                const type = typeof obj;
                if (type === "string") return obj.length * 2;
                if (type === "number") return 8;
                if (type === "boolean") return 4;
                // Blob/File — use native .size property
                if (obj instanceof Blob) return obj.size;
                if (Array.isArray(obj)) {
                    let s = 16; // array overhead
                    for (let i = 0; i < obj.length; i++) s += estimateObjectSize(obj[i], depth + 1);
                    return s;
                }
                if (type === "object") {
                    let s = 32; // object overhead
                    const keys = Object.keys(obj);
                    for (let i = 0; i < keys.length; i++) {
                        s += keys[i].length * 2; // key
                        s += estimateObjectSize(obj[keys[i]], depth + 1); // value
                    }
                    return s;
                }
                return 8; // fallback
            };

            // Get total counts for progress tracking
            const idbCount = (storeName) =>
                new Promise((resolve, reject) => {
                    const tx = this.db.transaction([storeName], "readonly");
                    const req = tx.objectStore(storeName).count();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

            const [totalMedia, totalThumbs] = await Promise.all([idbCount("media"), idbCount("thumbnails")]);
            const grandTotal = totalMedia + totalThumbs;

            if (grandTotal === 0) {
                const emptyStats = { totalSizeBytes: 0, thumbnailSizeBytes: 0, mediaSizeBytes: 0, topUser: { userId: "None", size: 0 }, _cachedAt: Date.now() };
                await new Promise((r) => chrome.storage.local.set({ [this._STATS_KEY]: emptyStats, [this._CALC_STATUS_KEY]: { state: "COMPLETE", progress: 100 } }, r));
                console.log("[Storage] No items to calculate sizes for.");
                this._isCalculating = false;
                return emptyStats;
            }

            let processed = 0;
            let lastReportedPct = -1;

            // Report progress at 5% increments (was 10%)
            const reportProgress = () => {
                const pct = Math.floor((processed / grandTotal) * 100);
                const bucket = Math.floor(pct / 5) * 5; // Round down to nearest 5
                if (bucket > lastReportedPct) {
                    lastReportedPct = bucket;
                    setStatus("CALCULATING", bucket);
                    console.log(`[Storage] Stats calculation progress: ${bucket}% (${processed}/${grandTotal})`);
                }
            };

            // Initial status
            setStatus("CALCULATING", 0);
            console.log(`[Storage] Starting size calculation: ${grandTotal} items (${totalMedia} media + ${totalThumbs} thumbnails)`);

            // --- Phase 1: Media size (with per-user tracking) ---
            let mediaSize = 0;
            const userSizes = {}; // Track per-user byte sizes

            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(["media"], "readonly");
                const store = tx.objectStore("media");
                const req = store.openCursor();

                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const m = cursor.value;
                        const itemSize = estimateObjectSize(m);
                        mediaSize += itemSize;
                        processed++;

                        // Track per-user sizes for "Top User (Space)"
                        if (m.userId) {
                            userSizes[m.userId] = (userSizes[m.userId] || 0) + itemSize;
                        }

                        reportProgress();

                        if (processed % CHUNK_SIZE === 0) {
                            setTimeout(() => cursor.continue(), YIELD_MS);
                        } else {
                            cursor.continue();
                        }
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => reject(req.error);
            });

            // --- Phase 2: Thumbnail size ---
            let thumbSize = 0;

            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(["thumbnails"], "readonly");
                const store = tx.objectStore("thumbnails");
                const req = store.openCursor();

                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        const t = cursor.value;
                        // Use blob.size directly for binary data — fast and accurate
                        thumbSize += t.blob && t.blob.size ? t.blob.size : estimateObjectSize(t);
                        processed++;
                        reportProgress();

                        if (processed % CHUNK_SIZE === 0) {
                            setTimeout(() => cursor.continue(), YIELD_MS);
                        } else {
                            cursor.continue();
                        }
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => reject(req.error);
            });

            // --- Phase 3: Determine top user by size ---
            let topUser = { userId: "None", size: 0 };
            for (const [userId, size] of Object.entries(userSizes)) {
                if (size > topUser.size) {
                    topUser = { userId, size };
                }
            }

            // --- Phase 4: Persist results ---
            const detailedStats = {
                totalSizeBytes: mediaSize + thumbSize,
                thumbnailSizeBytes: thumbSize,
                mediaSizeBytes: mediaSize,
                topUser: topUser,
                _cachedAt: Date.now(),
            };

            await new Promise((r) =>
                chrome.storage.local.set(
                    {
                        [this._STATS_KEY]: detailedStats,
                        [this._CALC_STATUS_KEY]: { state: "COMPLETE", progress: 100 },
                    },
                    r,
                ),
            );

            console.log(`[Storage] Stats calculation complete: media=${mediaSize}, thumbs=${thumbSize}, total=${mediaSize + thumbSize}, topUser=${topUser.userId}`);
            return detailedStats;
        } catch (err) {
            console.error("[Storage] calculateDetailedStats error:", err);
            setStatus("ERROR", 0);
            throw err;
        } finally {
            this._isCalculating = false;
        }
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
