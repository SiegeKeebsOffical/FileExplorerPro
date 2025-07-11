// script.js (Main entry point)

// Global variables for application state (reverted to individual 'let' declarations)
let currentPath = ''; // Stores the currently browsed directory path
let currentFiles = []; // Array of file objects currently displayed in the grid
let selectedFile = null; // The file object currently selected in the details panel
let rootPath = ''; // The root directory of the file explorer
let currentFileIndex = -1; // Index of the currently focused file in the `currentFiles` array
let currentFileTagsArray = []; // Tags for the selected file, stored as an array for manipulation

// Zoom level for the file grid display
let zoomLevel = parseFloat(localStorage.getItem('zoomLevel')) || 100;
const ZOOM_STEP = 10; // Increment/decrement for zoom buttons

// Global variables for tag display and filtering
const MAX_TAGS_ON_ICON = 6; // Max tags to display on file icon
let activeFilterTags = new Set(); // Stores tags currently used for filtering
let filterTagInputTimeout; // For debouncing filter tag input

// Global variables for persisted display rating category
let persistedDisplayRatingCategory = localStorage.getItem('displayRatingCategory') || 'overall';

// Global variables for folder and file visibility settings
let showSubfolderContent = localStorage.getItem('showSubfolderContent') === 'true'; // Whether to show files recursively from subfolders
let showHiddenFiles = localStorage.getItem('showHiddenFiles') === 'true'; // Whether to display hidden files
let openGalleryAutomatically = localStorage.getItem('openGalleryAutomatically') === 'true'; // New checkbox for "Open Gallery Automatically"
let hideFolders = localStorage.getItem('hideFolders') === 'true'; // Whether to hide folders in the file grid

// Directory configuration mode state
let directoryConfigMode = false;
let hiddenDirectories = new Set(JSON.parse(localStorage.getItem('hiddenDirectories') || '[]'));
let expandedFolders = new Set(JSON.parse(localStorage.getItem('expandedFolders') || '[]'));

// Global variables for rating configuration
let categoryRatingMappings = {}; // Object: {file_category: [rating_categories]} maps file categories to applicable rating categories
const allFileCategories = ['checkpoint', 'lora', 'video', 'evaluation grid', 'images', 'misc', 'work', 'personal', 'media', 'archive'];

// Global variables for focus window and gallery
let focusOverlay;
let focusImage;
let focusVideo;
let focusGalleryImage;
let focusGalleryVideo;
let fileDetails;
let detailsContent;
let focusMainContent;
let noPreviewText;
let gallerySidebar;
let galleryImagesContainer;
let customGalleryKeywordInput;
let hideFileButton;
let openGalleryAutomaticallyCheckbox; // This will be assigned a DOM element
let galleryZoomSlider;
let galleryThumbSize = localStorage.getItem('galleryThumbSize') || 100;
let focusFileNameDisplay;
let contextMenu;
let contextMenuOpenFileLocation;
let zoomSlider;
let zoomPercentSpan;
let displayRatingCategoryDropdown;
let fileGridContainer;
let folderTreeContainer;
let currentPathSpan;
let statusBar;
let tagInput;

// Global variables for zoom and pan in the focus window
let currentZoomFactor = 1;
let currentPanX = 0;
let currentPanY = 0;
let focusedMediaElement = null; // Will hold the currently displayed image/video element in focus window
let isDragging = false; // Flag for panning interaction
let lastMouseX = 0; // Last mouse X position for pan calculation
let lastMouseY = 0; // Last mouse Y position for pan calculation

// Gallery navigation state
let isViewingGalleryImage = false; // True if a gallery image is currently in the main focus area, false if the original file's preview is.
let originalFilePreviewUrl = ''; // Stores the URL of the original file's preview to revert to.
let currentGalleryImages = []; // Array of paths fetched from /api/gallery_images
let currentGalleryImageIndex = -1; // Index of the current image in currentGalleryImages
let currentFocusedFile = null; // Global variable to hold the currently focused file for resize handling

// Global variables for sort state
let currentSortKey = localStorage.getItem('sortBy') || 'name'; // Current sort key (e.g., 'name', 'modified')
let currentSortOrder = localStorage.getItem('sortOrder') || 'asc'; // Current sort order ('asc' or 'desc')


