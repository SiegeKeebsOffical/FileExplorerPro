// src/focusWindowManager.js

import { basename } from './utils.js';
import { updateStatusBar } from './uiManager.js';

// Dependencies (will be passed from main script or derived from global state)
let globalState = {}; // Placeholder for global state object passed from main script

/**
 * Initializes the FocusWindowManager with necessary global state and DOM element references.
 * @param {object} state - The global state object containing references needed by focus window functions.
 * @param {object} domElements - Object with references to key DOM elements.
 */
export function initializeFocusWindowManager(state, domElements) {
    globalState = state;
    globalState.focusOverlay = domElements.focusOverlay;
    globalState.focusImage = domElements.focusImage;
    globalState.focusVideo = domElements.focusVideo;
    globalState.focusGalleryImage = domElements.focusGalleryImage;
    globalState.focusGalleryVideo = domElements.focusGalleryVideo;
    globalState.focusMainContent = domElements.focusMainContent;
    globalState.noPreviewText = domElements.noPreviewText;
    globalState.gallerySidebar = domElements.gallerySidebar;
    globalState.galleryImagesContainer = domElements.galleryImagesContainer;
    globalState.galleryZoomSlider = domElements.galleryZoomSlider;
    globalState.focusFileNameDisplay = domElements.focusFileNameDisplay; // New: filename display element
}

/**
 * Opens the focus window to display a file preview (image or video).
 * @param {object} file - The file object to preview.
 */
export async function openFocusWindow(file) {
    console.assert(globalState.focusOverlay, "Error: focusOverlay element not found in DOM!");
    if (!file) {
        console.error("Attempted to open focus window with invalid file object:", file);
        closeFocusWindow();
        return;
    }

    console.log("Attempting to open focus window for file:", file.name);

    // If the overlay is currently hidden, make it visible.
    // This ensures it only transitions from 'none' to 'flex' once.
    if (globalState.focusOverlay.style.display === 'none') {
        globalState.focusOverlay.style.display = 'flex';
    }

    // Reset gallery navigation state
    globalState.isViewingGalleryImage = false;
    globalState.currentGalleryImageIndex = -1;
    globalState.currentGalleryImages = []; // Clear previous gallery images

    // Determine the actual source path for the media to be displayed.
    const actualSourcePath = file.preview_image_path ? file.preview_image_path : file.path;
    globalState.originalFilePreviewUrl = actualSourcePath; // Store original RAW URL

    globalState.currentFocusedFile = file; // Set the global variable for resize handling

    // Always show the original file preview first (fastest initial display)
    updateFocusWindowContent(file);

    // Handle gallery sidebar visibility and content
    const showGallery = file.category === 'lora' || file.category === 'checkpoint';

    if (showGallery) {
        applyGalleryZoom();
        globalState.gallerySidebar.classList.remove('hidden');
        globalState.focusOverlay.classList.add('with-gallery');
        await loadGalleryImages(file); // This will populate currentGalleryImages and render thumbnails

        // After gallery images are loaded and rendered, if auto-open is enabled,
        // display the first gallery image with a slight delay to allow DOM to render.
        if (globalState.openGalleryAutomatically && globalState.currentGalleryImages.length > 0) {
            console.log("Open Gallery Automatically is enabled, delaying loading first gallery image.");
            setTimeout(() => {
                // Pass the raw path, let displayGalleryImageInFocus find the element if needed
                displayGalleryImageInFocus(globalState.currentGalleryImages[0]);
            }, 50); // Small delay
        }
    } else {
        globalState.gallerySidebar.classList.add('hidden');
        globalState.focusOverlay.classList.remove('with-gallery');
        // updateFocusWindowContent(file) is already called above, no need to call again
    }

    updateFocusWindowDimensions(file); // Call the new function to set dimensions

    console.log('Focus window opened. Current display style:', globalState.focusOverlay.style.display);
}

/**
 * Updates the content displayed in the focus window based on the given file.
 * @param {object} file - The file object to display.
 */
