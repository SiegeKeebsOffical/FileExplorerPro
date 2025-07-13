// src/fileDetailsManager.js

// Removed imports for sdMetadataIntegration.js as it's being replaced
import { generateMetadataDisplayHtml, fetchAndDisplayAssociatedMetadata } from './metadataLoader.js'; // Import new function
import { basename, showCustomConfirm } from './utils.js'; // For basename and showCustomConfirm
import { openFocusWindow, closeFocusWindow } from './focusWindowManager.js'; // Import from focusWindowManager

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the FileDetailsManager with necessary global state and DOM elements.
 * @param {object} state - The global state object containing references needed by file details functions.
 * @param {object} domElements - Object with references to key DOM elements.
 */
export function initializeFileDetailsManager(state, domElements) {
    globalState = state;
    // Assign DOM elements to local variables if they are used directly here
    globalState.fileDetails = domElements.fileDetails;
    globalState.detailsContent = domElements.detailsContent;
    globalState.customGalleryKeywordInput = domElements.customGalleryKeywordInput;
    globalState.hideFileButton = domElements.hideFileButton;
}

/**
 * Selects a file in the grid, highlights it, shows its details, and opens the focus window if it's not a directory.
 * @param {object} file - The file object that was selected.
 * @param {HTMLElement} element - The DOM element corresponding to the selected file.
 */
export async function selectFile(file, element) {
    // Remove selection from all items
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Select current item
    if (element) {
        element.classList.add('selected');
    }
    globalState.selectedFile = file; // Set the global selected file

    // Initialize currentFileTagsArray from selectedFile.tags
    globalState.currentFileTagsArray = globalState.selectedFile.tags ? globalState.selectedFile.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '') : [];

    // Update currentFileIndex for navigation
    globalState.currentFileIndex = globalState.currentFiles.findIndex(f => f.path === file.path);

    console.log(`DEBUG: selectFile called for ${file.name} (Type: ${file.is_directory ? 'Directory' : 'File'}). Initial category: ${file.category}, is_category_manual: ${file.is_category_manual}`);

    // Apply smart categorization if needed (this can trigger showFileDetails again)
    // Only attempt to apply smart category if the file is NOT missing and not already categorized manually
    if (!file.is_directory && (!file.category || file.category === '') && !file.is_category_manual) {
        console.log(`DEBUG: Attempting to apply smart category for ${file.name}`);
        await applySmartCategoryToSelectedFile(file);
    } else {
        console.log(`DEBUG: Skipping smart category for ${file.name}. Category: ${file.category}, Manual: ${file.is_category_manual}`);
    }

    // Always show file details initially (with or without workflow metadata yet)
    // Use globalState.selectedFile as it might have been updated by smart category
    console.log(`DEBUG: Calling showFileDetails for ${globalState.selectedFile.name}`);
    await showFileDetails(globalState.selectedFile);

    // Only attempt to open the focus window if it's NOT a directory
    if (!globalState.selectedFile.is_directory) {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm'];
        // Check if it's an image, doesn't have workflow metadata yet, AND is NOT missing
        if (imageExtensions.includes(globalState.selectedFile.extension) && !globalState.selectedFile.workflow_metadata && !globalState.selectedFile.is_missing) {
            globalState.updateStatusBar('Extracting workflow metadata...');
            try {
                const response = await fetch(`/api/image_workflow_metadata?filepath=${encodeURIComponent(globalState.selectedFile.path)}`);
                const result = await response.json();

                if (result.success && result.workflow_metadata) {
                    globalState.selectedFile.workflow_metadata = result.workflow_metadata;
                    globalState.updateStatusBar('Workflow metadata extracted and displayed.');
                    // Re-render details to show the new workflow metadata
                    await showFileDetails(globalState.selectedFile);
                } else {
                    globalState.updateStatusBar(`Failed to extract workflow metadata: ${result.error || 'No workflow found.'}`);
                    console.warn(`Failed to extract workflow metadata for ${globalState.selectedFile.name}: ${result.error || 'No workflow found.'}`);
                }
            } catch (error) {
                console.error('Network error during workflow metadata extraction:', error);
                globalState.updateStatusBar('Network error during workflow metadata extraction.');
            } finally {
                setTimeout(() => globalState.updateStatusBar('Ready'), 2000);
            }
        }
        console.log(`DEBUG: Opening focus window for ${globalState.selectedFile.name}`);
        openFocusWindow(globalState.selectedFile); // Open or update the content of the focus window
    } else {
        console.log(`DEBUG: Closing focus window as ${globalState.selectedFile.name} is a directory.`);
        closeFocusWindow(); // Close focus window if a directory is selected
    }
}

