from flask import Flask, render_template, jsonify, request, send_file
import os
import json
import mimetypes
from datetime import datetime
from pathlib import Path
import sqlite3
from werkzeug.utils import safe_join
import configparser
import sys
import hashlib
import subprocess # Import subprocess for opening file location

# Import functions from your workflow_analysis.py script
try:
    from workflow_analysis import analyze_comfyui_workflow, load_comfyui_workflow
except ImportError as e:
    print(f"Error importing workflow_analysis.py: {e}")
    print("Please ensure workflow_analysis.py is in the same directory as app.py or in PYTHONPATH.")


    def analyze_comfyui_workflow(filepath):
        print("Warning: analyze_comfyui_workflow is not available.")
        return {"error": "workflow_analysis.py not loaded"}


    def load_comfyui_workflow(filepath):
        print("Warning: load_comfyui_workflow is not available.")
        return None

# Import functions from your new extraction scripts
try:
    from extract_webp_json import extract_json_from_webp
except ImportError as e:
    print(f"Error importing extract_webp_json.py: {e}")


    def extract_json_from_webp(filepath, output_file=None):
        print(f"Warning: extract_json_from_webp is not available. Error: {e}")
        return False

try:
    from extract_comfyui_workflow import extract_workflow_from_png_pypng
except ImportError as e:
    print(f"Error importing extract_comfyui_workflow.py: {e}")


    def extract_workflow_from_png_pypng(filepath):
        print(f"Warning: extract_workflow_from_png_pypng is not available. Error: {e}")
        return None, "Extraction script not found."


# --- Resource Path Resolution for PyInstaller (for bundled files like index.html) ---
def resource_path(relative_path):
    """
    Get absolute path to resource, works for dev and for PyInstaller.
    This is for *reading* files bundled with the executable.
    """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


# --- Persistent Data Path Resolution (for writable config/db files) ---
def get_persistent_dir():
    """
    Get a persistent directory for application data that is next to the executable.
    This is where config files and databases should be stored.
    """
    if hasattr(sys, '_MEIPASS'):
        # When running as a PyInstaller onefile executable, sys.executable is the .exe itself
        # We want the directory containing the .exe
        return os.path.dirname(sys.executable)
    else:
        # When running from source, use the current working directory
        return os.path.abspath(".")


# Define the base directory for all persistent app data (config, db, cache)
APP_DATA_BASE_DIR = os.path.join(get_persistent_dir(), 'cache')
os.makedirs(APP_DATA_BASE_DIR, exist_ok=True)  # Ensure this directory exists

# Config file path (now points to a persistent location within 'cache' folder)
CONFIG_FILE = os.path.join(APP_DATA_BASE_DIR, 'filebrowser_config.ini')
print(f"Config file location: {os.path.abspath(CONFIG_FILE)}")

# Database file path (now points to a persistent location within 'cache' folder)
DATABASE = os.path.join(APP_DATA_BASE_DIR, 'file_metadata.db')
print(f"Database file location: {os.path.abspath(DATABASE)}")

app = Flask(__name__, template_folder=resource_path('templates'))


# Helper to normalize paths for database consistency
def normalize_db_filepath(filepath):
    """
    Normalizes a filepath for consistent database storage and retrieval.
    Uses os.path.normpath to handle / and \ consistently and resolve . and ..
    Uses os.path.normcase for case-insensitive comparison on case-insensitive filesystems (like Windows).
    """
    return os.path.normcase(os.path.normpath(filepath))


# --- New: Hashing function for file content and filename ---
def calculate_quick_hash(filepath, block_size=8192):  # Hash first 8KB
    """
    Calculates MD5 hash of the first `block_size` bytes of a file,
    and includes the filename in the hash.
    Designed for quick identification, not full integrity.
    Returns None if file is inaccessible or doesn't exist.
    """
    if not os.path.exists(filepath) or os.path.isdir(filepath):
        return None

    normalized_filepath = normalize_db_filepath(filepath)
    filename = os.path.basename(normalized_filepath)

    hasher = hashlib.md5()
    try:
        with open(normalized_filepath, 'rb') as f:
            chunk = f.read(block_size)
            if not chunk:  # Handle empty files
                # For empty files, hash only the filename
                hasher.update(filename.encode('utf-8'))
                return hasher.hexdigest()

            hasher.update(chunk)
            # Include the filename in the hash after the file content
            hasher.update(filename.encode('utf-8'))
        return hasher.hexdigest()
    except Exception as e:
        print(f"Error calculating hash for {filepath}: {e}")
        return None


