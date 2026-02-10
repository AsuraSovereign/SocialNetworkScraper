// DOM Elements
const contentArea = document.getElementById('content-area');
const statsTab = document.getElementById('tab-stats');
const videosTab = document.getElementById('tab-videos');
const exportTab = document.getElementById('tab-export');
const deleteTab = document.getElementById('tab-delete');

const linkStats = document.getElementById('link-stats');
const linkVideos = document.getElementById('link-videos');
const linkExport = document.getElementById('link-export');
const linkDelete = document.getElementById('link-delete');

// Filters
const filterPlatform = document.getElementById('filter-platform');
const filterUser = document.getElementById('filter-user');

// State
let allMedia = [];

// Init
async function init() {
    setupNavigation();
    setupFilters();
    loadData();
}

function setupFilters() {
    filterPlatform.addEventListener('change', () => renderVideos());
    filterUser.addEventListener('change', () => renderVideos());
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
    } else if (tabName === 'videos') {
        videosTab.style.display = 'block';
        linkVideos.classList.add('active');
        renderVideos();
    } else if (tabName === 'export') {
        exportTab.style.display = 'block';
        linkExport.classList.add('active');
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

    // Smart Default: Check New Only if there are unexported items
    const hasUnexported = allMedia.some(m => !m.exported);
    const filterNewOnly = document.getElementById('filter-new-only');
    if (filterNewOnly) {
        filterNewOnly.checked = hasUnexported;
    }

    renderStats(); // Default view
}

// --- STATS ---
function renderStats() {
    const totalVideos = allMedia.length;
    const users = new Set(allMedia.map(m => m.userId)).size;
    const lastScrape = allMedia.length > 0 ? new Date(Math.max(...allMedia.map(m => m.scrapedAt))).toLocaleString() : 'Never';

    document.getElementById('stat-total-videos').textContent = totalVideos;
    document.getElementById('stat-total-users').textContent = users;
    document.getElementById('stat-last-active').textContent = lastScrape;

    // Populate User Filter
    const userList = [...new Set(allMedia.map(m => m.userId))];

    // Helper to populate select
    const populate = (select) => {
        select.innerHTML = '<option value="ALL">All Users</option>';
        userList.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            select.appendChild(opt);
        });
    };

    populate(filterUser);
    populate(document.getElementById('export-user'));
}

// --- VIDEOS GRID ---
let currentFiltered = [];
let currentPage = 0;
const PAGE_SIZE = 40;
let observer = null;

const filterNewOnly = document.getElementById('filter-new-only');
filterNewOnly.addEventListener('change', () => renderVideos());

function renderVideos(reset = true) {
    const grid = document.getElementById('video-grid');
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

        // Thumbnail Logic
        let thumbHtml;
        if (media.thumbnailUrl) {
            thumbHtml = `<div class="thumb" loading="lazy" style="background-image: url('${media.thumbnailUrl}')"></div>`;
        } else {
            // Extract Video ID
            const parts = media.originalUrl.split('/');
            const videoId = parts[parts.length - 1].split('?')[0] || 'Unknown';
            const dateStr = new Date(media.scrapedAt).toLocaleDateString();

            thumbHtml = `
                <div class="thumb placeholder" style="flex-direction: column; padding: 10px; text-align: center;">
                    <span style="font-size: 0.8rem; color: #888; margin-bottom: 5px;">ID: ${videoId}</span>
                    <span style="font-size: 0.7rem; color: #555;">Scraped: ${dateStr}</span>
                </div>
            `;
        }

        card.innerHTML = `
            ${thumbHtml}
            <div class="video-info">
                <h3>${media.userId}</h3>
                <p>${new Date(media.scrapedAt).toLocaleDateString()}</p>
                <div class="actions">
                    <a href="${media.originalUrl}" target="_blank">View</a>
                    <button class="btn-download" data-url="${media.originalUrl}">Download</button>
                    ${!media.exported ? '<span title="New / Not Exported" style="color: #00f2ea; font-size: 0.8rem;">● New</span>' : ''}
                </div>
            </div>
        `;
        fragment.appendChild(card);
    });

    grid.appendChild(fragment);

    // 4. Setup Infinite Scroll Observer
    setupObserver();
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
document.getElementById('video-grid').addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-download')) {
        const url = e.target.getAttribute('data-url');
        if (url) {
            chrome.runtime.sendMessage({ action: 'DOWNLOAD_MEDIA', payload: { url: url } });
        }
    }
});

// --- EXPORT ---
// --- EXPORT ---
const exportPlatform = document.getElementById('export-platform');
const exportUser = document.getElementById('export-user');
const exportNewOnly = document.getElementById('export-new-only');

// Initialize Export Settings (Persistence)
function initExportSettings() {
    const storedVal = localStorage.getItem('socialScraper_exportNewOnly');

    // Default to true if not set, otherwise parse stored value
    if (storedVal === null) {
        exportNewOnly.checked = true;
    } else {
        exportNewOnly.checked = storedVal === 'true';
    }

    // Save on change
    exportNewOnly.addEventListener('change', () => {
        localStorage.setItem('socialScraper_exportNewOnly', exportNewOnly.checked);
        updateLivePreview(); // Existing listener triggers this too, but for clarity
    });
}
initExportSettings();

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
[exportPlatform, exportUser, exportNewOnly].forEach(el => {
    el.addEventListener('change', updateLivePreview);
});

document.querySelectorAll('#column-pills input').forEach(cb => {
    cb.addEventListener('change', updateLivePreview);
});

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
const deletePlatform = document.getElementById('delete-platform');
const deleteUser = document.getElementById('delete-user');
const deleteCountParams = document.getElementById('delete-count');

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

// Wire up filters
[deletePlatform, deleteUser].forEach(el => {
    el.addEventListener('change', updateDeletePreview);
});

// Populate Delete User Select (when Stats loaded)
// Modified renderStats to populate delete-user as well (already handled by populate call? check init)
// Ah, renderStats populated 'export-user', we need to populate 'delete-user' too.
// We'll hook into renderStats by monkey patching or just adding a listener if possible, 
// but since renderStats is global scope here, let's just modify the existing populate logic 
// or overwrite it securely.
const originalRenderStats = renderStats;
renderStats = function () {
    originalRenderStats();
    // Populate delete user select
    const userList = [...new Set(allMedia.map(m => m.userId))];
    const select = document.getElementById('delete-user');
    const currentValue = select.value;

    select.innerHTML = '<option value="ALL">All Users</option>';
    userList.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
    });
    // Restore selection if valid
    if (userList.includes(currentValue) || currentValue === 'ALL') {
        select.value = currentValue;
    }
}


// Delete Action
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
    // Allow small delay for download to start
    setTimeout(async () => {
        const confirmed = confirm(`WARNING: You are about to PERMANENTLY delete ${data.length} items.\n\nA snapshot has been downloaded.\n\nAre you sure you want to proceed?`);

        if (confirmed) {
            try {
                const keys = data.map(m => m.id);
                await window.socialDB.deleteBatch('media', keys);

                alert('Deletion successful.');

                // Reload
                await loadData();
                updateDeletePreview();
                // Stay on tab
            } catch (err) {
                console.error(err);
                alert('Error deleting data: ' + err.message);
            }
        }
    }, 500);
});
