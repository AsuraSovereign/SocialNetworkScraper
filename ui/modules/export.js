/**
 * Export Logic
 */

import { newOnlyModeState, currentExportMode, setCurrentExportMode } from "./state.js";
import { formatColumnName, downloadFile, generateExportFilename, sanitizeFilename } from "./utils.js";

export function initExport() {
    setupExportTabs();

    // Live Preview Triggers
    const previewTriggers = ["export-platform", "export-user", "export-date-start", "export-date-end", "export-new-only", "export-new-only-global"];
    previewTriggers.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("change", updateLivePreview);
    });

    document.querySelectorAll("#column-pills input").forEach((cb) => {
        cb.addEventListener("change", updateLivePreview);
    });

    const btnRun = document.getElementById("btn-run-export");
    if (btnRun) {
        btnRun.addEventListener("click", async () => {
            await handleExportAction();
        });
    }

    // Zip Strategy Toggle logic
    const zipToggleOptions = document.querySelectorAll(".zip-strategy-toggle .toggle-option");
    const zipStrategyInput = document.getElementById("zip-strategy-value");

    if (zipToggleOptions.length > 0) {
        zipToggleOptions.forEach((opt) => {
            opt.addEventListener("click", () => {
                zipToggleOptions.forEach((o) => o.classList.remove("active"));
                opt.classList.add("active");

                const val = opt.getAttribute("data-value");
                if (zipStrategyInput) zipStrategyInput.value = val;

                const batchSettings = document.getElementById("zip-batch-settings");
                const sizeSettings = document.getElementById("zip-size-settings");

                if (batchSettings) batchSettings.style.display = val === "batch" ? "block" : "none";
                if (sizeSettings) sizeSettings.style.display = val === "size" ? "block" : "none";
            });
        });
    }

    // DB Export Type Change
    const dbType = document.getElementById("db-export-type");
    if (dbType) {
        const storeSel = document.getElementById("db-store-select");
        const snapshotOpts = document.getElementById("db-snapshot-options");
        const includeThumbsWrapper = document.getElementById("db-include-thumbs-wrapper");

        const handleDbType = () => {
            const val = dbType.value;
            if (storeSel) storeSel.style.display = val === "single" ? "block" : "none";
            if (snapshotOpts) snapshotOpts.style.display = val === "snapshot" ? "block" : "none";
            if (includeThumbsWrapper) includeThumbsWrapper.style.display = val === "single" ? "block" : "none";
        };
        dbType.addEventListener("change", handleDbType);
        handleDbType(); // Init state

        // Init Last Snapshot Time Display
        updateLastSnapshotDisplay();
    }
}

function updateLastSnapshotDisplay() {
    const el = document.getElementById("last-snapshot-time");
    if (!el) return;

    const lastTime = localStorage.getItem("socialScraper_lastSnapshot");
    if (lastTime) {
        el.textContent = new Date(parseInt(lastTime)).toLocaleString();
    } else {
        el.textContent = "Never";
    }
}

function setupExportTabs() {
    const btns = document.querySelectorAll(".export-nav .nav-btn");
    btns.forEach((btn) => {
        btn.addEventListener("click", () => {
            btns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            const mode = btn.dataset.mode;
            setCurrentExportMode(mode);
            updateExportUI();
        });
    });

    const newOnlyToggle = document.getElementById("export-new-only");
    const newOnlyGlobal = document.getElementById("export-new-only-global");

    if (newOnlyToggle) {
        newOnlyToggle.addEventListener("change", (e) => {
            const val = e.target.checked;
            newOnlyModeState[currentExportMode] = val;

            if (newOnlyGlobal && newOnlyGlobal.checked) {
                Object.keys(newOnlyModeState).forEach((k) => (newOnlyModeState[k] = val));
            }
            updateLivePreview();
        });
    }

    if (newOnlyGlobal) {
        newOnlyGlobal.addEventListener("change", (e) => {
            if (e.target.checked) {
                const currentVal = newOnlyModeState[currentExportMode];
                Object.keys(newOnlyModeState).forEach((k) => (newOnlyModeState[k] = currentVal));
            }
        });
    }

    updateExportUI();
}

