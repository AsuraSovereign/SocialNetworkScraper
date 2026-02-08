/**
 * Popup Logic
 */

document.getElementById('openDashboard').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
});

async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function init() {
    const tab = await getCurrentTab();
    const actionsDiv = document.getElementById('actions');
    const statusDiv = document.getElementById('status');
    const body = document.body;

    if (!tab.url) return;

    if (tab.url.includes('tiktok.com')) {
        body.classList.add('tiktok-theme');
        const scrapeBtn = document.createElement('button');
        scrapeBtn.className = 'btn btn-primary';
        scrapeBtn.textContent = 'Start TikTok Scrape';
        scrapeBtn.onclick = async () => {
            const privacyMode = document.getElementById('privacyMode').checked;
            statusDiv.textContent = 'Initializing...';

            // Try sending message first
            chrome.tabs.sendMessage(tab.id, { action: 'START_SCRAPE_TIKTOK', privacyMode }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script likely not loaded. 
                    // Dynamic injection of modules is flaky; asking user to reload is robust.
                    console.log("Content script not found. Asking for reload.");

                    statusDiv.innerHTML = '';
                    const msg = document.createElement('div');
                    msg.style.marginBottom = '8px';
                    msg.textContent = 'Extension updated. Please reload page.';

                    const reloadBtn = document.createElement('button');
                    reloadBtn.className = 'btn btn-secondary';
                    reloadBtn.textContent = 'Reload Page';
                    reloadBtn.onclick = () => {
                        chrome.tabs.reload(tab.id);
                        window.close();
                    };

                    statusDiv.appendChild(msg);
                    statusDiv.appendChild(reloadBtn);
                } else {
                    statusDiv.textContent = 'Scraping... (Check Console)';
                    // Close popup automatically after start? Optional.
                }
            });
        };
        actionsDiv.appendChild(scrapeBtn);
    }
    else if (tab.url.includes('facebook.com')) {
        body.classList.add('fb-theme');
        const scrapeBtn = document.createElement('button');
        scrapeBtn.className = 'btn btn-primary';
        scrapeBtn.textContent = 'Start Facebook Scrape';
        // Placeholder implementation
        scrapeBtn.onclick = () => { statusDiv.textContent = 'Coming Soon'; };
        actionsDiv.appendChild(scrapeBtn);
    }
    else {
        statusDiv.textContent = 'Navigate to a supported social site.';
    }
}

init();
