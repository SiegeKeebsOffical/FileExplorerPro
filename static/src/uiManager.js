// src/uiManager.js

import { normalizePath, getLastPathPart, basename } from './utils.js';

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the UIManager with necessary global state and DOM element references.
 * @param {object} state - The global state object containing references needed by UI functions.
 * @param {object} domElements - Object with references to key DOM elements.
 */
export function initializeUIManager(state, domElements) {
    globalState = state;
    // We don't directly assign domElements here as many are already assigned in script.js's DOMContentLoaded
    // and are implicitly available via globalState if needed.
    // For functions that directly manipulate DOM, they will query the DOM themselves or rely on being passed elements.
}


/**
 * Recursively renders the folder tree in the sidebar.
 * @param {Array} folders - Array of folder objects to render.
 * @param {HTMLElement} container - The DOM element to append folders to.
 * @param {function} selectFolderCallback - Callback function for selecting a folder.
 */
export function renderFolderTree(folders, container, selectFolderCallback) {
    container.innerHTML = ''; // Clear existing content

    folders.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        const normalizedPath = normalizePath(folder.path); // Normalize path separators for consistency
        item.dataset.path = normalizedPath;

        // Add hidden-folder class if this folder is in hiddenDirectories
        if (globalState.hiddenDirectories.has(normalizedPath)) {
            item.classList.add('hidden-folder');
        }

        const toggle = document.createElement('div');
        toggle.className = 'tree-toggle';
        toggle.textContent = folder.has_children ? '▶' : ''; // Display arrow if has children

        const icon = document.createElement('span');
        icon.textContent = '📁'; // Folder icon

        const name = document.createElement('span');
        name.textContent = folder.name;

        item.appendChild(toggle);
        item.appendChild(icon);
        item.appendChild(name);

        // Event listener for selecting a folder (navigation or config mode)
        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            selectFolderCallback(folder.path, item);
        });

        container.appendChild(item);

        // Render children if they exist
        if (folder.children && folder.children.length > 0) {
            const children = document.createElement('div');
            children.className = 'tree-children hidden'; // Start hidden
            renderFolderTree(folder.children, children, selectFolderCallback); // Recursive call
            container.appendChild(children);

            // Check if this folder was previously expanded and show children
            if (globalState.expandedFolders.has(normalizedPath)) {
                children.classList.remove('hidden');
                toggle.textContent = '▼'; // Change arrow to down
            }

            // Toggle children visibility on arrow click
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                children.classList.toggle('hidden');
                const isHidden = children.classList.contains('hidden');
                toggle.textContent = isHidden ? '▶' : '▼';
                // Save/remove from expanded state in localStorage
                if (isHidden) {
                    globalState.expandedFolders.delete(normalizedPath);
                } else {
                    globalState.expandedFolders.add(normalizedPath);
                }
                localStorage.setItem('expandedFolders', JSON.stringify(Array.from(globalState.expandedFolders))); // Save state
            });
        }
    });
}

/**
 * Renders the given array of files into the file grid.
 * @param {Array} files - Array of file objects to render.
 * @param {function} selectFileCallback - Callback function for selecting a file.
 * @param {object} options - Object containing rendering options (e.g., displayRatingCategory, hideFolders, showHiddenFiles).
 */