export function updateFocusWindowContent(file) {
    // Explicitly hide all media elements and pause/reset videos
    globalState.focusImage.classList.add('hidden');
    globalState.focusImage.src = ''; // Clear src
    globalState.focusVideo.classList.add('hidden');
    globalState.focusVideo.pause();
    globalState.focusVideo.currentTime = 0;
    globalState.focusVideo.src = ''; // Clear src
    globalState.focusGalleryImage.classList.add('hidden');
    globalState.focusGalleryImage.src = ''; // Clear src
    globalState.focusGalleryVideo.classList.add('hidden');
    globalState.focusGalleryVideo.pause();
    globalState.focusGalleryVideo.currentTime = 0;
    globalState.focusGalleryVideo.src = ''; // Clear src
    globalState.noPreviewText.classList.add('hidden'); // Hide no preview text

    // Determine the actual source path for the media to be displayed.
    const actualSourcePath = file.preview_image_path ? file.preview_image_path : file.path;

    // Determine media type and display
    const actualExtension = actualSourcePath.split('.').pop().toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes('.' + actualExtension);
    const isVideo = ['.mp4', '.webm', '.ogg'].includes('.' + actualExtension);

    if (isImage) {
        globalState.focusedMediaElement = globalState.focusImage;
        globalState.focusImage.src = `/api/thumbnail/${encodeURIComponent(actualSourcePath)}`;
        globalState.focusImage.classList.remove('hidden');
    } else if (isVideo) {
        globalState.focusedMediaElement = globalState.focusVideo;
        globalState.focusVideo.src = `/api/thumbnail/${encodeURIComponent(actualSourcePath)}`;
        globalState.focusVideo.classList.remove('hidden');
        globalState.focusVideo.load();
        globalState.focusVideo.play();
    } else {
        globalState.focusedMediaElement = null; // No media element to zoom/pan
        globalState.noPreviewText.classList.remove('hidden');
    }

    // Update filename display
    if (globalState.focusFileNameDisplay) {
        globalState.focusFileNameDisplay.textContent = basename(file.name); // Display the original file's name
        globalState.focusFileNameDisplay.classList.remove('hidden');
    }

    // Reset zoom and pan for the newly displayed content
    resetZoomPan();

    // Remove active class from all gallery thumbnails
    document.querySelectorAll('.gallery-image-thumbnail').forEach(thumb => {
        thumb.classList.remove('active-gallery-image');
    });

    globalState.isViewingGalleryImage = false;
    globalState.currentGalleryImageIndex = -1; // No gallery image is currently focused
}

/**
 * Displays the original file's preview in the focus window.
 */
export function displayOriginalPreview() {
    // Explicitly hide all media elements and pause/reset videos
    globalState.focusImage.classList.add('hidden');
    globalState.focusImage.src = ''; // Clear src
    globalState.focusVideo.classList.add('hidden');
    globalState.focusVideo.pause();
    globalState.focusVideo.currentTime = 0;
    globalState.focusVideo.src = ''; // Clear src
    globalState.focusGalleryImage.classList.add('hidden');
    globalState.focusGalleryImage.src = ''; // Clear src
    globalState.focusGalleryVideo.classList.add('hidden');
    globalState.focusGalleryVideo.pause();
    globalState.focusGalleryVideo.currentTime = 0;
    globalState.focusGalleryVideo.src = ''; // Clear src
    globalState.noPreviewText.classList.add('hidden'); // Hide no preview text

    // Determine media type and display based on originalFilePreviewUrl
    const actualExtension = globalState.originalFilePreviewUrl.split('.').pop().toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes('.' + actualExtension);
    const isVideo = ['.mp4', '.webm', '.ogg'].includes('.' + actualExtension);

    if (isImage) {
        globalState.focusedMediaElement = globalState.focusImage;
        globalState.focusImage.src = `/api/thumbnail/${encodeURIComponent(globalState.originalFilePreviewUrl)}`;
        globalState.focusImage.classList.remove('hidden');
    } else if (isVideo) {
        globalState.focusedMediaElement = globalState.focusVideo;
        globalState.focusVideo.src = `/api/thumbnail/${encodeURIComponent(globalState.originalFilePreviewUrl)}`;
        globalState.focusVideo.classList.remove('hidden');
        globalState.focusVideo.load();
        globalState.focusVideo.play();
    } else {
        globalState.focusedMediaElement = null;
        globalState.noPreviewText.classList.remove('hidden');
    }

    // Update filename display to the original file's name
    if (globalState.focusFileNameDisplay && globalState.currentFocusedFile) {
        globalState.focusFileNameDisplay.textContent = basename(globalState.currentFocusedFile.name);
        globalState.focusFileNameDisplay.classList.remove('hidden');
    }

    // Reset zoom and pan for the newly displayed content
    resetZoomPan();

    // Remove active class from all gallery thumbnails
    document.querySelectorAll('.gallery-image-thumbnail').forEach(thumb => {
        thumb.classList.remove('active-gallery-image');
    });

    globalState.isViewingGalleryImage = false;
    globalState.currentGalleryImageIndex = -1; // No gallery image is currently focused
}

