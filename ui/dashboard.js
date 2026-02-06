// DOM Elements
const contentArea = document.getElementById('content-area');
const statsTab = document.getElementById('tab-stats');
const videosTab = document.getElementById('tab-videos');
const exportTab = document.getElementById('tab-export');

const linkStats = document.getElementById('link-stats');
const linkVideos = document.getElementById('link-videos');
const linkExport = document.getElementById('link-export');

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
}

function showTab(tabName) {
    // Hide all
    statsTab.style.display = 'none';
    videosTab.style.display = 'none';
    exportTab.style.display = 'none';

    // Deactivate links
    linkStats.classList.remove('active');
    linkVideos.classList.remove('active');
    linkExport.classList.remove('active');

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
    }
}

async function loadData() {
    // Wait for script to load if needed? It should be synchronous.
    if (!window.socialDB) { console.error("Database not loaded"); return; }

    await window.socialDB.init();
    allMedia = await window.socialDB.getAll('media');
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
    // Keep "All Users" option
    filterUser.innerHTML = '<option value="ALL">All Users</option>';
    userList.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        filterUser.appendChild(opt);
    });
}

// --- VIDEOS GRID ---
function renderVideos() {
    const grid = document.getElementById('video-grid');
    grid.innerHTML = ''; // Clear

    // 1. Filter Data
    const pFilter = filterPlatform.value;
    const uFilter = filterUser.value;

    let filtered = allMedia.filter(m => {
        if (pFilter !== 'ALL' && m.platform !== pFilter) return false;
        if (uFilter !== 'ALL' && m.userId !== uFilter) return false;
        return true;
    });

    // 2. Render
    const limit = 50;
    filtered.slice(0, limit).forEach(media => {
        const card = document.createElement('div');
        card.className = 'video-card';

        // Thumbnail Logic
        let thumbHtml;
        if (media.thumbnailUrl) {
            thumbHtml = `<div class="thumb" style="background-image: url('${media.thumbnailUrl}')"></div>`;
        } else {
            // Extract Video ID
            const parts = media.originalUrl.split('/');
            const videoId = parts[parts.length - 1].split('?')[0] || 'Unknown'; // Handle query params
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
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
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
document.getElementById('btn-export-txt').addEventListener('click', () => {
    const text = allMedia.map(m => m.originalUrl).join('\n');
    downloadFile(text, 'export.txt', 'text/plain');
});

document.getElementById('btn-export-csv').addEventListener('click', () => {
    const header = "User,URL,Date,Platform\n";
    const rows = allMedia.map(m => `${m.userId},${m.originalUrl},${new Date(m.scrapedAt).toISOString()},${m.platform}`).join('\n');
    downloadFile(header + rows, 'export.csv', 'text/csv');
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
