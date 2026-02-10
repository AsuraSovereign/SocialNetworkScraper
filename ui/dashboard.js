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
let allMedia = [];

// Init
async function init() {
    await loadTabs();
    initUI();
    setupNavigation();
    setupFilters();
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
        const data = getExportData();
        if (data.length === 0) { alert('No data matches your filters.'); return; }

        const text = data.map(m => m.originalUrl).join('\n');
        const filename = generateExportFilename('txt');
        downloadFile(text, filename, 'text/plain');

        await markItemsAsExported(data);
    });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
        const data = getExportData();
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

    // Delete Button
    document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
        const data = getDeleteFilterData();
        if (data.length === 0) {
            alert('No data to delete.');
            return;
        }

        // 1. Snapshot Download
        const filename = `SNAPSHOT_BEFORE_DELETE_${new Date().toISOString().split('T')[0]}.json`;
        const jsonContent = JSON.stringify(data, null, 2);
        downloadFile(jsonContent, filename, 'application/json');

        // 2. Confirmation
        setTimeout(async () => {
            const confirmed = confirm(`WARNING: You are about to PERMANENTLY delete ${data.length} items.\n\nA snapshot has been downloaded.\n\nAre you sure you want to proceed?`);

            if (confirmed) {
                try {
                    const keys = data.map(m => m.id);
                    await window.socialDB.deleteBatch('media', keys);
                    alert('Deletion successful.');
                    await loadData(); // Reload
                    updateDeletePreview();
                } catch (err) {
                    console.error(err);
                    alert('Error deleting data: ' + err.message);
                }
            }
        }, 500);
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
    allMedia = await window.socialDB.getAll('media');

    renderStats(); // Populates User Filter Dropdown

    // Smart Default Logic (Requires UI elements to be ready)
    if (!filterNewOnly || !filterUser) return; // Safety check

    const hasUnexported = allMedia.some(m => !m.exported);

    if (hasUnexported) {
        // Option A: Show New Only (Default behavior if new items exist)
        filterNewOnly.checked = true;
    } else {
        // Option B: Show Last Scraped User (If no new items)
        filterNewOnly.checked = false;

        if (allMedia.length > 0) {
            // Find item with max scrapedAt
            const lastItem = allMedia.reduce((prev, current) => (prev.scrapedAt > current.scrapedAt) ? prev : current);
            if (lastItem && lastItem.userId && filterUser) {
                filterUser.value = lastItem.userId;
            }
        }
    }
}