// Import all necessary modules
import * as utils from './src/utils.js';
import * as uiManager from './src/uiManager.js';
import * as fileOperations from './src/fileOperations.js';
import * as fileDetailsManager from './src/fileDetailsManager.js';
import * as focusWindowManager from './src/focusWindowManager.js';
import * as settingsManager from './src/settingsManager.js';
import * as ratingConfigManager from './src/ratingConfigManager.js';
import * as filterManager from './src/filterManager.js';
import * as zoomManager from './src/zoomManager.js';
import * as sortManager from './src/sortManager.js';


// DOM element references for the initial setup modal (these are local to script.js)
let initialSetupOverlay;
let initialSetupModal;
let initialStartPathInput;
let initialImageDirectoryInput;
let saveInitialPathsBtn;
let initialSetupError;


// Bundle global state and DOM elements to pass to modules for initialization
let globalStateBundle = {}; // Will be populated in DOMContentLoaded
let domElementsBundle = {}; // Will be populated in DOMContentLoaded


/**
 * Sets up all global event listeners for user interactions.
 * This function is called once after DOMContentLoaded, after initial data loading.
 */
function setupEventListeners() {
    // Toolbar Buttons and Checkboxes
    document.getElementById('upButton')?.addEventListener('click', globalStateBundle.navigateToFolder.bind(null, globalStateBundle.currentPath + '/..'));
    document.getElementById('hideFoldersToggle')?.addEventListener('change', settingsManager.toggleHideFolders);
    document.getElementById('showSubfolderContentToggle')?.addEventListener('change', settingsManager.toggleShowSubfolderContent);
    document.getElementById('showHiddenFilesToggle')?.addEventListener('change', settingsManager.toggleShowHiddenFiles);
    document.getElementById('toggleDirConfigMode')?.addEventListener('click', settingsManager.toggleDirectoryConfigMode);
    document.getElementById('darkModeToggle')?.addEventListener('click', settingsManager.toggleDarkMode);
    document.getElementById('zoomOutBtn')?.addEventListener('click', () => zoomManager.zoomOut(globalStateBundle));
    document.getElementById('zoomInBtn')?.addEventListener('click', () => zoomManager.zoomIn(globalStateBundle));
    document.getElementById('settingsBtn')?.addEventListener('click', settingsManager.showSettings);
    document.getElementById('manageRatingsBtn')?.addEventListener('click', ratingConfigManager.showRatingConfigModal);
    document.getElementById('filterBtn')?.addEventListener('click', filterManager.showFilterModal);
    document.getElementById('refreshBtn')?.addEventListener('click', globalStateBundle.refreshFiles);

    // File Details Panel
    document.getElementById('closeFileDetailsBtn')?.addEventListener('click', globalStateBundle.closeDetails);
    document.getElementById('hideFileButton')?.addEventListener('click', fileDetailsManager.toggleHideFile);

    // Settings Modal Buttons
    document.getElementById('closeSettingsModalBtn')?.addEventListener('click', settingsManager.closeSettings);
    document.getElementById('browseStartPathBtn')?.addEventListener('click', settingsManager.browseForPath);
    document.getElementById('browseImageDirBtn')?.addEventListener('click', settingsManager.browseForImageDirectory);
    document.getElementById('saveSettingsBtn')?.addEventListener('click', settingsManager.saveSettings);
    document.getElementById('cancelSettingsBtn')?.addEventListener('click', settingsManager.closeSettings);
    if (domElementsBundle.openGalleryAutomaticallyCheckbox) {
        domElementsBundle.openGalleryAutomaticallyCheckbox.addEventListener('change', function() {
            globalStateBundle.openGalleryAutomatically = this.checked;
            localStorage.setItem('openGalleryAutomatically', globalStateBundle.openGalleryAutomatically);
        });
    }

    // Rating Config Modal Buttons
    document.getElementById('closeRatingConfigModalBtn')?.addEventListener('click', ratingConfigManager.closeRatingConfigModal);
    document.getElementById('addRatingDefBtn')?.addEventListener('click', ratingConfigManager.addRatingDefinition);
    document.getElementById('applySmartCategoriesBtn')?.addEventListener('click', ratingConfigManager.applySmartDefaultCategories);
    document.getElementById('saveRatingConfigBtn')?.addEventListener('click', ratingConfigManager.saveRatingConfig);
    document.getElementById('cancelRatingConfigBtn')?.addEventListener('click', ratingConfigManager.closeRatingConfigModal);

    // Filter Modal Buttons
    document.getElementById('closeFilterModalBtn')?.addEventListener('click', filterManager.closeFilterModal);
    document.getElementById('clearFilterTagsBtn')?.addEventListener('click', filterManager.clearFilterTags);
    document.getElementById('applyFilterBtn')?.addEventListener('click', filterManager.applyFilter);
    document.getElementById('cancelFilterModalBtn')?.addEventListener('click', filterManager.closeFilterModal);

    // Event listener for display rating category dropdown
    domElementsBundle.displayRatingCategoryDropdown?.addEventListener('change', function() {
        localStorage.setItem('displayRatingCategory', this.value);
        globalStateBundle.persistedDisplayRatingCategory = this.value;
        globalStateBundle.refreshFiles();
    });

    // Debounce search input
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput?.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(globalStateBundle.refreshFiles, 300);
    });

    // Setup zoom functionality for the file grid
    zoomManager.setupZoom(globalStateBundle);

    // Event listener for closing focus window
    domElementsBundle.focusOverlay?.addEventListener('click', (e) => {
        if (e.target === domElementsBundle.focusOverlay) {
            focusWindowManager.closeFocusWindow();
        }
    });

    // Listener for clicks within the focusMainContent area
    domElementsBundle.focusMainContent?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (globalStateBundle.isViewingGalleryImage) {
            if (e.target === domElementsBundle.focusGalleryImage || e.target === domElementsBundle.focusGalleryVideo) {
                focusWindowManager.revertToOriginalView();
            } else if (e.target === domElementsBundle.focusMainContent || e.target === domElementsBundle.noPreviewText) {
                focusWindowManager.closeFocusWindow();
            }
        } else {
            if (e.target === domElementsBundle.focusImage || e.target === domElementsBundle.focusVideo) {
                focusWindowManager.closeFocusWindow();
            } else if (e.target === domElementsBundle.focusMainContent || e.target === domElementsBundle.noPreviewText) {
                focusWindowManager.closeFocusWindow();
            }
        }
    });

    // Add mouse wheel listener for zoom within the focus window
    domElementsBundle.focusMainContent?.addEventListener('wheel', focusWindowManager.handleWheelZoom, { passive: false });

    // Add mouse listeners for panning within the focus window
    domElementsBundle.focusMainContent?.addEventListener('mousedown', focusWindowManager.handleMouseDown);
    domElementsBundle.focusMainContent?.addEventListener('mousemove', focusWindowManager.handleMouseMove);
    domElementsBundle.focusMainContent?.addEventListener('mouseup', focusWindowManager.handleMouseUp);
    domElementsBundle.focusMainContent?.addEventListener('mouseleave', focusWindowManager.handleMouseUp);

    // Add window resize listener for focus window
    window.addEventListener('resize', () => {
        if (domElementsBundle.focusOverlay?.style.display === 'flex' && globalStateBundle.currentFocusedFile) {
            focusWindowManager.updateFocusWindowDimensions(globalStateBundle.currentFocusedFile);
        }
    });

    // Gallery zoom slider event listener
    if (domElementsBundle.galleryZoomSlider) {
        domElementsBundle.galleryZoomSlider.value = globalStateBundle.galleryThumbSize;
        domElementsBundle.galleryZoomSlider.addEventListener('input', function() {
            globalStateBundle.galleryThumbSize = parseInt(this.value);
            focusWindowManager.applyGalleryZoom();
            localStorage.setItem('galleryThumbSize', globalStateBundle.galleryThumbSize);
        });
    }

    // Prevent clicks on gallery sidebar from closing the focus window
    domElementsBundle.gallerySidebar?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Filter modal event listeners for tag input and keydown
    document.getElementById('filterTagInput')?.addEventListener('input', filterManager.handleFilterTagInput);
    document.getElementById('filterTagInput')?.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const newTag = this.value.trim();
            if (newTag) {
                filterManager.addFilterTag(newTag);
                this.value = '';
                filterManager.renderSuggestedFilterTags([]);
            }
        }
    });

    // Add event listeners for sort buttons
    document.querySelectorAll('.sort-button').forEach(button => {
        button.addEventListener('click', sortManager.handleSortButtonClick);
    });

    // Context menu for files
    document.addEventListener('contextmenu', function(e) {
        const fileItem = e.target.closest('.file-item');
        if (fileItem) {
            e.preventDefault();
            const filePath = fileItem.dataset.path;
            if (filePath) {
                domElementsBundle.contextMenu.dataset.currentFilepath = filePath;
                domElementsBundle.contextMenu.style.left = `${e.pageX}px`;
                domElementsBundle.contextMenu.style.top = `${e.pageY}px`;
                domElementsBundle.contextMenu.classList.remove('hidden');
            }
        }
    });

    // Hide context menu when clicking anywhere else
    document.addEventListener('click', function(e) {
        if (domElementsBundle.contextMenu && !domElementsBundle.contextMenu.contains(e.target)) {
            domElementsBundle.contextMenu.classList.add('hidden');
        }
    });

    // Add listener for the "Open File Location" menu item
    domElementsBundle.contextMenuOpenFileLocation?.addEventListener('click', function() {
        const filePath = domElementsBundle.contextMenu.dataset.currentFilepath;
        if (filePath) {
            window.openFileLocation(filePath);
        }
        domElementsBundle.contextMenu.classList.add('hidden');
    });


    // NEW: Event listener for saving initial paths from the modal
    if (saveInitialPathsBtn) {
        saveInitialPathsBtn.addEventListener('click', async () => {
            const startPath = initialStartPathInput.value.trim();
            const imageDirectory = initialImageDirectoryInput.value.trim();

            initialSetupError.textContent = ''; // Clear previous errors

            try {
                // Call the modified saveSettings from settingsManager with explicit arguments.
                await settingsManager.saveSettings(startPath, imageDirectory, globalStateBundle.openGalleryAutomatically);
                // If successful, hide the modal and proceed with full app initialization
                initialSetupOverlay.classList.add('hidden');
                initialSetupModal.classList.add('hidden');
                uiManager.updateStatusBar('Initial paths set. Ready.');

                // After saving, re-run the necessary initialization steps
                settingsManager.loadPreferences();
                sortManager.updateSortButtonsUI();
                await ratingConfigManager.loadRatingConfig(); // Ensure ratings are loaded before populating dropdown

                // Debugging log: Check allRatingDefinitions after loading config
                console.log('DEBUG: globalStateBundle.allRatingDefinitions after save and loadRatingConfig:', globalStateBundle.allRatingDefinitions);

                // Populate dropdown with actual loaded rating definitions
                if (globalStateBundle.allRatingDefinitions && Array.isArray(globalStateBundle.allRatingDefinitions) && globalStateBundle.allRatingDefinitions.length > 0) {
                    // Corrected mapping: Directly use the string if it's a string, or def.name if it's an object
                    const ratingNames = globalStateBundle.allRatingDefinitions
                        .map(def => typeof def === 'string' ? def : (typeof def === 'object' && def !== null && typeof def.name === 'string' ? def.name : null))
                        .filter(name => name !== null); // Filter out any nulls resulting from invalid 'def' or 'def.name'

                    console.log('DEBUG: Populating dropdown with (after save):', ratingNames);
                    uiManager.populateDisplayRatingCategoryDropdown(ratingNames);
                } else {
                    // Fallback to default if no custom ratings are loaded
                    console.log('DEBUG: Falling back to default categories (after save).');
                    uiManager.populateDisplayRatingCategoryDropdown(['overall', 'technical', 'artistic']);
                }
                fileOperations.loadInitialData();
                settingsManager.checkDarkModePreference();
            } catch (error) {
                initialSetupError.textContent = error.message; // Display error in the modal
                console.error('Error saving initial paths:', error);
            }
        });
    }

    // NEW: Browse buttons for initial setup modal (placeholder using prompt)
    document.querySelectorAll('#initialSetupModal .browse-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            const targetId = event.target.dataset.target;
            const inputElement = document.getElementById(targetId);
            if (inputElement) {
                const path = prompt(`Enter the path for ${targetId === 'initialStartPath' ? 'Default Start Path' : 'Image Gallery Directory'}:`);
                if (path) {
                    inputElement.value = path.trim();
                }
            }
        });
    });
}


