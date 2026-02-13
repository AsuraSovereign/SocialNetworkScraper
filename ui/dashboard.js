// DOM Elements (Initialized in initUI)
const contentArea = document.getElementById('content-area');
const statsTab = document.getElementById('tab-stats');
const videosTab = document.getElementById('tab-videos');
const exportTab = document.getElementById('tab-export');
const deleteTab = document.getElementById('tab-delete');

const linkStats = document.getElementById('link-stats');
const linkVideos = document.getElementById('link-videos');
const linkExport = document.getElementById('link-export');
const linkDelete = document.getElementById('link-delete');

// Filters & UI Elements (Initialized in initUI)
let filterPlatform, filterUser, filterNewOnly;
let exportPlatform, exportUser, exportNewOnly;
let deletePlatform, deleteUser, deleteCountParams;

// State
// Removed allMedia global to prevent memory crashes
let cachePopulateBtn = null; // Reference to cache populate button

// Init
async function init() {
    await loadTabs();
    initUI();
    setupNavigation();
    setupFilters();
    setupCacheProgressListener(); // Set up global listener
    loadData();
}

async function loadTabs() {
    const tabs = [
        { id: 'tab-stats', file: 'tabs/stats.html' },
        { id: 'tab-videos', file: 'tabs/videos.html' },
        { id: 'tab-export', file: 'tabs/export.html' },
        { id: 'tab-delete', file: 'tabs/delete.html' }
    ];

    const promises = tabs.map(async (tab) => {
        try {
            const response = await fetch(tab.file);
            const html = await response.text();
            document.getElementById(tab.id).innerHTML = html;
        } catch (err) {
            console.error(`Failed to load ${tab.file}:`, err);
            document.getElementById(tab.id).innerHTML = `<p style="color:red">Error loading ${tab.file}</p>`;
        }
    });

    await Promise.all(promises);
}

