import sys
import zlib
import json
import png
from pathlib import Path
from PIL import Image
import re


def extract_workflow_from_png_pypng(png_file_path):
    """Extract using pypng (checks all chunks)"""
    try:
        reader = png.Reader(filename=png_file_path)
        chunks = list(reader.chunks())

        for chunk_type, chunk_data in chunks:
            # Try to decode as JSON (could be in any chunk)
            try:
                # Check if compressed
                try:
                    decompressed = zlib.decompress(chunk_data)
                    text = decompressed.decode('utf-8')
                except:
                    text = chunk_data.decode('utf-8', errors='ignore')

                # Look for JSON structure
                if '"nodes"' in text or '"workflow"' in text:
                    workflow = json.loads(text.strip())
                    return workflow, text
            except:
                continue
        raise ValueError("No workflow found in PNG chunks")
    except Exception as e:
        raise ValueError(f"PyPNG extraction failed: {str(e)}")


def extract_workflow_from_png_pillow(png_file_path):
    """Extract using Pillow (checks metadata)"""
    try:
        with Image.open(png_file_path) as img:
            for key, value in img.info.items():
                if isinstance(value, str):
                    # Check if it's JSON
                    if '"nodes"' in value or '"workflow"' in value:
                        try:
                            workflow = json.loads(value)
                            return workflow, value
                        except:
                            continue
            raise ValueError("No workflow found in Pillow metadata")
    except Exception as e:
        raise ValueError(f"Pillow extraction failed: {str(e)}")


def brute_force_search(png_file_path):
    """Brute-force search for JSON in binary data"""
    try:
        with open(png_file_path, 'rb') as f:
            data = f.read()

        # Search for JSON-like patterns
        text = data.decode('utf-8', errors='ignore')
        matches = re.findall(r'\{.*"nodes".*\}', text, re.DOTALL)

        if matches:
            best_match = max(matches, key=len)  # Take the longest match
            workflow = json.loads(best_match)
            return workflow, best_match

        raise ValueError("No JSON workflow found in binary data")
    except Exception as e:
        raise ValueError(f"Brute-force search failed: {str(e)}")


def save_workflow(output_path, workflow_text, workflow_json):
    """Save workflow to JSON and TXT files"""
    json_path = output_path.with_suffix('.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(workflow_json, f, indent=2)
    print(f"✅ Workflow saved as JSON: {json_path}")

    txt_path = output_path.with_suffix('.txt')
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(workflow_text)
    print(f"✅ Workflow saved as text: {txt_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_comfyui_workflow.py <input.png> [output_name]")
        sys.exit(1)

    input_file = sys.argv[1]
    output_base = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(input_file).with_suffix('')

    print(f"🔍 Extracting workflow from: {input_file}")

    # Try multiple extraction methods
    methods = [
        ("PyPNG (Chunk-based)", extract_workflow_from_png_pypng),
        ("Pillow (Metadata)", extract_workflow_from_png_pillow),
        ("Brute-force (Binary Search)", brute_force_search)
    ]

    for method_name, method_func in methods:
        try:
            print(f"\n🔄 Trying method: {method_name}")
            workflow_json, workflow_text = method_func(input_file)
            save_workflow(output_base, workflow_text, workflow_json)
            print("🎉 Success!")
            sys.exit(0)
        except Exception as e:
            print(f"❌ {method_name} failed: {str(e)}")

    print("\n❌ All extraction methods failed. Possible reasons:")
    print("- The image was saved without workflow data")
    print("- The workflow is stored in a non-standard format")
    print("- Try opening in ComfyUI manually (drag & drop)")
    sys.exit(1)


if __name__ == "__main__":
    main()