/**
 * Generates HTML for displaying extracted ComfyUI workflow metadata.
 * @param {object} file - The file object, expected to have a 'workflow_metadata' property.
 * @returns {string} HTML string for displaying workflow metadata.
 */
function generateWorkflowMetadataDisplayHtml(file) {
    const workflowMetadata = file.workflow_metadata;
    if (!workflowMetadata) {
        return ''; // No workflow metadata to display
    }

    let html = `
        <div class="metadata-section">
            <h3>ComfyUI Workflow Metadata</h3>
            <button id="copyAllWorkflowBtn" class="copy-button" title="Copy All Workflow Metadata">Copy All</button>
    `;

    // Function to create a copy button for a specific text
    const createCopyButton = (id) => `
        <button class="copy-button-inline" data-copy-target="${id}" title="Copy to clipboard">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
            </svg>
        </button>
    `;

    // Helper to render items from a category
    const renderCategory = (categoryName, dataKey) => {
        if (workflowMetadata[dataKey] && workflowMetadata[dataKey].length > 0) {
            html += `<div class="metadata-category">`; // New wrapper for category
            html += `<h4>${categoryName}:</h4>`;
            html += `<dl class="metadata-list">`; // Using description list
            workflowMetadata[dataKey].forEach((item, index) => {
                const itemId = `${dataKey}-${index}`;
                html += `<div class="metadata-item">`; // Wrapper for each item (dt + dd)
                if (item.title) {
                    html += `<dt class="metadata-title">${item.title}</dt>`;
                }
                if (item.value) {
                    html += `<dd class="metadata-value">`;
                    if (typeof item.value === 'string') {
                        html += `<div class="metadata-field-content" id="${itemId}">${item.value}</div>`;
                    } else {
                        // For complex objects, consider pre-formatting or providing a "view JSON" button
                        html += `<pre class="metadata-field-content metadata-json" id="${itemId}">${JSON.stringify(item.value, null, 2)}</pre>`;
                    }
                    html += `${createCopyButton(itemId)}`;
                    html += `</dd>`;
                }
                html += `</div>`; // Close metadata-item
            });
            html += `</dl>`; // Close metadata-list
            html += `</div>`; // Close metadata-category
        }
    };

    // Render prominent categories
    renderCategory('Positive Prompts', 'Positive Prompts');
    renderCategory('Negative Prompts', 'Negative Prompts');
    renderCategory('Base Models', 'Base Models');
    renderCategory('LoRA Models', 'LoRA Models');

    // Group other categories for a different visual treatment if desired
    html += `<div class="metadata-category-group">`; // New group for less prominent categories
    const otherCategories = ['VAE', 'CLIP', 'SAMPLER', 'STEPS', 'LATENT', 'CFG', 'SCHEDULER', 'DENOISE'];
    otherCategories.forEach(cat => {
        renderCategory(cat, cat); // Re-use renderCategory
    });
    html += `</div>`; // Close metadata-category-group


    html += `</div>`; // Close metadata-section

    return html;
}