function initUI() {
    // Videos Tab Elements
    filterPlatform = document.getElementById('filter-platform');
    filterUser = document.getElementById('filter-user');
    filterNewOnly = document.getElementById('filter-new-only');

    // Export Tab Elements
    exportPlatform = document.getElementById('export-platform');
    exportUser = document.getElementById('export-user');
    exportNewOnly = document.getElementById('export-new-only');

    // Delete Tab Elements
    deletePlatform = document.getElementById('delete-platform');
    deleteUser = document.getElementById('delete-user');
    deleteCountParams = document.getElementById('delete-count');

    // Re-attach specific listeners that depended on these elements being present
    // Note: Some listeners were attached globally or in setupFilters, checking below...

    // Export UI Logic Init
    if (exportNewOnly) {
        // Export Settings Persistence
        const storedVal = localStorage.getItem('socialScraper_exportNewOnly');
        if (storedVal === null) {
            exportNewOnly.checked = true;
        } else {
            exportNewOnly.checked = storedVal === 'true';
        }

        exportNewOnly.addEventListener('change', () => {
            localStorage.setItem('socialScraper_exportNewOnly', exportNewOnly.checked);
            updateLivePreview();
        });
    }

    // Export Buttons
    document.getElementById('btn-export-txt').addEventListener('click', async () => {
        const data = await getExportData();
        if (data.length === 0) { alert('No data matches your filters.'); return; }

        const text = data.map(m => m.originalUrl).join('\n');
        const filename = generateExportFilename('txt');
        downloadFile(text, filename, 'text/plain');

        await markItemsAsExported(data);
    });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const data = await getExportData();
        if (data.length === 0) { alert('No data matches your filters.'); return; }

        const columns = getSelectedColumns();
        if (columns.length === 0) { alert('Please select at least one column.'); return; }

        // Header
        const header = columns.map(c => formatColumnName(c)).join(',') + '\n';

        // Rows
        const rows = data.map(m => {
            return columns.map(col => {
                let val = m[col] || '';
                if (col === 'scrapedAt') val = new Date(val).toISOString();
                // Escape CSV injection/commas
                const str = String(val).replace(/"/g, '""');
                return `"${str}"`;
            }).join(',');
        }).join('\n');

        const filename = generateExportFilename('csv');
        downloadFile(header + rows, filename, 'text/csv');

        await markItemsAsExported(data);
    });

    // NEW: Export Users
    document.getElementById('btn-export-users').addEventListener('click', async () => {
        // We use the current export filters? Or just export ALL users?
        // Requirement says: "Export all users already scrapped" and "Export all users already scrapped by platform"
        // So we should respect the Platform filter, but maybe ignore User filter (since we want list of users).
        // Let's use getUniqueUsers(platform)

        const pFilter = exportPlatform.value;
        const users = await window.socialDB.getUniqueUsers(pFilter);

        if (users.length === 0) {
            alert('No users found.');
            return;
        }

        const text = users.join('\n');
        const filename = `Users_${pFilter === 'ALL' ? 'AllPlatforms' : pFilter}_${new Date().toISOString().split('T')[0]}.txt`;
        downloadFile(text, filename, 'text/plain');
    });

    // NEW: Export Thumbnails
    document.getElementById('btn-export-thumbs').addEventListener('click', async () => {
        if (!window.showDirectoryPicker) {
            alert("Browser not supported.");
            return;
        }

        const pFilter = exportPlatform.value;
        const uFilter = exportUser.value;
        const criteria = { platform: pFilter, userId: uFilter, newOnly: exportNewOnly.checked };

        // Check count
        const count = await window.socialDB.countMedia(criteria);
        if (count === 0) { alert('No items match criteria.'); return; }

        const btn = document.getElementById('btn-export-thumbs');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Select Folder...';

        try {
            const dirHandle = await window.showDirectoryPicker();
            btn.textContent = 'Exporting...';

            await backupToFolder(dirHandle, criteria, (processed) => {
                btn.textContent = `Exporting... ${processed}/${count}`;
            });

            alert(`Export Complete! Saved to ${dirHandle.name}/images`);
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                alert("Export failed: " + err.message);
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    // Delete Action
    document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
        // 1. Get Count first
        const pFilter = deletePlatform.value;
        const uFilter = deleteUser.value;
        const criteria = { platform: pFilter, userId: uFilter };

        const count = await window.socialDB.countMedia(criteria);

        if (count === 0) {
            alert('No data to delete.');
            return;
        }

        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API needed for large backups. Please update Chrome.");
            return;
        }

        const btn = document.getElementById('btn-delete-confirm');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Waiting for folder selection...';

        try {
            const dirHandle = await window.showDirectoryPicker();
            btn.textContent = 'Initializing Backup...';

            // Reuse backup function
            const { processed, mediaIds, thumbnailUrls } = await backupToFolder(dirHandle, criteria, (p) => {
                btn.textContent = `Backing up... ${p}/${count}`;
            });

            // Backup Complete
            btn.textContent = 'Backup Complete. Deleting...';

            // Delete Phase
            const confirmed = confirm(`Backup saved to selected folder.\n(${processed} items backed up)\n\nAre you sure you want to PERMANENTLY delete these items from the extension?`);

            if (confirmed) {
                // Delete in batches to avoid locking DB for too long
                const DELETE_BATCH = 500;
                for (let i = 0; i < mediaIds.length; i += DELETE_BATCH) {
                    const batchIds = mediaIds.slice(i, i + DELETE_BATCH);
                    await window.socialDB.deleteBatch('media', batchIds);
                    btn.textContent = `Deleting Media... ${Math.min(i + DELETE_BATCH, mediaIds.length)}/${mediaIds.length}`;
                }

                // Delete Thumbnails
                if (thumbnailUrls.length > 0) {
                    const uniqueThumbUrls = [...new Set(thumbnailUrls)];
                    for (let i = 0; i < uniqueThumbUrls.length; i += DELETE_BATCH) {
                        const batchUrls = uniqueThumbUrls.slice(i, i + DELETE_BATCH);
                        await window.socialDB.deleteBatch('thumbnails', batchUrls);
                        btn.textContent = `Deleting Thumbs... ${Math.min(i + DELETE_BATCH, uniqueThumbUrls.length)}/${uniqueThumbUrls.length}`;
                    }
                }

                alert('Deletion and Cleanup successful.');
                await loadData(); // Reload UI
                updateDeletePreview();
            }

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("Backup/Delete process failed:", err);
                alert("Process failed: " + err.message);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });

    // Wire up standard filters
    if (filterNewOnly) filterNewOnly.addEventListener('change', () => renderVideos());

    // Wire up Export/Delete filters
    [exportPlatform, exportUser].forEach(el => {
        if (el) el.addEventListener('change', updateLivePreview);
    });
    if (exportNewOnly) exportNewOnly.addEventListener('change', updateLivePreview); // Attached above but safe to double check

    document.querySelectorAll('#column-pills input').forEach(cb => {
        cb.addEventListener('change', updateLivePreview);
    });

    [deletePlatform, deleteUser].forEach(el => {
        if (el) el.addEventListener('change', updateDeletePreview);
    });

    // Event Delegation for Video Grid is on #video-grid which is dynamically loaded
    // But we can attach to document or re-attach to grid.
    // Better to attach to #video-grid inside initUI?
    // Actually, let's keep the global delegation on 'video-grid' if possible, or delegation on content-area
    // The original code had listener on 'video-grid' which now doesn't exist at parsed time.
    const videoGrid = document.getElementById('video-grid');
    if (videoGrid) {
        videoGrid.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-download')) {
                const url = e.target.getAttribute('data-url');
                if (url) {
                    chrome.runtime.sendMessage({ action: 'DOWNLOAD_MEDIA', payload: { url: url } });
                }
            }
        });
    }
}

