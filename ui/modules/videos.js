/**
 * Videos Tab Logic
 */
import { showPlaceholder } from "./utils.js";

let currentCriteria = {};
let currentPage = 0;
const PAGE_SIZE = 40;
let observer = null;

export function initVideos() {
    setupFilters();
    // Delegation for video grid download buttons
    const videoGrid = document.getElementById("video-grid");
    if (videoGrid) {
        videoGrid.addEventListener("click", (e) => {
            if (e.target.classList.contains("btn-download")) {
                const url = e.target.getAttribute("data-url");
                if (url) {
                    chrome.runtime.sendMessage({
                        action: "DOWNLOAD_MEDIA",
                        payload: { url: url },
                    });
                }
            }
        });
    }
}

function setupFilters() {
    const filterPlatform = document.getElementById("filter-platform");
    const filterUser = document.getElementById("filter-user");
    const filterNewOnly = document.getElementById("filter-new-only");

    if (filterPlatform) filterPlatform.addEventListener("change", () => renderVideos());
    if (filterUser) filterUser.addEventListener("change", () => renderVideos());
    if (filterNewOnly) filterNewOnly.addEventListener("change", () => renderVideos());
}

export async function renderVideos(reset = true) {
    const grid = document.getElementById("video-grid");
    if (!grid) return;

    const filterPlatform = document.getElementById("filter-platform");
    const filterUser = document.getElementById("filter-user");
    const filterNewOnly = document.getElementById("filter-new-only");

    if (reset) {
        grid.innerHTML = "";
        currentPage = 0;

        currentCriteria = {
            platform: filterPlatform ? filterPlatform.value : "ALL",
            userId: filterUser ? filterUser.value : "ALL",
            newOnly: filterNewOnly ? filterNewOnly.checked : false,
        };

        updateVideoStatsHeader(currentCriteria);
    }

    const offset = currentPage * PAGE_SIZE;
    const result = await window.socialDB.queryMedia(currentCriteria, offset, PAGE_SIZE);

    const batch = result.items;

    // Optional sort by scrapedAt descending
    batch.sort((a, b) => b.scrapedAt - a.scrapedAt);

    if (batch.length === 0 && reset) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No videos found matching criteria.</div>';
        return;
    }

    const oldSentinel = document.getElementById("scroll-sentinel");
    if (oldSentinel) oldSentinel.remove();

    const fragment = document.createDocumentFragment();
    batch.forEach((media) => {
        if (!media) return;
        const card = document.createElement("div");
        card.className = "video-card";

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
                    ${!media.exported ? '<span title="New / Not Exported" style="color: #00f2ea; font-size: 0.8rem;">● New</span>' : ""}
                </div>
            </div>
        `;

        fragment.appendChild(card);
        loadThumbnailForCard(card, media);
    });

    grid.appendChild(fragment);

    if (result.hasMore) {
        setupObserver();
    }
}

async function loadThumbnailForCard(card, media) {
    const thumbDiv = card.querySelector(".thumb");
    const url = media.thumbnailUrl;

    if (!url) {
        showPlaceholder(thumbDiv, media);
        return;
    }

    if (url.startsWith("data:")) {
        thumbDiv.style.backgroundImage = `url('${url}')`;
        thumbDiv.classList.remove("loading");
        thumbDiv.innerHTML = "";
        return;
    }

    const TTL = 7 * 24 * 60 * 60 * 1000;

    try {
        const cached = await window.socialDB.getThumbnail(url);
        const now = Date.now();

        if (cached) {
            if (cached.error && now < cached.ttl) {
                showPlaceholder(thumbDiv, media, "Load Failed (Cached)");
                return;
            }

            if (now < cached.ttl) {
                if (cached.blob) {
                    const blobUrl = URL.createObjectURL(cached.blob);
                    thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
                    thumbDiv.classList.remove("loading");
                    thumbDiv.innerHTML = "";
                } else {
                    showPlaceholder(thumbDiv, media, "Invalid Cache");
                }
            } else {
                fetchAndCache(url, thumbDiv, cached.blob);
            }
        } else {
            fetchAndCache(url, thumbDiv, null);
        }
    } catch (err) {
        console.error("Cache Error:", err);
        thumbDiv.style.backgroundImage = `url('${url}')`;
        thumbDiv.innerHTML = "";
    }
}

async function fetchAndCache(url, thumbDiv, fallbackBlob) {
    const TTL = 7 * 24 * 60 * 60 * 1000;
    const ERROR_TTL = 24 * 60 * 60 * 1000;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");

        const blob = await response.blob();

        await window.socialDB.saveThumbnail({
            url: url,
            blob: blob,
            ttl: Date.now() + TTL,
            error: false,
        });

        const blobUrl = URL.createObjectURL(blob);
        thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
        thumbDiv.classList.remove("loading");
        thumbDiv.innerHTML = "";
    } catch (err) {
        console.warn(`[Cache] Fetch failed for ${url}:`, err);

        if (fallbackBlob) {
            await window.socialDB.saveThumbnail({
                url: url,
                blob: fallbackBlob,
                ttl: Date.now() + TTL,
                error: false,
            });

            const blobUrl = URL.createObjectURL(fallbackBlob);
            thumbDiv.style.backgroundImage = `url('${blobUrl}')`;
            thumbDiv.classList.remove("loading");
            thumbDiv.innerHTML = "";
        } else {
            await window.socialDB.saveThumbnail({
                url: url,
                blob: null,
                ttl: Date.now() + ERROR_TTL,
                error: true,
            });

            showPlaceholder(thumbDiv, { originalUrl: url, scrapedAt: Date.now() }, "Load Failed");
        }
    }
}

async function updateVideoStatsHeader(criteria) {
    const statsHeader = document.getElementById("video-stats-header");
    if (!statsHeader) return;

    statsHeader.innerHTML = "Loading stats...";

    try {
        const count = await window.socialDB.countMedia(criteria);

        if (count === 0) {
            statsHeader.innerHTML = "No items to display.";
            return;
        }

        let text = "";
        if (criteria.userId && criteria.userId !== "ALL") {
            text = `<strong>${criteria.userId}</strong> &bull; ${count} Videos matching criteria`;
        } else {
            text = `Found <strong>${count}</strong> Videos`;
            if (criteria.newOnly) {
                text += ` (New / Unexported)`;
            }
        }
        statsHeader.innerHTML = text;
    } catch (e) {
        console.error("Error updating stats header", e);
        statsHeader.innerHTML = "Error loading stats";
    }
}

function setupObserver() {
    const oldSentinel = document.getElementById("scroll-sentinel");
    if (oldSentinel) oldSentinel.remove();

    const sentinel = document.createElement("div");
    sentinel.id = "scroll-sentinel";
    sentinel.style.height = "50px";
    sentinel.style.margin = "20px 0";
    document.getElementById("video-grid").appendChild(sentinel);

    if (observer) observer.disconnect();

    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                currentPage++;
                renderVideos(false);
            }
        },
        { rootMargin: "200px" },
    );

    observer.observe(sentinel);
}