export function updateExportUI() {
    const title = document.getElementById("export-mode-title");
    const updateBtn = document.getElementById("btn-export-text");

    const groups = {
        platform: document.getElementById("group-platform"),
        user: document.getElementById("group-user"),
        date: document.getElementById("group-date"),
        newOnly: document.getElementById("group-new-only"),
    };

    const opts = {
        thumbnails: document.getElementById("opt-thumbnails"),
        db: document.getElementById("opt-db"),
        csv: document.getElementById("opt-csv"),
    };

    const set = (el, show) => {
        if (el) el.style.display = show ? "block" : "none";
    };

    Object.values(opts).forEach((el) => set(el, false));
    if (groups.newOnly) {
        groups.newOnly.style.display = "none";
        const toggle = document.getElementById("export-new-only");
        if (toggle) {
            toggle.checked = newOnlyModeState[currentExportMode] || false;
        }
    }

    switch (currentExportMode) {
        case "users":
            if (title) title.textContent = "Export Users";
            if (updateBtn) updateBtn.textContent = "Export Users List";
            set(groups.platform, true);
            set(groups.user, false);
            set(groups.date, true);
            set(groups.newOnly, true);
            break;
        case "urls":
            if (title) title.textContent = "Export URLs";
            if (updateBtn) updateBtn.textContent = "Export URLs (TXT)";
            set(groups.platform, true);
            set(groups.user, true);
            set(groups.date, true);
            set(groups.newOnly, true);
            break;
        case "thumbnails":
            if (title) title.textContent = "Export Thumbnails";
            if (updateBtn) updateBtn.textContent = "Export Thumbnails (ZIP)";
            set(groups.platform, true);
            set(groups.user, true);
            set(groups.date, true);
            set(opts.thumbnails, true);
            set(groups.newOnly, true);
            break;
        case "db":
            if (title) title.textContent = "Database Export";
            if (updateBtn) updateBtn.textContent = "Export Database";
            set(groups.platform, false);
            set(groups.user, false);
            set(groups.date, false);
            set(opts.db, true);
            set(groups.newOnly, false);
            const dbType = document.getElementById("db-export-type");
            const storeSel = document.getElementById("db-store-select");
            if (dbType && storeSel) {
                storeSel.style.display = dbType.value === "single" ? "block" : "none";
            }
            break;
        case "csv":
            if (title) title.textContent = "Export CSV";
            if (updateBtn) updateBtn.textContent = "Export Data (CSV)";
            set(groups.platform, true);
            set(groups.user, true);
            set(groups.date, true);
            set(opts.csv, true);
            set(groups.newOnly, true);
            break;
    }

    const previewCard = document.getElementById("export-preview-card");
    if (previewCard) {
        const showPreview = ["users", "urls", "csv"].includes(currentExportMode);
        previewCard.style.display = showPreview ? "block" : "none";
        if (showPreview) updateLivePreview();
    } else {
        updateLivePreview();
    }
}