// Function to add copy buttons dynamically (for workflow metadata)
function addWorkflowMetadataCopyButtons(container) {
    container.querySelectorAll('.copy-button-inline').forEach(button => {
        button.onclick = (e) => {
            e.stopPropagation();
            const targetId = button.dataset.copyTarget;
            const contentElement = document.getElementById(targetId);
            if (contentElement) {
                const textToCopy = contentElement.textContent || contentElement.innerText;
                copyTextToClipboard(textToCopy);
            }
        };
    });

    const copyAllButton = container.querySelector('#copyAllWorkflowBtn');
    if (copyAllButton) {
        copyAllButton.onclick = (e) => {
            e.stopPropagation();
            const allContentElements = container.querySelectorAll('.metadata-field-content');
            let allText = [];
            allContentElements.forEach(el => allText.push(el.textContent || el.innerText));
            copyTextToClipboard(allText.join('\n\n')); // Join with double newline for readability
        };
    }
}

// Helper for copying text to clipboard
function copyTextToClipboard(text) {
    if (window.isSecureContext) { // navigator.clipboard is only available in secure contexts (HTTPS)
        navigator.clipboard.writeText(text).then(function() {
            globalState.updateStatusBar('Copied to clipboard!');
        }, function(err) {
            console.error('Could not copy text: ', err);
            // Fallback for non-secure contexts or failures
            fallbackCopyTextToClipboard(text);
        });
    } else {
        fallbackCopyTextToClipboard(text);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0"; // Make it invisible
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        const msg = successful ? 'Copied to clipboard!' : 'Failed to copy!';
        globalState.updateStatusBar(msg);
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
        globalState.updateStatusBar('Failed to copy to clipboard.');
    }
    document.body.removeChild(textArea);
}

/**
 * Displays the details of the selected file in the side panel.
 * @param {object} file - The file object whose details are to be displayed.
 */