/**
 * Displays a gallery image in the main focus window area.
 * @param {string} rawImageUrl - The raw file path of the image to display.
 * @param {HTMLElement} [clickedThumbnail=null] - The thumbnail element that was clicked (optional).
 */
export function displayGalleryImageInFocus(rawImageUrl, clickedThumbnail = null) {
    // Explicitly hide all media elements and pause/reset videos
    globalState.focusImage.classList.add('hidden');
    globalState.focusImage.src = ''; // Clear src
    globalState.focusVideo.classList.add('hidden');
    globalState.focusVideo.pause();
    globalState.focusVideo.currentTime = 0;
    globalState.focusVideo.src = ''; // Clear src
    globalState.focusGalleryImage.classList.add('hidden');
    globalState.focusGalleryImage.src = ''; // Clear src
    globalState.focusGalleryVideo.classList.add('hidden');
    globalState.focusGalleryVideo.pause();
    globalState.focusGalleryVideo.currentTime = 0;
    globalState.focusGalleryVideo.src = ''; // Clear src
    globalState.noPreviewText.classList.add('hidden'); // Hide no preview text

    const finalSrcUrl = `/api/thumbnail/${encodeURIComponent(rawImageUrl)}`;

    // Determine media type and display
    const actualExtension = rawImageUrl.split('.').pop().toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes('.' + actualExtension);
    const isVideo = ['.mp4', '.webm', '.ogg'].includes('.' + actualExtension);

    if (isImage) {
        globalState.focusedMediaElement = globalState.focusGalleryImage;
        globalState.focusGalleryImage.src = finalSrcUrl;
        globalState.focusGalleryImage.classList.remove('hidden');
    } else if (isVideo) {
        globalState.focusedMediaElement = globalState.focusGalleryVideo;
        globalState.focusGalleryVideo.src = finalSrcUrl;
        globalState.focusGalleryVideo.classList.remove('hidden');
        globalState.focusGalleryVideo.load();
        globalState.focusGalleryVideo.play();
    } else {
        globalState.focusedMediaElement = null;
        globalState.noPreviewText.classList.remove('hidden');
    }

    // Update filename display to the gallery image's name
    if (globalState.focusFileNameDisplay) {
        globalState.focusFileNameDisplay.textContent = basename(rawImageUrl);
        globalState.focusFileNameDisplay.classList.remove('hidden');
    }

    // Reset zoom and pan for the newly displayed content
    resetZoomPan();

    // Highlight the clicked thumbnail
    document.querySelectorAll('.gallery-image-thumbnail').forEach(thumb => {
        thumb.classList.remove('active-gallery-image');
    });
    if (clickedThumbnail) {
        clickedThumbnail.classList.add('active-gallery-image');
    } else {
        // If clickedThumbnail is not provided, find it by full path
        const matchingThumbnail = document.querySelector(`.gallery-image-thumbnail[data-full-path="${CSS.escape(rawImageUrl)}"]`);
        if (matchingThumbnail) {
            matchingThumbnail.classList.add('active-gallery-image');
            matchingThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    globalState.isViewingGalleryImage = true;
    globalState.currentGalleryImageIndex = globalState.currentGalleryImages.indexOf(rawImageUrl); // Update index
}

/**
 * Resets zoom and pan for the focused media element in the focus window.
 */
export function resetZoomPan() {
    globalState.currentZoomFactor = 1;
    globalState.currentPanX = 0;
    globalState.currentPanY = 0;
    applyZoomPan();
}

/**
 * Applies the current zoom and pan values to the focused media element using CSS variables.
 */
export function applyZoomPan() {
    if (globalState.focusedMediaElement) {
        globalState.focusedMediaElement.style.setProperty('--zoom-factor', globalState.currentZoomFactor);
        globalState.focusedMediaElement.style.setProperty('--pan-x', `${globalState.currentPanX}px`);
        globalState.focusedMediaElement.style.setProperty('--pan-y', `${globalState.currentPanY}px`);
    }
}

/**
 * Handles mouse wheel events for zooming the focused media element.
 * @param {WheelEvent} event - The mouse wheel event.
 */
export function handleWheelZoom(event) {
    if (!globalState.focusedMediaElement) return;

    event.preventDefault(); // Prevent page scrolling

    const scaleAmount = event.deltaY < 0 ? 1.1 : 1 / 1.1; // Zoom in/out factor
    const oldZoomFactor = globalState.currentZoomFactor;
    let newZoomFactor = oldZoomFactor * scaleAmount;

    // Constrain zoom factor (e.g., between 1x and 5x)
    newZoomFactor = Math.max(1, Math.min(newZoomFactor, 5));

    if (newZoomFactor === oldZoomFactor) return; // No change, no need to re-calculate

    // Get mouse position relative to the *focusedMediaElement*
    const rect = globalState.focusedMediaElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate how much the mouse point moves relative to the element's top-left corner
    // after scaling, and adjust pan to counteract that movement.
    globalState.currentPanX -= (mouseX * (newZoomFactor / oldZoomFactor - 1));
    globalState.currentPanY -= (mouseY * (newZoomFactor / oldZoomFactor - 1));

    globalState.currentZoomFactor = newZoomFactor;
    applyZoomPan();
}

/**
 * Handles mouse down event for initiating pan on the focused media element.
 * @param {MouseEvent} event - The mouse down event.
 */
export function handleMouseDown(event) {
    if (globalState.focusedMediaElement && globalState.currentZoomFactor > 1) { // Only pan if zoomed in
        event.preventDefault(); // Prevent default drag behavior (e.g., image drag)
        globalState.isDragging = true;
        globalState.focusedMediaElement.classList.add('dragging'); // Add dragging cursor
        globalState.lastMouseX = event.clientX;
        globalState.lastMouseY = event.clientY;
    }
}

/**
 * Handles mouse move event for panning the focused media element.
 * @param {MouseEvent} event - The mouse move event.
 */
export function handleMouseMove(event) {
    if (globalState.isDragging && globalState.focusedMediaElement) {
        event.preventDefault(); // Prevent default selection behavior
        const dx = event.clientX - globalState.lastMouseX;
        const dy = event.clientY - globalState.lastMouseY;

        globalState.currentPanX += dx;
        globalState.currentPanY += dy;

        applyZoomPan();

        globalState.lastMouseX = event.clientX;
        globalState.lastMouseY = event.clientY;
    }
}

/**
 * Handles mouse up event for ending pan on the focused media element.
 */
export function handleMouseUp() {
    globalState.isDragging = false;
    if (globalState.focusedMediaElement) {
        globalState.focusedMediaElement.classList.remove('dragging'); // Remove dragging cursor
    }
}

/**
 * Updates the dimensions of the focus window and its content based on available space.
 * This ensures the media preview resizes correctly when the window or side panels change.
 * @param {object} file - The currently focused file object.
 */
export function updateFocusWindowDimensions(file) {
    // Recalculate available space for the focus window content
    let availableWidth = window.innerWidth - (20 * 2); // Overlay padding (left and right)
    let availableHeight = window.innerHeight - (20 * 2); // Overlay padding (top and bottom)

    console.log(`[RESIZE/OPEN] Initial available space: ${availableWidth}x${availableHeight}`);

    // Adjust for fileDetails pane if open
    if (globalState.fileDetails.classList.contains('open')) {
        const detailsWidth = globalState.fileDetails.offsetWidth;
        availableWidth -= detailsWidth;
        globalState.focusOverlay.style.right = detailsWidth + 'px'; // Shrink overlay from the right
        console.log(`[RESIZE/OPEN] After details pane: availableWidth=${availableWidth}, focusOverlay.style.right=${globalState.focusOverlay.style.right}`);
    } else {
        globalState.focusOverlay.style.right = '0'; // Reset right if details not open
    }

    // Adjust for gallery sidebar if visible (it's absolute, but we need to account for its space)
    const showGallery = file.category === 'lora' || file.category === 'checkpoint';
    if (showGallery) {
        const galleryWidth = globalState.gallerySidebar.offsetWidth;
        availableWidth -= galleryWidth;
        console.log(`[RESIZE/OPEN] After gallery sidebar: availableWidth=${availableWidth}, galleryWidth=${galleryWidth}`);
    }

    // Set width and height for focusMainContent based on calculated available space
    globalState.focusMainContent.style.width = `${availableWidth}px`; // Set width directly
    globalState.focusMainContent.style.height = `${availableHeight}px`; // Set height directly

    console.log(`[RESIZE/OPEN] Final focus main content width: ${globalState.focusMainContent.style.width}`);
    console.log(`[RESIZE/OPEN] Final focus main content height: ${globalState.focusMainContent.style.height}`);

    // Add more debug logging for computed styles
    const computedStyleMainContent = window.getComputedStyle(globalState.focusMainContent);
    console.log(`[DEBUG] focusMainContent computed width: ${computedStyleMainContent.width}, height: ${computedStyleMainContent.height}`);

    // After media is loaded and displayed, log its computed style
    if (globalState.focusedMediaElement && !globalState.focusedMediaElement.classList.contains('hidden')) {
        // Wait for image/video to load to get accurate dimensions
        if (globalState.focusedMediaElement.tagName === 'IMG') {
            globalState.focusedMediaElement.onload = () => {
                const computedStyleMedia = window.getComputedStyle(globalState.focusedMediaElement);
                console.log(`[DEBUG] focusedMediaElement (IMG) computed width: ${computedStyleMedia.width}, height: ${computedStyleMedia.height}`);
                console.log(`[DEBUG] focusedMediaElement (IMG) natural width: ${globalState.focusedMediaElement.naturalWidth}, natural height: ${globalState.focusedMediaElement.naturalHeight}`);
            };
        } else if (globalState.focusedMediaElement.tagName === 'VIDEO') {
            globalState.focusedMediaElement.onloadedmetadata = () => {
                const computedStyleMedia = window.getComputedStyle(globalState.focusedMediaElement);
                console.log(`[DEBUG] focusedMediaElement (VIDEO) computed width: ${computedStyleMedia.width}, height: ${computedStyleMedia.height}`);
                console.log(`[DEBUG] focusedMediaElement (VIDEO) natural width: ${globalState.focusedMediaElement.videoWidth}, natural height: ${globalState.focusedMediaElement.videoHeight}`);
            };
        }
    }
}

/**
 * Closes the focus window and resets its state.
 */
export function closeFocusWindow() {
    if (globalState.focusOverlay) {
        globalState.focusOverlay.style.display = 'none'; // Set display to none to hide it
    }
    if (globalState.focusVideo) {
        globalState.focusVideo.pause(); // Pause video when closing
        globalState.focusVideo.currentTime = 0; // Reset video to beginning
    }
    if (globalState.focusGalleryVideo) {
        globalState.focusGalleryVideo.pause(); // Pause gallery video when closing
        globalState.focusGalleryVideo.currentTime = 0; // Reset gallery video to beginning
    }

    if (globalState.galleryImagesContainer) {
        globalState.galleryImagesContainer.innerHTML = ''; // Clear gallery images
    }
    if (globalState.gallerySidebar) {
        globalState.gallerySidebar.classList.add('hidden'); // Hide gallery sidebar
    }
    if (globalState.focusOverlay) {
        globalState.focusOverlay.classList.remove('with-gallery'); // Remove gallery layout class
        globalState.focusOverlay.style.right = '0'; // Reset right position when closing
    }
    globalState.currentFocusedFile = null; // Clear the globally focused file

    // Reset gallery navigation state
    globalState.isViewingGalleryImage = false;
    globalState.originalFilePreviewUrl = '';
    globalState.currentGalleryImages = [];
    globalState.currentGalleryImageIndex = -1;

    // Hide filename display when closing
    if (globalState.focusFileNameDisplay) {
        globalState.focusFileNameDisplay.classList.add('hidden');
        globalState.focusFileNameDisplay.textContent = '';
    }

    // Reset zoom and pan when closing the window
    resetZoomPan();
    globalState.focusedMediaElement = null; // Clear focused media element

    console.log('Focus window closed. Current display style:', globalState.focusOverlay ? globalState.focusOverlay.style.display : 'N/A (element missing)');
    globalState.closeDetails(); // Close details panel when focus window closes
}


/**
 * Applies the current gallery thumbnail zoom level by setting a CSS custom property.
 */
export function applyGalleryZoom() {
    if (globalState.gallerySidebar) {
        // Set the CSS custom property for the active thumbnail size
        globalState.gallerySidebar.style.setProperty('--gallery-thumb-size-active', `${globalState.galleryThumbSize}px`);
        // The actual width of the sidebar and thumbnails will be controlled by CSS based on hover.
        // No need to directly set width/height here anymore, CSS will handle it.
    }
}

/**
 * Loads relevant gallery images for the selected file from the backend.
 * @param {object} file - The file object (e.g., Lora/Checkpoint) for which to load gallery images.
 */
export async function loadGalleryImages(file) {
    if (!globalState.galleryImagesContainer) return;

    globalState.galleryImagesContainer.innerHTML = ''; // Clear previous images
    globalState.galleryImagesContainer.textContent = 'Loading gallery...'; // Loading indicator

    try {
        const customKeyword = file.custom_gallery_keyword || '';
        const params = new URLSearchParams({
            filepath: file.path,
            custom_keyword: customKeyword
        });
        const response = await fetch(`/api/gallery_images?${params}`);
        const data = await response.json();

        if (data.error) {
            globalState.galleryImagesContainer.textContent = `Error: ${data.error}`;
            console.error('Error loading gallery images:', data.error);
            return;
        }

        globalState.currentGalleryImages = data.images || []; // Store the fetched images (raw paths)

        if (globalState.currentGalleryImages.length > 0) {
            renderGalleryImages(globalState.currentGalleryImages);
        } else {
            globalState.galleryImagesContainer.textContent = 'No relevant images found.';
        }

    } catch (error) {
        globalState.galleryImagesContainer.textContent = 'Failed to load gallery.';
        console.error('Network error loading gallery images:', error);
    }
}

/**
 * Renders the gallery image thumbnails in the sidebar.
 * @param {Array<string>} imagePaths - Array of full image paths to render.
 */
export function renderGalleryImages(imagePaths) {
    if (!globalState.galleryImagesContainer) return;

    globalState.galleryImagesContainer.innerHTML = ''; // Clear previous images

    imagePaths.forEach(imagePath => {
        const img = document.createElement('img');
        img.className = 'gallery-image-thumbnail';
        img.src = `/api/thumbnail/${encodeURIComponent(imagePath)}`; // Thumbnail src needs encoding
        img.alt = basename(imagePath);
        img.dataset.fullPath = imagePath; // Store raw full path for main display

        img.onerror = function() {
            this.style.display = 'none'; // Hide broken image
            console.warn(`Failed to load gallery thumbnail: ${imagePath}`);
        };

        // IMPORTANT: This click handler should update the main focus image, not close the window
        img.onclick = (e) => { // Keep inline onclick for dynamically created elements
            e.stopPropagation(); // Prevent this click from bubbling up to focusOverlay and closing it
            displayGalleryImageInFocus(imagePath, img); // Pass raw path
        };
        globalState.galleryImagesContainer.appendChild(img);
    });
}

/**
 * Reverts the focus window display from a gallery image back to the original file's preview.
 */
export function revertToOriginalView() {
    displayOriginalPreview(); // Call the function to display the original preview
}