function setupFilters() {
    if (filterPlatform) filterPlatform.addEventListener('change', () => renderVideos());
    if (filterUser) filterUser.addEventListener('change', () => renderVideos());
}

function setupCacheProgressListener() {
    // Global listener for cache population progress updates
    console.log('[Dashboard] Setting up cache progress listener');
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "CACHE_PROGRESS_UPDATE") {
            console.log('[Dashboard] Received CACHE_PROGRESS_UPDATE:', request);
            const { current, total, complete } = request;

            if (!cachePopulateBtn) {
                console.warn('[Dashboard] Button not initialized yet, ignoring message');
                return;
            }

            if (complete) {
                console.log('[Dashboard] Cache population complete, resetting button');
                cachePopulateBtn.textContent = 'Populate Cache';
                cachePopulateBtn.disabled = false;
                if (total > 0) {
                    console.log(`Cache population complete. Processed ${total} items.`);
                } else {
                    console.log('Cache is already up to date.');
                }
                renderStorageStats();
            } else {
                console.log(`[Dashboard] Updating button: ${current}/${total}`);
                cachePopulateBtn.disabled = true;
                cachePopulateBtn.textContent = `Populating... (${current}/${total})`;
            }
        }
    });
}

function setupNavigation() {
    linkStats.addEventListener('click', () => showTab('stats'));
    linkVideos.addEventListener('click', () => showTab('videos'));
    linkExport.addEventListener('click', () => showTab('export'));
    linkDelete.addEventListener('click', () => showTab('delete'));
}

function showTab(tabName) {
    // Hide all
    statsTab.style.display = 'none';
    videosTab.style.display = 'none';
    exportTab.style.display = 'none';
    deleteTab.style.display = 'none';

    // Deactivate links
    linkStats.classList.remove('active');
    linkVideos.classList.remove('active');
    linkExport.classList.remove('active');
    // linkDelete.classList.remove('active'); // Style is inline, so we just leave it

    // Show active
    if (tabName === 'stats') {
        statsTab.style.display = 'block';
        linkStats.classList.add('active');
        renderStats();
        renderStorageStats(); // Refresh storage stats on tab view
    } else if (tabName === 'videos') {
        videosTab.style.display = 'block';
        linkVideos.classList.add('active');
        renderVideos();
    } else if (tabName === 'export') {
        exportTab.style.display = 'block';
        linkExport.classList.add('active');
        updateLivePreview();
    } else if (tabName === 'delete') {
        deleteTab.style.display = 'block';
        updateDeletePreview();
    }
}

async function loadData() {
    // Wait for script to load if needed? It should be synchronous.
    if (!window.socialDB) { console.error("Database not loaded"); return; }

    await window.socialDB.init();
    // REMOVED: allMedia = await window.socialDB.getAll('media');

    renderStats(); // Populates User Filter Dropdown

    // Smart Default Logic (Requires UI elements to be ready)
    if (!filterNewOnly || !filterUser) return; // Safety check

    // Check if there are any unexported items
    // Use queryMedia to check for at least 1 new item
    const newItemsCheck = await window.socialDB.queryMedia({ newOnly: true }, 0, 1);
    const hasUnexported = newItemsCheck.items.length > 0;

    if (hasUnexported) {
        // Option A: Show New Only (Default behavior if new items exist)
        filterNewOnly.checked = true;
    } else {
        // Option B: Show Last Scraped User (If no new items)
        filterNewOnly.checked = false;

        if (filterUser) {
            const stats = await window.socialDB.getStorageUsage();
            if (stats && stats.counts.lastScraped > 0) {
                // We don't have the user ID of the last scraped item easily available in stats
                // unless we add it. For now, defaulting to 'ALL' is safe.
                // Or we could do a query sorted by time? queryMedia doesn't support sort yet.
                // Let's just leave it as is or default to ALL.
            }
        }
    }
}