// Keyboard shortcuts (remain in main script as they manage overall app behavior)
document.addEventListener('keydown', function(e) {
    if (e.key === 'F5') {
        e.preventDefault(); // Prevent default browser refresh
        globalStateBundle.refreshFiles();
    } else if (e.key === 'Escape') {
        e.preventDefault(); // Prevent default browser behavior (e.g., closing full-screen)

        // Get references to all potential modals/overlays
        const ratingConfigModal = document.getElementById('ratingConfigModal');
        const settingsModal = document.getElementById('settingsModal');
        const filterModal = document.getElementById('filterModal');
        // Use the locally defined DOM element variables
        const focusOverlayElement = focusOverlay;
        const fileDetailsElement = fileDetails;
        const contextMenuElement = contextMenu;
        const initialSetupModalElement = initialSetupModal; // The new modal

        // If the initial setup modal is open, prevent all other shortcuts and force interaction with it.
        if (!initialSetupModalElement?.classList.contains('hidden')) {
            return; // Do nothing, user must interact with the setup modal
        }

        // Close other modals/panels in order of precedence
        if (focusOverlayElement?.style.display === 'flex') {
            focusWindowManager.closeFocusWindow();
        } else if (!ratingConfigModal?.classList.contains('hidden')) {
            ratingConfigManager.closeRatingConfigModal();
        } else if (!settingsModal?.classList.contains('hidden')) {
            settingsManager.closeSettings();
        } else if (!filterModal?.classList.contains('hidden')) {
            filterManager.closeFilterModal();
        } else if (!contextMenuElement?.classList.contains('hidden')) {
            contextMenuElement.classList.add('hidden');
        } else if (fileDetailsElement?.classList.contains('open')) {
            fileDetailsManager.closeDetails();
        }
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); // Prevent default browser scroll
        if (e.shiftKey) {
            fileOperations.navigateToPreviousFile(true); // Force file navigation
        } else {
            fileOperations.navigateToPreviousFile(false); // Normal behavior (gallery first)
        }
    } else if (e.key === 'ArrowRight') {
        e.preventDefault(); // Prevent default browser scroll
        if (e.shiftKey) {
            fileOperations.navigateToNextFile(true); // Force file navigation
        } else {
            fileOperations.navigateToNextFile(false); // Normal behavior (gallery first)
        }
    } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        document.getElementById('searchInput')?.focus(); // Focus the search input
    }
});