export async function updateLivePreview() {
    const filters = getActiveFilters();
    const table = document.getElementById("preview-table");
    const placeholder = document.getElementById("preview-placeholder");
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    thead.innerHTML = "";
    tbody.innerHTML = "";

    let columns = [];
    let rows = [];

    try {
        if (currentExportMode === "users") {
            const users = await window.socialDB.getUniqueUsers(filters);
            const displayUsers = users.slice(0, 10);
            columns = ["Username"];
            displayUsers.forEach((u) => {
                rows.push([`<td title="${u}">${u}</td>`]);
            });
            if (users.length > 10) {
                rows.push([`<td style="text-align:center; color:#888; font-style:italic;">...and ${users.length - 10} more</td>`]);
            }
        } else if (currentExportMode === "urls") {
            const result = await window.socialDB.queryMedia(filters, 0, 10);
            columns = ["Video URL", "Date Scraped"];
            result.items.forEach((m) => {
                const val = m.originalUrl || "";
                const date = m.scrapedAt ? new Date(m.scrapedAt).toLocaleString() : "";
                rows.push([`<td title="${val}" style="max-width: 300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${val}</td>`, `<td>${date}</td>`]);
            });
        } else if (currentExportMode === "csv") {
            const rawCols = getSelectedColumns();
            if (rawCols.length === 0) {
                columns = ["Info"];
                rows.push(['<td style="color:#888;">No columns selected</td>']);
            } else {
                columns = rawCols.map((c) => formatColumnName(c));
                const result = await window.socialDB.queryMedia(filters, 0, 10);
                result.items.forEach((item) => {
                    const rowCells = rawCols.map((col) => {
                        let val = item[col];
                        if (col === "videoId" && !val) val = item.id;
                        val = val || "";
                        if (col === "scrapedAt") val = new Date(val).toLocaleString();
                        return `<td title="${val}">${val}</td>`;
                    });
                    rows.push(rowCells);
                });
            }
        }
    } catch (e) {
        console.error("Preview Error:", e);
        if (placeholder) {
            placeholder.textContent = "Error loading preview";
            placeholder.style.display = "block";
        }
        table.style.display = "none";
        return;
    }

    const hasData = rows.length > 0;
    if (!hasData) {
        if (placeholder) {
            placeholder.innerHTML = "No data matches filter";
            placeholder.style.display = "block";
        }
        table.style.display = "none";
    } else {
        if (placeholder) placeholder.style.display = "none";
        table.style.display = "table";
        thead.innerHTML = "<tr>" + columns.map((c) => `<th>${c}</th>`).join("") + "</tr>";
        tbody.innerHTML = rows.map((r) => `<tr>${r.join("")}</tr>`).join("");
    }
}

function getActiveFilters() {
    const pEl = document.getElementById("export-platform");
    const uEl = document.getElementById("export-user");
    const startEl = document.getElementById("export-date-start");
    const endEl = document.getElementById("export-date-end");

    const p = pEl ? pEl.value : "ALL";
    const u = uEl ? uEl.value : "ALL";
    const start = startEl ? startEl.value : null;
    const end = endEl ? endEl.value : null;

    let sTime = null;
    let eTime = null;

    if (start) sTime = new Date(start).getTime();
    if (end) {
        const eDate = new Date(end);
        eDate.setHours(23, 59, 59, 999);
        eTime = eDate.getTime();
    }
    if (start && !end) {
        const sDate = new Date(start);
        sDate.setHours(23, 59, 59, 999);
        eTime = sDate.getTime();
    }

    let excludeMask = 0;
    if (newOnlyModeState[currentExportMode]) {
        excludeMask = getExportFlag(currentExportMode);
    }

    return {
        platform: p,
        userId: u,
        startDate: sTime,
        endDate: eTime,
        newOnly: newOnlyModeState[currentExportMode] || false,
        excludeMask: excludeMask,
    };
}

function getSelectedColumns() {
    const checkboxes = document.querySelectorAll("#column-pills input:checked");
    return Array.from(checkboxes).map((cb) => cb.value);
}

function getExportFlag(mode) {
    const Flags = window.socialDB.constructor.ExportFlags;
    if (!Flags) return 0;
    switch (mode) {
        case "urls":
            return Flags.URLS;
        case "users":
            return Flags.USERS;
        case "thumbnails":
            return Flags.THUMBNAILS;
        case "csv":
            return Flags.CSV;
        case "db":
            return Flags.DB;
        default:
            return 0;
    }
}

async function handleExportAction() {
    const btn = document.getElementById("btn-run-export");
    const originalText = btn.innerHTML;
    const progressEl = document.getElementById("export-progress");

    const setBusy = (msg) => {
        btn.disabled = true;
        btn.textContent = msg;
        if (progressEl) {
            progressEl.style.display = "block";
            progressEl.textContent = msg;
        }
    };

    const setIdle = () => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (progressEl) progressEl.style.display = "none";
    };

    try {
        setBusy("Initializing...");
        const filters = getActiveFilters();

        switch (currentExportMode) {
            case "users":
                await exportUsers(filters);
                break;
            case "urls":
                await exportUrls(filters);
                break;
            case "thumbnails":
                await exportThumbnails(filters, setBusy);
                break;
            case "db":
                await exportSnapshot(setBusy);
                break;
            case "csv":
                await exportCSV(filters);
                break;
        }

        if (!filters.newOnly) {
            updateLivePreview();
        }
    } catch (err) {
        console.error("Export Failed:", err);
        alert("Export Failed: " + err.message);
    } finally {
        setIdle();
    }
}

