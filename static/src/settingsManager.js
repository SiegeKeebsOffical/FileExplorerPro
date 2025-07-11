// src/settingsManager.js

import { updateStatusBar } from './uiManager.js';
import { loadInitialData } from './fileOperations.js'; // Assuming loadInitialData is needed here
import { showCustomConfirm } from './utils.js'; // For showCustomConfirm
import { normalizePath } from './utils.js'; // Import normalizePath from utils

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the SettingsManager with necessary global state and DOM element references.
 * @param {object} state - The global state object containing references needed by settings functions.
 * @param {object} domElements - Object with references to key DOM elements.
 */
export function initializeSettingsManager(state, domElements) {
    globalState = state;
    // Ensure domElements and its properties are accessed safely
    globalState.openGalleryAutomaticallyCheckbox = domElements?.openGalleryAutomaticallyCheckbox;
}

/**
 * Fetches settings from the backend to check if start_path and image_directory are set.
 * This is crucial for the initial setup prompt.
 * @returns {Promise<object>} A promise that resolves with the settings object.
 */
export async function getBackendSettings() {
    try {
        const response = await fetch('/api/settings');
        if (!response.ok) {
            // If the response is not OK, throw an error to be caught.
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        const settings = await response.json();
        return settings;
    } catch (error) {
        console.error('Error fetching backend settings:', error);
        // Return default empty values on error so the app can still try to prompt.
        return { start_path: '', image_directory: '', open_gallery_automatically: false };
    }
}

/**
 * Fetches rating categories and their mappings from the backend and updates globalState.
 * @returns {Promise<void>}
 */
export async function fetchRatingCategories() {
    try {
        console.log('settingsManager: Attempting to fetch rating config from /api/rating_config');
        const response = await fetch('/api/rating_config');
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        const config = await response.json();
        console.log('settingsManager: Fetched rating config:', config);

        // Update global state with fetched categories and mappings
        globalState.allFileCategories = config.categories || [];
        globalState.categoryRatingMappings = config.mappings || {};

        console.log('settingsManager: globalState.allFileCategories after fetch:', globalState.allFileCategories);
        console.log('settingsManager: globalState.categoryRatingMappings after fetch:', globalState.categoryRatingMappings);

        // Populate the display rating category dropdown with the fetched categories
        // This call needs to happen once the categories are loaded.
        // We will call this from script.js after fetching.
        // uiManager.populateDisplayRatingCategoryDropdown(globalState.allFileCategories); // This will be called from script.js
    } catch (error) {
        console.error('settingsManager: Error fetching rating categories:', error);
        updateStatusBar('Error fetching rating categories.');
    }
}


/**
 * Loads user preferences from localStorage into global variables.
 * This function will be called early in the main script's DOMContentLoaded.
 */
export function loadPreferences() {
    // Retrieve sort preferences into global variables
    globalState.currentSortKey = localStorage.getItem('sortBy') || 'name';
    globalState.currentSortOrder = localStorage.getItem('sortOrder') || 'asc';

    // Retrieve displayRatingCategory into the global variable
    globalState.persistedDisplayRatingCategory = localStorage.getItem('displayRatingCategory') || 'overall';
    // Retrieve showSubfolderContent into the global variable
    globalState.showSubfolderContent = localStorage.getItem('showSubfolderContent') === 'true';
    globalState.showHiddenFiles = localStorage.getItem('showHiddenFiles') === 'true';
    // Retrieve hideFolders into the global variable
    globalState.hideFolders = localStorage.getItem('hideFolders') === 'true'; // Ensure this is loaded

    // Retrieve new "Open Gallery Automatically" setting
    // Ensure it's read as a boolean correctly. If null, default to false as per existing logic.
    globalState.openGalleryAutomatically = localStorage.getItem('openGalleryAutomatically') === 'true';

    if (globalState.openGalleryAutomaticallyCheckbox) {
        globalState.openGalleryAutomaticallyCheckbox.checked = globalState.openGalleryAutomatically;
    } else {
        console.warn('loadPreferences: openGalleryAutomaticallyCheckbox element not found yet.');
    }

    // Set initial state of checkboxes in the toolbar
    const showSubfolderContentToggle = document.getElementById('showSubfolderContentToggle');
    if (showSubfolderContentToggle) {
        showSubfolderContentToggle.checked = globalState.showSubfolderContent;
    }
    const showHiddenFilesToggle = document.getElementById('showHiddenFilesToggle');
    if (showHiddenFilesToggle) {
        showHiddenFilesToggle.checked = globalState.showHiddenFiles;
    }
    // ADDED: Update the state of the hideFoldersToggle checkbox
    const hideFoldersToggle = document.getElementById('hideFoldersToggle');
    if (hideFoldersToggle) {
        hideFoldersToggle.checked = globalState.hideFolders;
    }
}

/**
 * Displays the settings modal and loads current settings from the backend.
 */
export function showSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (globalState.openGalleryAutomaticallyCheckbox) {
        globalState.openGalleryAutomaticallyCheckbox.checked = globalState.openGalleryAutomatically;
    } else {
        console.warn('showSettings: openGalleryAutomaticallyCheckbox element not found yet. Cannot set initial state.');
    }

    // Load current settings from the backend API
    fetch('/api/settings')
        .then(response => response.json())
        .then(settings => {
            // Corrected IDs here
            const startPathInput = document.getElementById('startPathInput');
            const imageDirectoryInput = document.getElementById('imageDirectoryInput');

            if (startPathInput) {
                startPathInput.value = settings.start_path || '';
            } else {
                console.warn('Element with ID "startPathInput" not found in settings modal.');
            }

            if (imageDirectoryInput) {
                imageDirectoryInput.value = settings.image_directory || '';
            } else {
                console.warn('Element with ID "imageDirectoryInput" not found in settings modal.');
            }

            if (typeof settings.open_gallery_automatically !== 'undefined') {
                globalState.openGalleryAutomatically = settings.open_gallery_automatically;
                if (globalState.openGalleryAutomaticallyCheckbox) {
                    globalState.openGalleryAutomaticallyCheckbox.checked = globalState.openGalleryAutomatically;
                }
            }
        })
        .catch(error => {
            console.error('Error fetching settings from backend:', error);
            updateStatusBar('Error fetching settings.');
        });
}

