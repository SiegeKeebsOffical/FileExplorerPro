// src/ratingConfigManager.js

import { updateStatusBar } from './uiManager.js';
import { refreshFiles } from './fileOperations.js'; // Assuming refreshFiles is needed here
import { showCustomConfirm } from './utils.js'; // For showCustomConfirm

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the RatingConfigManager with necessary global state.
 * @param {object} state - The global state object containing references needed by rating config functions.
 */
export function initializeRatingConfigManager(state) {
    globalState = state;
}

/**
 * Displays the rating configuration modal.
 */
export function showRatingConfigModal() {
    const modal = document.getElementById('ratingConfigModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    console.log('Rating config modal opened. Current state:', modal.classList.contains('hidden') ? 'hidden' : 'visible');
    loadRatingConfig(); // Ensure latest data is loaded
}

/**
 * Closes the rating configuration modal.
 */
export function closeRatingConfigModal() {
    const modal = document.getElementById('ratingConfigModal');
    if (modal) {
        modal.classList.add('hidden');
        console.log('Rating config modal closed. Current state:', modal.classList.contains('hidden') ? 'hidden' : 'visible');
    }
}

/**
 * Loads rating definitions and category mappings from the backend.
 * Includes retry logic for robustness.
 */
export async function loadRatingConfig() {
    try {
        const response = await fetch('/api/rating_config');
        const data = await response.json();

        // Check if data is valid (e.g., contains expected properties)
        if (data && Array.isArray(data.rating_definitions) && typeof data.category_rating_mappings === 'object') {
            globalState.allRatingDefinitions = data.rating_definitions;
            globalState.categoryRatingMappings = data.category_rating_mappings;

            // NEW: Handle transition from empty category to 'misc'
            if (globalState.categoryRatingMappings[''] && !globalState.categoryRatingMappings['misc']) {
                globalState.categoryRatingMappings['misc'] = globalState.categoryRatingMappings[''];
                delete globalState.categoryRatingMappings['']; // Remove the old empty key
            } else if (globalState.categoryRatingMappings[''] && globalState.categoryRatingMappings['misc']) {
                // If both exist, merge them (preferring 'misc' if there are conflicts, or just appending)
                globalState.categoryRatingMappings['misc'] = Array.from(new Set([
                    ...(globalState.categoryRatingMappings['misc'] || []),
                    ...(globalState.categoryRatingMappings[''] || [])
                ]));
                delete globalState.categoryRatingMappings[''];
            }


            renderRatingDefinitions();
            renderCategoryRatingMappings();
            globalState.ratingConfigRetryCount = 0; // Reset retry count on success
            updateStatusBar('Rating configuration loaded.');
        } else {
            throw new Error('Invalid data structure received for rating config.');
        }
    } catch (error) {
        console.error('Error loading rating configuration:', error);
        updateStatusBar('Error loading rating config: ' + error.message);

        if (globalState.ratingConfigRetryCount < globalState.MAX_RATING_CONFIG_RETRIES) {
            globalState.ratingConfigRetryCount++;
            console.warn(`Retrying loadRatingConfig in ${globalState.RATING_CONFIG_RETRY_DELAY / 1000} seconds. Attempt ${globalState.ratingConfigRetryCount}/${globalState.MAX_RATING_CONFIG_RETRIES}`);
            setTimeout(() => loadRatingConfig(), globalState.RATING_CONFIG_RETRY_DELAY);
        } else {
            console.error('Max retries reached for loading rating configuration. Giving up.');
            updateStatusBar('Failed to load rating config after multiple attempts.');
        }
    }
}

/**
 * Renders the list of defined rating categories in the modal.
 */
export function renderRatingDefinitions() {
    const list = document.getElementById('ratingDefinitionsList');
    if (!list) return;
    list.innerHTML = '';
    globalState.allRatingDefinitions.forEach(def => {
        const li = document.createElement('li');
        li.className = 'rating-list-item';
        li.innerHTML = `
            <span>${def}</span>
            <button class="remove-rating-def-btn" data-def="${def}">Remove</button>
        `;
        list.appendChild(li);
    });

    // Attach event listeners using delegation or by re-selecting elements
    document.querySelectorAll('.remove-rating-def-btn').forEach(button => {
        button.addEventListener('click', function() {
            removeRatingDefinition(this.dataset.def);
        });
    });
}

/**
 * Adds a new rating definition.
 */
export function addRatingDefinition() {
    console.log('addRatingDefinition called.'); // Debugging: Check if function is called
    const input = document.getElementById('newRatingDefinitionInput');
    console.log('newRatingDefinitionInput element:', input); // Debugging: Check if input element is found
    if (!input) {
        console.error('newRatingDefinitionInput element not found in addRatingDefinition.'); // Debugging: Log if not found
        return;
    }
    const newDef = input.value.trim().toLowerCase();
    if (newDef && !globalState.allRatingDefinitions.includes(newDef)) {
        globalState.allRatingDefinitions.push(newDef);
        globalState.allRatingDefinitions.sort(); // Keep sorted alphabetically
        renderRatingDefinitions();
        // Improvement 1: Immediately propagate new rating definition to category mappings
        renderCategoryRatingMappings();
        input.value = ''; // Clear input field
    }
}

/**
 * Removes a rating definition and updates associated mappings.
 * @param {string} defToRemove - The rating definition to remove.
 */
export function removeRatingDefinition(defToRemove) {
    globalState.allRatingDefinitions = globalState.allRatingDefinitions.filter(def => def !== defToRemove);
    renderRatingDefinitions();
    // Also remove this rating category from all category-rating mappings
    for (const fileCat in globalState.categoryRatingMappings) {
        globalState.categoryRatingMappings[fileCat] = globalState.categoryRatingMappings[fileCat].filter(rc => rc !== defToRemove);
    }
    // Improvement 1 (part of propagation): Re-render mappings after removal
    renderCategoryRatingMappings();
    // No need to save immediately, saveRatingConfig will handle it on modal close
}

/**
 * Renders the checkboxes for mapping file categories to rating categories.
 */
export function renderCategoryRatingMappings() {
    const container = document.getElementById('categoryRatingMappingContainer');
    if (!container) return;
    container.innerHTML = '';

    // NEW: Ensure 'misc' is always in the list of file categories to render
    const categoriesToRender = Array.from(new Set([...globalState.allFileCategories, 'misc'])); // Add 'misc' if not present

    categoriesToRender.forEach(fileCat => {
        const item = document.createElement('div');
        item.className = 'category-mapping-item';
        // Display "Misc" with a capital M, and "None" if the category is empty string (legacy)
        // Updated: Always display "Misc" if the category is an empty string.
        const displayFileCat = fileCat === '' ? 'Misc' : (fileCat.charAt(0).toUpperCase() + fileCat.slice(1));
        item.innerHTML = `<h5>${displayFileCat} Category:</h5><div class="checkbox-group"></div>`;
        const checkboxGroup = item.querySelector('.checkbox-group');

        globalState.allRatingDefinitions.forEach(ratingDef => {
            let isChecked = (globalState.categoryRatingMappings[fileCat] || []).includes(ratingDef);

            // Improvement 2: By default, all categories should have the "Overall" Rating selected.
            // This logic applies to 'misc' as well.
            if (ratingDef === 'overall' && !(globalState.categoryRatingMappings[fileCat] || []).includes('overall')) {
                isChecked = true;
                // Also update the global state to reflect this default selection
                if (!globalState.categoryRatingMappings[fileCat]) {
                    globalState.categoryRatingMappings[fileCat] = [];
                }
                globalState.categoryRatingMappings[fileCat].push('overall');
            }

            const checkboxHtml = `
                <label>
                    <input type="checkbox"
                        data-file-category="${fileCat}"
                        data-rating-category="${ratingDef}"
                        ${isChecked ? 'checked' : ''}
                        onchange="window.handleCategoryRatingCheckbox(this)">
                    ${ratingDef.charAt(0).toUpperCase() + ratingDef.slice(1)}
                </label>
            `;
            checkboxGroup.insertAdjacentHTML('beforeend', checkboxHtml);
        });
        container.appendChild(item);
    });
}

/**
 * Handles changes to the category-rating mapping checkboxes.
 * Exposed globally because it's called from dynamically inserted HTML.
 * @param {HTMLInputElement} checkbox - The checkbox element that was changed.
 */
export function handleCategoryRatingCheckbox(checkbox) {
    const fileCat = checkbox.dataset.fileCategory;
    const ratingCat = checkbox.dataset.ratingCategory;

    if (!globalState.categoryRatingMappings[fileCat]) {
        globalState.categoryRatingMappings[fileCat] = [];
    }

    if (checkbox.checked) {
        if (!globalState.categoryRatingMappings[fileCat].includes(ratingCat)) {
            globalState.categoryRatingMappings[fileCat].push(ratingCat);
        }
    } else {
        globalState.categoryRatingMappings[fileCat] = globalState.categoryRatingMappings[fileCat].filter(rc => rc !== ratingCat);
    }
}


/**
 * Saves the current rating configuration (definitions and mappings) to the backend.
 */
export async function saveRatingConfig() {
    try {
        const response = await fetch('/api/rating_config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                rating_definitions: globalState.allRatingDefinitions,
                category_rating_mappings: globalState.categoryRatingMappings
            })
        });

        const result = await response.json();

        if (result.success) {
            closeRatingConfigModal();
            updateStatusBar('Rating configuration saved successfully');
            setTimeout(() => {
                updateStatusBar('Ready');
            }, 2000);
            refreshFiles(); // Reload files to reflect potential changes in sorting or displayed ratings
        } else {
            updateStatusBar('Failed to save rating configuration: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving rating configuration:', error);
        updateStatusBar('Error saving rating configuration');
    }
}