export async function showFileDetails(file) {
    console.log(`DEBUG: showFileDetails called for ${file.name}.`);

    // Helper function to format file size
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Helper function to format date strings
    const formatDate = (isoString) => {
        if (isoString === "0001-01-01T00:00:00") { // Placeholder for actual min date string from Python
            return 'N/A';
        }
        try {
            return new Date(isoString).toLocaleString();
        } catch (e) {
            console.error("Error parsing date string:", isoString, e);
            return 'Invalid Date';
        }
    };

    // Generate HTML for generic associated metadata
    const { associatedMetadataHtml, metadataErrorHtml } = generateMetadataDisplayHtml(file);
    // Generate HTML for ComfyUI workflow metadata
    const workflowMetadataHtml = generateWorkflowMetadataDisplayHtml(file);


    // Determine which rating categories apply to the current file's category
    const fileCategory = file.category || '';
    const applicableRatingCategories = globalState.categoryRatingMappings[fileCategory] || [];

    let ratingsHtml = '';
    if (applicableRatingCategories.length > 0) {
        ratingsHtml = `<div class="metadata-section"><h3>Ratings</h3>`;
        applicableRatingCategories.forEach(ratingCategory => {
            const currentRating = file.ratings ? (file.ratings[ratingCategory] || 0) : 0; // Check file.ratings exists
            ratingsHtml += createStarRatingHtml(ratingCategory, currentRating);
        });
        ratingsHtml += `</div>`;
    }

    // Custom Gallery Keyword field, only for Lora/Checkpoint categories
    let customGalleryKeywordHtml = '';
    if (file.category === 'lora' || file.category === 'checkpoint') {
        customGalleryKeywordHtml = `
            <div class="metadata-section" id="customGalleryKeywordSection">
                <h3>Custom Gallery Keyword</h3>
                <div class="metadata-field">
                    <label for="customGalleryKeyword">Override default image search:</label>
                    <input type="text" id="customGalleryKeyword" placeholder="e.g., 'my_model_images'" value="${file.custom_gallery_keyword || ''}">
                </div>
            </div>
        `;
    }

    try {
        // Populate the details content
        globalState.detailsContent.innerHTML = `
            ${metadataErrorHtml}
            <div class="metadata-section">
                <h3>File Information</h3>
                <p><strong>Name:</strong> ${file.name} ${file.is_missing ? '(Missing Primary File)' : ''}</p>
                <p><strong>Size:</strong> ${file.is_directory ? 'Folder' : formatSize(file.size)}</p>
                <p><strong>Type:</strong> ${file.mime_type || 'Unknown'}</p>
                <p><strong>Modified:</strong> ${formatDate(file.modified)}</p>
                <p><strong>Created:</strong> ${formatDate(file.created)}</p>
                ${file.preview_image_path ? `<p><strong>Preview Image:</strong> ${basename(file.preview_image_path)}</p>` : ''}
            </div>

            <div class="metadata-section">
                <h3>Suggested Tags</h3>
                <div id="suggestedTagsContainer" class="suggested-tags-box"></div>
            </div>

            <div class="metadata-section">
                <h3>Tags</h3>
                <div id="currentTagsContainer" class="tag-container"></div>
                <div class="metadata-field">
                    <input type="text" id="tagInput" placeholder="Add tags (comma or enter to add)...">
                </div>
            </div>

            ${ratingsHtml}

            <div class="metadata-section">
                <h3>Category</h3>
                <div class="metadata-field">
                    <select id="fileCategory">
                        <option value="">None</option>
                        ${globalState.allFileCategories.map(cat => `<option value="${cat}" ${file.category === cat ? 'selected' : ''}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('')}
                    </select>
                    ${file.is_category_manual ? '<span style="font-size: 0.8em; color: #0078d4; margin-left: 5px;">(Manually Set)</span>' : '<span style="font-size: 0.8em; color: #666; margin-left: 5px;">(Auto-Assigned)</span>'}
                </div>
            </div>

            <div class="metadata-section">
                <h3>Notes</h3>
                <div class="metadata-field">
                    <textarea id="fileNotes" rows="3" placeholder="Add notes...">${file.notes || ''}</textarea>
                </div>
            </div>

            ${customGalleryKeywordHtml}

            ${workflowMetadataHtml}
            ${associatedMetadataHtml}


            <button id="saveMetadataBtnDynamic" style="width: 100%; padding: 8px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Changes</button>
        `;

        // Assign customGalleryKeywordInput after it's rendered
        globalState.customGalleryKeywordInput = document.getElementById('customGalleryKeyword');

        // Add workflow metadata copy buttons
        addWorkflowMetadataCopyButtons(globalState.detailsContent);

        // NEW: Fetch and display associated metadata if a path exists
        if (file.associated_metadata_path) {
            const associatedMetadataContainer = document.getElementById('associatedMetadataContent');
            if (associatedMetadataContainer) {
                fetchAndDisplayAssociatedMetadata(file.associated_metadata_path, associatedMetadataContainer, globalState.updateStatusBar);
            }
        }


        // Attach listener for the dynamically created Save Changes button
        const saveMetadataButton = document.getElementById('saveMetadataBtnDynamic');
        if (saveMetadataButton) {
            saveMetadataButton.addEventListener('click', saveMetadata);
        }

        // Attach listener for notes textarea to save notes automatically on input
        const fileNotesTextarea = document.getElementById('fileNotes');
        if (fileNotesTextarea) {
            fileNotesTextarea.addEventListener('input', saveNotes);
        }

        // Update the "Hide File" button text based on the file's hidden status
        if (globalState.hideFileButton) { // Ensure button exists
            if (file.is_hidden) {
                globalState.hideFileButton.textContent = 'Unhide File';
                globalState.hideFileButton.style.backgroundColor = '#28a745'; // Green for unhide
            } else {
                globalState.hideFileButton.textContent = 'Hide File';
                globalState.hideFileButton.style.backgroundColor = '#dc3545'; // Red for hide
            }
            // Hide the button for directories
            if (file.is_directory) {
                globalState.hideFileButton.classList.add('hidden');
            } else {
                globalState.hideFileButton.classList.remove('hidden');
            }
        }

        // Setup rating interaction for all dynamically created rating sections
        applicableRatingCategories.forEach(ratingCategory => {
            document.querySelectorAll(`#rating-${ratingCategory} .star`).forEach(star => {
                star.addEventListener('click', function() {
                    const rating = parseInt(this.dataset.rating);
                    // Get the current rating for this category from the selectedFile object
                    const currentRatingForCategory = globalState.selectedFile.ratings ? (globalState.selectedFile.ratings[ratingCategory] || 0) : 0;

                    if (rating === currentRatingForCategory) {
                        // If clicking the current rating, reset to 0
                        updateFileRating(ratingCategory, 0);
                    } else {
                        // Otherwise, set to the new rating
                        updateFileRating(ratingCategory, rating);
                    }
                });
            });
        });

        // Add event listener for category change to re-render ratings and custom keyword field
        const fileCategoryDropdown = document.getElementById('fileCategory');
        if (fileCategoryDropdown) {
            fileCategoryDropdown.addEventListener('change', function() {
                // Update selectedFile.category immediately for accurate re-rendering
                globalState.selectedFile.category = this.value;
                // Set is_category_manual to 1 (manually set) when user changes category
                globalState.selectedFile.is_category_manual = 1;
                console.log(`DEBUG: Category changed to ${this.value}, is_category_manual set to 1. Triggering saveMetadata.`);
                saveMetadata(); // <--- CRITICAL CHANGE: Call saveMetadata here
                showFileDetails(globalState.selectedFile); // Re-render details to show correct rating fields, manual flag, and custom keyword field
            });
        }

        // Setup tag input
        const tagInput = document.getElementById('tagInput');
        if (tagInput) {
            tagInput.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault(); // Prevent default Enter/comma behavior (e.g., form submission)
                    const newTag = tagInput.value.trim();
                    if (newTag) {
                        addTag(newTag);
                        tagInput.value = ''; // Clear input
                    }
                }
            });
        }

        // Initial rendering of tags
        renderCurrentTags();
        renderSuggestedTags();

        console.log(`DEBUG: Adding 'open' class to fileDetails for ${file.name}.`);
        globalState.fileDetails.classList.add('open'); // Open the file details panel

    } catch (error) {
        console.error(`ERROR: Failed to render file details for ${file.name}:`, error);
        globalState.updateStatusBar(`Error displaying details for ${file.name}.`);
        // Optionally, close the panel or show a generic error message in the panel
        globalState.fileDetails.classList.remove('open');
        globalState.detailsContent.innerHTML = `<div class="metadata-error">Failed to load details for this file. Please check console for errors.</div>`;
    }
}