// --- STATS ---
async function renderStats() {
    // Safety check if elements exist
    const elVideos = document.getElementById('stat-total-videos');
    if (!elVideos) return;

    // Use optimized getStorageUsage
    const stats = await window.socialDB.getStorageUsage();

    const totalVideos = stats.counts.totalVideos;
    const users = stats.counts.totalUsers;
    const lastScrape = stats.counts.lastScraped > 0 ? new Date(stats.counts.lastScraped).toLocaleString() : 'Never';

    elVideos.textContent = totalVideos;
    document.getElementById('stat-total-users').textContent = users;
    document.getElementById('stat-last-active').textContent = lastScrape;

    // Populate User Filter
    const userList = await window.socialDB.getUniqueUsers();

    // Helper to populate select
    const populate = (select, includeAll = true) => {
        if (!select) return;
        const current = select.value;
        select.innerHTML = includeAll ? '<option value="ALL">All Users</option>' : '';
        userList.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            select.appendChild(opt);
        });
        if (current && (userList.includes(current) || current === 'ALL')) select.value = current;
    };

    populate(filterUser);
    populate(exportUser);
    populate(deleteUser);

    // Cache Buttons Logic
    const btnPopulateVal = document.getElementById('btn-populate-cache');
    const btnClearVal = document.getElementById('btn-clear-cache');

    if (btnPopulateVal) {
        // Clone to remove old listeners (simple way in this context)
        cachePopulateBtn = btnPopulateVal.cloneNode(true);
        btnPopulateVal.parentNode.replaceChild(cachePopulateBtn, btnPopulateVal);

        cachePopulateBtn.addEventListener('click', () => {
            cachePopulateBtn.disabled = true;
            cachePopulateBtn.textContent = 'Requesting...';

            chrome.runtime.sendMessage({ action: "START_CACHE_POPULATION" }, (response) => {
                if (chrome.runtime.lastError) {
                    cachePopulateBtn.textContent = 'Failed';
                    cachePopulateBtn.disabled = false;
                    console.error(chrome.runtime.lastError);
                    setTimeout(() => {
                        cachePopulateBtn.textContent = 'Populate Cache';
                    }, 2000);
                } else if (response && response.started) {
                    // Only set to "Starting..." if it didn't finish immediately
                    if (response.immediate) {
                        // It finished immediately (nothing to cache).
                        // The progress listener might have fired already or will fire momentarily.
                        // We just ensure we don't get stuck in "Starting..."
                        // Ideally, we wait for the "complete" message which resets the button.
                        // But if the "complete" message arrived BEFORE this callback, the button is already reset!
                        // If we set it to "Starting..." now, we overwrite the reset.
                        // So: If immediate, DO NOTHING. The "complete" message handles it.
                        console.log("Cache population completed immediately.");
                    } else {
                        cachePopulateBtn.textContent = 'Starting...';
                    }
                } else {
                    cachePopulateBtn.textContent = 'Error';
                    cachePopulateBtn.disabled = false;
                    if (response && response.error) {
                        alert("Error: " + response.error);
                    }
                }
            });
        });
    }

    if (btnClearVal) {
        const newBtn = btnClearVal.cloneNode(true);
        btnClearVal.parentNode.replaceChild(newBtn, btnClearVal);

        newBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to clear ALL cached thumbnails? Images will reload from network next time.')) {
                await window.socialDB.clearStore('thumbnails');
                renderStorageStats();
                alert('Thumbnail cache cleared.');
            }
        });
    }

    // Check status in case it's already running
    checkCacheStatus(); // defined below or helper

    // Render Storage Stats (Async but we don't await to not block UI)
    renderStorageStats();
}

function checkCacheStatus() {
    if (!cachePopulateBtn) return;

    chrome.runtime.sendMessage({ action: "GET_CACHE_STATUS" }, (response) => {
        if (chrome.runtime.lastError) {
            // console.warn("Background not ready");
            return;
        }
        if (response && response.status === 'RUNNING') {
            cachePopulateBtn.disabled = true;
            cachePopulateBtn.textContent = `Populating... (${response.progress}/${response.total})`;
        }
    });
}

