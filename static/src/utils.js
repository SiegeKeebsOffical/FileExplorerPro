// src/utils.js

/**
 * Normalizes a file path by replacing backslashes with forward slashes.
 * @param {string} path - The path to normalize.
 * @returns {string} The normalized path.
 */
export function normalizePath(path) {
    return path.replace(/\\/g, '/');
}

/**
 * Helper function to get the last part of a path (e.g., filename or folder name).
 * @param {string} path - The full path.
 * @returns {string} The last part of the path.
 */
export function getLastPathPart(path) {
    path = normalizePath(path);
    const parts = path.split('/').filter(part => part);
    return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * Helper to simulate Python's os.path.basename.
 * @param {string} path - The full path.
 * @returns {string} The base name of the path.
 */
export function basename(path) {
    return path.split(/[\\/]/).filter(p => p).pop() || path;
}

/**
 * Displays a custom confirmation dialog.
 * This function will be attached to the window object in script.js for global access by dynamic HTML.
 * @param {string} message - The message to display in the confirmation dialog.
 * @param {Function} onConfirm - Callback function to execute if the user confirms.
 */
export function showCustomConfirm(message, onConfirm) {
    const modalHtml = `
        <div id="customConfirmModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Confirm Action</h2>
                    <button class="close-modal" id="closeCustomConfirmModalBtn">×</button>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                </div>
                <div class="modal-footer">
                    <button id="confirmYesButton">Yes</button>
                    <button id="confirmNoButton">No</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Attach listeners for the custom confirm modal buttons
    document.getElementById('confirmYesButton').addEventListener('click', () => {
        onConfirm();
        document.getElementById('customConfirmModal').remove();
    });
    document.getElementById('confirmNoButton').addEventListener('click', () => {
        document.getElementById('customConfirmModal').remove();
    });
    document.getElementById('closeCustomConfirmModalBtn').addEventListener('click', () => {
        document.getElementById('customConfirmModal').remove();
    });
}