# Initialize the database and ensure table exists immediately after Flask app creation
def init_db():
    """Initialize SQLite database for file metadata and rating configurations"""
    conn = None
    try:
        # Ensure the directory for the database exists
        os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
        conn = sqlite3.connect(DATABASE)  # Use the resolved DATABASE path
        conn.row_factory = sqlite3.Row  # This allows access to columns by name
        cursor = conn.cursor()

        # Create file_metadata table if it doesn't exist with all desired columns.
        # This is the definitive schema. Migrations below will ensure older DBs match this.
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS file_metadata
                       (
                           filepath
                           TEXT
                           PRIMARY
                           KEY,
                           tags
                           TEXT,
                           ratings
                           TEXT, -- This is the desired column for JSON ratings
                           notes
                           TEXT,
                           category
                           TEXT,
                           is_category_manual
                           INTEGER
                           DEFAULT
                           0,
                           custom_gallery_keyword
                           TEXT,
                           is_hidden
                           INTEGER
                           DEFAULT
                           0,
                           file_hash
                           TEXT,
                           last_modified
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           workflow_metadata
                           TEXT  -- New column for workflow data
                       )
                       ''')
        conn.commit()

        # --- Migration Logic: Add missing columns if they and their default values don't exist ---
        cursor.execute("PRAGMA table_info(file_metadata)")
        columns = [col[1] for col in cursor.fetchall()]

        # Check and add 'ratings' column (migration from 'rating' if exists)
        if 'ratings' not in columns:
            print("Migrating: Adding 'ratings' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN ratings TEXT")
            # If an old 'rating' column exists, migrate its data
            if 'rating' in columns:
                print("Migrating: Copying data from old 'rating' column to 'ratings'...")
                cursor.execute(
                    "UPDATE file_metadata SET ratings = json_object('overall', rating) WHERE rating IS NOT NULL")
            conn.commit()

        # Drop old 'rating' column if 'ratings' exists and 'rating' still lingers
        if 'rating' in columns and 'ratings' in columns:
            try:
                print("Migrating: Attempting to drop old 'rating' column...")
                cursor.execute("ALTER TABLE file_metadata DROP COLUMN rating")
                conn.commit()
            except sqlite3.Error as e:
                print(
                    f"Warning: Could not drop old 'rating' column (might be due to SQLite version/schema constraints): {e}")

        # Add 'is_category_manual' column
        if 'is_category_manual' not in columns:
            print("Migrating: Adding 'is_category_manual' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN is_category_manual INTEGER DEFAULT 0")
            conn.commit()

        # Add 'custom_gallery_keyword' column
        if 'custom_gallery_keyword' not in columns:
            print("Migrating: Adding 'custom_gallery_keyword' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN custom_gallery_keyword TEXT")
            conn.commit()

        # Add 'is_hidden' column
        if 'is_hidden' not in columns:
            print("Migrating: Adding 'is_hidden' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN is_hidden INTEGER DEFAULT 0")
            conn.commit()

        # Add 'file_hash' column
        if 'file_hash' not in columns:
            print("Migrating: Adding 'file_hash' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN file_hash TEXT")
            conn.commit()

        # Add 'last_modified' column if it's missing (important for INSERT OR REPLACE)
        if 'last_modified' not in columns:
            print("Migrating: Adding 'last_modified' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
            conn.commit()

        # Add 'workflow_metadata' column if it's missing
        if 'workflow_metadata' not in columns:
            print("Migrating: Adding 'workflow_metadata' column to file_metadata table...")
            cursor.execute("ALTER TABLE file_metadata ADD COLUMN workflow_metadata TEXT")
            conn.commit()

        # Table for defining available rating categories (e.g., "overall", "quality")
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS rating_definitions
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           name
                           TEXT
                           UNIQUE
                           NOT
                           NULL
                       )
                       ''')

        # Table for mapping file categories to rating categories
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS category_rating_mapping
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           file_category
                           TEXT
                           NOT
                           NULL,
                           rating_category
                           TEXT
                           NOT
                           NULL,
                           UNIQUE
                       (
                           file_category,
                           rating_category
                       )
                           )
                       ''')

        # Insert default rating categories if they don't exist
        default_rating_definitions = ['overall', 'quality']
        for definition in default_rating_definitions:
            cursor.execute("INSERT OR IGNORE INTO rating_definitions (name) VALUES (?)", (definition,))

        # Insert default mappings if they don't exist (e.g., 'work' category uses 'overall' and 'quality')
        default_mappings = [
            ('work', 'overall'),
            ('personal', 'overall'),
            ('media', 'overall')
        ]
        for file_cat, rating_cat in default_mappings:
            cursor.execute(
                "INSERT OR IGNORE INTO category_rating_mapping (file_category, rating_category) VALUES (?, ?)",
                (file_cat, rating_cat))

        # Add new table for directory tree cache
        cursor.execute('''
                       CREATE TABLE IF NOT EXISTS directory_tree_cache
                       (
                           path
                           TEXT,
                           max_depth
                           INTEGER,
                           tree_json
                           TEXT,
                           last_cached
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           PRIMARY
                           KEY
                       (
                           path,
                           max_depth
                       )
                           )
                       ''')
        conn.commit()
        print("Database initialized or updated successfully.")
    except sqlite3.Error as e:
        print(f"Database error during initialization: {e}")
    finally:
        if conn:
            conn.close()


# Call init_db immediately after Flask app creation
init_db()


def get_db_connection(autocommit=False):
    """Establishes a connection to the SQLite database."""
    # FIX: Corrected typo from 'sqliteite3' to 'sqlite3'
    conn = sqlite3.connect(DATABASE)  # Use the resolved DATABASE path
    conn.row_factory = sqlite3.Row  # This allows access to columns by name
    if autocommit:
        conn.isolation_level = None  # Set to autocommit mode
    return conn


def get_default_start_path():
    """Get the default start path from config or return user home"""
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
        if 'DEFAULT' in config and 'start_path' in config[
            'DEFAULT']:  # Check if 'DEFAULT' section and 'start_path' key exist
            path = config['DEFAULT']['start_path']
            if os.path.exists(path):
                return path
    return os.path.expanduser('~')


def save_default_start_path(path):
    """Save the default start path to config (used for settings)"""
    config = configparser.ConfigParser()
    # Read existing config to preserve other settings
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
    if 'DEFAULT' not in config:
        config['DEFAULT'] = {}
    config['DEFAULT']['start_path'] = path
    with open(CONFIG_FILE, 'w') as configfile:
        config.write(configfile)


def save_current_path_to_config(path):
    """Save the last browsed path to config"""
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
    if 'DEFAULT' not in config:
        config['DEFAULT'] = {}
    config['DEFAULT']['current_path'] = path
    with open(CONFIG_FILE, 'w') as configfile:
        config.write(configfile)


def get_current_path():
    """Get the last browsed path from config"""
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
        if 'DEFAULT' in config and 'current_path' in config['DEFAULT']:
            path = config['DEFAULT']['current_path']
            if os.path.exists(path):
                return path
    return get_default_start_path()


def get_image_directory():
    """Get the image directory from config or return None"""
    config = configparser.ConfigParser()
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
        if 'DEFAULT' in config and 'image_directory' in config['DEFAULT']:
            path = config['DEFAULT']['image_directory']
            if os.path.exists(path):
                return path
    return None


def save_image_directory(path):
    """Save the image directory to config"""
    config = configparser.ConfigParser()
    # Read existing config to preserve other settings
    if os.path.exists(CONFIG_FILE):
        config.read(CONFIG_FILE)
    if 'DEFAULT' not in config:
        config['DEFAULT'] = {}
    config['DEFAULT']['image_directory'] = path
    with open(CONFIG_FILE, 'w') as configfile:
        config.write(configfile)


# Add a new API endpoint for settings
@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'POST':
        data = request.json
        start_path = data.get('start_path')
        image_directory = data.get('image_directory')

        # Only save if path is provided and exists
        if start_path and os.path.exists(start_path):
            save_default_start_path(start_path)
        if image_directory and os.path.exists(image_directory):
            save_image_directory(image_directory)

        # Return success even if only one path was valid, or if no paths were provided
        return jsonify({'success': True})
    else:
        return jsonify({
            'start_path': get_default_start_path(),
            'image_directory': get_image_directory()
        })


# Helper functions for directory tree cache
def _get_cached_tree(path, max_depth):
    conn = None
    try:
        conn = get_db_connection()  # Use the helper function
        cursor = conn.cursor()
        cursor.execute("SELECT tree_json FROM directory_tree_cache WHERE path = ? AND max_depth = ?", (path, max_depth))
        result = cursor.fetchone()
        if result:
            print(f"Cache hit for path: {path}, depth: {max_depth}")
            return json.loads(result[0])  # Deserialize JSON string back to Python object
    except sqlite3.Error as e:
        print(f"Error retrieving cached tree: {e}")
    except json.JSONDecodeError as e:
        print(f"Error decoding cached tree JSON for path {path}, depth {max_depth}: {e}")
    finally:
        if conn:
            conn.close()
    return None


def _save_cached_tree(path, max_depth, tree_data):
    conn = None
    try:
        conn = get_db_connection()  # Use the helper function
        cursor = conn.cursor()
        tree_json = json.dumps(tree_data)  # Serialize Python object to JSON string
        cursor.execute('''
            INSERT OR REPLACE INTO directory_tree_cache
            (path, max_depth, tree_json, last_cached)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ''', (path, max_depth, tree_json))
        conn.commit()
        print(f"Cache saved for path: {path}, depth: {max_depth}")
    except sqlite3.Error as e:
        print(f"Error saving cached tree: {e}")
    finally:
        if conn:
            conn.close()


def extract_comfyui_workflow_from_image(image_path):
    """
    Extracts ComfyUI workflow JSON from a PNG or WebP image's metadata
    using the provided helper scripts.
    """
    if not os.path.exists(image_path) or not os.path.isfile(image_path):
        return None, "Image file not found."

    file_extension = os.path.splitext(image_path)[1].lower()
    workflow_data = None
    error_message = None

    if file_extension == '.webp':
        # The extract_json_from_webp script saves to a file.
        # We need to temporarily save it and then load it.
        # A better long-term solution would be to modify the script to return the JSON directly.
        temp_json_path = f"{os.path.splitext(image_path)[0]}_temp.json"

        # Call the script's function, which saves the JSON to temp_json_path
        success = extract_json_from_webp(image_path, temp_json_path)

        if success and os.path.exists(temp_json_path):
            try:
                with open(temp_json_path, 'r', encoding='utf-8') as f:
                    workflow_data = json.load(f)
            except json.JSONDecodeError:
                error_message = "Extracted WebP workflow was not valid JSON."
            except Exception as e:
                error_message = f"Error reading extracted WebP JSON: {e}"
            finally:
                os.remove(temp_json_path)  # Clean up the temporary JSON file
        else:
            error_message = "Failed to extract workflow from WebP image or no workflow found."

    elif file_extension == '.png':
        try:
            # extract_workflow_from_png_pypng returns (workflow_json, workflow_text)
            workflow_data, _ = extract_workflow_from_png_pypng(image_path)
            if not workflow_data:
                error_message = "No workflow found in PNG image using PyPNG method."
        except Exception as e:
            error_message = f"Error extracting workflow from PNG image: {e}"

    else:
        error_message = "Unsupported image format for workflow extraction. Only PNG and WebP are supported for embedded workflow extraction."

    return workflow_data, error_message


@app.route('/api/image_workflow_metadata', methods=['GET'])
def get_image_workflow_metadata():
    """
    API endpoint to extract and analyze ComfyUI workflow metadata from an image
    or an adjacent .json file.
    """
    image_filepath = request.args.get('filepath')
    if not image_filepath or not os.path.exists(image_filepath):
        return jsonify({'error': 'File not found or path not provided.'}), 404

    # Normalize filepath for database operations
    normalized_filepath = normalize_db_filepath(image_filepath)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # First, check if workflow_metadata already exists in the database
        cursor.execute('SELECT workflow_metadata FROM file_metadata WHERE filepath = ?', (normalized_filepath,))
        db_workflow_metadata_json = cursor.fetchone()

        if db_workflow_metadata_json and db_workflow_metadata_json['workflow_metadata']:
            try:
                analyzed_inputs = json.loads(db_workflow_metadata_json['workflow_metadata'])
                return jsonify({'success': True, 'workflow_metadata': analyzed_inputs})
            except json.JSONDecodeError:
                print(f"Warning: Stored workflow metadata for {image_filepath} is malformed. Re-extracting.")
                # Proceed to re-extract if malformed
                pass  # continue to extraction logic below

        # If not in DB or malformed, extract and analyze
        workflow_data, error_message = extract_comfyui_workflow_from_image(image_filepath)

        # If not found in image, check for an adjacent .json file (e.g., 'image.json')
        if not workflow_data:
            base_name, _ = os.path.splitext(image_filepath)
            json_filepath = f"{base_name}.json"
            if os.path.exists(json_filepath):
                print(f"Found adjacent JSON file: {json_filepath}")
                workflow_data = load_comfyui_workflow(json_filepath)  # Use your load_comfyui_workflow
                if not workflow_data:
                    error_message = f"Could not load or parse workflow from {json_filepath}."
            else:
                print(f"No adjacent JSON file found for {image_filepath}")

        if workflow_data:
            try:
                analyzed_inputs = analyze_comfyui_workflow(workflow_data)  # Pass the dictionary directly

                # Save extracted and analyzed workflow metadata to DB for caching
                if analyzed_inputs:
                    try:
                        cursor.execute('''
                                       UPDATE file_metadata
                                       SET workflow_metadata = ?
                                       WHERE filepath = ?
                                       ''', (json.dumps(analyzed_inputs), normalized_filepath))
                        conn.commit()
                        print(f"Successfully cached workflow metadata for {image_filepath}.")
                    except sqlite3.Error as e:
                        print(f"Error saving workflow metadata to DB for {image_filepath}: {e}")
                    except Exception as e:
                        print(f"Unexpected error during DB save for {image_filepath}: {e}")

                return jsonify({'success': True, 'workflow_metadata': analyzed_inputs})
            except Exception as e:
                return jsonify({'success': False, 'error': f"Error analyzing workflow: {e}"}), 500
        else:
            return jsonify({'success': False, 'error': error_message or "No workflow data found."}), 404
    except Exception as e:
        print(f"Error in get_image_workflow_metadata: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/associated_metadata', methods=['GET'])
def get_associated_metadata():
    """
    API endpoint to fetch the content of an associated JSON metadata file.
    """
    filepath = request.args.get('filepath')
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'File not found or path not provided.'}), 404

    if not filepath.lower().endswith('.json'):
        return jsonify({'error': 'Provided file is not a JSON file.'}), 400

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            metadata_content = json.load(f)
        return jsonify({'success': True, 'metadata': metadata_content})
    except json.JSONDecodeError as e:
        return jsonify({'success': False, 'error': f"Error parsing JSON file: {e}"}), 500
    except IOError as e:
        return jsonify({'success': False, 'error': f"Error reading file: {e}"}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': f"An unexpected error occurred: {e}"}), 500


def _get_file_system_info(filepath):
    """
    Get detailed file system information for a given filepath.
    This function does NOT interact with the database.

    Args:
        filepath (str): The path to the file on disk.

    Returns:
        dict: A dictionary containing the file's information from the file system.
    """
    filepath = os.path.normcase(os.path.normpath(filepath))

    file_info = {
        'name': os.path.basename(filepath),
        'path': filepath,
        'size': 0,
        'modified': datetime.min.isoformat(),
        'created': datetime.min.isoformat(),
        'is_directory': False,
        'extension': os.path.splitext(filepath)[1].lower(),
        'mime_type': mimetypes.guess_type(filepath)[0] or 'unknown',
        'is_missing': False,
        'metadata_error': None,
        'file_hash': None,
    }

    try:
        stat = os.stat(filepath)
        file_info.update({
            'size': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'created': datetime.fromtimestamp(stat.st_ctime).isoformat(),
            'is_directory': os.path.isdir(filepath),
        })
        # Calculate hash only if it's a file and exists
        if not file_info['is_directory']:
            file_info['file_hash'] = calculate_quick_hash(filepath)
    except (OSError, PermissionError) as e:
        file_info['is_missing'] = True
        file_info['metadata_error'] = f"File system error: {e}"

    return file_info


@app.route('/')
def index():
    """Main page"""
    # render_template will automatically look in the `template_folder` set during Flask app creation
    return render_template('index.html')


@app.route('/api/save_current_path', methods=['POST'])
def api_save_current_path():
    try:
        data = request.json
        path = data.get('current_path')
        print(f"Received path to save: {path}")

        if path and os.path.exists(path):
            save_current_path_to_config(path)  # Call the correct function
            return jsonify({'success': True})
        else:
            print(f"Invalid path received: {path}")
            return jsonify({'error': 'Invalid path'}), 400
    except Exception as e:
        print(f"Error in save_current_path: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/tree')
def get_tree():
    """
    Get directory tree structure.
    Supports force_refresh to bypass cache.
    """
    root_path = get_default_start_path()
    current_path = get_current_path()
    max_depth = int(request.args.get('max_depth', 10))  # Get max_depth from request, default to 10
    force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'  # New parameter

    # Safety check
    if not os.path.exists(current_path):
        current_path = root_path

    tree_data = None
    if not force_refresh:
        # Try to load from cache first if not forcing refresh
        tree_data = _get_cached_tree(root_path, max_depth)

    if tree_data is None:  # If cache missed or refresh forced, generate the tree
        print(f"Generating tree for path: {root_path}, depth: {max_depth}, force_refresh: {force_refresh}")

        def generate_tree(path, current_depth):
            if current_depth >= max_depth:
                return []

            tree = []
            try:
                items = os.listdir(path)
                dirs = sorted([d for d in items if os.path.isdir(os.path.join(path, d))], key=str.lower)

                for d in dirs:
                    item_path = safe_join(path, d)
                    # Check if item_path is a valid directory before os.listdir for children
                    has_children = False
                    if os.path.isdir(item_path):
                        try:
                            has_children = any(
                                os.path.isdir(os.path.join(item_path, x)) for x in os.listdir(item_path) if
                                not x.startswith('.'))
                        except PermissionError:
                            print(f"Permission denied to list contents of: {item_path}")
                            # Treat as no children if permission denied
                            has_children = False
                        except OSError as e:
                            print(f"OS error checking children of {item_path}: {e}")
                            has_children = False

                    node = {
                        'name': d,
                        'path': item_path,
                        'is_dir': True,
                        'has_children': has_children,
                        'children': generate_tree(item_path, current_depth + 1) if has_children else []
                    }
                    tree.append(node)
            except PermissionError:
                print(f"Permission denied for directory: {path}. Returning empty tree for this path.")
                # Return empty list if permission denied for the current path
                return []
            except OSError as e:
                print(f"OS error accessing directory {path}: {e}. Returning empty tree for this path.")
                return []
            return tree

        tree_data = generate_tree(root_path, 0)

        # Save to cache after generation
        _save_cached_tree(root_path, max_depth, tree_data)

    return jsonify({
        'tree': tree_data,
        'current_path': current_path,
        'root_path': root_path
    })


def get_true_base_name(filename):
    """
    Determines the 'true' base name of a file by iteratively stripping known extensions
    from the end of the filename. This function should be robust against multiple extensions
    like 'file.preview.png' or 'model.cm-info.safetensors'.
    """
    if not filename:
        return ""  # Handle empty filename input gracefully

    # Define all known extensions, sorted by length descending to ensure correct stripping order
    # (e.g., .preview.png before .png, .cm-info.json before .json)
    all_known_extensions = [
        '.preview.jpeg', '.preview.jpg', '.preview.png', '.preview.webp',  # Preview extensions
        '.cm-info.json', '.info.json', '.meta.json', '.metadata.json',  # Metadata extensions
        '.safetensors', '.ckpt', '.pt', '.pth', '.webm',  # Primary content extensions
        '.jpg', '.jpeg', '.png', '.webp', '.gif', '.json',  # Common image/video/json extensions
    ]
    all_known_extensions_sorted = sorted(all_known_extensions, key=len, reverse=True)

    current_name = filename
    original_name = filename  # Keep original for fallback

    while True:
        stripped_something = False
        for ext in all_known_extensions_sorted:
            if current_name.lower().endswith(ext):
                current_name = current_name[:-len(ext)]
                stripped_something = True
                break
        if not stripped_something:
            break

    # If the filename ends with a dot after stripping, remove it
    if current_name.endswith('.'):
        current_name = current_name[:-1]

    # Fallback: if stripping resulted in an empty string (e.g., ".png" -> ""),
    # or if no known extensions were stripped, use os.path.splitext on the original filename.
    # If that also results in empty, use the original filename as a last resort.
    if not current_name or current_name == original_name:
        base_name_from_splitext = os.path.splitext(original_name)[0]
        if not base_name_from_splitext:
            # Removed debug print for this fallback for less log spam
            return original_name  # Last resort: return the full original filename
        else:
            # Removed debug print for this fallback for less log spam
            return base_name_from_splitext

    # Removed debug print for this function for less log spam
    return current_name


@app.route('/api/files')
def get_files():
    """
    Get files in a directory, prioritizing primary files and their associated data.
    Supports showing content from subfolders and hiding directories based on flags.
    Optimized for CPU by bulk fetching metadata and selectively updating.
    """
    directory = request.args.get('path', os.path.expanduser('~'))
    sort_by = request.args.get('sort', 'name')
    sort_order = request.args.get('order', 'asc')
    search_term = request.args.get('search', '').lower()
    display_rating_category = request.args.get('display_rating_category', 'overall')
    filter_tags_str = request.args.get('filter_tags', '')
    hide_folders = request.args.get('hide_folders', 'false').lower() == 'true'
    show_subfolder_content = request.args.get('show_subfolder_content', 'false').lower() == 'true'
    show_hidden_files = request.args.get('show_hidden_files', 'false').lower() == 'true'

    # Parse filter tags into a set for efficient lookup
    filter_tags = {tag.strip().lower() for tag in filter_tags_str.split(',') if tag.strip()}

    print(f"DEBUG: get_files called for directory: {directory}")
    print(
        f"DEBUG: hide_folders: {hide_folders}, show_subfolder_content: {show_subfolder_content}, show_hidden_files: {show_hidden_files}")
    print(f"DEBUG: Sorting by: {sort_by}, order: {sort_order}, requested rating category: {display_rating_category}")
    print(f"DEBUG: Filter tags (from frontend): {filter_tags}") # Added debug print for filter tags

    if not os.path.exists(directory) or not os.path.isdir(directory):
        print(f"ERROR: Directory not found or not a directory: {directory}")
        return jsonify({'error': 'Directory not found'}), 404

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Define primary content extensions (models, videos, and general images)
        primary_content_extensions = ['.safetensors', '.ckpt', '.pt', '.pth', '.webm', '.jpg', '.jpeg', '.png', '.webp',
                                      '.gif', '.gguf', '.json']
        # Define preview image extensions (specifically those with '.preview' in their name)
        preview_extensions = ['.preview.jpeg', '.preview.jpg', '.preview.png', '.preview.webp', 'preview.webm', '.preview.gif']
        # Define metadata extensions
        metadata_extensions = ['.cm-info.json', '.info.json', '.meta.json', '.metadata.json']

        # Sort extensions by length descending for internal logic (e.g., finding best primary/preview)
        primary_content_extensions_sorted = sorted(primary_content_extensions, key=len, reverse=True)
        preview_extensions_sorted = sorted(preview_extensions, key=len, reverse=True)
        metadata_extensions_sorted = sorted(metadata_extensions, key=len, reverse=True)

        all_file_paths_on_disk = set()
        all_dir_paths_on_disk = set()

        if show_subfolder_content:
            for root, dirs, files in os.walk(directory, followlinks=True):
                for file_name in files:
                    if not file_name.startswith('.'):
                        all_file_paths_on_disk.add(os.path.join(root, file_name))
                if not hide_folders:
                    for dir_name in dirs:
                        if not dir_name.startswith('.'):
                            all_dir_paths_on_disk.add(os.path.join(root, dir_name))
        else:
            # Explicitly list files and directories in the current directory only
            for item in os.listdir(directory):  # Use os.listdir directly
                if item.startswith('.'):
                    continue
                item_path = os.path.join(directory, item)
                if os.path.isfile(item_path):
                    all_file_paths_on_disk.add(item_path)
                elif os.path.isdir(item_path) and not hide_folders:
                    all_dir_paths_on_disk.add(item_path)

        # --- Bulk Fetch All Metadata from DB ---
        db_metadata_by_path = {}
        db_metadata_by_hash = {}
        try:
            cursor.execute(
                'SELECT filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata FROM file_metadata')
            for row in cursor.fetchall():
                normalized_db_path = normalize_db_filepath(row['filepath'])
                db_metadata_by_path[normalized_db_path] = row
                if row['file_hash']:
                    if row['file_hash'] not in db_metadata_by_hash:
                        db_metadata_by_hash[row['file_hash']] = []
                    db_metadata_by_hash[row['file_hash']].append(row)
        except sqlite3.Error as e:
            print(f"Error fetching all metadata from DB: {e}")

        file_groups = {}  # Key: (directory_name, true_base_name), Value: list of physical file paths in that group
        directories_info = []
        processed_db_paths = set()  # To track which DB entries have been matched to a physical file or explicitly handled

        # Process collected directory paths first
        for dir_path in sorted(list(all_dir_paths_on_disk)):
            try:
                stat = os.stat(dir_path)
                directories_info.append({
                    'name': os.path.basename(dir_path),
                    'path': dir_path,
                    'size': 0,
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    'created': datetime.min.isoformat(),
                    'is_directory': True,
                    'extension': '',
                    'mime_type': 'folder',
                    'preview_image_path': None,
                    'associated_metadata_path': None,
                    'workflow_metadata': None,
                    'is_missing': False,
                    'tags': '',
                    'ratings': {},
                    'notes': '',
                    'category': '',
                    'metadata_error': None,
                    'is_category_manual': 0,
                    'custom_gallery_keyword': '',
                    'is_hidden': 0,
                    'file_hash': None,
                    'any_file_in_group_exists': True  # Directories always exist if found by os.walk
                })
            except (OSError, PermissionError) as e:
                print(f"Warning: Could not stat directory {dir_path}: {e}")
                directories_info.append({
                    'name': os.path.basename(dir_path),
                    'path': dir_path,
                    'is_directory': True,
                    'is_missing': True,
                    'metadata_error': f"File system error: {e}",
                    'any_file_in_group_exists': False  # Directory is inaccessible
                })

        # Group files by effective base name (directory + filename without any extension)
        # This ensures that 'model.safetensors', 'model.txt', 'model.preview.png' are all grouped together
        for file_path in sorted(list(all_file_paths_on_disk)):
            directory_name = os.path.dirname(file_path)
            # Use the new helper to get the true base name for grouping
            file_name_true_base = get_true_base_name(os.path.basename(file_path))
            group_key = (directory_name, file_name_true_base)

            if group_key not in file_groups:
                file_groups[group_key] = []
            file_groups[group_key].append(file_path)

        primary_files_info = []
        updates_to_commit = []  # List of (action, data) tuples for batch DB operations

        for (directory_name, base_name_true), files_in_group_paths in file_groups.items():
            primary_content_file_on_disk = None  # This will store the path to the *actual* primary content file found on disk
            group_preview_path = None
            group_metadata_path = None
            any_file_in_group_exists = False  # Flag if at least one file (primary or secondary) exists in this group

            # First pass: Identify all existing files in the group and categorize them
            existing_primary_candidates = []
            existing_preview_candidates = []
            existing_metadata_candidates = []

            for file_path in files_in_group_paths:
                file_info_fs = _get_file_system_info(file_path)
                if not file_info_fs['is_missing']:  # If the physical file exists on disk
                    any_file_in_group_exists = True
                    file_name_lower = file_info_fs['name'].lower()

                    # Check if it's a preview file (must contain '.preview')
                    is_preview_file = False
                    for ext in preview_extensions_sorted:
                        if file_name_lower.endswith(ext):
                            is_preview_file = True
                            existing_preview_candidates.append(file_path)
                            break

                    # Check if it's a metadata file
                    is_metadata_file = False
                    for ext in metadata_extensions_sorted:
                        if file_name_lower.endswith(ext):
                            is_metadata_file = True
                            existing_metadata_candidates.append(file_path)
                            break

                    # Check if it's a primary content file (model, video, or general image NOT marked as a preview)
                    is_primary_content = False
                    if not is_preview_file:  # Only consider as primary if it's not a preview
                        if not is_metadata_file: # Only consider as primary if it's not metadata
                            for ext in primary_content_extensions_sorted:
                                if file_name_lower.endswith(ext):
                                    is_primary_content = True
                                    existing_primary_candidates.append(file_path)
                                    break

            # Now, select the best primary, preview, and metadata paths
            if existing_primary_candidates:
                # Prioritize based on the order in primary_content_extensions_sorted
                for p_ext in primary_content_extensions_sorted:
                    for candidate_path in existing_primary_candidates:
                        if candidate_path.lower().endswith(p_ext):
                            primary_content_file_on_disk = candidate_path
                            break
                    if primary_content_file_on_disk:
                        break

            if existing_preview_candidates:
                group_preview_path = existing_preview_candidates[0]  # Take the first found preview

            if existing_metadata_candidates:
                group_metadata_path = existing_metadata_candidates[0]  # Take the first found metadata


            # Determine the conceptual primary filepath for DB interaction.
            # This path *must* always represent the canonical primary file, even if missing.
            # It should *never* be a preview or metadata file path.
            # We use the true base name and the *actual* extension of the primary file found on disk,
            # or fallback to the most preferred primary extension if no primary file is found.
            if primary_content_file_on_disk:
                actual_primary_ext = os.path.splitext(primary_content_file_on_disk)[1].lower()
                conceptual_primary_filepath_for_db = os.path.join(directory_name, f"{base_name_true}{actual_primary_ext}")
            else:
                default_primary_ext = primary_content_extensions_sorted[
                    0] if primary_content_extensions_sorted else '.safetensors'  # Fallback to .safetensors if list is empty
                conceptual_primary_filepath_for_db = os.path.join(directory_name, f"{base_name_true}{default_primary_ext}")


            normalized_conceptual_path = normalize_db_filepath(conceptual_primary_filepath_for_db)

            # Get current file system info for the actual primary file (if it exists)
            # This fs_info is about the *actual* primary file on disk, not the conceptual one.
            fs_info_for_primary_on_disk = _get_file_system_info(
                primary_content_file_on_disk) if primary_content_file_on_disk else {}
            current_file_hash = fs_info_for_primary_on_disk.get('file_hash')
            current_file_mtime = fs_info_for_primary_on_disk.get('modified')

            # --- Determine metadata source and handle moves/updates ---
            metadata_source = None  # This will hold the DB row that provides the metadata for this conceptual file
            old_filepath_to_delete = None  # Track if an old path needs to be deleted

            # 1. Try to find metadata for the current conceptual path (most direct match)
            if normalized_conceptual_path in db_metadata_by_path:
                metadata_source = db_metadata_by_path[normalized_conceptual_path]

            # 2. If no direct match, and a physical file exists, try to find by hash (move detection for existing files)
            if metadata_source is None and primary_content_file_on_disk and current_file_hash:
                if current_file_hash in db_metadata_by_hash:
                    for entry in db_metadata_by_hash[current_file_hash]:
                        if normalize_db_filepath(entry['filepath']) != normalized_conceptual_path:
                            metadata_source = entry
                            old_filepath_to_delete = normalize_db_filepath(entry['filepath'])
                            print(f"DEBUG: Move detected by hash from '{old_filepath_to_delete}' to '{normalized_conceptual_path}'.")
                            break
                    if metadata_source is None and normalized_conceptual_path in db_metadata_by_path and \
                            db_metadata_by_path[normalized_conceptual_path]['file_hash'] == current_file_hash:
                        metadata_source = db_metadata_by_path[normalized_conceptual_path]

            # NEW LOGIC: If still no metadata_source, and the primary file is currently missing (not on disk),
            # check if an *old* DB entry exists that conceptually matches this missing file.
            if metadata_source is None and not primary_content_file_on_disk:
                for old_db_path, old_db_row in db_metadata_by_path.items():
                    # Skip DB entries already associated with a physical file
                    if old_db_path in processed_db_paths:
                        continue

                    old_base_name_true = get_true_base_name(os.path.basename(old_db_path))

                    # If the base names match AND the old DB entry has a non-null hash (indicating it was tracked)
                    # AND it's not the exact same path (to avoid self-matching if it's just a missing file at its original spot)
                    if (old_base_name_true == base_name_true and
                        old_db_row['file_hash'] is not None and
                        normalize_db_filepath(old_db_path) != normalized_conceptual_path):

                        metadata_source = old_db_row
                        old_filepath_to_delete = normalize_db_filepath(old_db_path)
                        print(f"DEBUG: Move detected for MISSING file (conceptual) from '{old_filepath_to_delete}' to '{normalized_conceptual_path}'.")
                        break # Found the metadata source, exit inner loop


            # 3. Prepare DB updates based on metadata_source and file existence
            if metadata_source:
                # If a move was detected (old_filepath_to_delete is set)
                if old_filepath_to_delete:
                    updates_to_commit.append({
                        'action': 'move',
                        'old_filepath': old_filepath_to_delete,
                        'new_filepath': normalized_conceptual_path,
                        'tags': metadata_source['tags'],
                        'ratings': metadata_source['ratings'],
                        'notes': metadata_source['notes'],
                        'category': metadata_source['category'],
                        'is_category_manual': metadata_source['is_category_manual'],
                        'is_hidden': metadata_source['is_hidden'],
                        'custom_gallery_keyword': metadata_source['custom_gallery_keyword'],
                        'file_hash': current_file_hash,  # Use the current physical file's hash (will be None if still missing)
                        'last_modified': current_file_mtime,  # Use the current physical file's mtime (will be None if still missing)
                        'workflow_metadata': metadata_source['workflow_metadata']
                    })
                    processed_db_paths.add(old_filepath_to_delete)  # Mark old path as handled
                # If metadata_source exists at the current conceptual path, check if update is needed
                elif primary_content_file_on_disk:  # Only update if the physical file exists
                    # Check if hash or mtime changed, or if it's a new entry (no old_filepath_to_delete)
                    if metadata_source['file_hash'] != current_file_hash or \
                            (current_file_mtime and metadata_source['last_modified'] and \
                             (datetime.fromisoformat(current_file_mtime) - datetime.fromisoformat(
                                 metadata_source['last_modified'])).total_seconds() > 1):
                        print(f"DEBUG: DB entry for {normalized_conceptual_path} needs update (hash/mtime changed).")
                        updates_to_commit.append({
                            'action': 'update',
                            'filepath': normalized_conceptual_path,
                            'tags': metadata_source['tags'],
                            'ratings': metadata_source['ratings'],
                            'notes': metadata_source['notes'],
                            'category': metadata_source['category'],
                            'is_category_manual': metadata_source['is_category_manual'],
                            'is_hidden': metadata_source['is_hidden'],
                            'custom_gallery_keyword': metadata_source['custom_gallery_keyword'],
                            'file_hash': current_file_hash,
                            'last_modified': current_file_mtime,
                            'workflow_metadata': metadata_source['workflow_metadata']
                        })
            else:  # No metadata_source found for current conceptual path, and no move detected
                if any_file_in_group_exists:  # Only insert if at least one physical file exists for this conceptual group
                    # Removed debug print for new DB entry
                    updates_to_commit.append({
                        'action': 'insert',
                        'filepath': normalized_conceptual_path,
                        'tags': '', 'ratings': '{}', 'notes': '', 'category': '',
                        'is_category_manual': 0, 'custom_gallery_keyword': '',
                        'is_hidden': 0, 'file_hash': current_file_hash,
                        'last_modified': current_file_mtime, 'workflow_metadata': None
                    })

            # Mark the current conceptual path as processed if it's being handled (either exists or its metadata is being moved to it)
            if normalized_conceptual_path not in processed_db_paths and (metadata_source or any_file_in_group_exists):
                processed_db_paths.add(normalized_conceptual_path)

            # Construct the file_info object for the frontend
            file_info = {
                'name': base_name_true,
                'path': normalized_conceptual_path,
                'size': fs_info_for_primary_on_disk.get('size', 0),
                'modified': fs_info_for_primary_on_disk.get('modified', datetime.min.isoformat()),
                'created': datetime.min.isoformat(),
                'is_directory': False,
                'extension': os.path.splitext(primary_content_file_on_disk)[
                    1].lower() if primary_content_file_on_disk else '',
                'mime_type': fs_info_for_primary_on_disk.get('mime_type', 'unknown'),
                'preview_image_path': group_preview_path,
                'associated_metadata_path': group_metadata_path, # Keep only the path, content fetched on demand
                'workflow_metadata': None,  # Will be populated from metadata_source or re-extracted
                'is_missing': not bool(primary_content_file_on_disk),
                'primary_file_exists_on_disk': bool(primary_content_file_on_disk),
                'tags': '', 'ratings': {}, 'notes': '', 'category': '',
                'is_category_manual': 0, 'custom_gallery_keyword': '',
                'is_hidden': 0, 'file_hash': current_file_hash,
                'any_file_in_group_exists': any_file_in_group_exists
            }

            # Populate with metadata from the determined source
            if metadata_source:
                file_info['tags'] = metadata_source['tags'] or ''
                if metadata_source['ratings'] is not None:
                    try:
                        file_info['ratings'] = json.loads(metadata_source['ratings'])
                    except json.JSONDecodeError:
                        print(
                            f"Warning: Existing ratings JSON for {metadata_source['filepath']} is malformed. Overwriting.")
                        file_info['ratings'] = {}
                file_info['notes'] = metadata_source['notes'] or ''
                file_info['category'] = metadata_source['category'] or ''
                file_info['is_category_manual'] = bool(metadata_source['is_category_manual'])
                # Ensure custom_gallery_keyword is an empty string if it's '0'
                cgk = metadata_source['custom_gallery_keyword'] or ''
                if cgk == '0': # Explicitly convert string '0' to empty string for display
                    cgk = ''
                file_info['custom_gallery_keyword'] = cgk
                file_info['is_hidden'] = bool(metadata_source['is_hidden'])
                if metadata_source['workflow_metadata']:
                    try:
                        file_info['workflow_metadata'] = json.loads(metadata_source['workflow_metadata'])
                    except json.JSONDecodeError:
                        print(f"Warning: Workflow metadata for {metadata_source['filepath']} in DB is malformed.")
                        file_info['workflow_metadata'] = None

            primary_files_info.append(file_info)
            # Add logging here to see what's being sent for each file
            print(f"DEBUG: get_files sending: {file_info['name']}, category: {file_info['category']}, is_category_manual: {file_info['is_category_manual']}")


        # Execute all collected DB operations and update db_metadata_by_path in memory
        for update_item in updates_to_commit:
            if update_item['action'] == 'move':
                # Removed debug print for DB DELETE
                cursor.execute('DELETE FROM file_metadata WHERE filepath = ?', (update_item['old_filepath'],))
                # Remove from in-memory cache
                if update_item['old_filepath'] in db_metadata_by_path:
                    del db_metadata_by_path[update_item['old_filepath']]

                # Removed debug print for DB INSERT/REPLACE
                cursor.execute('''
                    INSERT OR REPLACE INTO file_metadata
                    (filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    update_item['new_filepath'],
                    update_item['tags'],
                    update_item['ratings'],
                    update_item['notes'],
                    update_item['category'],
                    update_item['is_category_manual'],
                    update_item['is_hidden'],
                    update_item['custom_gallery_keyword'],
                    update_item['file_hash'],
                    update_item['last_modified'],
                    update_item['workflow_metadata']
                ))
                # Add/update in-memory cache for new path
                db_metadata_by_path[update_item['new_filepath']] = {
                    'filepath': update_item['new_filepath'],
                    'tags': update_item['tags'],
                    'ratings': update_item['ratings'],
                    'notes': update_item['notes'],
                    'category': update_item['category'],
                    'is_category_manual': update_item['is_category_manual'],
                    'is_hidden': update_item['is_hidden'],
                    'custom_gallery_keyword': update_item['custom_gallery_keyword'],
                    'file_hash': update_item['file_hash'],
                    'last_modified': update_item['last_modified'],
                    'workflow_metadata': update_item['workflow_metadata']
                }

            elif update_item['action'] == 'update' or update_item['action'] == 'insert':
                # Removed debug print for DB INSERT/REPLACE
                cursor.execute('''
                    INSERT OR REPLACE INTO file_metadata
                    (filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    update_item['filepath'],
                    update_item['tags'],
                    update_item['ratings'],
                    update_item['notes'],
                    update_item['category'],
                    update_item['is_category_manual'],
                    update_item['is_hidden'],
                    update_item['custom_gallery_keyword'],
                    update_item['file_hash'],
                    update_item['last_modified'],
                    update_item['workflow_metadata']
                ))
                # Add/update in-memory cache
                db_metadata_by_path[update_item['filepath']] = {
                    'filepath': update_item['filepath'],
                    'tags': update_item['tags'],
                    'ratings': update_item['ratings'],
                    'notes': update_item['notes'],
                    'category': update_item['category'],
                    'is_category_manual': update_item['is_category_manual'],
                    'is_hidden': update_item['is_hidden'],
                    'custom_gallery_keyword': update_item['custom_gallery_keyword'],
                    'file_hash': update_item['file_hash'],
                    'last_modified': update_item['last_modified'],
                    'workflow_metadata': update_item['workflow_metadata']
                }
        conn.commit()  # Commit all changes *before* processing DB-only entries

        # Identify and include metadata for "missing" files that still have DB entries
        for db_path, db_row in db_metadata_by_path.items():
            # Only process if this DB entry was NOT associated with any physical file found on disk
            # (either at its original path or a new path due to a move).
            # We also need to ensure that this db_path is part of the current directory being scanned,
            # unless it's a subfolder being shown.

            db_entry_dir = os.path.dirname(db_path)
            is_in_current_scan_scope = False
            # Check if the DB entry's directory is the current directory or a subfolder if show_subfolder_content is true
            if show_subfolder_content:
                if normalize_db_filepath(db_entry_dir).startswith(normalize_db_filepath(directory)):
                    is_in_current_scan_scope = True
            else:
                if normalize_db_filepath(db_entry_dir) == normalize_db_filepath(directory):
                    is_in_current_scan_scope = True

            # If the DB entry was not processed (meaning no physical file matched it in the first loop)
            # AND it's within the current scan's scope, then it's a truly missing file we should display.
            if db_path not in processed_db_paths and is_in_current_scan_scope:
                file_info = {
                    'name': get_true_base_name(os.path.basename(db_row['filepath'])),  # Use true base name here too
                    'path': db_row['filepath'],  # Keep old path for missing files
                    'size': 0,
                    'modified': datetime.min.isoformat(),
                    'created': datetime.min.isoformat(),
                    'is_directory': False,
                    'extension': os.path.splitext(db_row['filepath'])[1].lower(),
                    'mime_type': 'application/x-missing-file',
                    'preview_image_path': None,
                    'associated_metadata_path': None,  # No physical metadata file found
                    'workflow_metadata': None,  # Workflow metadata from DB will be loaded below
                    'is_missing': True,  # Primary file is missing (by definition in this block)
                    'primary_file_exists_on_disk': False,  # Explicitly false
                    'tags': db_row['tags'] or '',
                    'ratings': json.loads(db_row['ratings']) if db_row['ratings'] else {},
                    'notes': db_row['notes'] or '',
                    'category': db_row['category'] or '',
                    'metadata_error': "File missing from disk, metadata from DB.",
                    'is_category_manual': bool(db_row['is_category_manual']),
                    'custom_gallery_keyword': db_row['custom_gallery_keyword'] or '',
                    'is_hidden': bool(db_row['is_hidden']),
                    'file_hash': db_row['file_hash'],
                    'any_file_in_group_exists': False
                    # Explicitly false for truly deleted items (no physical files found)
                }
                # Ensure custom_gallery_keyword is an empty string if it's '0' for missing files too
                cgk_missing = file_info['custom_gallery_keyword']
                if cgk_missing == '0':
                    file_info['custom_gallery_keyword'] = ''

                if db_row['workflow_metadata']:
                    try:
                        file_info['workflow_metadata'] = json.loads(db_row['workflow_metadata'])
                    except json.JSONDecodeError:
                        print(f"Warning: Workflow metadata for {db_row['filepath']} in DB is malformed.")
                        file_info['workflow_metadata'] = None
                primary_files_info.append(file_info)
                # Removed debug print for appending DB-only file_info

        conn.commit()  # Final commit for any remaining DB-only updates (though most should be handled above)
        # Removed debug print for primary file selection count

        # Combine directories and primary files
        combined_items = directories_info + primary_files_info
        # Removed debug print for combined items count

        # Apply search and filter and filter out truly deleted files
        filtered_items = []
        for item_info in combined_items:
            # ONLY display items if they are directories OR if any file in their conceptual group exists on disk
            if not item_info['is_directory'] and not item_info['any_file_in_group_exists']:
                continue  # Skip if not a directory AND no primary or secondary files exist on disk

            # Apply search term filter
            if search_term and search_term not in item_info['name'].lower():
                continue

            # Apply hidden files filter
            if not item_info['is_directory'] and item_info['is_hidden'] and not show_hidden_files:
                continue

            # Apply tag filter (NEW LOGIC)
            if filter_tags: # Only apply if there are tags to filter by
                item_tags = {tag.strip().lower() for tag in item_info['tags'].split(',') if tag.strip()}
                # Check if all filter_tags are present in item_tags
                if not filter_tags.issubset(item_tags):
                    continue # Skip this item if it doesn't have all required tags

            filtered_items.append(item_info)

        # Sort files
        reverse = sort_order == 'desc'
        if sort_by == 'name':
            filtered_items.sort(key=lambda x: x['name'].lower(), reverse=reverse)
        elif sort_by == 'size':
            filtered_items.sort(key=lambda x: (0 if x['is_directory'] else 1, x['size']), reverse=reverse)
        elif sort_by == 'modified':
            filtered_items.sort(key=lambda x: x['modified'], reverse=reverse)
        elif sort_by == 'type':
            filtered_items.sort(key=lambda x: (0 if x['is_directory'] else 1, x['extension']), reverse=reverse)
        elif sort_by == 'rating':
            filtered_items.sort(
                key=lambda x: (0 if x['is_directory'] else 1, float(x['ratings'].get(display_rating_category, 0))),
                reverse=reverse)

        return jsonify({
            'files': filtered_items,
            'path': directory,
            'count': len(filtered_items)
        })

    except PermissionError:
        print(f"ERROR: Permission denied for directory: {directory}")
        return jsonify({'error': 'Permission denied'}), 403
    except Exception as e:
        print(f"An unexpected error occurred in get_files: {e}")
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/metadata', methods=['POST'])
def update_metadata():
    """Update file metadata"""
    data = request.json
    filepath = data.get('filepath')

    print(f"DEBUG: update_metadata received payload for {filepath}: {json.dumps(data, indent=2)}")

    if not filepath:
        return jsonify({'error': 'Filepath is required'}), 400

    normalized_filepath = normalize_db_filepath(filepath)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the existing metadata to merge ratings and other fields
        cursor.execute(
            'SELECT tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, workflow_metadata FROM file_metadata WHERE filepath = ?',
            (normalized_filepath,))
        existing_metadata = cursor.fetchone()

        existing_tags = ''
        existing_ratings = {}
        existing_notes = ''
        existing_category = ''
        existing_is_hidden = 0
        existing_custom_gallery_keyword = ''
        existing_workflow_metadata_json = None
        existing_file_hash = None

        if existing_metadata:
            existing_tags = existing_metadata['tags'] or ''
            if existing_metadata['ratings'] is not None:
                try:
                    existing_ratings = json.loads(existing_metadata['ratings'])
                except json.JSONDecodeError:
                    print(f"Warning: Existing ratings JSON for {filepath} is malformed. Overwriting.")
                    existing_ratings = {}
            existing_notes = existing_metadata['notes'] or ''
            existing_category = existing_metadata['category'] or ''
            existing_is_category_manual = existing_metadata['is_category_manual'] if existing_metadata[
                                                                                         'is_category_manual'] is not None else 0
            existing_custom_gallery_keyword = existing_metadata[
                                                  'custom_gallery_keyword'] or ''
            existing_is_hidden = existing_metadata['is_hidden'] if existing_metadata[
                                                                       'is_hidden'] is not None else 0
            existing_file_hash = existing_metadata['file_hash']
            existing_workflow_metadata_json = existing_metadata['workflow_metadata']

        # Update individual fields from request data, merging ratings
        tags = data.get('tags', existing_tags)
        notes = data.get('notes', existing_notes)
        category = data.get('category', existing_category)
        is_category_manual = data.get('is_category_manual', existing_is_category_manual)

        # --- MODIFICATION START ---
        # Handle custom_gallery_keyword: Ensure it's a string and convert numeric 0 to empty string
        custom_gallery_keyword_from_request = data.get('custom_gallery_keyword')
        if custom_gallery_keyword_from_request is None:
            custom_gallery_keyword = existing_custom_gallery_keyword # Preserve existing if not provided
        elif custom_gallery_keyword_from_request == 0: # If frontend somehow sends numeric 0
            custom_gallery_keyword = '' # Treat numeric 0 as empty string for this field
        else:
            custom_gallery_keyword = str(custom_gallery_keyword_from_request).strip() # Ensure it's a string and trim
        # --- MODIFICATION END ---

        is_hidden = data.get('is_hidden', existing_is_hidden)
        workflow_metadata_to_save = existing_workflow_metadata_json

        # New ratings are passed as a dictionary, merge them
        new_ratings = data.get('ratings', {})
        merged_ratings = {**existing_ratings, **new_ratings}

        ratings_json_str = json.dumps(merged_ratings)

        # Calculate the quick hash for the file as its content might have changed (e.g. if edited externally)
        current_file_hash = calculate_quick_hash(filepath)
        current_file_mtime = None
        try:
            current_file_mtime = datetime.fromtimestamp(os.stat(filepath).st_mtime).isoformat()
        except OSError:
            pass  # File might be missing or inaccessible, keep mtime as None

        print(f"DEBUG: update_metadata saving for {filepath}: category={category}, is_category_manual={is_category_manual}")

        cursor.execute('''
            INSERT OR REPLACE INTO file_metadata
            (filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            normalized_filepath,
            tags,
            ratings_json_str,
            notes,
            category,
            is_category_manual,
            custom_gallery_keyword,  # Use the cleaned custom_gallery_keyword
            is_hidden,
            current_file_hash,  # Use the newly calculated hash here
            current_file_mtime,  # Update last_modified from disk
            workflow_metadata_to_save,
        ))

        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in update_metadata: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/reparent_metadata', methods=['POST'])
