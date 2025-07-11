// src/sdMetadataIntegration.js

import { extractSDMetadata, formatSDMetadataForDisplay, getSDMetadataCSS } from './sdMetadataExtractor.js';

/**
 * Integration module for adding SD metadata support to fileDetailsManager
 * This module extends the existing metadata display functionality
 */

let cssInjected = false;

/**
 * Initialize SD metadata integration
 * Injects required CSS and sets up event handlers
 */
export function initializeSDMetadataIntegration() {
    if (!cssInjected) {
        injectSDMetadataCSS();
        cssInjected = true;
    }
}

/**
 * Inject CSS styles for SD metadata display
 */
function injectSDMetadataCSS() {
    const style = document.createElement('style');
    // style.textContent = getSDMetadataCSS();
    document.head.appendChild(style);
}

/**
 * Generate SD metadata HTML for a file
 * This function should be called from your existing generateMetadataDisplayHtml function
 * @param {object} file - File object from your system
 * @returns {Promise<Object>} Object with sdMetadataHtml and sdMetadataError
 */
export async function generateSDMetadataHtml(file) {
    const result = {
        sdMetadataHtml: '',
        sdMetadataError: null
    };

    // Only process image files
    if (!isImageFile(file)) {
        return result;
    }

    try {
        // Check if file exists and is accessible
        if (file.is_missing || file.is_directory) {
            return result;
        }

        // Attempt to load the image file
        const imageFile = await loadImageFile(file);
        if (!imageFile) {
            result.sdMetadataError = 'Could not load image file for metadata extraction';
            return result;
        }

        // Extract SD metadata
        const metadata = await extractSDMetadata(imageFile);

        if (metadata.error) {
            result.sdMetadataError = `SD metadata extraction error: ${metadata.error}`;
            return result;
        }

        // Generate HTML display
        result.sdMetadataHtml = formatSDMetadataForDisplay(metadata);

        // Store raw metadata for potential future use
        if (metadata.hasSDMetadata) {
            file._sdMetadata = metadata;
        }

    } catch (error) {
        console.error('SD metadata processing error:', error);
        result.sdMetadataError = `Failed to process SD metadata: ${error.message}`;
    }

    return result;
}

/**
 * Check if a file is an image that might contain SD metadata
 * @param {object} file - File object
 * @returns {boolean} True if file might have SD metadata
 */
function isImageFile(file) {
    if (!file.mime_type) return false;

    const supportedTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp'
    ];

    return supportedTypes.includes(file.mime_type.toLowerCase());
}

/**
 * Load image file for metadata extraction
 * This function needs to be adapted based on how your system accesses files
 * @param {object} file - File object
 * @returns {Promise<File|Blob|null>} Image file or null if failed
 */
async function loadImageFile(file) {
    try {
        // Method 1: If you have direct file access via URL
        // In the context of app.py, files are served via /api/thumbnail
        if (file.path) {
            // Use the /api/thumbnail endpoint to fetch the file content
            const response = await fetch(`/api/thumbnail/${encodeURIComponent(file.path)}`);
            if (response.ok) {
                return await response.blob();
            } else {
                console.error(`Failed to fetch file from /api/thumbnail/: ${response.status} ${response.statusText}`);
            }
        }

        // Method 2: If using file input or drag/drop (for reference)
        // This would be used if the user uploads files directly
        if (file instanceof File) {
            return file;
        }

        console.warn('Could not determine how to load file for SD metadata extraction:', file.name);
        return null;

    } catch (error) {
        console.error('Error loading image file:', error);
        return null;
    }
}

/**
 * Enhanced metadata display function that includes SD metadata
 * This replaces or extends your existing generateMetadataDisplayHtml function
 * @param {object} file - File object
 * @returns {Promise<Object>} Object with associatedMetadataHtml and metadataErrorHtml
 */
export async function generateEnhancedMetadataDisplayHtml(file) {
    // Initialize SD metadata integration if not already done
    initializeSDMetadataIntegration();

    let associatedMetadataHtml = '';
    let metadataErrorHtml = '';

    // Get SD metadata for image files
    if (isImageFile(file)) {
        const sdResult = await generateSDMetadataHtml(file);

        if (sdResult.sdMetadataHtml) {
            associatedMetadataHtml += `
                <div class="metadata-section">
                    <h3>Stable Diffusion Metadata</h3>
                    ${sdResult.sdMetadataHtml}
                </div>
            `;
        }

        if (sdResult.sdMetadataError) {
            metadataErrorHtml += `
                <div class="metadata-error" style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 8px; margin-bottom: 10px; border-radius: 4px;">
                    <strong>SD Metadata Warning:</strong> ${sdResult.sdMetadataError}
                </div>
            `;
        }
    }

    // Add other metadata sections here if needed
    // For example, EXIF data, file properties, etc.

    return {
        associatedMetadataHtml,
        metadataErrorHtml
    };
}

/**
 * Utility function to copy SD parameters to clipboard
 * @param {object} file - File object with SD metadata
 * @param {string} section - Which section to copy ('prompt', 'negative', 'parameters', 'all')
 */
