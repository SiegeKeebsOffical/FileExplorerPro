// src/zoomManager.js

/**
 * Initializes the zoom functionality by setting up the slider and displaying the initial zoom percentage.
 * @param {object} globalState - The global state bundle.
 */
export function initializeZoomManager(globalState) {
    // Ensure zoomSlider and zoomPercentSpan are available in the globalStateBundle
    globalState.zoomSlider = globalState.zoomSlider || document.getElementById('zoomSlider');
    globalState.zoomPercentSpan = globalState.zoomPercentSpan || document.getElementById('zoomPercent');

    // Set initial slider value and update display
    if (globalState.zoomSlider) {
        // Ensure the slider value is within its defined min/max
        const min = parseFloat(globalState.zoomSlider.min);
        const max = parseFloat(globalState.zoomSlider.max);
        globalState.zoomLevel = Math.max(min, Math.min(max, globalState.zoomLevel));

        globalState.zoomSlider.value = globalState.zoomLevel;
        updateZoomDisplay(globalState);
        globalState.zoomSlider.addEventListener('input', () => {
            globalState.zoomLevel = parseFloat(globalState.zoomSlider.value);
            localStorage.setItem('zoomLevel', globalState.zoomLevel);
            updateZoomDisplay(globalState);
            applyZoomToGrid(globalState);
        });
    }
}

/**
 * Increases the zoom level.
 * @param {object} globalState - The global state bundle.
 */
export function zoomIn(globalState) {
    if (globalState.zoomSlider) {
        const currentSliderValue = parseFloat(globalState.zoomSlider.value);
        const newSliderValue = Math.min(parseFloat(globalState.zoomSlider.max), currentSliderValue + globalState.ZOOM_STEP);
        globalState.zoomSlider.value = newSliderValue;
        globalState.zoomLevel = newSliderValue;
        localStorage.setItem('zoomLevel', globalState.zoomLevel);
        updateZoomDisplay(globalState);
        applyZoomToGrid(globalState);
    }
}

/**
 * Decreases the zoom level.
 * @param {object} globalState - The global state bundle.
 */
export function zoomOut(globalState) {
    if (globalState.zoomSlider) {
        const currentSliderValue = parseFloat(globalState.zoomSlider.value);
        const newSliderValue = Math.max(parseFloat(globalState.zoomSlider.min), currentSliderValue - globalState.ZOOM_STEP);
        globalState.zoomSlider.value = newSliderValue;
        globalState.zoomLevel = newSliderValue;
        localStorage.setItem('zoomLevel', globalState.zoomLevel);
        updateZoomDisplay(globalState);
        applyZoomToGrid(globalState);
    }
}

/**
 * Updates the displayed zoom percentage in the UI.
 * @param {object} globalState - The global state bundle.
 */
function updateZoomDisplay(globalState) {
    if (globalState.zoomPercentSpan) {
        globalState.zoomPercentSpan.textContent = `${globalState.zoomLevel}%`;
    }
}

/**
 * Calculates the CSS zoom factor based on the displayed percentage from the slider.
 * This uses a piecewise linear function to map:
 * - New 10% (slider 10) -> Old 100% (CSS factor 1.0)
 * - New 100% (slider 100) -> Old 500% (CSS factor 5.0)
 * - New 500% (slider 500) -> Old 1000% (CSS factor 10.0)
 * @param {number} displayedPercentage - The percentage value from the zoom slider (10-500).
 * @returns {number} The actual CSS scaling factor to apply.
 */
function calculateCssZoomFactor(displayedPercentage) {
    let cssFactor;
    if (displayedPercentage <= 100) {
        // Segment 1: From (10, 1) to (100, 5)
        // Slope m = (5 - 1) / (100 - 10) = 4 / 90 = 2/45
        // Equation: F - F1 = m * (S - S1) => F = F1 + m * (S - S1)
        cssFactor = 1 + (2 / 45) * (displayedPercentage - 10);
    } else {
        // Segment 2: From (100, 5) to (500, 10)
        // Slope m = (10 - 5) / (500 - 100) = 5 / 400 = 1/80
        // Equation: F - F1 = m * (S - S1) => F = F1 + m * (S - S1)
        cssFactor = 5 + (1 / 80) * (displayedPercentage - 100);
    }
    // Ensure the factor is not less than 0.1 (or some sensible minimum)
    return Math.max(0.1, cssFactor);
}

/**
 * Applies the calculated zoom factor to the file grid CSS variable.
 * @param {object} globalState - The global state bundle.
 */
export function applyZoomToGrid(globalState) {
    const fileGrid = document.getElementById('fileGrid');
    if (fileGrid) {
        const cssZoomFactor = calculateCssZoomFactor(globalState.zoomLevel);
        fileGrid.style.setProperty('--zoom-level', cssZoomFactor);
    }
}

/**
 * Sets up the initial zoom state and applies it to the grid.
 * This function is called during application initialization.
 * @param {object} globalState - The global state bundle.
 */
export function setupZoom(globalState) {
    initializeZoomManager(globalState);
    applyZoomToGrid(globalState); // Apply initial zoom on setup
}