/**
 * Helper function to create HTML for a single star rating group.
 * @param {string} ratingCategory - The name of the rating category.
 * @param {number} currentRating - The current rating value (0-5).
 * @returns {string} HTML string for the star rating.
 */
function createStarRatingHtml(ratingCategory, currentRating) {
    return `
        <div class="rating-group">
            <label>${ratingCategory.charAt(0).toUpperCase() + ratingCategory.slice(1)} Rating:</label>
            <div class="rating" id="rating-${ratingCategory}">
                ${[1,2,3,4,5].map(i => `<span class="star ${i <= currentRating ? 'active' : ''}" data-rating="${i}" data-category="${ratingCategory}">★</span>`).join('')}
            </div>
        </div>
    `;
}

/**
 * Updates a specific rating category for the selected file and saves metadata.
 * @param {string} ratingCategory - The category of the rating to update.
 * @param {number} newRating - The new rating value (0-5).
 */
function updateFileRating(ratingCategory, newRating) {
    if (!globalState.selectedFile.ratings) { // Ensure ratings object exists
        globalState.selectedFile.ratings = {};
    }
    globalState.selectedFile.ratings[ratingCategory] = newRating;
    // Visually update the stars for the specific category
    document.querySelectorAll(`#rating-${ratingCategory} .star`).forEach((s, i) => {
        s.classList.toggle('active', i < newRating);
    });
    saveMetadata(); // Save changes immediately
}