def reparent_metadata():
    """
    API to reparent metadata from an old filepath (that might be missing)
    to a new filepath (where the file now exists).
    This is useful for files moved before automatic hash-based detection.
    """
    data = request.json
    old_filepath = data.get('old_filepath')
    new_filepath = data.get('new_filepath')

    if not old_filepath or not new_filepath:
        return jsonify({'error': 'Both old_filepath and new_filepath are required.'}), 400

    normalized_old_filepath = normalize_db_filepath(old_filepath)
    normalized_new_filepath = normalize_db_filepath(new_filepath)

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # 1. Fetch metadata from the old path
        cursor.execute('SELECT * FROM file_metadata WHERE filepath = ?', (normalized_old_filepath,))
        old_metadata = cursor.fetchone()

        if not old_metadata:
            return jsonify({'error': f"No metadata found for old path: {old_filepath}"}), 404

        # 2. Verify new file exists on disk
        if not os.path.exists(new_filepath):
            return jsonify({'error': f"New file path does not exist on disk: {new_filepath}"}), 404

        # 3. Calculate current hash and mtime for the new file
        current_file_hash = calculate_quick_hash(new_filepath)
        current_file_mtime = datetime.fromtimestamp(os.stat(new_filepath).st_mtime).isoformat()

        # 4. Delete the old record
        cursor.execute('DELETE FROM file_metadata WHERE filepath = ?', (normalized_old_filepath,))

        # 5. Insert/Update with new path and potentially new hash/mtime
        cursor.execute('''
            INSERT OR REPLACE INTO file_metadata
            (filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            normalized_new_filepath,
            old_metadata['tags'],
            old_metadata['ratings'],
            old_metadata['notes'],
            old_metadata['category'],
            old_metadata['is_category_manual'],
            old_metadata['custom_gallery_keyword'], # This will be the original value, which is fine for reparenting
            old_metadata['is_hidden'],
            current_file_hash,  # Use the newly calculated hash for the new file
            current_file_mtime,  # Use the newly calculated mtime for the new file
            old_metadata['workflow_metadata']
        ))

        conn.commit()
        print(f"DEBUG: Successfully reparented metadata from '{old_filepath}' to '{new_filepath}'.")
        return jsonify({'success': True, 'message': 'Metadata reparented successfully.'})

    except sqlite3.Error as e:
        if conn:
            conn.rollback()
        print(f"ERROR: Database error during reparent_metadata: {e}")
        return jsonify({'error': f"Database error: {str(e)}"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"ERROR: An unexpected error occurred during reparent_metadata: {e}")
        return jsonify({'error': f"An unexpected error occurred: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/thumbnail/<path:filepath>')
def get_thumbnail(filepath):
    """
    Serve the original file or an associated preview image for thumbnails.
    The 'filepath' argument from the URL is expected to be the full system path.
    """
    conn = None  # Initialize conn to None
    try:
        full_filepath = filepath
        full_filepath = _resolve_filepath(full_filepath)

        if not os.path.exists(full_filepath):
            # If the direct path doesn't exist, try to find an associated preview image
            base_name, _ = os.path.splitext(os.path.basename(full_filepath))
            directory = os.path.dirname(full_filepath)

            found_preview = False
            for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp']:
                preview_path = os.path.join(directory, f"{base_name}.preview{ext}")
                if os.path.exists(preview_path):
                    full_filepath = preview_path
                    found_preview = True
                    break

            if not found_preview:
                print(f"Thumbnail: File or associated preview not found for {filepath}")
                return jsonify({'error': 'File or associated preview not found'}), 404

        mime_type = mimetypes.guess_type(full_filepath)[0]
        if mime_type and (mime_type.startswith('image/') or mime_type.startswith('video/')):
            return send_file(full_filepath, mimetype=mime_type)

        print(f"Thumbnail: Not an image or video file: {filepath}")
        return jsonify({'error': 'Not an image or video file'}), 400
    except Exception as e:
        print(f"Error serving thumbnail for {filepath}: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/navigate_up')
def navigate_up():
    """Get parent directory of current path"""
    current = request.args.get('path', os.path.expanduser('~'))
    parent = os.path.dirname(current)

    # Prevent going above root
    if os.name == 'nt':  # Windows
        drive = os.path.splitdrive(current)[0] + '\\'
        # Ensure parent does not go above the drive root (e.g., C:\)
        if len(parent) < len(drive) and current.upper() != drive.upper():
            parent = drive
        elif current.upper() == drive.upper():  # Already at drive root
            parent = '/'  # Changed from drive to '/' for consistency with Unix-like
    else:  # Unix-like
        if parent == '':
            parent = '/'
        elif parent == current:  # Already at root
            parent = '/'

    return jsonify({
        'parent_path': parent,
        'can_go_up': parent != current
    })


@app.route('/api/drives')
def get_drives():
    """Get available drives (Windows) or root directories (Unix)"""
    drives = []

    if os.name == 'nt':  # Windows
        import string
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                drives.append({
                    'name': f"Local Disk ({letter}:)",
                    'path': drive
                })
    else:  # Unix-like
        drives.append({
            'name': 'Root',
            'path': '/'
        })

        # Add common directories
        home = os.path.expanduser('~')
        if os.path.exists(home):
            drives.append({
                'name': 'Home',
                'path': home
            })

    return jsonify(drives)


def _resolve_filepath(input_path):
    """
    Resolves and normalizes a file path for FFmpeg commands.
    (This function is not directly used by Flask routes but is kept for completeness
    if FFmpeg integration is added later.)

    Args:
        input_path (str): The input file path which may contain mixed slashes or relative paths

    Returns:
        str: A properly formatted absolute path with consistent slashes
    """
    # Convert to Path object to handle path normalization
    path = Path(input_path)

    # Resolve to absolute path if it's not already
    if not path.is_absolute():
        path = path.resolve()

    # Convert to forward slashes (FFmpeg prefers this on Windows too)
    normalized_path = path.as_posix()

    return normalized_path


@app.route('/api/rating_config', methods=['GET', 'POST'])
def handle_rating_config():
    """
    API to manage rating definitions and category-rating mappings.
    GET: Returns all rating definitions and current mappings.
    POST: Updates rating definitions and mappings.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    if request.method == 'GET':
        # Get all rating definitions
        cursor.execute("SELECT name FROM rating_definitions ORDER BY name")
        rating_definitions = [row[0] for row in cursor.fetchall()]

        # Get all category-rating mappings
        cursor.execute("SELECT file_category, rating_category FROM category_rating_mapping")
        mappings = {}
        for file_cat, rating_cat in cursor.fetchall():
            if file_cat not in mappings:
                mappings[file_cat] = []
            mappings[file_cat].append(rating_cat)

        conn.close()
        return jsonify({
            'rating_definitions': rating_definitions,
            'category_rating_mappings': mappings
        })

    elif request.method == 'POST':
        data = request.json
        new_rating_definitions = data.get('rating_definitions', [])
        new_category_rating_mappings = data.get('category_rating_mappings',
                                                {})

        try:
            # Update rating definitions
            if new_rating_definitions:
                cursor.execute("DELETE FROM rating_definitions WHERE name NOT IN ({})".format(
                    ','.join(['?'] * len(new_rating_definitions))
                ), new_rating_definitions)
            else:
                cursor.execute("DELETE FROM rating_definitions")

            for definition in new_rating_definitions:
                cursor.execute("INSERT OR IGNORE INTO rating_definitions (name) VALUES (?)", (definition,))

            # Update category-rating mappings
            cursor.execute("DELETE FROM category_rating_mapping")
            for file_cat, rating_cats in new_category_rating_mappings.items():
                for rating_cat in rating_cats:
                    cursor.execute("INSERT INTO category_rating_mapping (file_category, rating_category) VALUES (?, ?)",
                                   (file_cat, rating_cat))

            conn.commit()
            return jsonify({'success': True})
        except Exception as e:
            conn.rollback()
            return jsonify({'error': str(e)}), 500
        finally:
            conn.close()


@app.route('/api/batch_update_categories', methods=['POST'])
def batch_update_categories():
    """
    API to batch update categories for multiple files.
    Expects a JSON body with a list of updates:
    {
        "updates": [
            {"filepath": "path/to/file1.txt", "category": "new_category1"},
            {"filepath": "path/to/file2.jpg", "category": "new_category2"}
        ]
    }
    """
    data = request.json
    updates = data.get('updates', [])
    updated_count = 0

    print(f"Received batch_update_categories request. Updates: {updates}")

    if not isinstance(updates, list):
        print("Error: 'updates' is not a list.")
        return jsonify({'error': 'Invalid data format. "updates" must be a list.'}), 400

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        for item in updates:
            filepath = item.get('filepath')
            category = item.get('category')
            is_category_manual = item.get('is_category_manual', 0)

            if not filepath:
                print(f"Skipping update due to missing filepath: {item}")
                continue

            normalized_filepath = normalize_db_filepath(filepath)

            # Fetch existing metadata to preserve other fields (tags, ratings, notes, custom_gallery_keyword, is_hidden, workflow_metadata)
            cursor.execute(
                'SELECT tags, ratings, notes, custom_gallery_keyword, is_hidden, workflow_metadata, file_hash FROM file_metadata WHERE filepath = ?',
                (normalized_filepath,))
            existing_data = cursor.fetchone()

            existing_tags = ''
            existing_ratings_json = '{}'
            existing_notes = ''
            existing_category = ''
            existing_is_hidden = 0
            existing_custom_gallery_keyword = ''
            existing_workflow_metadata_json = None
            existing_file_hash = None

            if existing_data:
                existing_tags = existing_data['tags'] or ''
                if existing_data['ratings'] is not None:
                    existing_ratings_json = existing_data['ratings']
                else:
                    existing_ratings_json = '{}'

                try:
                    json.loads(existing_ratings_json)
                except json.JSONDecodeError:
                    print(f"Warning: Existing ratings JSON for {filepath} is malformed. Setting to empty object.")
                    existing_ratings_json = '{}'

                existing_notes = existing_data['notes'] or ''
                existing_custom_gallery_keyword = existing_data['custom_gallery_keyword'] or ''
                existing_is_hidden = existing_data['is_hidden'] if existing_data['is_hidden'] is not None else 0
                existing_workflow_metadata_json = existing_data['workflow_metadata']
                existing_file_hash = existing_data['file_hash']

            # Calculate current mtime and hash if the file still exists
            current_file_hash = None
            current_file_mtime = None
            if os.path.exists(filepath):
                current_file_hash = calculate_quick_hash(filepath)
                try:
                    current_file_mtime = datetime.fromtimestamp(os.stat(filepath).st_mtime).isoformat()
                except OSError:
                    pass  # Keep as None if inaccessible

            print(f"Updating file: {filepath} with category: {category}, manual: {is_category_manual}")
            cursor.execute('''
                INSERT OR REPLACE INTO file_metadata
                (filepath, tags, ratings, notes, category, is_category_manual, custom_gallery_keyword, is_hidden, file_hash, last_modified, workflow_metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                normalized_filepath,
                existing_tags,
                existing_ratings_json,
                existing_notes,
                category,
                is_category_manual,
                existing_custom_gallery_keyword, # Custom gallery keyword is preserved, not updated in batch
                existing_is_hidden,
                current_file_hash if current_file_hash else existing_file_hash,  # Use new hash if available, else old
                current_file_mtime if current_file_mtime else (
                    existing_data['last_modified'] if existing_data else None),  # Use new mtime if available, else old
                existing_workflow_metadata_json,
            ))
            updated_count += 1

        conn.commit()
        print(f"Batch update committed. Total updated: {updated_count}")
        return jsonify({'success': True, 'updated_count': updated_count})

    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in batch_update_categories: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/suggested_tags')
