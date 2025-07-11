// src/fileOperations.js

// Changed to import uiManager as a namespace to match usage throughout the file.
import * as uiManager from './uiManager.js';
import { saveCurrentPath } from './settingsManager.js'; // Assuming saveCurrentPath moves here
import { selectFile } from './fileDetailsManager.js'; // Import selectFile from fileDetailsManager
import { openFocusWindow, closeFocusWindow } from './focusWindowManager.js'; // Import openFocusWindow and closeFocusWindow directly
import { normalizePath } from './utils.js';

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the FileOperations module with necessary global state.
 * @param {object} state - The global state object containing references needed by file operations.
 */
export function initializeFileOperations(state) {
    globalState = state;
}

/**
 * Loads initial data for the file browser, including the folder tree and files for the current path.
 */
export async function loadInitialData() {
    console.log('Loading initial data...');
    uiManager.showLoading(true); // Show loading indicator at the very beginning
    try {
        // Always force refresh the tree on initial load to ensure it's up-to-date
        const treeResponse = await fetch(`/api/tree?max_depth=10&force_refresh=true`);
        const treeData = await treeResponse.json();
        globalState.rootPath = treeData.root_path;
        globalState.currentPath = treeData.current_path;

        // Render the initial folder tree
        uiManager.renderFolderTree(treeData.tree, document.getElementById('folderTree'), navigateToFolder);
        uiManager.updateFolderVisibility(); // Apply initial folder visibility after tree is rendered

        // Load files for the current path
        await loadFiles(globalState.currentPath);

        // Highlight the current folder in the tree after a small delay
        setTimeout(() => {
            uiManager.highlightCurrentFolder(globalState.currentPath);
        }, 100);

    } catch (error) {
        console.error('Error loading initial data:', error);
        uiManager.updateStatusBar('Error loading data');
    } finally {
        uiManager.showLoading(false); // Hide loading indicator
    }
}


/**
 * Loads files for a given path from the backend and renders them.
 * Applies current sorting, searching, and filtering preferences.
 * @param {string} path - The directory path to load files from.
 */
