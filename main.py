import sys
import threading
import time
import os
import requests  # For pinging the Flask server
import configparser
import base64
import shutil # For cleaning up cache directory

# Import Flask app from app.py
try:
    from app import app as flask_app
    # Import the resource_path and get_persistent_dir functions from app.py
    from app import resource_path, get_persistent_dir
except ImportError as e:
    print(f"Error: Could not import Flask app or helper functions from 'app.py': {e}")
    print("Please ensure 'app.py' is correctly placed and has no import issues.")
    sys.exit(1)

# Import Waitress for serving Flask in a production-like manner
try:
    from waitress import serve
except ImportError:
    print("Error: 'waitress' not found.")
    print("Please install it using: pip install waitress")
    sys.exit(1)

from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout,
                             QSizePolicy, QFrame)
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineSettings, QWebEngineProfile
from PyQt5.QtCore import QUrl, QThread, pyqtSignal, pyqtSlot, QByteArray, Qt
from PyQt5.QtGui import QPalette, QColor

# Define the port for the Flask application
FLASK_PORT = 5000
FLASK_URL = f"http://127.0.0.1:{FLASK_PORT}"

# Define the remote debugging port for QWebEngineView (can be any unused port)
WEBENGINE_DEBUG_PORT = 9222

# Define the path for the window configuration file
# Now uses the persistent app data path within the 'cache' folder
WINDOW_CONFIG_FILE = os.path.join(get_persistent_dir(), 'cache', 'window_settings.ini')


class FlaskThread(QThread):
    """
    A QThread subclass to run the Flask application using Waitress in a separate thread.
    This prevents the Flask app from blocking the PyQt GUI and provides better performance.
    """
    flask_ready = pyqtSignal()
    flask_failed = pyqtSignal(str)  # Signal for Flask startup failure

    def run(self):
        """
        Runs the Flask application using Waitress.
        """
        print(f"Starting Flask app on {FLASK_URL} using Waitress...")
        try:
            # Use waitress.serve for a more robust server
            serve(flask_app, host='127.0.0.1', port=FLASK_PORT, threads=8)  # Use more threads for better concurrency
        except Exception as e:
            print(f"Flask app (Waitress) failed to start: {e}")
            self.flask_failed.emit(str(e))  # Emit error message
            sys.exit(-1)  # Exit thread if Flask fails

    def start_flask_server_and_wait(self):
        """
        Starts the Flask development server in its own thread and waits for it to be ready.
        """
        self.start()  # Start the FlaskThread

        # Robust check to wait for Flask to be ready
        max_retries = 30  # Try for up to 30 seconds
        retry_delay = 0.5  # Check every 0.5 seconds
        for i in range(max_retries):
            try:
                # Attempt to connect to a known Flask endpoint (e.g., the root URL)
                response = requests.get(FLASK_URL, timeout=0.5)
                if response.status_code == 200:
                    print(f"Flask app is reachable at {FLASK_URL}")
                    self.flask_ready.emit()  # Signal that Flask is ready
                    return
            except requests.exceptions.ConnectionError:
                print(f"Waiting for Flask app... (Attempt {i + 1}/{max_retries})")
                time.sleep(retry_delay)
            except Exception as e:
                print(f"Error checking Flask status: {e}")
                time.sleep(retry_delay)

        print(f"Flask app did not become ready after {max_retries * retry_delay} seconds.")
        self.flask_failed.emit("Flask server failed to start or become reachable.")