async function renderStorageStats() {
    try {
        const stats = await window.socialDB.getStorageUsage();

        // Format Bytes
        const formatSize = (bytes) => {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        document.getElementById('stat-db-usage').textContent = formatSize(stats.totalSizeBytes);
        document.getElementById('stat-thumb-usage').textContent = `Thumbnails: ${formatSize(stats.thumbnailSizeBytes)}`;

        document.getElementById('stat-top-user').textContent = stats.topUser.userId !== 'None' ? stats.topUser.userId : '-';
        document.getElementById('stat-top-user-size').textContent = `Size: ${formatSize(stats.topUser.size)}`;

        document.getElementById('stat-cache-count').textContent = stats.counts.cachedThumbnails;
        document.getElementById('stat-cache-missing').textContent = stats.counts.videosNotCached;
        document.getElementById('stat-cache-expired').textContent = stats.counts.expiredThumbnails;
        document.getElementById('stat-cache-invalid').textContent = stats.counts.invalidThumbnails;

    } catch (err) {
        console.error("Error rendering storage stats:", err);
    }
}

// --- VIDEOS GRID ---
let currentCriteria = {};
let currentPage = 0;
const PAGE_SIZE = 40;
let observer = null;

// Removed top-level event listener for filterNewOnly, handled in initUI

async function renderVideos(reset = true) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    const statsHeader = document.getElementById('video-stats-header');

    if (reset) {
        grid.innerHTML = ''; // Clear
        currentPage = 0;

        // 1. Build Criteria
        currentCriteria = {
            platform: filterPlatform.value,
            userId: filterUser.value,
            newOnly: filterNewOnly.checked
        };

        // Update Stats Header (Async)
        updateVideoStatsHeader(currentCriteria);
    }

    // 2. Query DB
    // We don't sort by date in queryMedia yet (it uses index order or store order).
    // Store order for 'media' is by 'id' (url). To sort by scrapedAt, we'd need an index.
    // For now, let's accept default order or fix index later.
    // Default order is effectively "insertion order" if IDs are time-based? No, IDs are URLs.
    // So order might be random-ish.
    // The Red Team report mentioned "Refactoring Suggestions". Sorting is a "Nice to have".
    // I Will proceed with default order.

    const offset = currentPage * PAGE_SIZE;
    const result = await window.socialDB.queryMedia(currentCriteria, offset, PAGE_SIZE);

    const batch = result.items;

    // Sort batch in memory for better UX on small pages?
    batch.sort((a, b) => b.scrapedAt - a.scrapedAt);

    if (batch.length === 0 && reset) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No videos found matching criteria.</div>';
        return;
    }

    // Remove old sentinel BEFORE appending new batch to avoid gaps/sandwiches
    const oldSentinel = document.getElementById('scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();

    // 3. Render Batch
    const fragment = document.createDocumentFragment();
    batch.forEach((media, index) => {
        if (!media) {
            console.error(`[Dashboard] Batch item ${index} is null/undefined!`);
            return;
        }
        const card = document.createElement('div');
        card.className = 'video-card';

        // Placeholder structure - Thumbnail loaded async
        const dateStr = new Date(media.scrapedAt).toLocaleDateString();

        card.innerHTML = `
            <div class="thumb loading" style="background-color: #222; display:flex; align-items:center; justify-content:center;">
                <span class="loader" style="color:#555">...</span>
            </div>
            <div class="video-info">
                <h3>${media.userId}</h3>
                <p>${dateStr}</p>
                <div class="actions">
                    <a href="${media.originalUrl}" target="_blank">View</a>
                    <button class="btn-download" data-url="${media.originalUrl}">Download</button>
                    ${!media.exported ? '<span title="New / Not Exported" style="color: #00f2ea; font-size: 0.8rem;">● New</span>' : ''}
                </div>
            </div>
        `;

        fragment.appendChild(card);

        // Trigger Async Load
        loadThumbnailForCard(card, media);
    });

    grid.appendChild(fragment);

    // 4. Setup Infinite Scroll Observer
    // If we got a full page, assume there might be more.
    // queryMedia returns hasMore flag if I implemented it?
    // My previous replacement for queryMedia included `hasMore`.
    if (result.hasMore) {
        setupObserver();
    }
}

/**
 * Thumbnail Caching Logic
 * 7 Days TTL, Extend on Fail
 */