/**
 * Applies smart default categories to uncategorized files based on file type and size.
 * This operation is irreversible.
 */
export async function applySmartDefaultCategories() {
    // Using a custom confirm dialog for better UX, as per instructions.
    showCustomConfirm('Are you sure you want to apply smart default categories to uncategorized files? This action cannot be undone.', async () => {
        updateStatusBar('Applying smart default categories...');
        try {
            // Fetch all files from the current path to check their current categories and properties
            const params = new URLSearchParams({
                path: globalState.currentPath, // Pass the current path
                filter: 'all', // Fetch all files regardless of current filters
                sort: 'name',
                order: 'asc'
            });
            const response = await fetch(`/api/files?${params}`);
            const allFiles = await response.json();

            if (allFiles.error) {
                throw new Error(allFiles.error);
            }

            const filesToUpdate = [];

            for (const file of allFiles.files) {
                console.log(`Processing file: ${file.name}, Category: '${file.category}', is_category_manual: ${file.is_category_manual}, Extension: '${file.extension}', Size: ${file.size}`);

                // Only process files that are not directories, have no category assigned, and are not manually categorized
                // NEW: Treat empty category as 'misc' for smart categorization purposes
                if (!file.is_directory && (!file.category || file.category === '' || file.category === 'misc') && !file.is_category_manual) {
                    let newCategory = 'misc';
                    const fileNameLower = file.name.toLowerCase();
                    const extension = file.extension ? file.extension.toLowerCase() : '';

                    if (extension === '.safetensors') {
                        // Safetensor files under 1GB are 'lora'
                        if (file.size < 1024 * 1024 * 1024) { // 1GB in bytes
                            newCategory = 'lora';
                            console.log(`  -> Matched LORA for ${file.name}`);
                        }
                        // Safetensor files over 3GB are 'checkpoint'
                        else if (file.size >= 3 * 1024 * 1024 * 1024) { // 3GB in bytes
                            newCategory = 'checkpoint';
                            console.log(`  -> Matched CHECKPOINT for ${file.name}`);
                        }
                    } else if (extension === '.mp4' || extension === '.webm') {
                        newCategory = 'video';
                        console.log(`  -> Matched VIDEO for ${file.name}`);
                    } else if (extension === '.webp' || extension === '.png' || extension === '.jpg' || extension === '.jpeg') {
                        // .webp or .png files with 'Grid' in the name are 'Evaluation Grid'
                        if (fileNameLower.includes('grid')) {
                            newCategory = 'evaluation grid';
                            console.log(`  -> Matched EVALUATION GRID for ${file.name}`);
                        }
                        // Other .webp or .png files are 'images'
                        else {
                            newCategory = 'images';
                            console.log(`  -> Matched IMAGES for ${file.name}`);
                        }
                    }

                    if (newCategory) {
                        filesToUpdate.push({
                            filepath: file.path,
                            category: newCategory,
                            is_category_manual: 0 // Mark as auto-assigned
                        });
                        console.log(`  -> Added to update list: ${file.name} -> ${newCategory} (Auto)`);
                    } else {
                        // NEW: Default to 'misc' if no other smart category is assigned
                        newCategory = 'misc';
                        filesToUpdate.push({
                            filepath: file.path,
                            category: newCategory,
                            is_category_manual: 0 // Mark as auto-assigned
                        });
                        console.log(`  -> Added to update list: ${file.name} -> ${newCategory} (Default Misc)`);
                    }
                } else {
                    console.log(`  -> Skipped (is directory, already categorized, or manually set): ${file.name}`);
                }
            }

            console.log('Files identified for update:', filesToUpdate);

            if (filesToUpdate.length > 0) {
                // Send batch update to the backend
                const payload = { updates: filesToUpdate };
                console.log('Sending payload to backend:', payload);

                const updateResponse = await fetch('/api/batch_update_categories', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload)
                });

                const updateResult = await updateResponse.json();
                console.log('Backend update result:', updateResult);

                if (updateResult.success) {
                    updateStatusBar(`Successfully categorized ${updateResult.updated_count} files.`);
                    await refreshFiles(); // AWAIT this call to ensure currentFiles is updated
                    // If the currently selected file was updated, re-select it to refresh details
                    if (globalState.selectedFile && filesToUpdate.some(f => f.filepath === globalState.selectedFile.path)) {
                        const updatedSelectedFile = globalState.currentFiles.find(f => f.path === globalState.selectedFile.path);
                        if (updatedSelectedFile) {
                            globalState.selectFile(updatedSelectedFile, document.querySelector(`.file-item[data-path="${CSS.escape(updatedSelectedFile.path)}"]`));
                        }
                    }
                } else {
                    updateStatusBar('Error applying smart categories: ' + (updateResult.error || 'Unknown error'));
                }
            } else {
                updateStatusBar('No uncategorized files found to apply smart defaults to.');
            }
        } catch (error) {
            console.error('Error in applySmartDefaultCategories:', error);
            updateStatusBar('Error applying smart categories.');
        } finally {
            setTimeout(() => {
                updateStatusBar('Ready');
            }, 3000);
            closeRatingConfigModal();
        }
    });
}