async function exportUsers(filters) {
    const users = await window.socialDB.getUniqueUsers(filters);
    if (users.length === 0) throw new Error("No users found matching criteria.");

    const text = users.join("\n");
    const filename = `Users_${new Date().toISOString().split("T")[0]}.txt`;
    downloadFile(text, filename, "text/plain");

    let flags = getExportFlag("users");
    const globalApply = document.getElementById("export-new-only-global");
    if (globalApply && globalApply.checked) {
        flags = window.socialDB.constructor.ExportFlags.ALL_EXPORT;
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const promises = batch.map((u) => window.socialDB.queryMedia({ userId: u }, 0, 10000));
        const results = await Promise.all(promises);

        let idsToMark = [];
        results.forEach((res) => {
            if (res.items) res.items.forEach((item) => idsToMark.push(item.id));
        });

        if (idsToMark.length > 0) {
            await window.socialDB.markAsExported(idsToMark, flags);
        }
    }
}

async function exportUrls(filters) {
    // Large limit
    const result = await window.socialDB.queryMedia(filters, 0, 500000);
    if (result.items.length === 0) throw new Error("No items found.");

    const text = result.items.map((m) => m.originalUrl).join("\n");
    const filename = `URLs_${new Date().toISOString().split("T")[0]}.txt`;
    downloadFile(text, filename, "text/plain");

    const ids = result.items.map((m) => m.id);
    let flags = getExportFlag("urls");
    const globalApply = document.getElementById("export-new-only-global");
    if (globalApply && globalApply.checked) {
        flags = window.socialDB.constructor.ExportFlags.ALL_EXPORT;
    }
    await window.socialDB.markAsExported(ids, flags);
}