export function copySDMetadataToClipboard(file, section = 'all') {
    if (!file._sdMetadata || !file._sdMetadata.hasSDMetadata) {
        console.warn('No SD metadata available for this file');
        return false;
    }

    const params = file._sdMetadata.parsedParameters;
    let textToCopy = '';

    switch(section) {
        case 'prompt':
            textToCopy = params.prompt || '';
            break;
        case 'negative':
            textToCopy = params.negativePrompt || '';
            break;
        case 'parameters':
            textToCopy = formatParametersAsText(params);
            break;
        case 'all':
        default:
            textToCopy = formatAllParametersAsText(params);
            break;
    }

    if (textToCopy) {
        // Using document.execCommand('copy') as navigator.clipboard.writeText() might not work in some iframe environments.
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed'; // Prevent scrolling to bottom of page in MS Edge.
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
            console.log('SD metadata copied to clipboard');
            showToast?.('Copied to clipboard');
            return true;
        } catch (err) {
            console.error('Failed to copy to clipboard using execCommand:', err);
            // Fallback for browsers that might not support execCommand or when it fails
            // Consider showing a message to the user that copying failed, or suggest manual copy
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    return false;
}

/**
 * Format parameters as text string (similar to A1111 format)
 * @param {object} params - Parsed parameters
 * @returns {string} Formatted parameter string
 */
function formatParametersAsText(params) {
    const parts = [];

    if (params.steps) parts.push(`Steps: ${params.steps}`);
    if (params.sampler) parts.push(`Sampler: ${params.sampler}`);
    if (params.cfgScale) parts.push(`CFG scale: ${params.cfgScale}`);
    if (params.seed) parts.push(`Seed: ${params.seed}`);
    if (params.size.width && params.size.height) parts.push(`Size: ${params.size.width}x${params.size.height}`);
    if (params.model) parts.push(`Model: ${params.model}`);
    if (params.modelHash) parts.push(`Model hash: ${params.modelHash}`);
    if (params.clipSkip) parts.push(`Clip skip: ${params.clipSkip}`);
    if (params.denoisingStrength) parts.push(`Denoising strength: ${params.denoisingStrength}`);
    if (params.version) parts.push(`Version: ${params.version}`);

    // Add other parameters
    if (params.other) {
        for (const [key, value] of Object.entries(params.other)) {
            if (key !== 'parseError') {
                parts.push(`${key}: ${value}`);
            }
        }
    }

    return parts.join(', ');
}

/**
 * Format all parameters as complete text (prompt + negative + parameters)
 * @param {object} params - Parsed parameters
 * @returns {string} Complete formatted string
 */
function formatAllParametersAsText(params) {
    let text = '';

    if (params.prompt) {
        text += params.prompt + '\n';
    }

    if (params.negativePrompt) {
        text += `Negative prompt: ${params.negativePrompt}\n`;
    }

    const paramText = formatParametersAsText(params);
    if (paramText) {
        text += paramText;
    }

    return text.trim();
}

/**
 * Add copy buttons to SD metadata display
 * Call this after the metadata HTML has been inserted into the DOM
 * @param {HTMLElement} container - Container element with SD metadata
 */
export function addSDMetadataCopyButtons(container, file) {
    if (!file._sdMetadata || !file._sdMetadata.hasSDMetadata) return;

    // Add copy buttons to prompt sections
    const promptSection = container.querySelector('.sd-prompt');
    if (promptSection) {
        addCopyButton(promptSection, () => copySDMetadataToClipboard(file, 'prompt'), 'Copy Prompt');
    }

    const negativeSection = container.querySelector('.sd-negative-prompt');
    if (negativeSection) {
        addCopyButton(negativeSection, () => copySDMetadataToClipboard(file, 'negative'), 'Copy Negative Prompt');
    }

    const paramsSection = container.querySelector('.sd-params');
    if (paramsSection) {
        addCopyButton(paramsSection, () => copySDMetadataToClipboard(file, 'parameters'), 'Copy Parameters');
    }

    // Add a "Copy All" button to the metadata display
    const sdDisplay = container.querySelector('.sd-metadata-display');
    if (sdDisplay) {
        const copyAllBtn = document.createElement('button');
        copyAllBtn.textContent = 'Copy All SD Data';
        copyAllBtn.className = 'sd-copy-all-btn';
        copyAllBtn.style.cssText = `
            margin-top: 10px;
            padding: 6px 12px;
            background: #0078d4;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;
        copyAllBtn.onclick = () => copySDMetadataToClipboard(file, 'all');
        sdDisplay.appendChild(copyAllBtn);
    }
}

/**
 * Add a copy button to an element
 * @param {HTMLElement} element - Element to add button to
 * @param {Function} copyFunction - Function to call when button is clicked
 * @param {string} tooltip - Tooltip text
 */
function addCopyButton(element, copyFunction, tooltip) {
    const copyBtn = document.createElement('button');
    copyBtn.innerHTML = '📋';
    copyBtn.title = tooltip;
    copyBtn.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(255,255,255,0.8);
        border: 1px solid #ddd;
        border-radius: 3px;
        width: 24px;
        height: 24px;
        cursor: pointer;
        font-size: 12px;
        display: none;
    `;

    // Make parent relative for absolute positioning
    element.style.position = 'relative';

    // Show/hide button on hover
    element.addEventListener('mouseenter', () => copyBtn.style.display = 'block');
    element.addEventListener('mouseleave', () => copyBtn.style.display = 'none');

    copyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyFunction();
    };

    element.appendChild(copyBtn);
}

/**
 * Simple toast notification function
 * @param {string} message - Message to show
 */
function showToast(message) {
    // Create or update existing toast
    let toast = document.getElementById('sd-metadata-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sd-metadata-toast';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 10px 16px;
            border-radius: 4px;
            z-index: 10000;
            font-size: 14px;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 2000);
}
