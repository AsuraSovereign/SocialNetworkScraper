/**
 * Import Logic
 */

import { renderStorageStats } from "./stats.js";

// We need a way to reload data globally.
// Import depends on reloading stats and maybe other things.
// We can pass a callback or dispatch an event.
// For now we will import reload function or rely on user refreshing/switching tabs?
// Better to dispatch a custom event "DataUpdated".

export function initImport() {
    setupImportTab();
}

function setupImportTab() {
    const dropZone = document.getElementById("import-drop-zone");
    const fileInput = document.getElementById("file-import-input");
    const btnSelect = document.getElementById("btn-select-files");
    const btnStart = document.getElementById("btn-start-import");

    if (btnSelect) {
        btnSelect.addEventListener("click", () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener("change", handleFileSelect);
    }

    if (dropZone) {
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("border-blue-500");
        });

        dropZone.addEventListener("dragleave", () => {
            dropZone.classList.remove("border-blue-500");
        });

        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("border-blue-500");
            if (e.dataTransfer.files) {
                fileInput.files = e.dataTransfer.files;
                handleFileSelect({ target: fileInput });
            }
        });
    }

    if (btnStart) {
        btnStart.addEventListener("click", handleImport);
    }
}

function handleFileSelect(e) {
    const files = e.target.files;
    const btnStart = document.getElementById("btn-start-import");

    if (files.length > 0) {
        if (btnStart) btnStart.disabled = false;
        const dropZoneH4 = document.querySelector("#import-drop-zone h4");
        if (dropZoneH4) dropZoneH4.textContent = `${files.length} file(s) selected`;
    } else {
        if (btnStart) btnStart.disabled = true;
    }
}