export async function loadFiles(path) {
    uiManager.showLoading(true); // Show loading indicator
    try {
        // Get current sorting, display, and filter parameters from global state and DOM
        const sortBy = globalState.currentSortKey;
        const sortOrder = globalState.currentSortOrder;
        const displayRatingCategory = globalState.persistedDisplayRatingCategory;
        const search = document.getElementById('searchInput').value;
        const filterTags = Array.from(globalState.activeFilterTags).join(','); // Convert Set to comma-separated string

        // Construct URL parameters
        const params = new URLSearchParams({
            path: path,
            sort: sortBy,
            order: sortOrder,
            search: search,
            display_rating_category: displayRatingCategory,
            filter_tags: filterTags,
            hide_folders: globalState.hideFolders,
            show_subfolder_content: globalState.showSubfolderContent,
            show_hidden_files: globalState.showHiddenFiles
        });

        const response = await fetch(`/api/files?${params}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        globalState.currentFiles = data.files; // Update global list of current files

        // Custom sort: Directories first, then by current sort key/order
        globalState.currentFiles.sort((a, b) => {
            // Directories always come before files
            if (a.is_directory && !b.is_directory) return -1;
            if (!a.is_directory && b.is_directory) return 1;

            // If both are same type (both directory or both file), apply existing sort logic
            let comparison = 0;
            const aValue = a[globalState.currentSortKey];
            const bValue = b[globalState.currentSortKey];

            if (typeof aValue === 'string' && typeof bValue === 'string') {
                comparison = aValue.localeCompare(bValue);
            } else if (aValue < bValue) {
                comparison = -1;
            } else if (aValue > bValue) {
                comparison = 1;
            }

            return globalState.currentSortOrder === 'asc' ? comparison : -comparison;
        });

        // Collect unique rating categories for the dropdown
        const uniqueRatingCategories = new Set(['overall']); // Always include 'overall' by default
        globalState.currentFiles.forEach(file => {
            if (file.ratings) {
                Object.keys(file.ratings).forEach(cat => uniqueRatingCategories.add(cat));
            }
        });

        // Sort categories alphabetically and populate the dropdown using uiManager
        uiManager.populateDisplayRatingCategoryDropdown(Array.from(uniqueRatingCategories).sort());

        // Render files in the grid using uiManager's function
        uiManager.renderFiles(globalState.currentFiles, selectFile, { // Changed from renderFileGrid to renderFiles
            displayRatingCategory: displayRatingCategory,
            hideFolders: globalState.hideFolders,
            showHiddenFiles: globalState.showHiddenFiles
        });
        uiManager.updateBreadcrumb(data.path); // Update breadcrumb navigation
        updateUpButton(); // Corrected: Call updateUpButton directly
        uiManager.updateStatusBar(`${data.count} items`); // Update status bar

    } catch (error) {
        console.error('Error loading files:', error);
        uiManager.updateStatusBar(`Error: ${error.message}`);
    } finally {
        uiManager.showLoading(false); // Hide loading indicator
    }
}

/**
 * Navigates to a specified folder path, loads its contents, and updates the UI.
 * @param {string} path - The full path of the folder to navigate to.
 */
export async function navigateToFolder(path) {
    console.log('[DEBUG] Navigating to folder:', path);

    try {
        // Normalize path separators
        path = normalizePath(path);
        globalState.currentPath = path; // Update global current path

        // If in directory config mode, handle folder click for hiding/unhiding
        if (globalState.directoryConfigMode) {
            // Pass the path and the actual tree item element
            const treeItemElement = document.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
            if (treeItemElement) {
                globalState.handleFolderClickInConfigMode(path, treeItemElement); // Call via globalState
            } else {
                console.warn(`Tree item element not found for path: ${path}`);
            }
            return; // Prevent normal navigation in config mode
        }

        // Load files for the new path (this will also update breadcrumb and status bar)
        await loadFiles(globalState.currentPath);

        // Highlight the current folder in the tree
        uiManager.highlightCurrentFolder(globalState.currentPath);

        saveCurrentPath(globalState.currentPath); // Save the current path to backend
        closeFocusWindow(); // Corrected: Call closeFocusWindow directly
        globalState.closeDetails(); // Ensure details panel is also closed on folder navigation

        console.log('[DEBUG] Navigation completed successfully');
    } catch (error) {
        console.error('[ERROR] Navigation failed:', error);
    }
}

/**
 * Navigates up to the parent directory.
 */
export async function navigateUp() {
    try {
        const response = await fetch(`/api/navigate_up?path=${encodeURIComponent(globalState.currentPath)}`);
        const data = await response.json();

        if (data.can_go_up) {
            await navigateToFolder(data.parent_path);
        }
    } catch (error) {
        console.error('Error navigating up:', error);
    }
}

/**
 * Updates the enabled/disabled state of the "Up" button.
 */
export function updateUpButton() {
    const upButton = document.getElementById('upButton');
    if (upButton) {
        // Disable up button if at root or an invalid path
        if (globalState.currentPath === globalState.rootPath || globalState.currentPath === '' || globalState.currentPath === '/') {
            upButton.disabled = true;
        } else {
            upButton.disabled = false;
        }
    }
}

/**
 * Refreshes the files displayed in the current directory.
 */
export async function refreshFiles() {
    await loadFiles(globalState.currentPath);
    // Only force refresh the folder tree if explicitly needed, e.g., if a new folder was created/deleted
    // For general refreshes, the existing tree should be sufficient.
    // If you add a "Refresh Tree" button, that button should call loadFolderTree(true).
    await loadFolderTree(false); // Changed to false for normal refresh
}

/**
 * Loads the folder tree structure from the backend.
 * @param {boolean} forceRefresh - If true, bypasses the cache and forces a fresh tree generation.
 */
export async function loadFolderTree(forceRefresh = false) {
    try {
        // Only fetch if forceRefresh is true or if the tree hasn't been loaded yet
        // For now, we'll always fetch, but the backend can cache.
        const params = new URLSearchParams({
            path: globalState.rootPath,
            max_depth: 10,
            force_refresh: forceRefresh // Pass force_refresh to backend
        });
        const response = await fetch(`/api/tree?${params}`);
        const data = await response.json();

        globalState.rootPath = data.root_path;
        uiManager.renderFolderTree(data.tree, document.getElementById('folderTree'), navigateToFolder);
        uiManager.updateBreadcrumb(globalState.currentPath);
        uiManager.updateFolderVisibility(); // Ensure visibility is updated after rendering
    } catch (error) {
        console.error('Error loading folder tree:', error);
    }
}

/**
 * Navigates to the previous file in the current file list, skipping directories and hidden files.
 * @param {boolean} forceFileNavigation - If true, always navigate between files, ignoring gallery view.
 */
export function navigateToPreviousFile(forceFileNavigation = false) {
    if (globalState.focusOverlay.style.display === 'flex') { // Only navigate if focus window is open
        if (globalState.isViewingGalleryImage && !forceFileNavigation && globalState.currentGalleryImages.length > 0) {
            // Navigate within gallery images if not forcing file navigation and in gallery view
            globalState.currentGalleryImageIndex = (globalState.currentGalleryImageIndex - 1 + globalState.currentGalleryImages.length) % globalState.currentGalleryImages.length;
            globalState.displayGalleryImageInFocus(globalState.currentGalleryImages[globalState.currentGalleryImageIndex], document.querySelector(`.gallery-image-thumbnail[data-full-path="${CSS.escape(globalState.currentGalleryImages[globalState.currentGalleryImageIndex])}"]`));
        } else { // This block handles both forceFileNavigation and when not in gallery view
            if (globalState.currentFileIndex > 0) { // Ensure there's a previous file to go to
                let newIndex = globalState.currentFileIndex - 1;
                let previousFile = globalState.currentFiles[newIndex];

                // Skip directories and hidden files when navigating with arrow keys
                while (previousFile && (previousFile.is_directory || (previousFile.is_hidden && !globalState.showHiddenFiles)) && newIndex >= 0) {
                    newIndex--;
                    previousFile = globalState.currentFiles[newIndex];
                }

                if (previousFile) { // Ensure a valid file was found
                    const targetElement = document.querySelector(`.file-item[data-path="${CSS.escape(previousFile.path)}"]`);
                    if (targetElement) {
                        selectFile(previousFile, targetElement);
                    } else {
                        console.warn("Previous file element not found in DOM:", previousFile.path);
                    }
                } else {
                    console.log("No previous file to navigate to.");
                }
            }
        }
    }
}

/**
 * Navigates to the next file in the current file list, skipping directories and hidden files.
 * @param {boolean} forceFileNavigation - If true, always navigate between files, ignoring gallery view.
 */
export function navigateToNextFile(forceFileNavigation = false) {
    if (globalState.focusOverlay.style.display === 'flex') { // Only navigate if focus window is open
        if (globalState.isViewingGalleryImage && !forceFileNavigation && globalState.currentGalleryImages.length > 0) {
            // Navigate within gallery images if not forcing file navigation and in gallery view
            globalState.currentGalleryImageIndex = (globalState.currentGalleryImageIndex + 1) % globalState.currentGalleryImages.length;
            globalState.displayGalleryImageInFocus(globalState.currentGalleryImages[globalState.currentGalleryImageIndex], document.querySelector(`.gallery-image-thumbnail[data-full-path="${CSS.escape(globalState.currentGalleryImages[globalState.currentGalleryImageIndex])}"]`));
        } else { // This block handles both forceFileNavigation and when not in gallery view
            if (globalState.currentFileIndex < globalState.currentFiles.length - 1) { // Ensure there's a next file to go to
                let newIndex = globalState.currentFileIndex + 1;
                let nextFile = globalState.currentFiles[newIndex];

                // Skip directories and hidden files when navigating with arrow keys
                while (nextFile && (nextFile.is_directory || (nextFile.is_hidden && !globalState.showHiddenFiles)) && newIndex < globalState.currentFiles.length) {
                    newIndex++;
                    nextFile = globalState.currentFiles[newIndex];
                }

                if (nextFile) { // Ensure a valid file was found
                    const targetElement = document.querySelector(`.file-item[data-path="${CSS.escape(nextFile.path)}"]`);
                    if (targetElement) {
                        selectFile(nextFile, targetElement);
                    } else {
                        console.warn("Next file element not found in DOM:", nextFile.path);
                    }
                } else {
                    console.log("No next file to navigate to.");
                }
            }
        }
    }
}

/**
 * Sends a request to the backend to open the file's location in the native file explorer.
 * @param {string} filepath - The full path to the file.
 */
export async function openFileLocation(filepath) {
    try {
        const response = await fetch('/api/open_file_location', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filepath: filepath })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Open file location result:', result.message);
        // Optionally, show a success message to the user
        // uiManager.showMessage(result.message, 'success');
    } catch (error) {
        console.error('Error opening file location:', error);
        // For now, just log the error.
        console.error(`Failed to open file location: ${error.message}`);
    }
}