/**
 * Renders the current tags of the selected file in the details panel.
 */
function renderCurrentTags() {
    const container = document.getElementById('currentTagsContainer');
    if (!container) return;
    container.innerHTML = ''; // Clear existing tags

    globalState.currentFileTagsArray.forEach(tag => {
        const tagPill = document.createElement('span');
        tagPill.className = 'tag-pill';
        tagPill.textContent = tag;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-tag';
        removeBtn.textContent = 'x';
        removeBtn.onclick = (e) => { // Keep inline onclick for dynamically created tags
            e.stopPropagation(); // Prevent parent click
            removeTag(tag);
        };

        tagPill.appendChild(removeBtn);
        container.appendChild(tagPill);
    });
}

/**
 * Adds a new tag to the selected file's tags.
 * @param {string} tag - The tag to add.
 */
function addTag(tag) {
    tag = tag.toLowerCase(); // Standardize tags to lowercase
    if (!globalState.currentFileTagsArray.includes(tag)) {
        globalState.currentFileTagsArray.push(tag);
        renderCurrentTags();
        saveMetadata(); // Save changes immediately
    }
}

/**
 * Removes a tag from the selected file's tags.
 * @param {string} tagToRemove - The tag to remove.
 */
function removeTag(tagToRemove) {
    globalState.currentFileTagsArray = globalState.currentFileTagsArray.filter(tag => tag !== tagToRemove);
    renderCurrentTags();
    saveMetadata(); // Save changes immediately
}

/**
 * Generates a list of suggested tags based on other files in the same category.
 * @returns {Array<string>} An array of suggested tags.
 */