/**
 * Closes the settings modal.
 */
export function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Prompts the user to enter a default start path.
 * (Simplified: In a real app, this would be a file dialog.)
 */
export function browseForPath() {
    const path = prompt('Enter the default start path:');
    if (path && path.trim() !== '') {
        const inputElement = document.getElementById('startPathInput'); // Corrected ID
        if (inputElement) {
            inputElement.value = path.trim();
        } else {
            console.warn('browseForPath: Element with ID "startPathInput" not found.');
        }
    }
}

/**
 * Prompts the user to enter an image gallery directory.
 * (Simplified: In a real app, this would be a file dialog.)
 */
export function browseForImageDirectory() {
    const path = prompt('Enter the image gallery directory:');
    if (path && path.trim() !== '') {
        const inputElement = document.getElementById('imageDirectoryInput'); // Corrected ID
        if (inputElement) {
            inputElement.value = path.trim();
        } else {
            console.warn('browseForImageDirectory: Element with ID "imageDirectoryInput" not found.');
        }
    }
}

/**
 * Saves the settings (start path and image directory) to the backend.
 * This function is now more flexible, accepting parameters for the initial setup.
 * If parameters are not provided, it reads from the regular settings modal.
 * @param {string} [startPathArg] - The start path to save (optional, read from DOM if not provided).
 * @param {string} [imageDirectoryArg] - The image directory to save (optional, read from DOM if not provided).
 * @param {boolean} [openGalleryAutomaticallyArg] - The 'open gallery automatically' preference (optional, read from DOM if not provided).
 * @returns {Promise<boolean>} A promise that resolves to true on success, throws error on failure.
 */
export async function saveSettings(startPathArg, imageDirectoryArg, openGalleryAutomaticallyArg) {
    let startPath, imageDirectory, openGalleryAutomatically;
    const isInitialSetupCall = (startPathArg !== undefined && imageDirectoryArg !== undefined);

    if (isInitialSetupCall) {
        // Called from initial setup modal
        startPath = startPathArg;
        imageDirectory = imageDirectoryArg;
        openGalleryAutomatically = openGalleryAutomaticallyArg !== undefined ? openGalleryAutomaticallyArg : false; // Default for initial if not provided
    } else {
        // Called from regular settings modal
        // Corrected IDs here
        startPath = document.getElementById('startPathInput')?.value || '';
        imageDirectory = document.getElementById('imageDirectoryInput')?.value || '';
        openGalleryAutomatically = globalState.openGalleryAutomaticallyCheckbox ? globalState.openGalleryAutomaticallyCheckbox.checked : false;
    }

    if (!startPath || startPath.trim() === '') {
        throw new Error('Default Start Path cannot be empty.');
    }
    if (!imageDirectory || imageDirectory.trim() === '') {
        throw new Error('Image Gallery Directory cannot be empty.');
    }

    const pathData = {
        start_path: startPath,
        image_directory: imageDirectory,
        open_gallery_automatically: openGalleryAutomatically
    };

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(pathData)
        });

        const data = await response.json();
        if (data.success) {
            // Update global state and localStorage only after successful backend save
            globalState.openGalleryAutomatically = openGalleryAutomatically;
            localStorage.setItem('openGalleryAutomatically', openGalleryAutomatically);

            if (!isInitialSetupCall) {
                // Only update UI and reload if called from the regular settings modal
                closeSettings();
                updateStatusBar('Settings saved successfully');
                setTimeout(() => {
                    updateStatusBar('Ready');
                }, 2000);
                loadInitialData(); // This will trigger loadPreferences again, which should pick up the correct state
            }
            return true; // Indicate success
        } else {
            throw new Error(data.error || 'Unknown error saving settings.');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        if (!isInitialSetupCall) {
            updateStatusBar('Failed to save settings: ' + error.message);
        }
        throw error; // Re-throw the error for the caller (script.js) to handle
    }
}