async function loadThumbnailForCard(card, media) {
    const thumbDiv = card.querySelector('.thumb');
    const url = media.thumbnailUrl;

    // 1. Handle Invalid/Missing URLs
    if (!url) {
        showPlaceholder(thumbDiv, media);
        return;
    }

    // 2. Handle Data URIs (Direct usage, no caching needed/possible efficiently)
    if (url.startsWith('data:')) {
        thumbDiv.style.backgroundImage = `url('${url}')`;
        thumbDiv.classList.remove('loading');
        thumbDiv.innerHTML = '';
        return;
    }

    // 3. Cache Logic
    const TTL = 7 * 24 * 60 * 60 * 1000; // 7 Days in ms

    try {
        const cached = await window.socialDB.getThumbnail(url);
        const now = Date.now();

        if (cached) {
            // Check for Negative Cache (Prior Failure)
            if (cached.error && now < cached.ttl) {
                // Negative Hit: Skip fetch
                showPlaceholder(thumbDiv, media, "Load Failed (Cached)");
                return;
            }

            if (now < cached.ttl) {
                // HIT & VALID
                if (cached.blob) {
                    const blobUrl = URL.createObjectURL(cached.blob);
                    thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
                    thumbDiv.classList.remove('loading');
                    thumbDiv.innerHTML = '';
                } else {
                    // Should be covered by error check, but safety fallback
                    showPlaceholder(thumbDiv, media, "Invalid Cache");
                }
            } else {
                // HIT & EXPIRED -> Re-fetch
                // console.log(`[Cache] Expired: ${url}`);
                fetchAndCache(url, thumbDiv, cached.blob); // Pass old blob as fallback
            }
        } else {
            // MISS -> Fetch
            fetchAndCache(url, thumbDiv, null);
        }
    } catch (err) {
        console.error("Cache Error:", err);
        // Fallback to direct URL if cache fails completely
        thumbDiv.style.backgroundImage = `url('${url}')`;
        thumbDiv.innerHTML = '';
    }
}

async function fetchAndCache(url, thumbDiv, fallbackBlob) {
    const TTL = 7 * 24 * 60 * 60 * 1000;
    const ERROR_TTL = 24 * 60 * 60 * 1000; // 24 Hours for failed attempts

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');

        const blob = await response.blob();

        // Save New
        await window.socialDB.saveThumbnail({
            url: url,
            blob: blob,
            ttl: Date.now() + TTL,
            error: false
        });

        const blobUrl = URL.createObjectURL(blob);
        thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
        thumbDiv.classList.remove('loading');
        thumbDiv.innerHTML = '';

    } catch (err) {
        console.warn(`[Cache] Fetch failed for ${url}:`, err);

        if (fallbackBlob) {
            // EXTEND TTL for Old Blob
            console.log(`[Cache] Extending TTL for old blob (7 days)`);
            await window.socialDB.saveThumbnail({
                url: url,
                blob: fallbackBlob,
                ttl: Date.now() + TTL,
                error: false
            });

            const blobUrl = URL.createObjectURL(fallbackBlob);
            thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
            thumbDiv.classList.remove('loading');
            thumbDiv.innerHTML = '';
        } else {
            // NEGATIVE CACHING: Save failure state
            await window.socialDB.saveThumbnail({
                url: url,
                blob: null,
                ttl: Date.now() + ERROR_TTL,
                error: true
            });

            showPlaceholder(thumbDiv, { originalUrl: url, scrapedAt: Date.now() }, "Load Failed");
        }
    }
}

function showPlaceholder(thumbDiv, media, msg = null) {
    const parts = media.originalUrl ? media.originalUrl.split('/') : ['Unknown'];
    const videoId = parts[parts.length - 1].split('?')[0] || 'Unknown';

    thumbDiv.classList.add('placeholder');
    thumbDiv.classList.remove('loading');
    thumbDiv.innerHTML = `
        <div style="flex-direction: column; padding: 10px; text-align: center;">
            <span style="font-size: 0.8rem; color: #888; margin-bottom: 5px;">ID: ${videoId}</span>
            ${msg ? `<span style="font-size: 0.7rem; color: #ff0050;">${msg}</span>` : ''}
        </div>
    `;
}

async function updateVideoStatsHeader(criteria) {
    const statsHeader = document.getElementById('video-stats-header');
    if (!statsHeader) return;

    statsHeader.innerHTML = 'Loading stats...';

    try {
        const count = await window.socialDB.countMedia(criteria);

        if (count === 0) {
            statsHeader.innerHTML = 'No items to display.';
            return;
        }

        let text = '';

        if (criteria.userId && criteria.userId !== 'ALL') {
            // Specific User View
            text = `<strong>${criteria.userId}</strong> &bull; ${count} Videos matching criteria`;
        } else {
            // All Users View
            // We don't have unique users count for filtered query easily without scan
            // So we just show total videos.
            text = `Found <strong>${count}</strong> Videos`;
            if (criteria.newOnly) {
                text += ` (New / Unexported)`;
            }
        }

        statsHeader.innerHTML = text;
    } catch (e) {
        console.error("Error updating stats header", e);
        statsHeader.innerHTML = 'Error loading stats';
    }
}

