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