/**
 * Toggles dark mode on/off and saves the preference to localStorage.
 */
export function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    updateDarkModeButton();
}

/**
 * Saves the current browsing path to the backend.
 * @param {string} path - The path to save.
 */
export function saveCurrentPath(path) {
    fetch('/api/save_current_path', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ current_path: path })
    })
    .then(response => response.json())
    .then(data => console.log('Save result:', data))
    .catch(err => console.error('Error saving path:', err));
}

/**
 * Updates the text and icon of the dark mode toggle button.
 */
export function updateDarkModeButton() {
    const btn = document.getElementById('darkModeToggle');
    if (btn) { // Ensure button exists
        if (document.body.classList.contains('dark-mode')) {
            btn.textContent = '☀️ Light Mode';
        } else {
            btn.textContent = '🌙 Dark Mode';
        }
    }
}

/**
 * Checks for a saved dark mode preference and applies it on load.
 * Defaults to dark mode if no preference is found.
 */
export function checkDarkModePreference() {
    const darkModePreference = localStorage.getItem('darkMode');
    // If darkModePreference is null (not set yet) OR "true", enable dark mode.
    const enableDarkMode = darkModePreference === null || darkModePreference === 'true';

    if (enableDarkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    updateDarkModeButton();
}

/**
 * Toggles whether folders are hidden in the file grid and refreshes display.
 */
export function toggleHideFolders() {
    globalState.hideFolders = document.getElementById('hideFoldersToggle').checked;
    localStorage.setItem('hideFolders', globalState.hideFolders);
    globalState.refreshFiles(); // Call refreshFiles from global state
}

/**
 * Toggles whether content from subfolders is shown recursively and refreshes display.
 */
export function toggleShowSubfolderContent() {
    globalState.showSubfolderContent = document.getElementById('showSubfolderContentToggle').checked;
    localStorage.setItem('showSubfolderContent', globalState.showSubfolderContent);
    globalState.refreshFiles(); // Call refreshFiles from global state
}

/**
 * Toggles whether hidden files are displayed in the file grid and refreshes display.
 */
export function toggleShowHiddenFiles() {
    globalState.showHiddenFiles = document.getElementById('showHiddenFilesToggle').checked;
    localStorage.setItem('showHiddenFiles', globalState.showHiddenFiles);
    globalState.refreshFiles(); // Call refreshFiles from global state
}

/**
 * Toggles directory configuration mode, changing UI and behavior for folder selection.
 */
export function toggleDirectoryConfigMode() {
    globalState.directoryConfigMode = !globalState.directoryConfigMode;
    const btn = document.getElementById('toggleDirConfigMode');
    if (!btn) return;

    if (globalState.directoryConfigMode) {
        document.body.classList.add('dir-config-mode');
        btn.textContent = '✅ Exit Config Mode';
        btn.style.backgroundColor = '#4CAF50';
        btn.style.borderColor = '#4CAF50';
        // ADDED: Call updateFolderVisibility when entering config mode
        globalState.updateFolderVisibility();
    } else {
        document.body.classList.remove('dir-config-mode');
        btn.textContent = '⚙️ Configure Directories';
        btn.style.backgroundColor = '';
        btn.style.borderColor = '';
        // CRITICAL FIX: Call updateFolderVisibility when exiting config mode
        globalState.updateFolderVisibility();
    }
}

/**
 * Handles folder clicks when in directory configuration mode, toggling hidden status.
 * @param {string} path - The path of the clicked folder.
 * @param {HTMLElement} element - The DOM element of the clicked folder.
 */
export function handleFolderClickInConfigMode(path, element) {
    if (!globalState.directoryConfigMode) return; // Should only run if in config mode

    // Normalize the path before adding/deleting from the set
    const normalizedPath = normalizePath(path);

    if (globalState.hiddenDirectories.has(normalizedPath)) {
        globalState.hiddenDirectories.delete(normalizedPath);
        element.classList.remove('hidden-folder'); // IMMEDIATE VISUAL UPDATE
    } else {
        globalState.hiddenDirectories.add(normalizedPath);
        element.classList.add('hidden-folder'); // IMMEDIATE VISUAL UPDATE
    }

    // Save to localStorage
    localStorage.setItem('hiddenDirectories', JSON.stringify(Array.from(globalState.hiddenDirectories)));

    // REMOVED: globalState.updateFolderVisibility() from here.
    // It will now only be called once when exiting config mode.
}

/**
 * Clears all hidden folder settings.
 */
export function clearAllHiddenFolders() {
    window.showCustomConfirm('Are you sure you want to unhide all folders? This cannot be undone.', () => {
        globalState.hiddenDirectories.clear();
        localStorage.removeItem('hiddenDirectories');
        globalState.updateFolderVisibility();
        if (globalState.directoryConfigMode) {
            document.querySelectorAll('.tree-item.hidden-folder').forEach(item => {
                item.classList.remove('hidden-folder');
            });
        }
    });
}
