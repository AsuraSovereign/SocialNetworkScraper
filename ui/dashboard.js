import { initStats, renderStats, setupCacheProgressListener } from "./modules/stats.js";
import { initVideos, renderVideos } from "./modules/videos.js";
import { initExport, updateLivePreview } from "./modules/export.js";
import { initDelete, updateDeletePreview } from "./modules/delete.js";
import { initImport } from "./modules/import.js";

// DOM Elements
const statsTab = document.getElementById("tab-stats");
const videosTab = document.getElementById("tab-videos");
const exportTab = document.getElementById("tab-export");
const deleteTab = document.getElementById("tab-delete");
const importTab = document.getElementById("tab-import");

const linkStats = document.getElementById("link-stats");
const linkVideos = document.getElementById("link-videos");
const linkExport = document.getElementById("link-export");
const linkDelete = document.getElementById("link-delete");
const linkImport = document.getElementById("link-import");

// Init
async function init() {
    await loadTabs();
    initUI();
    setupNavigation();
    setupCacheProgressListener();
    loadData();

    // Listen for data updates (e.g. from Import)
    document.addEventListener("dataUpdated", () => {
        loadData();
    });
}

// Global Load Tabs - Loads HTML content
async function loadTabs() {
    const tabs = [
        { id: "tab-stats", file: "tabs/stats.html" },
        { id: "tab-videos", file: "tabs/videos.html" },
        { id: "tab-export", file: "tabs/export.html" },
        { id: "tab-delete", file: "tabs/delete.html" },
        { id: "tab-import", file: "tabs/import.html" },
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
    // Initialize Modules
    initStats();
    initVideos();
    initExport();
    initDelete();
    initImport();
}

function setupNavigation() {
    if (linkStats) linkStats.addEventListener("click", () => showTab("stats"));
    if (linkVideos) linkVideos.addEventListener("click", () => showTab("videos"));
    if (linkExport) linkExport.addEventListener("click", () => showTab("export"));
    if (linkDelete) linkDelete.addEventListener("click", () => showTab("delete"));
    if (linkImport) linkImport.addEventListener("click", () => showTab("import"));
}

function showTab(tabName) {
    // Hide all
    statsTab.style.display = "none";
    videosTab.style.display = "none";
    exportTab.style.display = "none";
    deleteTab.style.display = "none";
    importTab.style.display = "none";

    // Deactivate links
    linkStats.classList.remove("active");
    linkVideos.classList.remove("active");
    linkExport.classList.remove("active");
    linkImport.classList.remove("active");
    // linkDelete style is usually hardcoded but we can manage class if desired

    // Show active
    if (tabName === "stats") {
        statsTab.style.display = "block";
        linkStats.classList.add("active");
        renderStats();
    } else if (tabName === "videos") {
        videosTab.style.display = "block";
        linkVideos.classList.add("active");
        renderVideos();
    } else if (tabName === "export") {
        exportTab.style.display = "block";
        linkExport.classList.add("active");
        updateLivePreview();
    } else if (tabName === "delete") {
        deleteTab.style.display = "block";
        updateDeletePreview();
    } else if (tabName === "import") {
        importTab.style.display = "block";
        linkImport.classList.add("active");
    }
}

async function loadData() {
    if (!window.socialDB) {
        console.error("Database not loaded");
        return;
    }

    await window.socialDB.init();

    // Initial Stats Render
    renderStats();
}

// Start
init();
