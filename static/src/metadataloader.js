// metadataLoader.js

/**
 * Generates HTML content for displaying file metadata and any associated errors.
 * This function assumes the 'file' object passed in already contains 'associated_metadata_path'
 * and 'metadata_error' properties.
 *
 * @param {object} file - The file object containing metadata information.
 * @returns {object} An object with two properties:
 * - {string} associatedMetadataHtml: HTML string for the associated metadata section.
 * - {string} metadataErrorHtml: HTML string for any metadata error message.
 */
export function generateMetadataDisplayHtml(file) {
    let associatedMetadataHtml = '';
    let metadataErrorHtml = '';

    // Check if a metadata_error exists
    if (file.metadata_error) {
        metadataErrorHtml = `
            <p class="metadata-error"><strong>Metadata Error:</strong> ${file.metadata_error}</p>
        `;
    }

    // Check if there's an associated metadata path (e.g., a .json file)
    if (file.associated_metadata_path) {
        associatedMetadataHtml = `
            <div class="metadata-section">
                <h3>Associated Metadata (from ${basename(file.associated_metadata_path)})</h3>
                <div id="associatedMetadataContent" class="json-display">
                    Loading associated metadata...
                </div>
            </div>
        `;
    } else if (file.associated_metadata && Object.keys(file.associated_metadata).length > 0) {
        // Fallback for cases where associated_metadata might be directly embedded (e.g., from old structure)
        associatedMetadataHtml = `
            <div class="metadata-section">
                <h3>Associated Metadata (from file)</h3>
                <pre class="json-display">${JSON.stringify(file.associated_metadata, null, 2)}</pre>
            </div>
        `;
    }

    return { associatedMetadataHtml, metadataErrorHtml };
}

/**
 * Fetches and displays associated JSON metadata for a given file path.
 * This function should be called after the HTML structure for displaying
 * associated metadata is already in the DOM (e.g., after showFileDetails).
 *
 * @param {string} filepath - The path to the associated JSON file.
 * @param {HTMLElement} containerElement - The DOM element where the JSON content should be displayed.
 * @param {function} updateStatusBar - Callback to update the status bar.
 */
export async function fetchAndDisplayAssociatedMetadata(filepath, containerElement, updateStatusBar) {
    if (!filepath || !containerElement) {
        console.error("Missing filepath or container element for associated metadata display.");
        return;
    }

    containerElement.innerHTML = 'Loading associated metadata...'; // Show loading state
    updateStatusBar('Loading associated metadata...');

    try {
        const response = await fetch(`/api/associated_metadata?filepath=${encodeURIComponent(filepath)}`);
        const result = await response.json();

        if (result.success && result.metadata) {
            containerElement.innerHTML = `<pre class="json-display">${JSON.stringify(result.metadata, null, 2)}</pre>`;
            updateStatusBar('Associated metadata loaded.');
        } else {
            containerElement.innerHTML = `<p class="metadata-error">Failed to load associated metadata: ${result.error || 'Unknown error'}</p>`;
            updateStatusBar('Error loading associated metadata.');
            console.error('Error loading associated metadata:', result.error);
        }
    } catch (error) {
        containerElement.innerHTML = `<p class="metadata-error">Network error loading associated metadata.</p>`;
        updateStatusBar('Network error loading associated metadata.');
        console.error('Network error loading associated metadata:', error);
    } finally {
        setTimeout(() => updateStatusBar('Ready'), 2000);
    }
}

// Utility function (can be moved to utils.js if not already there)
function basename(path) {
    return path.split(/[\\/]/).pop();
}
