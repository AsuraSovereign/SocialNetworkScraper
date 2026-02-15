/**
 * Delete Tab Logic
 */

export function initDelete() {
    const deletePlatform = document.getElementById("delete-platform");
    const deleteUser = document.getElementById("delete-user");

    if (deletePlatform) deletePlatform.addEventListener("change", updateDeletePreview);
    if (deleteUser) deleteUser.addEventListener("change", updateDeletePreview);

    document.getElementById("btn-delete-confirm").addEventListener("click", async () => {
        // 1. Get Count first
        const pFilter = deletePlatform.value;
        const uFilter = deleteUser.value;
        const criteria = { platform: pFilter, userId: uFilter };

        const count = await window.socialDB.countMedia(criteria);

        if (count === 0) {
            alert("No data to delete.");
            return;
        }

        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API needed for large backups. Please update Chrome.");
            return;
        }

        const btn = document.getElementById("btn-delete-confirm");
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Waiting for folder selection...";

        try {
            const dirHandle = await window.showDirectoryPicker();
            btn.textContent = "Initializing Backup...";

            // Reuse backup function
            const { processed, mediaIds, thumbnailUrls } = await backupToFolder(dirHandle, criteria, (p) => {
                btn.textContent = `Backing up... ${p}/${count}`;
            });

            // Backup Complete
            btn.textContent = "Backup Complete. Deleting...";

            // Delete Phase
            const confirmed = confirm(`Backup saved to selected folder.\n(${processed} items backed up)\n\nAre you sure you want to PERMANENTLY delete these items from the extension?`);

            if (confirmed) {
                // Delete in batches to avoid locking DB for too long
                const DELETE_BATCH = 500;
                for (let i = 0; i < mediaIds.length; i += DELETE_BATCH) {
                    const batchIds = mediaIds.slice(i, i + DELETE_BATCH);
                    await window.socialDB.deleteBatch("media", batchIds);
                    btn.textContent = `Deleting Media... ${Math.min(i + DELETE_BATCH, mediaIds.length)}/${mediaIds.length}`;
                }

                // Delete Thumbnails
                if (thumbnailUrls.length > 0) {
                    const uniqueThumbUrls = [...new Set(thumbnailUrls)];
                    for (let i = 0; i < uniqueThumbUrls.length; i += DELETE_BATCH) {
                        const batchUrls = uniqueThumbUrls.slice(i, i + DELETE_BATCH);
                        await window.socialDB.deleteBatch("thumbnails", batchUrls);
                        btn.textContent = `Deleting Thumbs... ${Math.min(i + DELETE_BATCH, uniqueThumbUrls.length)}/${uniqueThumbUrls.length}`;
                    }
                }

                alert("Deletion and Cleanup successful.");

                // Ideally trigger a reload of data, but that's handled at top level usually.
                // We'll trust the user to refresh or we can dispatch an event.
                // For now, re-render preview.
                updateDeletePreview();
                // Also might want to tell stats to update if they are visible
            }
        } catch (err) {
            if (err.name !== "AbortError") {
                console.error("Backup/Delete process failed:", err);
                alert("Process failed: " + err.message);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });

    updateDeletePreview(); // Initial load
}

export async function updateDeletePreview() {
    const deletePlatform = document.getElementById("delete-platform");
    const deleteUser = document.getElementById("delete-user");
    const deleteCountParams = document.getElementById("delete-count");

    const pFilter = deletePlatform ? deletePlatform.value : "ALL";
    const uFilter = deleteUser ? deleteUser.value : "ALL";
    const criteria = { platform: pFilter, userId: uFilter };

    const count = await window.socialDB.countMedia(criteria);

    const sampleResult = await window.socialDB.queryMedia(criteria, 0, 10);
    const data = sampleResult.items;

    const columns = ["originalUrl", "scrapedAt", "userId", "platform"];
    const table = document.getElementById("delete-preview-table");
    const tbody = table.querySelector("tbody");

    if (deleteCountParams) deleteCountParams.textContent = count;

    tbody.innerHTML = "";
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" style="text-align:center; color:#888;">No data matches filter</td></tr>`;
        return;
    }

    data.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = columns
            .map((col) => {
                let val = item[col] || "";
                if (col === "scrapedAt") val = new Date(val).toLocaleString();
                return `<td title="${val}">${val}</td>`;
            })
            .join("");
        tbody.appendChild(tr);
    });

    if (count > 10) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="${columns.length}" style="text-align:center; color:#888;">...and ${count - 10} more items</td>`;
        tbody.appendChild(tr);
    }
}

async function backupToFolder(dirHandle, criteria, updateProgress) {
    const imagesHandle = await dirHandle.getDirectoryHandle("images", { create: true });
    const fileHandle = await dirHandle.getFileHandle("data_backup.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write("[\n");

    const BATCH_SIZE = 50;
    let offset = 0;
    let processed = 0;
    let hasMore = true;
    let firstItem = true;
    const mediaIds = [];
    const thumbnailUrls = [];

    let batchCount = 0;
    const MAX_BATCHES = 10000;

    while (hasMore && batchCount < MAX_BATCHES) {
        batchCount++;
        const result = await window.socialDB.queryMedia(criteria, offset, BATCH_SIZE);
        const batch = result.items;
        hasMore = result.hasMore;
        offset += BATCH_SIZE;

        if (batch.length === 0) break;

        for (const media of batch) {
            if (!firstItem) await writable.write(",\n");
            await writable.write(JSON.stringify(media, null, 2));
            firstItem = false;

            if (media.thumbnailUrl && !media.thumbnailUrl.startsWith("data:")) {
                try {
                    const cached = await window.socialDB.getThumbnail(media.thumbnailUrl);
                    let blob = null;
                    if (cached && cached.blob) {
                        blob = cached.blob;
                    } else {
                        const resp = await fetch(media.thumbnailUrl);
                        if (resp.ok) blob = await resp.blob();
                    }

                    if (blob) {
                        let ext = "jpg";
                        if (blob.type) ext = blob.type.split("/")[1] || "jpg";

                        const safeUserId = (media.userId || "unknown").replace(/[^a-z0-9]/gi, "_");
                        const safeId = (media.id || "unknown").replace(/[^a-z0-9]/gi, "_");
                        const filename = `${media.platform}_${safeUserId}_${safeId}.${ext}`;

                        const imgFileHandle = await imagesHandle.getFileHandle(filename, { create: true });
                        const imgWritable = await imgFileHandle.createWritable();
                        await imgWritable.write(blob);
                        await imgWritable.close();
                    }
                } catch (e) {
                    console.warn("Failed to backup image:", media.thumbnailUrl, e);
                }
                thumbnailUrls.push(media.thumbnailUrl);
            }

            mediaIds.push(media.id);
            processed++;

            if (processed % 5 === 0 && updateProgress) {
                updateProgress(processed);
            }
        }
    }

    await writable.write("\n]");
    await writable.close();

    return { processed, mediaIds, thumbnailUrls };
}
