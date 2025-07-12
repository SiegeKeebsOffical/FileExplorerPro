import sys
import json
from PIL import Image
import piexif


def extract_json_from_webp(input_file, output_file=None):
    """
    Extracts embedded JSON metadata from a WebP file and saves it to a separate file.

    Args:
        input_file (str): Path to the input WebP file
        output_file (str, optional): Path to the output JSON file.
                                    If None, uses input file name with .json extension.
    """
    try:
        # Open the WebP file
        with Image.open(input_file) as img:
            # Check if the file is a WebP
            if img.format != 'WEBP':
                print(f"Error: Input file is not a WebP image (detected format: {img.format})")
                return False

            # Get all metadata
            metadata = img.info

            # Check for EXIF data
            if 'exif' in metadata:
                try:
                    exif_dict = piexif.load(metadata['exif'])

                    # Check ImageDescription specifically
                    if piexif.ImageIFD.ImageDescription in exif_dict["0th"]:
                        image_desc = exif_dict["0th"][piexif.ImageIFD.ImageDescription]
                        if isinstance(image_desc, bytes):
                            image_desc = image_desc.decode('utf-8')

                        # The JSON appears after "Workflow:" in the string
                        if image_desc.startswith("Workflow:"):
                            json_str = image_desc[len("Workflow:"):].strip()
                            try:
                                json_data = json.loads(json_str)

                                # Determine output filename if not provided
                                if output_file is None:
                                    if input_file.lower().endswith('.webp'):
                                        output_file = input_file[:-5] + '.json'
                                    else:
                                        output_file = input_file + '.json'

                                # Save JSON to file
                                with open(output_file, 'w') as f:
                                    json.dump(json_data, f, indent=2)

                                print(f"Successfully extracted JSON workflow to {output_file}")
                                return True
                            except json.JSONDecodeError as e:
                                print(f"Error parsing JSON from ImageDescription: {e}")
                                print("Partial content:", json_str[:200], "...")
                                return False
                except Exception as ex:
                    print(f"Error reading EXIF data: {ex}")

            print("No valid JSON workflow found in the WebP file.")
            return False

    except Exception as e:
        print(f"Error processing file: {str(e)}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_webp_json.py input.webp [output.json]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    extract_json_from_webp(input_file, output_file)