class MainWindow(QMainWindow):
    """
    The main window for the PyQt application, containing the QWebEngineView.
    Enhanced with professional dark theme as a clean container.
    """

    def __init__(self):
        super().__init__()
        self.setWindowTitle("File Explorer Pro")

        # Apply dark theme
        self.apply_dark_theme()

        # Load window settings
        self.config = configparser.ConfigParser()
        # Ensure the directory for WINDOW_CONFIG_FILE exists before trying to read it
        os.makedirs(os.path.dirname(WINDOW_CONFIG_FILE), exist_ok=True)
        self.config.read(WINDOW_CONFIG_FILE)

        # Restore geometry if available, otherwise set default
        if 'Window' in self.config and 'geometry' in self.config['Window']:
            try:
                encoded_geometry = self.config['Window']['geometry']
                decoded_geometry = base64.b64decode(encoded_geometry.encode('utf-8'))
                self.restoreGeometry(QByteArray(decoded_geometry))
                print("Restored window geometry from config.")
            except Exception as e:
                print(f"Error restoring window geometry: {e}. Using default.")
                self.setGeometry(100, 100, 1400, 900)  # Larger default size
        else:
            self.setGeometry(100, 100, 1400, 900)  # Larger default size
            print("No window geometry found in config. Using default.")

        # Set minimum size for better UX
        self.setMinimumSize(800, 600)

        # Setup central widget with custom styling
        self.setup_central_widget()

        # Setup web engine with enhanced settings
        self.setup_web_engine()

        # Start Flask server
        self.flask_thread = FlaskThread()
        self.flask_thread.flask_ready.connect(self.on_flask_ready)
        self.flask_thread.flask_failed.connect(self.on_flask_failed)
        self.flask_thread.start_flask_server_and_wait()

    def apply_dark_theme(self):
        """Apply a professional dark theme to the application"""
        dark_palette = QPalette()

        # Window colors
        dark_palette.setColor(QPalette.Window, QColor(45, 45, 45))
        dark_palette.setColor(QPalette.WindowText, QColor(255, 255, 255))

        # Base colors (for input fields)
        dark_palette.setColor(QPalette.Base, QColor(35, 35, 35))
        dark_palette.setColor(QPalette.AlternateBase, QColor(53, 53, 53))

        # Text colors
        dark_palette.setColor(QPalette.Text, QColor(255, 255, 255))
        dark_palette.setColor(QPalette.BrightText, QColor(255, 0, 0))

        # Button colors
        dark_palette.setColor(QPalette.Button, QColor(53, 53, 53))
        dark_palette.setColor(QPalette.ButtonText, QColor(255, 255, 255))

        # Highlight colors
        dark_palette.setColor(QPalette.Highlight, QColor(42, 130, 218))
        dark_palette.setColor(QPalette.HighlightedText, QColor(0, 0, 0))

        # Disabled colors
        dark_palette.setColor(QPalette.Disabled, QPalette.WindowText, QColor(127, 127, 127))
        dark_palette.setColor(QPalette.Disabled, QPalette.Text, QColor(127, 127, 127))
        dark_palette.setColor(QPalette.Disabled, QPalette.ButtonText, QColor(127, 127, 127))

        QApplication.setPalette(dark_palette)

        # Windows-specific: Enable dark mode for title bar and window chrome
        if sys.platform == "win32":
            try:
                import ctypes
                from ctypes import wintypes

                # Enable dark mode for the window title bar on Windows 10/11
                hwnd = int(self.winId())

                # DWMWA_USE_IMMERSIVE_DARK_MODE
                DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                set_window_attribute = ctypes.windll.dwmapi.DwmSetWindowAttribute
                set_window_attribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.POINTER(ctypes.c_int),
                                                 wintypes.DWORD]

                # Enable dark mode
                dark_mode = ctypes.c_int(1)
                set_window_attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ctypes.byref(dark_mode),
                                     ctypes.sizeof(dark_mode))

                print("Windows dark mode title bar enabled")
            except Exception as e:
                print(f"Could not enable Windows dark title bar: {e}")

        # Apply additional stylesheet for fine-tuning
        self.setStyleSheet("""
            QMainWindow {
                background-color: #2d2d2d;
                color: #ffffff;
            }

            QFrame#browser_frame {
                background-color: #1e1e1e;
                border: 2px solid #555555;
                border-radius: 8px;
                margin: 4px;
            }
        """)

    def setup_central_widget(self):
        """Setup the central widget with professional styling"""
        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QVBoxLayout(self.central_widget)
        self.layout.setContentsMargins(8, 8, 8, 8)  # Add some padding

        # Create a frame for the browser to add border styling
        self.browser_frame = QFrame()
        self.browser_frame.setObjectName("browser_frame")
        self.browser_frame.setFrameStyle(QFrame.NoFrame)

        frame_layout = QVBoxLayout(self.browser_frame)
        frame_layout.setContentsMargins(0, 0, 0, 0)

        self.browser = QWebEngineView()
        self.browser.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        frame_layout.addWidget(self.browser)

        self.layout.addWidget(self.browser_frame)

    def setup_web_engine(self):
        """Setup web engine with enhanced settings and performance optimizations"""
        # Environment Variables for Chromium flags
        if sys.platform == "win32":
            os.environ["QT_QPA_PLATFORM"] = "windows:darkmode=2"

        # Enhanced Chromium command-line arguments for better video support
        chromium_flags = [
            # GPU and hardware acceleration
            "--enable-gpu-rasterization",
            "--enable-accelerated-video-decode",
            "--enable-accelerated-mjpeg-decode",
            "--enable-gpu-memory-buffer-video-frames",
            "--enable-zero-copy",

            # Video codec support
            "--enable-features=VaapiVideoDecoder,VaapiVideoEncoder",
            "--enable-hardware-overlays",
            "--use-gl=desktop",  # Use desktop OpenGL

            # Media and codec flags
            "--autoplay-policy=no-user-gesture-required",
            "--enable-experimental-web-platform-features",
            "--enable-features=MediaFoundationH264Encoding",

            # Performance optimizations
            "--max_old_space_size=4096",
            "--js-flags=--max-old-space-size=4096",
            "--memory-pressure-off",
            "--max_old_space_size=8192",

            # Security relaxation for local content (be cautious with these in production)
            "--disable-web-security",
            "--allow-running-insecure-content",
            "--disable-features=VizDisplayCompositor",

            # Additional codec support
            "--enable-proprietary-codecs",
            "--enable-features=WebRTC-H264WithOpenH264FFmpeg",

            # Prevent throttling
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",

            # Dark mode support
            "--force-dark-mode",
            "--enable-features=WebUIDarkMode",
        ]

        # Platform-specific optimizations
        if sys.platform == "win32":
            chromium_flags.extend([
                "--enable-media-foundation-video-capture",
                "--force-color-profile=srgb",
            ])
        elif sys.platform.startswith("linux"):
            chromium_flags.extend([
                "--enable-features=VaapiVideoDecoder",
                "--use-gl=desktop",
            ])
        elif sys.platform == "darwin":  # macOS
            chromium_flags.extend([
                "--enable-features=Metal",
            ])

        os.environ['QTWEBENGINE_CHROMIUM_FLAGS'] = " ".join(chromium_flags)
        os.environ['QTWEBENGINE_REMOTE_DEBUGGING'] = str(WEBENGINE_DEBUG_PORT)

        print(f"PyQtWebEngine Chromium flags: {os.environ['QTWEBENGINE_CHROMIUM_FLAGS']}")
        print(f"PyQtWebEngine remote debugging enabled on port {WEBENGINE_DEBUG_PORT}")

        # Enhanced QWebEngineSettings
        settings = QWebEngineSettings.globalSettings()

        # Core settings
        settings.setAttribute(QWebEngineSettings.PluginsEnabled, True)
        settings.setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.LocalStorageEnabled, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.AllowRunningInsecureContent, True)

        # Media and autoplay settings
        settings.setAttribute(QWebEngineSettings.PlaybackRequiresUserGesture, False)
        settings.setAttribute(QWebEngineSettings.AllowWindowActivationFromJavaScript, True)

        # Performance settings
        settings.setAttribute(QWebEngineSettings.Accelerated2dCanvasEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebGLEnabled, True)

        # Hide scrollbars to prevent double scrollbars
        settings.setAttribute(QWebEngineSettings.ShowScrollBars, True)

        # Enable error page for debugging
        settings.setAttribute(QWebEngineSettings.ErrorPageEnabled, True)

        # Set up custom profile for additional control
        profile = QWebEngineProfile.defaultProfile()
        profile.setHttpUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

        # Set cache and storage paths to the persistent 'cache' folder
        cache_path = os.path.join(get_persistent_dir(), "cache")
        os.makedirs(cache_path, exist_ok=True) # Ensure this directory exists
        profile.setCachePath(cache_path)
        profile.setPersistentStoragePath(cache_path)

    @pyqtSlot()
    def on_flask_ready(self):
        """
        Slot connected to the FlaskThread's flask_ready signal.
        Loads the Flask app's URL into the QWebEngineView once Flask is ready.
        """
        print(f"Flask app is ready. Loading {FLASK_URL} in browser...")
        self.browser.setUrl(QUrl(FLASK_URL))

    @pyqtSlot(str)
    def on_flask_failed(self, error_message):
        """
        Slot connected to the FlaskThread's flask_failed signal.
        Handles cases where the Flask server fails to start.
        """
        print(f"Flask server failed to start: {error_message}")

        error_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Server Error</title>
            <style>
                body {{
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
                    color: #ffffff;
                    margin: 0;
                    padding: 40px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                }}
                .container {{
                    background: rgba(45, 45, 45, 0.9);
                    border-radius: 12px;
                    padding: 40px;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                    border: 1px solid #555;
                    max-width: 600px;
                    text-align: center;
                }}
                h1 {{
                    color: #ff6b6b;
                    margin-bottom: 20px;
                    font-size: 2.2em;
                    font-weight: 300;
                }}
                p {{
                    line-height: 1.6;
                    margin-bottom: 15px;
                    color: #cccccc;
                }}
                .error-details {{
                    background: #3a3a3a;
                    border-left: 4px solid #ff6b6b;
                    padding: 15px;
                    border-radius: 6px;
                    margin: 20px 0;
                    font-family: 'Courier New', monospace;
                    font-size: 0.9em;
                    text-align: left;
                    overflow-x: auto;
                }}
                .icon {{
                    font-size: 4em;
                    margin-bottom: 20px;
                    opacity: 0.7;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">⚠️</div>
                <h1>Backend Server Error</h1>
                <p>The Flask backend server could not be started or reached.</p>
                <p>Please ensure <strong>app.py</strong> is correctly placed and has no import issues.</p>
                <div class="error-details">
                    <strong>Error Details:</strong><br>
                    {error_message}
                </div>
                <p><em>Check the console for additional debugging information.</em></p>
            </div>
        </body>
        </html>
        """
        self.browser.setHtml(error_html)

    def closeEvent(self, event):
        """
        Handles the window close event.
        Ensures the Flask thread is terminated gracefully and saves window geometry.
        """
        print("Closing application. Stopping Flask server and saving window settings...")

        # Save window geometry
        geometry = self.saveGeometry()
        encoded_geometry = base64.b64encode(geometry.data()).decode('utf-8')

        if 'Window' not in self.config:
            self.config['Window'] = {}
        self.config['Window']['geometry'] = encoded_geometry

        try:
            # Ensure the directory for WINDOW_CONFIG_FILE exists before writing
            os.makedirs(os.path.dirname(WINDOW_CONFIG_FILE), exist_ok=True)
            with open(WINDOW_CONFIG_FILE, 'w') as configfile:
                self.config.write(configfile)
            print(f"Window geometry saved to {WINDOW_CONFIG_FILE}")
        except Exception as e:
            print(f"Error saving window geometry to config file: {e}")

        # Clean up cache directory on exit (this is the persistent 'cache' folder)
        cache_path = os.path.join(get_persistent_dir(), "cache")
        try:
            if os.path.exists(cache_path):
                shutil.rmtree(cache_path)
                print("Cleaned up cache directory")
        except Exception as e:
            print(f"Error cleaning up cache: {e}")

        # Terminate Flask thread
        self.flask_thread.terminate()
        self.flask_thread.wait(5000)
        if self.flask_thread.isRunning():
            print("Warning: Flask thread did not terminate gracefully.")
        print("Flask server stopped.")
        event.accept()


if __name__ == "__main__":
    # Set environment variables before QApplication creation
    os.environ['QT_AUTO_SCREEN_SCALE_FACTOR'] = '1'
    os.environ['QT_ENABLE_HIGHDPI_SCALING'] = '1'

    # QApplication attributes should be set before QApplication is instantiated
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps)
    QApplication.setAttribute(Qt.AA_ShareOpenGLContexts)  # Important for video rendering

    app = QApplication(sys.argv)

    # Set application properties
    app.setApplicationName("File Explorer Pro")
    app.setApplicationVersion("1.0")
    app.setOrganizationName("Your Organization")

    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