async function handleImport() {
    const fileInput = document.getElementById("file-import-input");
    const files = fileInput.files;
    if (!files || files.length === 0) return;

    const btnStart = document.getElementById("btn-start-import");
    const progressContainer = document.getElementById("import-progress-container");
    const progressBar = document.getElementById("import-progress-bar");
    const statusText = document.getElementById("import-status-text");
    const percentageText = document.getElementById("import-percentage");
    const log = document.getElementById("import-log");
    const mode = document.getElementById("import-mode").value;

    if (btnStart) btnStart.disabled = true;
    if (progressContainer) progressContainer.classList.remove("hidden");

    const updateProgress = (pct, msg) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (statusText) statusText.textContent = msg;
        if (percentageText) percentageText.textContent = `${Math.round(pct)}%`;
    };

    const addLog = (msg) => {
        if (!log) return;
        const p = document.createElement("div");
        p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
    };

    let totalFiles = files.length;
    let processedFiles = 0;
    let totalItemsImported = 0;
    let totalErrors = 0;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        updateProgress((processedFiles / totalFiles) * 100, `Processing ${file.name}...`);
        addLog(`Reading ${file.name}...`);

        try {
            if (file.name.toLowerCase().endsWith(".zip")) {
                // --- ZIP Import Strategy ---
                if (!window.JSZip) throw new Error("JSZip library not loaded.");
                addLog(`Detected ZIP archive. Opening...`);

                const zip = await window.JSZip.loadAsync(file);

                // 0. Check for Snapshot Manifest
                const manifestFile = zip.file("snapshot.json");
                if (manifestFile) {
                    try {
                        const manifestText = await manifestFile.async("string");
                        const manifest = JSON.parse(manifestText);
                        addLog(`Snapshot detected (v${manifest.version || "?"}) created at ${manifest.created || "?"}`);
                    } catch (e) {
                        console.warn("Invalid snapshot manifest", e);
                    }
                }

                // 1. Import Media Metadata (media.json)
                const mediaFile = zip.file("media.json");
                if (mediaFile) {
                    addLog("Found media.json in ZIP. Importing metadata...");
                    try {
                        const mediaText = await mediaFile.async("string");
                        const mediaData = JSON.parse(mediaText);

                        let items = [];
                        if (Array.isArray(mediaData)) items = mediaData;
                        else if (mediaData.items) items = mediaData.items;

                        if (items.length > 0) {
                            const res = await window.socialDB.importData("media", items, mode);
                            addLog(`Media Import: ${res.success} imported, ${res.errors} skipped/failed.`);
                            totalItemsImported += res.success;
                            totalErrors += res.errors;
                        }
                    } catch (e) {
                        addLog(`Error importing media.json: ${e.message}`);
                        totalErrors++;
                    }
                }

                // 2. Look for Thumbnails Metadata
                const metaFile = zip.file("thumbnails_meta.json");
                if (metaFile) {
                    addLog("Found thumbnails_meta.json. Importing thumbnails...");
                    const metaText = await metaFile.async("string");
                    const metaItems = JSON.parse(metaText);

                    let zipSuccess = 0;
                    let zipErrors = 0;

                    // Process sequentially or parallel? Parallel is faster but might key-lock DB if not careful.
                    // importData uses "readwrite" tx.
                    // Better to batch current blobs into a list and call importData once?
                    // But memory usage for Blobs might be high.
                    // Let's batch in chunks of 50.

                    let batch = [];
                    const BATCH_SIZE = 50;

                    for (const meta of metaItems) {
                        // Check for key variations: _zipFileName (legacy/export.js) or _zipPath (new)
                        const zipPath = meta._zipPath || meta._zipFileName;

                        if (zipPath) {
                            const blobFile = zip.file(zipPath);
                            if (blobFile) {
                                const blobData = await blobFile.async("blob");
                                // Reconstruct Blob with correct type
                                const finalBlob = new Blob([blobData], { type: meta._contentType || "image/jpeg" });

                                const newItem = { ...meta };
                                delete newItem._zipFileName;
                                delete newItem._zipPath;
                                delete newItem._contentType;
                                newItem.blob = finalBlob;

                                // Ensure URL is key (if missing, maybe skip or use ID?)
                                if (!newItem.url && newItem.thumbnailUrl) newItem.url = newItem.thumbnailUrl;

                                if (newItem.url) {
                                    batch.push(newItem);
                                } else {
                                    zipErrors++;
                                }
                            } else {
                                zipErrors++;
                            }
                        }

                        if (batch.length >= BATCH_SIZE) {
                            const res = await window.socialDB.importData("thumbnails", batch, mode);
                            zipSuccess += res.success;
                            zipErrors += res.errors; // importData errors (e.g. duplicates)
                            batch = [];
                        }
                    }

                    if (batch.length > 0) {
                        const res = await window.socialDB.importData("thumbnails", batch, mode);
                        zipSuccess += res.success;
                        zipErrors += res.errors;
                    }

                    addLog(`Thumbnails Import: ${zipSuccess} imported, ${zipErrors} skipped/failed.`);
                    totalItemsImported += zipSuccess;
                    totalErrors += zipErrors;
                }

                if (!mediaFile && !metaFile) {
                    addLog("No recognizable data (media.json or thumbnails_meta.json) found in ZIP.");
                }
            } else {
                // --- Standard JSON Import ---
                const text = await file.text();
                let data;
                try {
                    data = JSON.parse(text);
                } catch (jsonErr) {
                    addLog(`Error parsing JSON in ${file.name}: ${jsonErr.message}`);
                    processedFiles++;
                    continue;
                }

                let items = [];
                let storeName = "media";

                if (Array.isArray(data)) {
                    items = data;
                    addLog(`Detected simple array format. Assuming 'media' store.`);
                } else if (data.items && Array.isArray(data.items)) {
                    items = data.items;
                    if (data.store) storeName = data.store;
                    addLog(`Detected Dump format. Target Store: ${storeName}`);
                } else {
                    addLog(`Unknown format in ${file.name}. Skipping.`);
                    processedFiles++;
                    continue;
                }

                addLog(`Importing ${items.length} items into '${storeName}' (Mode: ${mode})...`);

                const result = await window.socialDB.importData(storeName, items, mode);

                addLog(`Completed ${file.name}: Success=${result.success}, Errors=${result.errors}`);
                totalItemsImported += result.success;
                totalErrors += result.errors;
            }
        } catch (err) {
            addLog(`Error processing ${file.name}: ${err.message}`);
        }

        processedFiles++;
    }

    updateProgress(100, "Import Complete");
    addLog(`All files processed. Total Imported: ${totalItemsImported}. Total Errors: ${totalErrors}.`);

    if (btnStart) {
        btnStart.disabled = false;
        btnStart.textContent = "Import More";
    }

    renderStorageStats();

    // Dispatch event to refresh data
    document.dispatchEvent(new CustomEvent("dataUpdated"));
}