function setupObserver() {
    // Remove old sentinel if exists
    const oldSentinel = document.getElementById('scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();

    // Infinite scroll always active if hasMore was true
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.height = '50px';
    sentinel.style.margin = '20px 0';
    document.getElementById('video-grid').appendChild(sentinel);

    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            console.log("[Dashboard] Sentinel Intersecting. Loading more...");
            currentPage++;
            renderVideos(false); // Load next batch (no reset)
        }
    }, { rootMargin: '200px' }); // Load before user hits absolute bottom

    observer.observe(sentinel);
}

// Event Delegation for Video Grid
// Moved to initUI (lines 178-188)

// --- EXPORT ---
// Variables initialized in initUI
// initExportSettings logic moved to initUI

async function getExportData() {
    const pFilter = exportPlatform.value;
    const uFilter = exportUser.value;
    const newOnly = exportNewOnly.checked;

    const criteria = {
        platform: pFilter,
        userId: uFilter,
        newOnly: newOnly
    };

    // For Export, we generally want ALL matching items.
    // WARNING: This puts them in memory.
    // Red Team Report: "Chunked Deletion... Limit Snapshot size".
    // For now, we perform the query fetching all (limit = Infinity).
    // This is safer than loading the WHOLE DB, but still risky for large exports.
    // Future improvement: Stream to file directly.

    // Using a large limit for now.
    const result = await window.socialDB.queryMedia(criteria, 0, 1000000);
    return result.items;
}

function getSelectedColumns() {
    // Updated selector for new pill structure
    const checkboxes = document.querySelectorAll('#column-pills input:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// --- LIVE PREVIEW ---
async function updateLivePreview() {
    // Optimization: queryMedia allows limit. We only need top 3.
    const pFilter = exportPlatform.value;
    const uFilter = exportUser.value;
    const newOnly = exportNewOnly.checked;

    const criteria = {
        platform: pFilter,
        userId: uFilter,
        newOnly: newOnly
    };

    const result = await window.socialDB.queryMedia(criteria, 0, 3);
    const data = result.items;

    const columns = getSelectedColumns();
    const table = document.getElementById('preview-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    // Headers
    thead.innerHTML = '<tr>' + columns.map(col => `<th>${formatColumnName(col)}</th>`).join('') + '</tr>';

    // Rows
    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center; color:#888;">No data matches filter</td></tr>`;
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = columns.map(col => {
            let val = item[col] || '';
            if (col === 'scrapedAt') val = new Date(val).toLocaleString();
            return `<td title="${val}">${val}</td>`;
        }).join('');
        tbody.appendChild(tr);
    });
}

function formatColumnName(col) {
    const map = {
        'originalUrl': 'Video URL',
        'scrapedAt': 'Date Scraped',
        'userId': 'Username',
        'platform': 'Platform',
        'videoId': 'Video ID',
        'thumbnailUrl': 'Thumbnail URL'
    };
    return map[col] || col;
}

// Event Listeners for Preview
// Moved to initUI

// Initial Preview Load
// We need to wait for data load
const originalLoadData = loadData;
loadData = async function () {
    await originalLoadData(); // Call original
    updateLivePreview(); // Then update preview
};

async function markItemsAsExported(items) {
    if (!items || items.length === 0) return;

    // Update in memory - Not needed as we removed allMedia

    // Update in DB (Batch update would be better but simple loop for now)
    // We can use SAVE_BATCH action just like scraper

    // We need to mark them as exported.
    items.forEach(m => m.exported = true);

    chrome.runtime.sendMessage({
        action: 'SAVE_BATCH',
        store: 'media',
        data: items
    });

    // Refresh preview to reflect "New Only" filter if active
    if (exportNewOnly.checked) updateLivePreview();
}

// Helper for descriptive filenames
function generateExportFilename(extension) {
    const platform = exportPlatform.value === 'ALL' ? 'AllPlatforms' : exportPlatform.value;
    const user = exportUser.value === 'ALL' ? 'AllUsers' : exportUser.value;
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const type = extension === 'txt' ? 'URLs' : 'Data';
    return `SocialScraper_${platform}_${user}_${type}_${date}.${extension}`;
}



function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

init();

// --- DELETE DATA TAB ---
// Variables initialized in initUI

async function getDeleteFilterData() {
    const pFilter = deletePlatform.value;
    const uFilter = deleteUser.value;

    const criteria = {
        platform: pFilter,
        userId: uFilter,
        newOnly: false // Delete usually targets all, or we could add a filter? Original code didn't have newOnly for delete.
    };

    // Similar to export, we fetch all for now.
    const result = await window.socialDB.queryMedia(criteria, 0, 1000000);
    return result.items;
}

async function updateDeletePreview() {
    const pFilter = deletePlatform.value;
    const uFilter = deleteUser.value;
    const criteria = { platform: pFilter, userId: uFilter };

    // Get count efficiently
    const count = await window.socialDB.countMedia(criteria);

    // Get Sample efficiently
    const sampleResult = await window.socialDB.queryMedia(criteria, 0, 10);
    const data = sampleResult.items;

    const columns = ['originalUrl', 'scrapedAt', 'userId', 'platform']; // Fixed columns for delete preview
    const table = document.getElementById('delete-preview-table');
    const tbody = table.querySelector('tbody');

    // Update Count
    deleteCountParams.textContent = count;

    // Rows (Limit to 10 for performance in preview)
    const previewData = data; // Already limited

    tbody.innerHTML = '';
    if (previewData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center; color:#888;">No data matches filter</td></tr>`;
        return;
    }

    previewData.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = columns.map(col => {
            let val = item[col] || '';
            if (col === 'scrapedAt') val = new Date(val).toLocaleString();
            return `<td title="${val}">${val}</td>`;
        }).join('');
        tbody.appendChild(tr);
    });

    if (count > 10) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${columns.length}" style="text-align:center; color:#888;">...and ${count - 10} more items</td>`;
        tbody.appendChild(tr);
    }
}