async function exportCSV(filters) {
    const result = await window.socialDB.queryMedia(filters, 0, 500000);
    if (result.items.length === 0) throw new Error("No items found.");

    const columns = getSelectedColumns();
    const header = columns.map((c) => formatColumnName(c)).join(",") + "\n";

    const rows = result.items
        .map((m) => {
            return columns
                .map((col) => {
                    let val = m[col];
                    if (col === "videoId" && !val) val = m.id;
                    val = val || "";
                    if (col === "scrapedAt") val = new Date(val).toISOString();
                    const str = String(val).replace(/"/g, '""');
                    return `"${str}"`;
                })
                .join(",");
        })
        .join("\n");

    const filename = `Export_${new Date().toISOString().split("T")[0]}.csv`;
    downloadFile(header + rows, filename, "text/csv");

    const ids = result.items.map((m) => m.id);
    let flags = getExportFlag("csv");
    const globalApply = document.getElementById("export-new-only-global");
    if (globalApply && globalApply.checked) {
        flags = window.socialDB.constructor.ExportFlags.ALL_EXPORT;
    }
    await window.socialDB.markAsExported(ids, flags);
}

async function exportThumbnails(filters, progressCallback) {
    progressCallback("Querying DB...");
    const result = await window.socialDB.queryMedia(filters, 0, 100000);
    const total = result.items.length;
    if (total === 0) throw new Error("No thumbnails found.");

    if (!window.JSZip) throw new Error("JSZip library not loaded.");

    const strategyEl = document.querySelector('input[name="zip-strategy"]:checked');
    const batchMode = strategyEl ? strategyEl.value === "batch" : true;
    const maxItems = parseInt(document.getElementById("zip-max-items").value) || 2000;
    const maxSizeMB = parseInt(document.getElementById("zip-max-size").value) || 500;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    let currentZip = new JSZip();
    let currentCount = 0;
    let currentSize = 0;
    let zipIndex = 1;

    const downloadZip = async (zip, idx) => {
        const content = await zip.generateAsync({ type: "blob" });
        const fname = `Thumbnails_Part${idx}.zip`;
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const mediaIds = [];

    for (let i = 0; i < total; i++) {
        const item = result.items[i];
        if (!item.thumbnailUrl) continue;

        try {
            const cached = await window.socialDB.getThumbnail(item.thumbnailUrl);
            let blob = null;
            if (cached && cached.blob) {
                blob = cached.blob;
            } else {
                continue;
            }

            let ext = "jpg";
            if (blob.type === "image/webp") ext = "webp";
            else if (blob.type === "image/png") ext = "png";

            const filename = `${sanitizeFilename(item.platform)}/${sanitizeFilename(item.userId)}/${sanitizeFilename(item.videoId || String(i))}.${ext}`;
            currentZip.file(filename, blob);

            mediaIds.push(item.id);
            currentCount++;
            currentSize += blob.size;

            progressCallback(`Zipping... ${i + 1}/${total}`);

            let flush = false;
            if (batchMode && currentCount >= maxItems) flush = true;
            if (!batchMode && currentSize >= maxSizeBytes) flush = true;

            if (flush) {
                progressCallback(`Downloading Batch ${zipIndex}...`);
                await downloadZip(currentZip, zipIndex);
                zipIndex++;
                currentZip = null; // Explicit dereference for GC
                currentZip = new JSZip();
                currentCount = 0;
                currentSize = 0;
            }
        } catch (e) {
            console.warn("Failed to zip item:", item, e);
        }
    }

    if (currentCount > 0) {
        progressCallback(`Downloading Final Batch...`);
        await downloadZip(currentZip, zipIndex);
    }

    // Explicit dereference for GC
    currentZip = null;

    if (mediaIds.length > 0) {
        let flags = getExportFlag("thumbnails");
        const globalApply = document.getElementById("export-new-only-global");
        if (globalApply && globalApply.checked) {
            flags = window.socialDB.constructor.ExportFlags.ALL_EXPORT;
        }
        await window.socialDB.markAsExported(mediaIds, flags);
    }
}

async function exportSnapshot(progressCallback) {
    const type = document.getElementById("db-export-type").value;

    // Legacy/Other modes
    if (type === "single" || type === "full") {
        await exportDBLegacy(progressCallback);
        return;
    }

    progressCallback("Initializing Snapshot...");
    if (!window.JSZip) throw new Error("JSZip library not loaded.");

    // Config
    const ZOOM_ZIP_LIMIT_MB = 500; // 500MB limit per ZIP header
    const ZOOM_ZIP_LIMIT_BYTES = ZOOM_ZIP_LIMIT_MB * 1024 * 1024;

    let zipIndex = 1;
    let currentZip = new JSZip();
    let currentSize = 0;

    // Manifest
    const manifest = {
        version: 1,
        created: new Date().toISOString(),
        parts: [],
    };

    // 1. Export Media Store (Metadata)
    progressCallback("Exporting Media Metadata...");

    // Incremental Logic
    const lastSnapshot = localStorage.getItem("socialScraper_lastSnapshot");
    const forceFull = document.getElementById("db-force-full-snapshot")?.checked;
    let sinceTime = 0;

    if (lastSnapshot && !forceFull) {
        sinceTime = parseInt(lastSnapshot);
        progressCallback(`Incremental Mode: Exporting items since ${new Date(sinceTime).toLocaleString()}...`);
    } else {
        progressCallback("Full Export Mode...");
    }

    const mediaResult = await getAllStoreData(
        "media",
        (count) => {
            progressCallback(`Fetching Metadata (${count})...`);
        },
        sinceTime,
    );

    // 2. Export Thumbnails
    progressCallback("Querying Thumbnails...");

    // Cursor strategy for thumbnails to save memory
    // We can't fetch all blobs appropriately without crashing memory on large DBs.
    // (Variables zipIndex, currentZip, currentSize are already active and contain media.json)

    // Metadata for the current ZIP part
    let currentThumbMeta = [];

    const downloadCurrentZip = async (isFinal = false) => {
        progressCallback(`Generating ZIP Part ${zipIndex}...`);

        // Add thumbnail mapping for this part
        if (currentThumbMeta.length > 0) {
            currentZip.file("thumbnails_meta.json", JSON.stringify(currentThumbMeta, null, 2));
        }

        // Add manifest to Part 1 only? or all?
        // Let's add manifest to Part 1.
        if (zipIndex === 1) {
            const finalManifest = { ...manifest, since: sinceTime, generated: Date.now() };
            currentZip.file("snapshot.json", JSON.stringify(finalManifest, null, 2));
            // Also add media.json to Part 1
            const mediaJson = JSON.stringify(mediaResult, null, 2);
            currentZip.file("media.json", mediaJson);
        }

        const content = await currentZip.generateAsync({ type: "blob" });
        const fname = `Snapshot_${new Date().toISOString().split("T")[0]}_Part${zipIndex}.zip`;
        downloadFileBlob(content, fname);

        // Reset
        zipIndex++;
        currentZip = new JSZip();
        currentSize = 0;
        currentThumbMeta = [];
    };

    // New Thumbnail Export Logic based on Media
    // We only export thumbnails that are referenced by the exported Media items.
    // This naturally handles incremental exports (only new media -> only new thumbnails).

    const mediaItems = mediaResult.items;
    const thumbUrlsToFetch = new Set();

    mediaItems.forEach((m) => {
        if (m.thumbnailUrl && !m.thumbnailUrl.startsWith("data:")) {
            thumbUrlsToFetch.add(m.thumbnailUrl);
        }
    });

    const totalThumbsToFetch = thumbUrlsToFetch.size;
    progressCallback(`Identified ${totalThumbsToFetch} thumbnails to export...`);

    const thumbUrlsArray = Array.from(thumbUrlsToFetch);
    let processedThumbs = 0;

    for (let i = 0; i < totalThumbsToFetch; i++) {
        const url = thumbUrlsArray[i];
        try {
            const thumb = await window.socialDB.getThumbnail(url);
            if (thumb && thumb.blob) {
                let ext = "jpg";
                if (thumb.blob.type === "image/webp") ext = "webp";
                else if (thumb.blob.type === "image/png") ext = "png";

                const safeName = `img_${processedThumbs}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
                const zipPath = `thumbnails/${safeName}`;

                currentZip.file(zipPath, thumb.blob);
                currentSize += thumb.blob.size;

                const meta = { ...thumb };
                delete meta.blob;
                meta._zipPath = zipPath;
                meta._contentType = thumb.blob.type;
                currentThumbMeta.push(meta);

                processedThumbs++;

                if (currentSize >= ZOOM_ZIP_LIMIT_BYTES) {
                    await downloadCurrentZip(false);
                }
            }
        } catch (e) {
            console.warn("Failed to fetch thumb", url, e);
        }

        if (i % 50 === 0) progressCallback(`Processing Thumbnails: ${i}/${totalThumbsToFetch}...`);
    }

    // Final Flush
    if (currentSize > 0 || (zipIndex === 1 && mediaItems.length > 0)) {
        await downloadCurrentZip(true);
    }

    if (mediaItems.length === 0 && processedThumbs === 0) {
        progressCallback("Nothing new to export.");
        alert("No new items found since last snapshot.");
    } else {
        // Update Snapshot Time
        localStorage.setItem("socialScraper_lastSnapshot", Date.now().toString());
        updateLastSnapshotDisplay(); // Refresh UI
        progressCallback("Snapshot Export Complete!");
    }
}

async function getAllStoreData(storeName, onProgress, since = 0) {
    let allItems = [];
    let offset = 0;
    const LIMIT = 2000;
    while (true) {
        let result;
        if (storeName === "media") {
            const criteria = { startDate: since };
            // Note: queryMedia returns { items, hasMore }
            result = await window.socialDB.queryMedia(criteria, offset, LIMIT);
        } else {
            // Fallback for non-media stores (unlikely to need incremental)
            result = await window.socialDB.exportStore(storeName, offset, LIMIT);
        }

        allItems = allItems.concat(result.items);
        // Important: queryMedia with filters uses 'skipped' count for offset,
        // so we need to track how many we successfully got?
        // No, queryMedia implementation: if (skipped < offset) skipped++ else push.
        // So offset represents the number of MATCHING items to skip.
        // Thus, we increase offset by the number of items we just retrieved.
        offset += result.items.length;

        if (onProgress) onProgress(allItems.length);

        if (!result.hasMore || result.items.length === 0) break;
    }

    return {
        type: "SocialScraper_Snapshot_Store",
        store: storeName,
        items: allItems,
    };
}

// Helper for download
function downloadFileBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Renamed old exportDB to exportDBLegacy for fallback
async function exportDBLegacy(progressCallback) {
    const type = document.getElementById("db-export-type").value;
    const storeNameEl = document.getElementById("db-target-store");
    const storeName = storeNameEl ? storeNameEl.value : "media";
    const includeThumbnails = document.getElementById("db-include-thumbnails")?.checked;

    const stores = type === "single" ? [storeName] : ["media", "thumbnails"];

    const downloadJSON = (obj, name) => {
        const blob = new Blob([JSON.stringify(obj, null, 2)], {
            type: "application/json",
        });
        downloadFileBlob(blob, name);
    };

    const downloadBlob = (blob, name) => {
        downloadFileBlob(blob, name);
    };

    const MAX_CHUNK_ITEMS = 5000;

    for (const store of stores) {
        // --- Thumbnails ZIP Export Strategy ---
        if (store === "thumbnails" && includeThumbnails) {
            progressCallback(`Exporting Thumbnails (ZIP Mode)...`);
            if (!window.JSZip) throw new Error("JSZip library not loaded.");

            const ZOOM_ZIP_LIMIT_MB = 200;
            const ZOOM_ZIP_LIMIT_COUNT = 2000;

            let offset = 0;
            let zipIndex = 1;

            let currentZip = new JSZip();
            let currentMeta = [];
            let currentSize = 0;
            let currentCount = 0;

            while (true) {
                const result = await window.socialDB.exportStore(store, offset, 1000);
                const items = result.items;

                if (items.length === 0) {
                    if (currentCount > 0) {
                        currentZip.file("thumbnails_meta.json", JSON.stringify(currentMeta, null, 2));
                        const content = await currentZip.generateAsync({ type: "blob" });
                        downloadBlob(content, `DB_thumbnails_Part${zipIndex}.zip`);
                    }
                    break;
                }

                for (const item of items) {
                    if (!item.blob) continue;

                    let ext = "jpg";
                    if (item.blob.type === "image/webp") ext = "webp";
                    else if (item.blob.type === "image/png") ext = "png";

                    const fileName = `images/thumb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;

                    currentZip.file(fileName, item.blob);

                    const meta = { ...item };
                    delete meta.blob;
                    meta._zipFileName = fileName;
                    meta._contentType = item.blob.type;
                    currentMeta.push(meta);

                    currentSize += item.blob.size;
                    currentCount++;

                    if (currentSize > ZOOM_ZIP_LIMIT_MB * 1024 * 1024 || currentCount >= ZOOM_ZIP_LIMIT_COUNT) {
                        progressCallback(`Zipping Thumbnails Part ${zipIndex}...`);

                        currentZip.file("thumbnails_meta.json", JSON.stringify(currentMeta, null, 2));
                        const content = await currentZip.generateAsync({ type: "blob" });
                        downloadBlob(content, `DB_thumbnails_Part${zipIndex}.zip`);

                        zipIndex++;
                        currentZip = new JSZip();
                        currentMeta = [];
                        currentSize = 0;
                        currentCount = 0;
                    }
                }

                offset += items.length;
                if (!result.hasMore) {
                    if (currentCount > 0) {
                        progressCallback(`Finishing Thumbnails Part ${zipIndex}...`);
                        currentZip.file("thumbnails_meta.json", JSON.stringify(currentMeta, null, 2));
                        const content = await currentZip.generateAsync({ type: "blob" });
                        downloadBlob(content, `DB_thumbnails_Part${zipIndex}.zip`);
                    }
                    break;
                }
                progressCallback(`Processed ${offset} thumbnails...`);
            }
            continue;
        }

        progressCallback(`Exporting ${store}...`);

        let offset = 0;
        let part = 1;
        while (true) {
            const res = await window.socialDB.exportStore(store, offset, MAX_CHUNK_ITEMS);
            if (res.items.length > 0) {
                const dump = {
                    type: "SocialScraper_DB_Dump",
                    store: store,
                    items: res.items,
                };
                downloadJSON(dump, `DB_${store}_Part${part}.json`);
                part++;
                offset += res.items.length;
            }
            if (!res.hasMore) break;
        }
    }
}