function getSuggestedTags() {
    const tagCounts = {};
    const currentCategory = globalState.selectedFile.category;

    globalState.currentFiles.forEach(file => {
        // Only consider files in the same category (if a category is selected)
        // and that are not the currently selected file itself.
        if (file.path !== globalState.selectedFile.path &&
            (currentCategory === '' || file.category === currentCategory) &&
            file.tags) {
            file.tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag !== '').forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    // Convert to array, sort by count (descending), then filter out tags already on the current file
    const sortedTags = Object.entries(tagCounts)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([tag]) => tag)
        .filter(tag => !globalState.currentFileTagsArray.includes(tag)); // Filter out existing tags

    return sortedTags;
}

/**
 * Renders suggested tags in the details panel.
 */
function renderSuggestedTags() {
    const container = document.getElementById('suggestedTagsContainer');
    if (!container) return;
    container.innerHTML = ''; // Clear existing suggested tags

    const suggestedTags = getSuggestedTags();

    if (suggestedTags.length === 0) {
        container.textContent = 'No suggestions.';
        return;
    }

    suggestedTags.forEach(tag => {
        const tagPill = document.createElement('span');
        tagPill.className = 'tag-pill';
        tagPill.textContent = tag;
        tagPill.title = `Click to add '${tag}'`; // Add tooltip

        tagPill.onclick = () => { // Keep inline onclick for dynamically created tags
            addTag(tag); // Add tag when clicked
        };

        container.appendChild(tagPill);
    });
}

/**
 * Saves the metadata (tags, ratings, category, custom keyword, hidden status)
 * of the currently selected file to the backend.
 * Notes are now saved by the saveNotes function separately.
 */
export async function saveMetadata() {
    if (!globalState.selectedFile) return;

    // Join the array back into a comma-separated string for saving
    const tags = globalState.currentFileTagsArray.join(', ');
    const category = document.getElementById('fileCategory').value;

    // Determine is_category_manual: 1 if a category is selected, 0 otherwise
    const isCategoryManual = category !== '' ? 1 : 0;

    // Get custom gallery keyword if the field exists
    const customGalleryKeyword = globalState.customGalleryKeywordInput ? globalState.customGalleryKeywordInput.value.trim() : '';

    // Get hidden status from selectedFile (it's updated by toggleHideFile)
    const isHidden = globalState.selectedFile.is_hidden ? 1 : 0;

    // Collect all ratings from the dynamically generated sections
    const updatedRatings = {};
    const applicableRatingCategories = globalState.categoryRatingMappings[category] || [];
    applicableRatingCategories.forEach(ratingCategory => {
        const ratingElement = document.getElementById(`rating-${ratingCategory}`);
        if (ratingElement) {
            const rating = ratingElement.querySelectorAll('.star.active').length;
            updatedRatings[ratingCategory] = rating;
        }
    });

    const payload = {
        filepath: globalState.selectedFile.path,
        tags: tags,
        ratings: updatedRatings, // Send the dictionary of ratings
        category: category,
        is_category_manual: isCategoryManual, // Send the manual flag
        custom_gallery_keyword: customGalleryKeyword, // Send custom gallery keyword
        is_hidden: isHidden // Send hidden status
    };

    console.log(`DEBUG: saveMetadata sending payload for ${globalState.selectedFile.name}:`, payload);

    try {
        const response = await fetch('/api/metadata', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            // Update the selectedFile object with the saved values
            globalState.selectedFile.tags = tags;
            globalState.selectedFile.ratings = updatedRatings; // Update local object
            globalState.selectedFile.category = category;
            // globalState.selectedFile.notes is updated by saveNotes()
            globalState.selectedFile.is_category_manual = isCategoryManual; // Update local object
            globalState.selectedFile.custom_gallery_keyword = customGalleryKeyword; // Update local object
            globalState.selectedFile.is_hidden = isHidden; // Update local object

            globalState.updateStatusBar('Metadata saved successfully');
            setTimeout(() => {
                globalState.updateStatusBar('Ready');
            }, 2000);
            // Re-render suggested tags as the current file's tags might have changed
            renderSuggestedTags();
            // Re-render file details to update the (Manually Set)/(Auto-Assigned) label and hide button
            showFileDetails(globalState.selectedFile);
        } else {
            globalState.updateStatusBar('Error saving metadata: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving metadata:', error);
        globalState.updateStatusBar('Error saving metadata');
    }
}

/**
 * Saves only the notes of the currently selected file to the backend.
 * This is called automatically when the notes textarea input changes.
 */
async function saveNotes() {
    if (!globalState.selectedFile) return;

    const notesTextarea = document.getElementById('fileNotes');
    const notes = notesTextarea ? notesTextarea.value : '';

    try {
        const response = await fetch('/api/metadata', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filepath: globalState.selectedFile.path,
                notes: notes,
                // Only send notes, other metadata is handled by saveMetadata
            })
        });
        const result = await response.json();

        if (result.success) {
            globalState.selectedFile.notes = notes; // Update local object
            globalState.updateStatusBar('Notes saved automatically.');
            setTimeout(() => {
                globalState.updateStatusBar('Ready');
            }, 1500); // Shorter delay for automatic save
        } else {
            globalState.updateStatusBar('Error saving notes: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving notes:', error);
        globalState.updateStatusBar('Error saving notes.');
    }
}


/**
 * Closes the file details panel.
 */
export function closeDetails() {
    if (globalState.fileDetails) {
        globalState.fileDetails.classList.remove('open');
    }
}

/**
 * Toggles the hidden status of the currently selected file and saves metadata.
 */