export function renderFiles(files, selectFileCallback, options) {
    const grid = document.getElementById('fileGrid');
    grid.innerHTML = ''; // Clear existing grid items

    const displayRatingCategory = options.displayRatingCategory;

    files.forEach(file => {
        // Skip rendering folders if hideFolders is true (handled by backend, but double-check)
        if (options.hideFolders && file.is_directory) {
            return;
        }
        // Skip rendering hidden files if showHiddenFiles is false (handled by backend, but double-check)
        if (file.is_hidden && !options.showHiddenFiles) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.path = file.path; // Store file path as a data attribute

        const iconContainer = document.createElement('div');
        iconContainer.className = 'file-icon-container';

        const icon = document.createElement('div');
        icon.className = 'file-icon';

        if (file.is_directory) {
            icon.classList.add('folder-icon');
            icon.textContent = '📁';
        } else if (file.mime_type && file.mime_type.startsWith('image/') || file.extension === '.webp' || file.extension === '.safetensors' || file.is_missing) {
            // Prioritize preview_image_path if available, especially for missing files
            const imageSource = file.preview_image_path ? `/api/thumbnail/${encodeURIComponent(file.preview_image_path)}` : `/api/thumbnail/${encodeURIComponent(file.path)}`;

            icon.classList.add('image');
            const img = document.createElement('img');
            img.className = 'thumbnail-image';
            img.src = imageSource;
            img.onerror = function() {
                this.style.display = 'none'; // Hide broken image
                // Fallback icon based on primary file type
                if (file.extension === '.safetensors') {
                    icon.textContent = '📦'; // Package icon for safetensors
                } else if (file.extension === '.webp') {
                    icon.textContent = '🖼️'; // Image icon for webp
                } else if (file.is_missing) {
                    icon.textContent = '❓'; // Missing file icon
                } else {
                    icon.textContent = '🖼️'; // Generic image icon
                }
            };
            icon.appendChild(img);

            // Add missing sash if the file is marked as missing
            if (file.is_missing) {
                const missingSash = document.createElement('div');
                missingSash.className = 'missing-sash';
                missingSash.textContent = 'MISSING';
                iconContainer.appendChild(missingSash);
            }

        } else if (file.mime_type && file.mime_type.startsWith('video/')) {
            // For video, also prioritize preview_image_path if it's a static image thumbnail
            const videoSource = file.preview_image_path ? `/api/thumbnail/${encodeURIComponent(file.preview_image_path)}` : `/api/thumbnail/${encodeURIComponent(file.path)}`;

            icon.classList.add('image'); // Use 'image' class for styling consistency
            const videoContainer = document.createElement('div');
            videoContainer.className = 'video-thumbnail';

            const video = document.createElement('video');
            video.src = videoSource;
            video.muted = true;
            video.preload = 'metadata';

            const overlay = document.createElement('div');
            overlay.className = 'video-overlay';
            overlay.textContent = '▶';

            videoContainer.appendChild(video);
            videoContainer.appendChild(overlay);
            icon.appendChild(videoContainer);

            // Load video frame (only if not using a static preview image)
            if (!file.preview_image_path) {
                video.addEventListener('loadedmetadata', function() {
                    video.currentTime = Math.min(1, video.duration * 0.1);
                });
            }

            video.onerror = function() {
                videoContainer.style.display = 'none';
                icon.textContent = '';
            };
        } else if (file.mime_type && (file.mime_type.includes('document') || file.mime_type.includes('pdf') || file.mime_type.includes('text'))) {
            icon.classList.add('document');
            icon.textContent = '📄';
        } else {
            icon.classList.add('default');
            icon.textContent = '📄';
        }

        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = file.name;

        iconContainer.appendChild(icon);
        item.appendChild(iconContainer);
        item.appendChild(name);

        // Add combined info overlay (rating and tags) for files (not directories)
        if (!file.is_directory) {
            const infoOverlay = document.createElement('div');
            infoOverlay.className = 'info-overlay';

            // Rating display
            if (displayRatingCategory !== 'none') {
                const rating = file.ratings ? (file.ratings[displayRatingCategory] || 0) : 0;
                const ratingDisplay = document.createElement('div');
                ratingDisplay.className = 'rating-display';
                ratingDisplay.innerHTML = `<span class="star-display">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>`;
                infoOverlay.appendChild(ratingDisplay);
            }

            // Tags display
            if (file.tags) {
                const tagsArray = file.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '');
                if (tagsArray.length > 0) {
                    const tagsDisplay = document.createElement('div');
                    tagsDisplay.className = 'tags-display';
                    // Display a limited number of tags
                    tagsArray.slice(0, globalState.MAX_TAGS_ON_ICON).forEach(tag => {
                        const tagPill = document.createElement('span');
                        tagPill.className = 'tag-pill';
                        tagPill.textContent = tag;
                        tagsDisplay.appendChild(tagPill);
                    });
                    infoOverlay.appendChild(tagsDisplay);
                }
            }
            if (infoOverlay.children.length > 0) { // Only add if it has content
                iconContainer.appendChild(infoOverlay);
            }
        }

        // Add hidden overlay if the file is hidden and showHiddenFiles is true
        if (file.is_hidden && options.showHiddenFiles) {
            const hiddenOverlay = document.createElement('div');
            hiddenOverlay.className = 'hidden-overlay';
            const hiddenSashLine = document.createElement('div'); // New inner div for the sash
            hiddenSashLine.className = 'hidden-sash-line';
            hiddenSashLine.textContent = 'HIDDEN';
            hiddenOverlay.appendChild(hiddenSashLine); // Append sash to overlay
            iconContainer.appendChild(hiddenOverlay);
        }

        // Event listeners for file selection and opening
        item.addEventListener('click', () => selectFileCallback(file, item));
        item.addEventListener('dblclick', (e) => {
            e.stopPropagation(); // Stop propagation to prevent immediate close of focus window if already open
            if (file.is_directory) {
                globalState.navigateToFolder(file.path); // Call navigation function from global scope
            } else {
                globalState.openFocusWindow(file); // Call focus window function from global scope
            }
        });

        grid.appendChild(item);
    });
}

