// src/filterManager.js

import { refreshFiles } from './fileOperations.js'; // Assuming refreshFiles is needed here

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the FilterManager with necessary global state.
 * @param {object} state - The global state object containing references needed by filter functions.
 */
export function initializeFilterManager(state) {
    globalState = state;
}

/**
 * Displays the filter modal and initializes its content.
 */
export async function showFilterModal() {
    const modal = document.getElementById('filterModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('filterTagInput').value = ''; // Clear input
    renderActiveFilterTags(); // Render current active filters

    // Fetch and render all suggested tags by default, passing currentPath
    const allSuggestedTags = await fetchSuggestedFilterTags('', globalState.currentPath);
    renderSuggestedFilterTags(allSuggestedTags);
}

/**
 * Closes the filter modal.
 */
export function closeFilterModal() {
    const modal = document.getElementById('filterModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Renders the tags currently applied as filters.
 */
export function renderActiveFilterTags() {
    const container = document.getElementById('activeFilterTagsContainer');
    if (!container) return; // Add check for container existence
    container.innerHTML = '';
    if (globalState.activeFilterTags.size === 0) {
        container.textContent = 'No tags applied.';
        return;
    }
    globalState.activeFilterTags.forEach(tag => {
        const tagPill = document.createElement('span');
        tagPill.className = 'tag-pill';
        tagPill.textContent = tag;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.textContent = 'x';
        removeBtn.onclick = (e) => { // Keep inline onclick for dynamically created elements
            e.stopPropagation();
            removeFilterTag(tag);
        };
        tagPill.appendChild(removeBtn);
        container.appendChild(tagPill);
    });
}

/**
 * Adds a tag to the active filters.
 * @param {string} tag - The tag to add.
 */
export function addFilterTag(tag) {
    tag = tag.toLowerCase();
    if (!globalState.activeFilterTags.has(tag)) {
        globalState.activeFilterTags.add(tag);
        renderActiveFilterTags();
        // No need to refresh files immediately, user will click apply
    }
}

/**
 * Removes a tag from the active filters.
 * @param {string} tagToRemove - The tag to remove.
 */
export function removeFilterTag(tagToRemove) {
    globalState.activeFilterTags.delete(tagToRemove);
    renderActiveFilterTags();
    // No need to refresh files immediately, user will click apply
}

/**
 * Clears all active filter tags.
 */
export function clearFilterTags() {
    globalState.activeFilterTags.clear();
    renderActiveFilterTags();
    // No need to refresh files immediately, user will click apply
}

/**
 * Applies the currently selected filters and refreshes the file display.
 */
export function applyFilter() {
    closeFilterModal();
    refreshFiles(); // This will now include the filter_tags parameter
}

/**
 * Fetches suggested tags from the backend, optionally filtered by a query and path.
 * @param {string} query - The search query for tags.
 * @param {string} path - The current directory path to consider for tags.
 * @returns {Promise<Array<object>>} A promise resolving to an array of tag objects ({tag: string, count: number}).
 */
export async function fetchSuggestedFilterTags(query, path) {
    try {
        // Include path in the API call
        const response = await fetch(`/api/suggested_tags?query=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`);
        const data = await response.json();
        if (data.error) {
            console.error('Error fetching suggested tags:', data.error);
            return [];
        }
        return data;
    } catch (error) {
        console.error('Network error fetching suggested tags:', error);
        return [];
    }
}

/**
 * Renders suggested filter tags in the filter modal.
 * @param {Array<object>} suggestedTags - Array of tag objects to display.
 */
export function renderSuggestedFilterTags(suggestedTags) {
    const container = document.getElementById('filterSuggestedTagsContainer');
    if (!container) return; // Add check for container existence
    container.innerHTML = '';
    if (suggestedTags.length === 0) {
        container.textContent = 'No suggestions.';
        return;
    }

    suggestedTags.forEach(item => {
        const tagPill = document.createElement('span');
        tagPill.className = 'tag-pill';
        tagPill.textContent = item.tag;
        const tagCount = document.createElement('span');
        tagCount.className = 'tag-count';
        tagCount.textContent = ` (${item.count})`;
        tagPill.appendChild(tagCount);
        tagPill.onclick = () => { // Keep inline onclick for dynamically created elements
            addFilterTag(item.tag);
            document.getElementById('filterTagInput').value = ''; // Clear input
            renderSuggestedFilterTags([]); // Clear suggestions after adding
        };
        container.appendChild(tagPill);
    });
}

/**
 * Handles input in the filter tag input field, debouncing API calls for suggestions.
 */
export async function handleFilterTagInput() {
    clearTimeout(globalState.filterTagInputTimeout);
    const query = document.getElementById('filterTagInput').value.trim();
    if (query.length > 1) { // Only fetch suggestions if query is at least 2 characters
        globalState.filterTagInputTimeout = setTimeout(async () => {
            const suggestions = await fetchSuggestedFilterTags(query, globalState.currentPath);
            renderSuggestedFilterTags(suggestions);
        }, 300); // Debounce for 300ms
    } else {
        // If query is empty or too short, show all tags from current folder
        globalState.filterTagInputTimeout = setTimeout(async () => {
            const allSuggestedTags = await fetchSuggestedFilterTags('', globalState.currentPath);
            renderSuggestedFilterTags(allSuggestedTags);
        }, 100); // Shorter debounce for default display
    }
}