export function toggleHideFile() {
    if (!globalState.selectedFile) return;

    // Toggle the is_hidden status
    globalState.selectedFile.is_hidden = !globalState.selectedFile.is_hidden;
    saveMetadata(); // Save the updated status

    // Update the button text immediately
    if (globalState.hideFileButton) { // Ensure button exists
        if (globalState.selectedFile.is_hidden) {
            globalState.hideFileButton.textContent = 'Unhide File';
            globalState.hideFileButton.style.backgroundColor = '#28a745'; // Green for unhide
        } else {
            globalState.hideFileButton.textContent = 'Hide File';
            globalState.hideFileButton.style.backgroundColor = '#dc3545'; // Red for hide
        }
        // Hide the button for directories
        if (globalState.selectedFile.is_directory) { // Corrected from 'file.is_directory' to 'globalState.selectedFile.is_directory'
            globalState.hideFileButton.classList.add('hidden');
        } else {
            globalState.hideFileButton.classList.remove('hidden');
        }
    }

    // If the file is now hidden and 'show hidden files' is not checked, close details and refresh
    if (globalState.selectedFile.is_hidden && !globalState.showHiddenFiles) {
        closeDetails();
        globalState.refreshFiles(); // Call refreshFiles from global state
    }
}

/**
 * Applies a smart default category to a single file if it's not already categorized
 * and its category hasn't been manually set. This is called when a file's details/focus window is opened.
 * @param {object} file - The file object to categorize.
 */
export async function applySmartCategoryToSelectedFile(file) {
    // Do not attempt to smart categorize missing files.
    if (file.is_missing) {
        console.log(`DEBUG: Skipping smart category for missing file: ${file.name}`);
        showFileDetails(file); // Still show details for missing file
        return;
    }

    // IMPORTANT: Only auto-assign if the category is currently empty AND NOT manually set
    if (file.category && file.category !== '' && file.is_category_manual) {
        console.log(`DEBUG: Skipping smart category for ${file.name}: Category '${file.category}' is already manually set.`);
        showFileDetails(file); // Still show details with existing manual category
        return;
    }


    let newCategory = 'misc';
    const fileNameLower = file.name.toLowerCase();
    const extension = file.extension ? file.extension.toLowerCase() : '';

    if (extension === '.safetensors' || extension == '.gguf') {
        if (file.size < 1024 * 1024 * 1024) { // 1GB
            newCategory = 'lora';
        } else if (file.size >= 3 * 1024 * 1024 * 1024) { // 3GB
            newCategory = 'checkpoint';
        }
    } else if (extension === '.mp4' || extension === '.webm' || extension === '.gif') {
        newCategory = 'video';
    } else if (extension === '.webp' || extension === '.png' || extension === '.jpeg' || extension === '.jpg') {
        if (fileNameLower.includes('grid')) {
            newCategory = 'evaluation grid';
        } else {
            newCategory = 'images';
        }
    }

    if (newCategory) {
        console.log(`DEBUG: Auto-assigning category for ${file.name}: ${newCategory}`);
        try {
            const response = await fetch('/api/metadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    filepath: file.path,
                    tags: file.tags, // Keep existing tags
                    ratings: file.ratings, // Keep existing ratings
                    notes: file.notes, // Keep existing notes
                    category: newCategory,
                    is_category_manual: 0, // Explicitly mark as auto-assigned
                    custom_gallery_keyword: file.custom_gallery_keyword, // Preserve existing custom keyword
                    is_hidden: file.is_hidden // Preserve existing hidden status
                })
            });

            const result = await response.json();

            if (result.success) {
                // Update the local selectedFile object with the new category and manual flag
                globalState.selectedFile.category = newCategory;
                globalState.selectedFile.is_category_manual = 0; // Ensure local state reflects auto-assigned
                console.log(`DEBUG: Successfully auto-assigned category for ${file.name}. Re-rendering details.`);
                showFileDetails(globalState.selectedFile); // Re-render details to show the new category
            } else {
                console.error('Error auto-assigning category:', result.error);
                globalState.updateStatusBar('Error auto-assigning category: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Network error during auto-assignment:', error);
            globalState.updateStatusBar('Network error during auto-assignment.');
        }
    } else {
        console.log(`DEBUG: No smart category found for ${file.name}.`);
        // Still show details even if no auto-category is found
        showFileDetails(file);
    }
}