/**
 * Updates the breadcrumb navigation based on the current path.
 * @param {string} path - The current directory path.
 */
export function updateBreadcrumb(path) {
    const breadcrumbPathContainer = document.querySelector('#breadcrumb .breadcrumb-path');
    breadcrumbPathContainer.innerHTML = ''; // Clear existing breadcrumb

    if (!path) return;

    // Normalize path separators
    path = normalizePath(path);
    const rootPathNormalized = normalizePath(globalState.rootPath);

    // Get the relative path from root
    let relativePath = path;
    if (path.startsWith(rootPathNormalized)) {
        relativePath = path.slice(rootPathNormalized.length);
    }

    // Split into parts
    const parts = relativePath.split('/').filter(part => part);

    // Add root item
    const rootItem = document.createElement('span');
    rootItem.className = 'breadcrumb-item';
    rootItem.textContent = getLastPathPart(globalState.rootPath);
    rootItem.addEventListener('click', () => globalState.navigateToFolder(globalState.rootPath));
    breadcrumbPathContainer.appendChild(rootItem);

    // Add path parts
    let currentPathPart = rootPathNormalized;
    parts.forEach((part) => {
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = ' > ';
        breadcrumbPathContainer.appendChild(separator);

        currentPathPart = currentPathPart.endsWith('/')
            ? currentPathPart + part
            : currentPathPart + '/' + part;

        const item = document.createElement('span');
        item.className = 'breadcrumb-item';
        item.textContent = part;
        item.addEventListener('click', () => globalState.navigateToFolder(currentPathPart));
        breadcrumbPathContainer.appendChild(item);
    });
}

/**
 * Highlights the current folder in the tree view and expands its parents if necessary.
 * @param {string} path - The path of the folder to highlight.
 */
export function highlightCurrentFolder(path) {
    // Normalize the target path for consistent comparison
    const normalizedTargetPath = normalizePath(path);

    // Remove highlight from all folders first
    document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
    });

    let folderItemToHighlight = null;

    // Iterate through path parts to find and expand parents and the target folder
    const pathParts = normalizedTargetPath.split(/[\\/]/).filter(part => part);
    let currentBuildPath = normalizePath(globalState.rootPath); // Start with the root path

    // Add root path to expanded folders to ensure it's always open if it has children
    // Only add if the root path actually corresponds to a tree item that exists
    if (document.querySelector(`.tree-item[data-path="${CSS.escape(normalizePath(globalState.rootPath))}"]`)) {
         globalState.expandedFolders.add(normalizePath(globalState.rootPath));
    }


    for (const part of pathParts) {
        currentBuildPath = currentBuildPath.endsWith('/')
            ? currentBuildPath + part
            : currentBuildPath + '/' + part;
        currentBuildPath = normalizePath(currentBuildPath); // Re-normalize after appending

        const checkItem = document.querySelector(`.tree-item[data-path="${CSS.escape(currentBuildPath)}"]`);

        if (checkItem) {
            folderItemToHighlight = checkItem; // Keep track of the deepest found item

            // Expand this folder if it has children and is not already expanded
            const toggle = checkItem.querySelector('.tree-toggle');
            const childrenContainer = checkItem.nextElementSibling;

            if (toggle && childrenContainer && childrenContainer.classList.contains('tree-children')) {
                if (childrenContainer.classList.contains('hidden')) {
                    childrenContainer.classList.remove('hidden');
                    toggle.textContent = '▼';
                }
                // Ensure this path is added to expandedFolders for persistence
                globalState.expandedFolders.add(currentBuildPath);
            }
        }
    }

    // After iterating through all parts, highlight the final target folder if found
    if (folderItemToHighlight) {
        folderItemToHighlight.classList.add('active');
        // Scroll to the folder to make it visible
        folderItemToHighlight.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }

    // Save the updated expandedFolders state to localStorage
    localStorage.setItem('expandedFolders', JSON.stringify(Array.from(globalState.expandedFolders)));
}