// Main DOMContentLoaded handler - this is where the initial path check happens
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Assign ALL necessary DOM elements to their global variables first.
    focusOverlay = document.getElementById('focusOverlay');
    focusImage = document.getElementById('focusImage');
    focusVideo = document.getElementById('focusVideo');
    focusGalleryImage = document.getElementById('focusGalleryImage');
    focusGalleryVideo = document.getElementById('focusGalleryVideo');
    fileDetails = document.getElementById('fileDetails');
    detailsContent = document.getElementById('detailsContent');
    focusMainContent = document.getElementById('focusMainContent');
    noPreviewText = document.getElementById('noPreviewText');
    gallerySidebar = document.getElementById('gallerySidebar');
    galleryImagesContainer = document.getElementById('galleryImagesContainer');
    customGalleryKeywordInput = document.getElementById('customGalleryKeyword');
    hideFileButton = document.getElementById('hideFileButton');
    openGalleryAutomaticallyCheckbox = document.getElementById('openGalleryAutomatically');
    galleryZoomSlider = document.getElementById('galleryZoomSlider');
    focusFileNameDisplay = document.getElementById('focusFileNameDisplay');
    contextMenu = document.getElementById('contextMenu');
    contextMenuOpenFileLocation = document.getElementById('contextMenuOpenFileLocation');
    zoomSlider = document.getElementById('zoomSlider');
    zoomPercentSpan = document.getElementById('zoomPercent');
    displayRatingCategoryDropdown = document.getElementById('displayRatingCategory');
    fileGridContainer = document.getElementById('fileGrid');
    folderTreeContainer = document.getElementById('folderTree');
    currentPathSpan = document.getElementById('currentPath');
    statusBar = document.getElementById('statusBar');
    tagInput = document.getElementById('tagInput');

    // Assign NEW DOM elements for the initial setup modal (local references)
    initialSetupOverlay = document.getElementById('initialSetupOverlay');
    initialSetupModal = document.getElementById('initialSetupModal');
    initialStartPathInput = document.getElementById('initialStartPath');
    initialImageDirectoryInput = document.getElementById('initialImageDirectory');
    saveInitialPathsBtn = document.getElementById('saveInitialPathsBtn');
    initialSetupError = document.getElementById('initialSetupError');

    // 2. Populate globalStateBundle and domElementsBundle with the assigned variables.
    globalStateBundle = {
        currentPath, currentFiles, selectedFile, rootPath, currentFileIndex, currentFileTagsArray,
        zoomLevel, ZOOM_STEP, MAX_TAGS_ON_ICON, activeFilterTags, filterTagInputTimeout,
        persistedDisplayRatingCategory, showSubfolderContent, showHiddenFiles, openGalleryAutomatically,
        hideFolders, directoryConfigMode, hiddenDirectories, expandedFolders, categoryRatingMappings,
        allFileCategories, galleryThumbSize, currentFocusedFile, isViewingGalleryImage,
        originalFilePreviewUrl, currentGalleryImages, currentGalleryImageIndex,
        currentZoomFactor, currentPanX, currentPanY, focusedMediaElement, isDragging,
        lastMouseX, lastMouseY, currentSortKey, currentSortOrder,

        // Expose functions directly as methods on the state bundle for inter-module communication
        refreshFiles: () => fileOperations.refreshFiles(),
        closeDetails: () => fileDetailsManager.closeDetails(),
        navigateToFolder: (path) => fileOperations.navigateToFolder(path),
        openFocusWindow: (file) => focusWindowManager.openFocusWindow(file),
        displayGalleryImageInFocus: (url, thumb) => focusWindowManager.displayGalleryImageInFocus(url, thumb),
        updateFolderVisibility: () => uiManager.updateFolderVisibility(),
        selectFile: (file, element) => fileDetailsManager.selectFile(file, element),
        handleFolderClickInConfigMode: (path, element) => settingsManager.handleFolderClickInConfigMode(path, element)
    };

    domElementsBundle = {
        focusOverlay, focusImage, focusVideo, focusGalleryImage, focusGalleryVideo, fileDetails, detailsContent,
        focusMainContent, noPreviewText, gallerySidebar, galleryImagesContainer, customGalleryKeywordInput,
        hideFileButton, openGalleryAutomaticallyCheckbox, galleryZoomSlider, focusFileNameDisplay,
        contextMenu, contextMenuOpenFileLocation, zoomSlider, zoomPercentSpan,
        displayRatingCategoryDropdown, fileGridContainer, folderTreeContainer, currentPathSpan,
        statusBar, tagInput
    };

    // Ensure the focus overlay and file details are hidden initially by inline style
    if (focusOverlay) {
        focusOverlay.classList.remove('hidden');
        focusOverlay.style.display = 'none';
    }
    if (fileDetails) {
        fileDetails.classList.remove('hidden');
        fileDetails.classList.remove('open');
    }

    // Expose utility functions to the global window object for dynamically inserted HTML.
    // Debugging log: Check if ratingConfigManager.handleCategoryRatingCheckbox is a function
    console.log('DEBUG: Type of ratingConfigManager.handleCategoryRatingCheckbox:', typeof ratingConfigManager.handleCategoryRatingCheckbox);
    // Defensive check: Only assign if the function exists
    if (typeof ratingConfigManager.handleCategoryRatingCheckbox === 'function') {
        window.handleCategoryRatingCheckbox = (checkbox) => ratingConfigManager.handleCategoryRatingCheckbox(checkbox);
    } else {
        console.error("Error: ratingConfigManager.handleCategoryRatingCheckbox is not a function. Please ensure it is exported correctly from ratingConfigManager.js");
    }
    window.showCustomConfirm = (message, onConfirm) => utils.showCustomConfirm(message, onConfirm);
    window.openFileLocation = (filepath) => fileOperations.openFileLocation(filepath);

    // 3. Initialize all modules with the populated bundles. This must happen before any logic that uses them.
    uiManager.initializeUIManager(globalStateBundle, domElementsBundle);
    fileOperations.initializeFileOperations(globalStateBundle);
    fileDetailsManager.initializeFileDetailsManager(globalStateBundle, domElementsBundle);
    focusWindowManager.initializeFocusWindowManager(globalStateBundle, domElementsBundle);
    settingsManager.initializeSettingsManager(globalStateBundle, domElementsBundle);
    ratingConfigManager.initializeRatingConfigManager(globalStateBundle);
    filterManager.initializeFilterManager(globalStateBundle);
    zoomManager.initializeZoomManager(globalStateBundle);
    sortManager.initializeSortManager(globalStateBundle);

    // Check dark mode preference early so UI is correct from the start.
    settingsManager.checkDarkModePreference();

    // 4. --- Initial Path Setup Check ---
    try {
        const settings = await settingsManager.getBackendSettings();
        const startPathSet = settings.start_path && settings.start_path.trim() !== '';
        const imageDirectorySet = settings.image_directory && settings.image_directory.trim() !== '';

        if (!startPathSet || !imageDirectorySet) {
            // Paths are not set, show the initial setup modal and overlay.
            initialSetupOverlay.classList.remove('hidden');
            initialSetupModal.classList.remove('hidden');
            // Pre-fill inputs if one path is already known but not the other.
            if (settings.start_path) initialStartPathInput.value = settings.start_path;
            if (settings.image_directory) initialImageDirectoryInput.value = settings.image_directory;

            // Update status bar to inform the user.
            uiManager.updateStatusBar('Please set initial paths to begin.');
            // No further app initialization here, as the user needs to set paths first.
        } else {
            // Paths are already set, proceed with normal application initialization.
            settingsManager.loadPreferences();
            sortManager.updateSortButtonsUI();

            // Load rating configuration first, as other parts of the UI might depend on it.
            await ratingConfigManager.loadRatingConfig();

            // Debugging log: Check allRatingDefinitions after initial load
            console.log('DEBUG: globalStateBundle.allRatingDefinitions after initial loadRatingConfig:', globalStateBundle.allRatingDefinitions);

            // Populate the display rating category dropdown using the loaded definitions.
            // Corrected mapping: Directly use the string if it's a string, or def.name if it's an object
            if (globalStateBundle.allRatingDefinitions && Array.isArray(globalStateBundle.allRatingDefinitions) && globalStateBundle.allRatingDefinitions.length > 0) {
                const ratingNames = globalStateBundle.allRatingDefinitions
                    .map(def => typeof def === 'string' ? def : (typeof def === 'object' && def !== null && typeof def.name === 'string' ? def.name : null))
                    .filter(name => name !== null); // Filter out any nulls resulting from invalid 'def' or 'def.name'

                console.log('DEBUG: Populating dropdown with (initial load):', ratingNames);
                uiManager.populateDisplayRatingCategoryDropdown(ratingNames);
            } else {
                // Fallback to default if no custom ratings are loaded or if the loaded data is invalid
                console.log('DEBUG: Falling back to default categories (initial load).');
                uiManager.populateDisplayRatingCategoryDropdown(['overall', 'technical', 'artistic']);
            }

            fileOperations.loadInitialData();
            uiManager.updateStatusBar('Ready');
        }
    } catch (error) {
        console.error('Error during initial path check or setup:', error);
        uiManager.updateStatusBar('Error checking initial paths. Please enter paths manually.');
        // If fetching settings fails, still show the modal to allow entry.
        initialSetupOverlay.classList.remove('hidden');
        initialSetupModal.classList.remove('hidden');
        initialSetupError.textContent = 'Failed to load initial settings from server. Please enter paths.';
    }

    // 5. Attach all event listeners. This happens once, after all DOM elements are assigned
    // and all modules are initialized, ensuring all targets and functions are ready.
    setupEventListeners();
});