// --- STATS ---
function renderStats() {
    // Safety check if elements exist
    const elVideos = document.getElementById('stat-total-videos');
    if (!elVideos) return;

    const totalVideos = allMedia.length;
    const users = new Set(allMedia.map(m => m.userId)).size;
    const lastScrape = allMedia.length > 0 ? new Date(Math.max(...allMedia.map(m => m.scrapedAt))).toLocaleString() : 'Never';

    elVideos.textContent = totalVideos;
    document.getElementById('stat-total-users').textContent = users;
    document.getElementById('stat-last-active').textContent = lastScrape;

    // Populate User Filter
    const userList = [...new Set(allMedia.map(m => m.userId))];

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
        const newBtn = btnPopulateVal.cloneNode(true);
        btnPopulateVal.parentNode.replaceChild(newBtn, btnPopulateVal);

        newBtn.addEventListener('click', async () => {
            if (!confirm('This will iterate all videos and fetch thumbnails not currently in cache. This might take a while. Continue?')) return;

            newBtn.disabled = true;
            newBtn.textContent = 'Populating...';

            let count = 0;
            const total = allMedia.length;

            // Serial execution with rate limit (0.2s delay per request)
            for (let i = 0; i < total; i++) {
                const media = allMedia[i];

                if (media.thumbnailUrl && !media.thumbnailUrl.startsWith('data:')) {
                    try {
                        // Check if exists first
                        const cached = await window.socialDB.getThumbnail(media.thumbnailUrl);

                        // If missing or expired, fetch with rate limit
                        if (!cached || Date.now() > cached.ttl) {
                            await fetchAndCache(media.thumbnailUrl, document.createElement('div'), null); // Dummy div
                            count++;

                            // Wait 200ms to ensure max 5 req/s
                            await new Promise(r => setTimeout(r, 200));
                        }
                    } catch (e) { console.error(e); }
                }

                // Update progess
                if (i % 5 === 0 || i === total - 1) {
                    newBtn.textContent = `Populating... (${i + 1}/${total})`;
                }
            }

            newBtn.textContent = 'Populate Cache';
            newBtn.disabled = false;
            alert(`Cache population complete. Fetched/Refreshed ${count} thumbnails.`);
            renderStorageStats();
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

    // Render Storage Stats (Async but we don't await to not block UI)
    renderStorageStats();
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
        document.getElementById('stat-cache-invalid').textContent = stats.counts.invalidThumbnails;

    } catch (err) {
        console.error("Error rendering storage stats:", err);
    }
}

// --- VIDEOS GRID ---
let currentFiltered = [];
let currentPage = 0;
const PAGE_SIZE = 40;
let observer = null;

// Removed top-level event listener for filterNewOnly, handled in initUI

function renderVideos(reset = true) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    const statsHeader = document.getElementById('video-stats-header');

    if (reset) {
        grid.innerHTML = ''; // Clear
        currentPage = 0;

        // 1. Filter Data Only on Reset
        const pFilter = filterPlatform.value;
        const uFilter = filterUser.value;
        const newOnly = filterNewOnly.checked;

        currentFiltered = allMedia.filter(m => {
            if (pFilter !== 'ALL' && m.platform !== pFilter) return false;
            if (uFilter !== 'ALL' && m.userId !== uFilter) return false;
            // "New" means NOT exported
            if (newOnly && m.exported === true) return false;
            return true;
        });

        // Sort by date desc (optional, but good for UX)
        currentFiltered.sort((a, b) => b.scrapedAt - a.scrapedAt);

        // Update Stats Header
        updateVideoStatsHeader(currentFiltered);
    }

    // 2. Pagination Logic
    const start = currentPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const batch = currentFiltered.slice(start, end);

    if (batch.length === 0 && reset) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No videos found matching criteria.</div>';
        return;
    }

    // 3. Render Batch
    const fragment = document.createDocumentFragment();
    batch.forEach(media => {
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
    setupObserver();
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
    // const TTL = 10000; // Debug: 10 seconds

    try {
        const cached = await window.socialDB.getThumbnail(url);
        const now = Date.now();

        if (cached) {
            if (now < cached.ttl) {
                // HIT & VALID
                const blobUrl = URL.createObjectURL(cached.blob);
                thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
                thumbDiv.classList.remove('loading');
                thumbDiv.innerHTML = '';
            } else {
                // HIT & EXPIRED -> Re-fetch
                console.log(`[Cache] Expired: ${url}`);
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

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');

        const blob = await response.blob();

        // Save New
        await window.socialDB.saveThumbnail({
            url: url,
            blob: blob,
            ttl: Date.now() + TTL
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
                ttl: Date.now() + TTL
            });

            const blobUrl = URL.createObjectURL(fallbackBlob);
            thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
            thumbDiv.classList.remove('loading');
            thumbDiv.innerHTML = '';
        } else {
            // No fallback, just show error placeholder or try direct URL (which likely fails too)
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

function updateVideoStatsHeader(filteredData) {
    const statsHeader = document.getElementById('video-stats-header');
    if (!statsHeader) return;

    if (filteredData.length === 0) {
        statsHeader.innerHTML = 'No items to display.';
        return;
    }

    const uniqueUsers = new Set(filteredData.map(m => m.userId)).size;
    const totalVideos = filteredData.length;
    const lastScrapeTime = Math.max(...filteredData.map(m => m.scrapedAt));
    const lastScrapeDate = new Date(lastScrapeTime).toLocaleString();

    let text = '';

    if (filterUser.value !== 'ALL') {
        // Specific User View
        text = `<strong>${filterUser.value}</strong> &bull; ${totalVideos} Videos &bull; Last Scraped: ${lastScrapeDate}`;
    } else {
        // All Users View
        text = `Showing <strong>${uniqueUsers}</strong> Users &bull; <strong>${totalVideos}</strong> Videos total`;
        if (filterNewOnly.checked) {
            text += ` (New / Unexported)`;
        }
    }

    statsHeader.innerHTML = text;
}

function setupObserver() {
    // Remove old sentinel if exists
    const oldSentinel = document.getElementById('scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();

    // If there are more items to load
    if ((currentPage + 1) * PAGE_SIZE < currentFiltered.length) {
        const sentinel = document.createElement('div');
        sentinel.id = 'scroll-sentinel';
        sentinel.style.height = '50px';
        sentinel.style.margin = '20px 0';
        // sentinel.textContent = 'Loading more...'; 
        document.getElementById('video-grid').appendChild(sentinel);

        if (observer) observer.disconnect();

        observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                currentPage++;
                renderVideos(false); // Load next batch (no reset)
            }
        }, { rootMargin: '200px' }); // Load before user hits absolute bottom

        observer.observe(sentinel);
    }
}

// Event Delegation for Video Grid
// Moved to initUI (lines 178-188)

// --- EXPORT ---
// Variables initialized in initUI
// initExportSettings logic moved to initUI

function getExportData() {
    const pFilter = exportPlatform.value;
    const uFilter = exportUser.value;
    const newOnly = exportNewOnly.checked;

    return allMedia.filter(m => {
        if (pFilter !== 'ALL' && m.platform !== pFilter) return false;
        if (uFilter !== 'ALL' && m.userId !== uFilter) return false;
        if (newOnly && m.exported) return false;
        return true;
    });
}



function getSelectedColumns() {
    // Updated selector for new pill structure
    const checkboxes = document.querySelectorAll('#column-pills input:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// --- LIVE PREVIEW ---
function updateLivePreview() {
    const data = getExportData().slice(0, 3); // Top 3
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

    // Update in memory
    items.forEach(m => m.exported = true);

    // Update in DB (Batch update would be better but simple loop for now)
    // We can use SAVE_BATCH action just like scraper
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

function getDeleteFilterData() {
    const pFilter = deletePlatform.value;
    const uFilter = deleteUser.value;

    return allMedia.filter(m => {
        if (pFilter !== 'ALL' && m.platform !== pFilter) return false;
        if (uFilter !== 'ALL' && m.userId !== uFilter) return false;
        return true;
    });
}

function updateDeletePreview() {
    const data = getDeleteFilterData();
    const columns = ['originalUrl', 'scrapedAt', 'userId', 'platform']; // Fixed columns for delete preview
    const table = document.getElementById('delete-preview-table');
    const tbody = table.querySelector('tbody');

    // Update Count
    deleteCountParams.textContent = data.length;

    // Rows (Limit to 10 for performance in preview)
    const previewData = data.slice(0, 10);

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

    if (data.length > 10) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${columns.length}" style="text-align:center; color:#888;">...and ${data.length - 10} more items</td>`;
        tbody.appendChild(tr);
    }
}