/**
 * Updates the text content of the status bar.
 * @param {string} text - The text to display in the status bar.
 */
export function updateStatusBar(text) {
    document.getElementById('statusBar').textContent = text;
}

/**
 * Shows or hides the loading indicator.
 * @param {boolean} show - True to show, false to hide.
 */
export function showLoading(show) {
    const loading = document.getElementById('loading');
    const grid = document.getElementById('fileGrid');

    if (loading && grid) {
        if (show) {
            loading.classList.remove('hidden');
            grid.style.opacity = '0.5'; // Dim the grid while loading
        } else {
            loading.classList.add('hidden');
            grid.style.opacity = '1'; // Restore opacity
        }
    }
}

/**
 * Updates the visibility of folders in the tree view based on hiddenDirectories set
 * and current directory config mode.
 */
export function updateFolderVisibility() {
    console.log("updateFolderVisibility called. directoryConfigMode:", globalState.directoryConfigMode);
    console.log("Current hiddenDirectories:", Array.from(globalState.hiddenDirectories));

    document.querySelectorAll('.tree-item').forEach(item => {
        // Ensure path is normalized for comparison with hiddenDirectories set
        const path = normalizePath(item.dataset.path);
        const isHiddenInConfig = globalState.hiddenDirectories.has(path);

        console.log(`Processing folder: ${path}`);
        console.log(`  - isHiddenInConfig (from set): ${isHiddenInConfig}`);
        console.log(`  - Before update: item.classList.contains('hidden'): ${item.classList.contains('hidden')}, item.classList.contains('hidden-folder'): ${item.classList.contains('hidden-folder')}, item.style.display: '${item.style.display}'`);

        if (globalState.directoryConfigMode) {
            // In config mode, show all folders but mark hidden ones
            item.classList.remove('hidden'); // Ensure it's visible in config mode
            if (isHiddenInConfig) {
                item.classList.add('hidden-folder');
            } else {
                item.classList.remove('hidden-folder');
            }
        } else {
            // Not in config mode, hide the hidden folders and remove the hidden-folder class
            item.classList.remove('hidden-folder'); // Remove strike-through
            if (isHiddenInConfig) {
                item.classList.add('hidden'); // Add the 'hidden' class to hide it
            } else {
                item.classList.remove('hidden'); // Remove the 'hidden' class to show it
            }
        }
        console.log(`  - After update: item.classList.contains('hidden'): ${item.classList.contains('hidden')}, item.classList.contains('hidden-folder'): ${item.classList.contains('hidden-folder')}, item.style.display: '${item.style.display}'`);
    });
}

/**
 * Populates the "Display Rating Category" dropdown with available categories.
 * @param {Array<string>} categories - Array of rating category names.
 */
export function populateDisplayRatingCategoryDropdown(categories) {
    const dropdown = document.getElementById('displayRatingCategory');
    if (!dropdown) return;

    dropdown.innerHTML = ''; // Clear existing options
    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'No Rating Display';
    dropdown.appendChild(noneOption);

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat.charAt(0).toUpperCase() + cat.slice(1); // Capitalize first letter
        dropdown.appendChild(option);
    });

    // Restore previous selection using the global persisted value
    if (categories.includes(globalState.persistedDisplayRatingCategory)) {
        dropdown.value = globalState.persistedDisplayRatingCategory;
    } else if (categories.includes('overall')) {
        dropdown.value = 'overall'; // Default to overall if available
    } else {
        dropdown.value = 'none'; // Fallback to none
    }
    console.log('uiManager: Dropdown populated. Current selected value:', dropdown.value);
}
