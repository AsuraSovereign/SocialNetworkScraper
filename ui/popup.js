/**
 * Popup Logic
 */

document.getElementById("openDashboard").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
});

async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function init() {
    const tab = await getCurrentTab();
    const actionsDiv = document.getElementById("actions");
    const statusDiv = document.getElementById("status");
    const body = document.body;

    if (!tab.url) return;

    const privacySelect = document.getElementById("privacyMode");
    const efficientSelect = document.getElementById("efficientScrolling");

    // Load saved settings
    chrome.storage.local.get(["privacySetting", "efficientScrolling"], (result) => {
        if (result.privacySetting) {
            privacySelect.value = result.privacySetting;
        } else {
            // Default
            privacySelect.value = "HIDDEN_UNTIL_DONE";
        }

        if (result.efficientScrolling !== undefined) {
            // handle string values
            efficientSelect.value = result.efficientScrolling === true ? "Efficient" : result.efficientScrolling === false ? "Off" : result.efficientScrolling;
        } else {
            // Default to "Efficient"
            efficientSelect.value = "Efficient";
        }
    });

    // Save on change
    privacySelect.addEventListener("change", () => {
        chrome.storage.local.set({ privacySetting: privacySelect.value });
    });

    efficientSelect.addEventListener("change", () => {
        chrome.storage.local.set({ efficientScrolling: efficientSelect.value });
    });

    if (tab.url.includes("tiktok.com")) {
        body.classList.add("tiktok-theme");
        const scrapeBtn = document.createElement("button");
        scrapeBtn.className = "btn btn-primary";
        scrapeBtn.textContent = "Start TikTok Scrape";
        scrapeBtn.onclick = async () => {
            const privacySetting = privacySelect.value;
            const efficientScrolling = efficientSelect.value;
            statusDiv.textContent = "Initializing...";

            // Try sending message first
            chrome.tabs.sendMessage(tab.id, { action: "START_SCRAPE_TIKTOK", privacySetting, efficientScrolling }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script likely not loaded.
                    // Dynamic injection of modules is flaky; asking user to reload is robust.
                    console.log("Content script not found. Asking for reload.");

                    statusDiv.innerHTML = "";
                    const msg = document.createElement("div");
                    msg.style.marginBottom = "8px";
                    msg.textContent = "Extension updated. Please reload page.";

                    const reloadBtn = document.createElement("button");
                    reloadBtn.className = "btn btn-secondary";
                    reloadBtn.textContent = "Reload Page";
                    reloadBtn.onclick = () => {
                        chrome.tabs.reload(tab.id);
                        window.close();
                    };

                    statusDiv.appendChild(msg);
                    statusDiv.appendChild(reloadBtn);
                } else {
                    statusDiv.textContent = "Scraping... (Check Console)";
                    // Close popup automatically after start? Optional.
                }
            });
        };
        actionsDiv.appendChild(scrapeBtn);
    } else if (tab.url.includes("facebook.com")) {
        body.classList.add("fb-theme");
        const scrapeBtn = document.createElement("button");
        scrapeBtn.className = "btn btn-primary";
        scrapeBtn.textContent = "Start Facebook Scrape";
        // Placeholder implementation
        scrapeBtn.onclick = () => {
            statusDiv.textContent = "Coming Soon";
        };
        actionsDiv.appendChild(scrapeBtn);
    } else {
        statusDiv.textContent = "Navigate to a supported social site.";
    }
}

init();
