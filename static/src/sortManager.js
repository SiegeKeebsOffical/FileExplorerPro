// src/sortManager.js

import { refreshFiles } from './fileOperations.js'; // Assuming refreshFiles is needed here

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the SortManager with necessary global state.
 * @param {object} state - The global state object containing references needed by sort functions.
 */
export function initializeSortManager(state) {
    globalState = state;
}

/**
 * Handles clicks on sort buttons, updating the sort key and order.
 * @param {Event} event - The click event.
 */
export function handleSortButtonClick(event) {
    const newSortKey = event.target.dataset.sortKey;

    if (newSortKey === globalState.currentSortKey) {
        // Toggle sort order if the same button is clicked again
        globalState.currentSortOrder = (globalState.currentSortOrder === 'asc') ? 'desc' : 'asc';
    } else {
        // Set new sort key, default to ascending
        globalState.currentSortKey = newSortKey;
        globalState.currentSortOrder = 'asc';
    }

    localStorage.setItem('sortBy', globalState.currentSortKey);
    localStorage.setItem('sortOrder', globalState.currentSortOrder);

    updateSortButtonsUI(); // Update button visuals
    refreshFiles(); // Reload files with new sort
}

/**
 * Updates the visual state of the sort buttons (active state and arrows).
 */
export function updateSortButtonsUI() {
    document.querySelectorAll('.sort-button').forEach(button => {
        button.classList.remove('sort-active', 'sort-asc', 'sort-desc');
        // Reset text content to original (without arrows)
        const originalText = button.dataset.sortKey.charAt(0).toUpperCase() + button.dataset.sortKey.slice(1);
        button.textContent = originalText;
    });

    const activeButton = document.querySelector(`.sort-button[data-sort-key="${globalState.currentSortKey}"]`);
    if (activeButton) {
        activeButton.classList.add('sort-active', `sort-${globalState.currentSortOrder}`);
        // Text content is automatically updated by CSS ::after pseudo-element for arrows
    }
}