def get_suggested_tags():
    """
    API to get suggested tags along with their counts.
    Optionally filters by a query string and by the current path.
    """
    query = request.args.get('query', '').lower()
    path = request.args.get('path', os.path.expanduser('~'))
    show_subfolder_content = request.args.get('show_subfolder_content', 'false').lower() == 'true'

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        tag_counts = {}

        file_paths_to_consider = []
        if show_subfolder_content:
            for root, _, files in os.walk(path, followlinks=True):
                for file_name in files:
                    file_paths_to_consider.append(os.path.join(root, file_name))
        else:
            for item in os.listdir(path):
                item_path = os.path.join(path, item)
                if os.path.isfile(item_path):
                    file_paths_to_consider.append(item_path)
                elif os.path.isdir(item_path):
                    # For directories, we need to look at files within them to get tags
                    # This is done by including them in file_paths_to_consider
                    # The get_files logic later filters out actual directories from the file list
                    # This part ensures their contained files' tags are considered for suggestions
                    for root_subdir, _, files_subdir in os.walk(item_path, followlinks=True):
                        for file_name_subdir in files_subdir:
                            file_paths_to_consider.append(os.path.join(root_subdir, file_name_subdir))

        normalized_file_paths = [normalize_db_filepath(p) for p in file_paths_to_consider]

        if normalized_file_paths:
            # Chunk the list of paths for the IN clause to avoid SQLite limits
            chunk_size = 999  # Max number of parameters for IN clause in SQLite is 999
            for i in range(0, len(normalized_file_paths), chunk_size):
                chunk = normalized_file_paths[i:i + chunk_size]
                placeholders = ','.join('?' * len(chunk))
                cursor.execute(
                    f"SELECT tags FROM file_metadata WHERE filepath IN ({placeholders}) AND tags IS NOT NULL AND tags != ''",
                    chunk)
                all_tags_raw = cursor.fetchall()

                for (tags_str,) in all_tags_raw:
                    if tags_str:
                        for tag in tags_str.split(','):
                            cleaned_tag = tag.strip().lower()
                            if cleaned_tag:
                                tag_counts[cleaned_tag] = tag_counts.get(cleaned_tag, 0) + 1

        filtered_tags = []
        for tag, count in tag_counts.items():
            if query in tag:
                filtered_tags.append({'tag': tag, 'count': count})

        filtered_tags.sort(key=lambda x: x['tag'])

        return jsonify(filtered_tags)
    except Exception as e:
        print(f"Error getting suggested tags: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@app.route('/api/gallery_images')
def get_gallery_images():
    """
    API to get relevant images for a given file (Lora/Checkpoint).
    Searches in a configured image directory based on filename or custom keyword.
    """
    filepath = request.args.get('filepath')
    custom_keyword = request.args.get('custom_keyword')

    if not filepath:
        return jsonify({'error': 'File path not provided.'}), 400  # Changed to 400 Bad Request

    # Determine search term: custom keyword from DB, or filename
    conn = None
    search_term = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        normalized_filepath = normalize_db_filepath(filepath)
        cursor.execute("SELECT custom_gallery_keyword FROM file_metadata WHERE filepath = ?",
                       (normalized_filepath,))
        result = cursor.fetchone()
        if result and result['custom_gallery_keyword']:
            search_term = result['custom_gallery_keyword']
            # Ensure that if the DB value is '0', it's treated as empty for search
            if search_term == '0':
                search_term = ''
            print(f"Using custom gallery keyword: {search_term} for {filepath}")
        else:
            # If no custom keyword, use the filename without extension as search term
            # This is derived from the *provided* filepath, not necessarily an existing file
            search_term = os.path.splitext(os.path.basename(filepath))[0]
            print(f"Using filename as search term: {search_term} for {filepath}")

        if not search_term:
            return jsonify({'images': []})

        search_term = search_term.lower()

        gallery_images = []
        allowed_extensions = ('.png', '.jpg', '.jpeg', '.gif', '.webp')
        gallery_max_images = 100

        # Determine the directory to search in. If image_directory is configured, use it.
        # Otherwise, use the directory of the current file.
        image_directory = get_image_directory()
        if not image_directory:
            # Use the directory of the *original* requested filepath for search
            image_directory = os.path.dirname(filepath)
            print(f"Using current file's directory for gallery search: {image_directory}")
        else:
            print(f"Using configured image directory for gallery search: {image_directory}")

        # Proceed to search for gallery images regardless of primary file existence
        for root, _, files in os.walk(image_directory, followlinks=True):
            for file in files:
                if file.lower().endswith(allowed_extensions) and search_term in file.lower():
                    full_image_path = os.path.join(root, file)
                    # Only add images that actually exist
                    if os.path.exists(full_image_path):
                        mtime = os.path.getmtime(full_image_path)
                        gallery_images.append((mtime, full_image_path))

        gallery_images.sort(reverse=True, key=lambda x: x[0])  # Sort images newest first
        # Apply gallery_max_images cutoff before sorting oldest first for display
        gallery_images = gallery_images[:gallery_max_images]
        gallery_images.sort(reverse=False, key=lambda x: x[0])  # Sort images oldest first after cutoff
        gallery_images = [img[1] for img in gallery_images]  # Extract only the paths

        return jsonify({'images': gallery_images})
    except Exception as e:
        print(f"Error getting gallery images: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/open_file_location', methods=['POST'])
def open_file_location():
    """
    Opens the containing folder of a given file in the native file explorer.
    """
    data = request.json
    filepath = data.get('filepath')

    if not filepath:
        return jsonify({'error': 'File path not provided.'}), 400

    # Ensure the path is safe to open
    if not os.path.exists(filepath):
        return jsonify({'error': 'File or directory not found.'}), 404

    try:
        # Get the directory of the file
        directory_to_open = os.path.dirname(filepath)
        if not directory_to_open: # If it's a file in the root of a drive/filesystem
            directory_to_open = filepath if os.path.isdir(filepath) else os.path.dirname(filepath)


        if sys.platform == "win32":
            # On Windows, use 'explorer.exe /select,' to open the folder and select the file
            # Or just 'explorer.exe' to open the folder
            if os.path.isfile(filepath):
                subprocess.Popen(f'explorer.exe /select,"{filepath}"')
            else: # It's a directory
                subprocess.Popen(f'explorer.exe "{filepath}"')
        elif sys.platform == "darwin":
            # On macOS, use 'open -R' to reveal the file in Finder, or 'open' for a directory
            if os.path.isfile(filepath):
                subprocess.Popen(['open', '-R', filepath])
            else: # It's a directory
                subprocess.Popen(['open', filepath])
        else:
            # On Linux, use 'xdg-open' which handles various file types and directories
            subprocess.Popen(['xdg-open', directory_to_open])

        return jsonify({'success': True, 'message': 'File location opened successfully.'})
    except Exception as e:
        print(f"Error opening file location for {filepath}: {e}")
        return jsonify({'error': f'Failed to open file location: {str(e)}'}), 500


if __name__ == '__main__':
    if not hasattr(sys, '_MEIPASS'):
        os.makedirs(resource_path('templates'), exist_ok=True)

    app.run(debug=True, port=5000)
