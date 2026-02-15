// State Management for Export Filters
export const newOnlyModeState = {
    users: false,
    urls: false,
    thumbnails: false,
    csv: false,
};

export let currentExportMode = "urls";

export function setCurrentExportMode(mode) {
    currentExportMode = mode;
}

// Store references to dynamically loaded or global elements if needed
// For now, most modules query their own elements.