async function backupToFolder(dirHandle, criteria, updateProgress) {
    // Create images directory
    const imagesHandle = await dirHandle.getDirectoryHandle('images', { create: true });

    // Create data.json file stream
    const fileHandle = await dirHandle.getFileHandle('data_backup.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write('[\n'); // Start JSON array

    // Processing Loop
    const BATCH_SIZE = 50;
    let offset = 0;
    let processed = 0;
    let hasMore = true;
    let firstItem = true;
    const mediaIds = [];
    const thumbnailUrls = [];

    // Safety check for infinite loop
    let batchCount = 0;
    const MAX_BATCHES = 10000; // 500k items max safety

    while (hasMore && batchCount < MAX_BATCHES) {
        batchCount++;
        // Fetch batch
        const result = await window.socialDB.queryMedia(criteria, offset, BATCH_SIZE);
        const batch = result.items;
        hasMore = result.hasMore;
        offset += BATCH_SIZE;

        if (batch.length === 0) break;

        // Process Batch
        for (const media of batch) {
            // 1. Write to JSON
            if (!firstItem) await writable.write(',\n');
            await writable.write(JSON.stringify(media, null, 2));
            firstItem = false;

            // 2. Backup Image
            if (media.thumbnailUrl && !media.thumbnailUrl.startsWith('data:')) {
                try {
                    const cached = await window.socialDB.getThumbnail(media.thumbnailUrl);
                    let blob = null;
                    if (cached && cached.blob) {
                        blob = cached.blob;
                    } else {
                        // Fallback fetch
                        const resp = await fetch(media.thumbnailUrl);
                        if (resp.ok) blob = await resp.blob();
                    }

                    if (blob) {
                        let ext = 'jpg';
                        if (blob.type) {
                            ext = blob.type.split('/')[1] || 'jpg';
                        }
                        // Sanitize filename
                        const safeUserId = (media.userId || 'unknown').replace(/[^a-z0-9]/gi, '_');
                        const safeId = (media.id || 'unknown').replace(/[^a-z0-9]/gi, '_');
                        const filename = `${media.platform}_${safeUserId}_${safeId}.${ext}`;

                        const imgFileHandle = await imagesHandle.getFileHandle(filename, { create: true });
                        const imgWritable = await imgFileHandle.createWritable();
                        await imgWritable.write(blob);
                        await imgWritable.close();
                    }
                } catch (e) {
                    console.warn('Failed to backup image:', media.thumbnailUrl, e);
                }

                thumbnailUrls.push(media.thumbnailUrl);
            }

            mediaIds.push(media.id);
            processed++;

            // Update UI
            if (processed % 5 === 0 && updateProgress) {
                updateProgress(processed);
            }
        }
    }

    await writable.write('\n]'); // End JSON array
    await writable.close();

    return { processed, mediaIds, thumbnailUrls };
}


