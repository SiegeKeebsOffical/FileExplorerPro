import json
import os
import zlib # Added for potential decompression if needed, though not directly used in the final version
from pathlib import Path # Added for Path object usage, though not directly used in analyze_workflow signature
import re # Added for regex usage, though not directly used in analyze_workflow signature

def load_comfyui_workflow(file_path):
    """
    Loads a ComfyUI workflow from a JSON file.

    Args:
        file_path (str): The path to the ComfyUI workflow JSON file.

    Returns:
        dict: The parsed JSON workflow as a dictionary.
              Returns None if the file is not found or is invalid JSON.
    """
    if not os.path.exists(file_path):
        print(f"Error: File not found at '{file_path}'")
        return None
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)
        return workflow
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format in '{file_path}': {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred while loading the file: {e}")
        return None

def find_image_save_node(nodes):
    """
    Identifies the primary image saving node in the ComfyUI workflow.
    It looks for nodes that have "save" in their type and accept an image input.

    Args:
        nodes (dict): A dictionary of nodes from the ComfyUI workflow,
                      keyed by node ID.

    Returns:
        tuple: (node_id, node_details) of the image save node, or (None, None) if not found.
    """
    image_save_keywords = ["save", "output", "export"]
    for node_id, node_data in nodes.items():
        # Use 'type' as per the user's script for node classification
        node_type = node_data.get('type', '').lower()
        # Check if the type contains any image save related keywords
        if any(keyword in node_type for keyword in image_save_keywords):
            # Further check if it has an image input. This is a heuristic.
            # Real ComfyUI outputs might be more complex, but 'inputs' usually has 'image' type.
            # We assume a node with 'type' containing 'save' and having an 'image' input
            # is a likely candidate.
            if 'inputs' in node_data: # For programmatic access to inputs, not 'widgets_values'
                 for input_def in node_data['inputs']:
                    if input_def.get('type', '').lower() == 'image':
                        print(f"Identified potential image save node: ID {node_id}, Type: {node_data.get('type')}")
                        return node_id, node_data
            # As a fallback, check if there's a specific 'Image' type in input links that point to it
            # This requires inspecting links, which is done later in trace_inputs
            # For now, rely on type and potential programmatic 'inputs' if available.
            elif node_data.get('type') == 'Save Image': # Direct match for a common node
                 print(f"Identified default 'Save Image' node: ID {node_id}, Type: {node_data.get('type')}")
                 return node_id, node_data
    print("Warning: Could not definitively identify an image save node.")
    return None, None

def get_node_inputs_from_links(target_node_id, all_links):
    """
    Finds all links that feed into a specific target node.

    Args:
        target_node_id (str): The ID of the node whose inputs we are looking for.
        all_links (list): The 'links' array from the ComfyUI workflow.

    Returns:
        list: A list of tuples, where each tuple contains
              (output_node_id, output_index, input_node_id, input_index, type)
              for links feeding into target_node_id.
    """
    incoming_links = []
    for link in all_links:
        # Link format: [link_num, output_node_id, output_idx, input_node_id, input_idx, type]
        if link[3] == int(target_node_id): # Ensure target_node_id is int for comparison
            incoming_links.append(link)
    return incoming_links

def _handle_conditioning_link(current_node_id, link, nodes, identified_inputs, _traverse, all_links_in_workflow):
    """
    Handles conditioning links to identify positive and negative prompts.
    It recursively traces back for STRING/TEXT inputs or widgets_values for prompt extraction.

    Args:
        current_node_id (str): The ID of the current node being processed.
        link (list): The current link being analyzed.
        nodes (dict): All nodes in the workflow (keyed by string ID).
        identified_inputs (dict): The dictionary to store identified inputs.
        _traverse (function): The recursive traversal function to continue general tracing.
        all_links_in_workflow (list): The complete 'links' array from the workflow.
    """
    output_node_id = str(link[1])
    input_index_on_current_node = link[4]
    node_data = nodes.get(current_node_id) # Get node_data for the current node

    input_name_on_current_node = None
    if node_data and 'inputs' in node_data and isinstance(node_data['inputs'], list):
        if input_index_on_current_node < len(node_data['inputs']):
            input_name_on_current_node = node_data['inputs'][input_index_on_current_node].get('name', '').lower()

    category = None
    if input_name_on_current_node and "positive" in input_name_on_current_node:
        category = "Positive Prompts"
    elif input_name_on_current_node and "negative" in input_name_on_current_node:
        category = "Negative Prompts"

    if category:
        prompt_found = False
        prompt_visited = set() # Local visited set for this prompt path to prevent infinite loops

        def _trace_prompt_source(node_id_to_trace):
            nonlocal prompt_found
            if node_id_to_trace in prompt_visited:
                return [] # Already visited this node in this prompt path, return empty list of parts
            prompt_visited.add(node_id_to_trace)

            source_node_data = nodes.get(node_id_to_trace)
            if not source_node_data or source_node_data.get('mode', 0) != 0: # Node disabled or missing
                return []

            current_node_prompt_parts = []
            source_node_type = source_node_data.get('type', 'Unknown Source')

            # Handle "concat" nodes specially: combine internal widgets_values and linked text inputs
            if "concat" in source_node_type.lower():
                # Recursively trace incoming STRING/TEXT/CONDITIONING links first
                source_incoming_links = get_node_inputs_from_links(node_id_to_trace, all_links_in_workflow)
                for incoming_link in source_incoming_links:
                    upstream_node_id = str(incoming_link[1])
                    upstream_link_type = incoming_link[5]
                    if upstream_link_type in ["STRING", "TEXT", "CONDITIONING"]:
                        traced_parts = _trace_prompt_source(upstream_node_id)
                        if traced_parts:
                            current_node_prompt_parts.extend(traced_parts)

                # Then, add this node's widgets_values as well
                if 'widgets_values' in source_node_data and source_node_data['widgets_values']:
                    # Assuming widget_values usually contains the string for concat nodes
                    current_node_prompt_parts.extend([str(v) for v in source_node_data['widgets_values'] if isinstance(v, (str, int, float))])

            else: # Standard node (not a "concat" type)
                # Prioritize linked STRING/TEXT inputs
                found_upstream_text = False
                source_incoming_links = get_node_inputs_from_links(node_id_to_trace, all_links_in_workflow)
                for incoming_link in source_incoming_links:
                    upstream_node_id = str(incoming_link[1])
                    upstream_link_type = incoming_link[5]

                    if upstream_link_type in ["STRING", "TEXT", "CONDITIONING"]:
                        # If a text source is found upstream, add it and mark as found
                        traced_parts = _trace_prompt_source(upstream_node_id)
                        if traced_parts:
                            current_node_prompt_parts.extend(traced_parts)
                            found_upstream_text = True
                            # Removed break here to allow multiple inputs to a text node, e.g., for multi-line inputs.
                            # The 'concat' logic should primarily handle combining, but some nodes might just take multiple text inputs.

                # If no upstream STRING/TEXT input was found, use widgets_values as a fallback
                if not found_upstream_text and 'widgets_values' in source_node_data and source_node_data['widgets_values']:
                    # Heuristic: assuming the first widget_value is the prompt text
                    if len(source_node_data['widgets_values']) > 0 and isinstance(source_node_data['widgets_values'][0], str):
                         current_node_prompt_parts.append(source_node_data['widgets_values'][0])
                    # If it's a number or other simple type, convert to string
                    elif len(source_node_data['widgets_values']) > 0:
                        current_node_prompt_parts.append(str(source_node_data['widgets_values'][0]))

            return current_node_prompt_parts

        # Start tracing from the node that outputs the CONDITIONING (output_node_id)
        # We need to collect all prompt parts from the chain.
        all_prompt_parts = _trace_prompt_source(output_node_id)

        if all_prompt_parts:
            # Join all collected parts to form the final prompt string
            final_prompt = " ".join(all_prompt_parts).strip()
            # Add to identified_inputs, ensuring no duplicates for the same prompt value
            if category not in identified_inputs:
                identified_inputs[category] = []
            if not any(item['value'] == final_prompt for item in identified_inputs[category]):
                # Add the 'origin' node (the first text-generating node found) for reference,
                # though the 'value' now represents the full concatenated prompt.
                # For simplicity, we can use the `output_node_id` as the primary source reference here.
                # A more complex solution might find the *earliest* source node.
                identified_inputs[category].append({
                    "node_id": output_node_id, # This is the immediate source of CONDITIONING
                    "node_type": nodes.get(output_node_id, {}).get('type', 'Unknown Type'),
                    "title": nodes.get(output_node_id, {}).get('title', f"Node {output_node_id}"),
                    "type": "TEXT", # Always mark as TEXT for prompts
                    "value": final_prompt
                })
                prompt_found = True # Mark that a prompt was found and recorded

        # Regardless of whether a prompt was explicitly found, continue general traversal
        # if the path hasn't been fully explored. This is to ensure all relevant nodes
        # in the general workflow are visited if they have other non-prompt inputs.
        # The `_trace_prompt_source` function handles its own visited set for this specific path.
        pass # No need for _traverse(output_node_id) here, as _trace_prompt_source already handles the traversal for prompt-related nodes.



def trace_workflow_inputs(start_node_id, workflow):
    """
    Recursively traces back the workflow from a starting node to identify all inputs.

    Args:
        start_node_id (str): The ID of the node to start tracing from (e.g., the image save node).
        workflow (dict): The parsed ComfyUI workflow.

    Returns:
        dict: A dictionary containing identified inputs, structured by category (e.g., models, prompts).
    """
    # Nodes might be a dict or a list, ensure we handle it as a dict keyed by node ID
    nodes_raw = workflow.get('nodes', {})
    nodes = {}
    if isinstance(nodes_raw, dict):
        nodes = {str(k): v for k, v in nodes_raw.items()}
    elif isinstance(nodes_raw, list):
        for node_data in nodes_raw:
            node_id = node_data.get('id')
            if node_id is not None:
                nodes[str(node_id)] = node_data
            else:
                print(f"Warning: Node in list format found without an 'id' field: {node_data}")
    else:
        print("Error: 'nodes' data in workflow is neither a dictionary nor a list. Cannot trace inputs.")
        return {}


    links = workflow.get('links', []) # Ensure links default to empty list if not present
    identified_inputs = {}
    visited = set() # To prevent infinite loops in cyclic graphs

    def _traverse(current_node_id):
        if current_node_id in visited:
            return
        visited.add(current_node_id)

        node_data = nodes.get(current_node_id)
        if not node_data:
            print(f"Warning: Node ID {current_node_id} not found in workflow nodes.")
            return

        node_type = node_data.get('type', 'Unknown Type') # Use 'type' as per user's script
        node_title = node_data.get('title', f"Node {current_node_id} ({node_type})")

        # Check for inputs via links
        incoming_links = get_node_inputs_from_links(current_node_id, links)

        if not incoming_links:
            # This is a source node (no inputs via links)
            # Its widgets_values would have been recorded above or are part of special handling.
            if node_data.get('mode', 0) == 0:
                # Only add to 'Source Nodes' if it hasn't already been added with parameters
                # and is not a known prompt type that might have been skipped above.
                # Removed the condition for "cliptextencode" as it's handled by _handle_conditioning_link
                if not ('widgets_values' in node_data and node_data['widgets_values']):
                    if "Source Nodes (No Parameters)" not in identified_inputs:
                        identified_inputs["Source Nodes (No Parameters)"] = []
                    identified_inputs["Source Nodes (No Parameters)"].append({
                        "node_id": current_node_id,
                        "node_type": node_type,
                        "title": node_title,
                        "description": "Node with no incoming links and no explicit parameters."
                    })
        else:
            # Recursively trace inputs
            for link in incoming_links:
                output_node_id = str(link[1])
                link_type = link[5]

                if link_type == "CONDITIONING":
                    _handle_conditioning_link(current_node_id, link, nodes, identified_inputs, _traverse, links) # Pass links
                # This checks if the model is a lora or base model
                elif link_type == "MODEL":
                    output_node_data = nodes.get(output_node_id)
                    if output_node_data and output_node_data.get('mode', 0) == 0:
                        model_type = output_node_data.get('type', 'Unknown Model Source')
                        model_title = output_node_data.get('title', f"Node {output_node_id} ({model_type})")
                        model_value = output_node_data.get('widgets_values', [])
                        if model_value:
                            # Define keywords for common base and LoRA loader types
                            lora_loader_keywords = ["lora", "loraloader", "loadlora", "applylora", "apply_lora"]

                            # Check if the node type strongly indicates a base or LoRA loader
                            if any(keyword in model_type.lower() for keyword in lora_loader_keywords):
                                category = "LoRA Models"
                            else:
                                # Fallback: if node type doesn't clearly define, use the 'model' input heuristic
                                # This handles generic "Apply Model" nodes or custom loaders
                                has_model_input = False
                                if 'inputs' in output_node_data and isinstance(output_node_data['inputs'], list):
                                    for input_def in output_node_data['inputs']:
                                        # Check for an input named 'model' of type 'MODEL'
                                        if input_def.get('name', '').lower() == 'model' and input_def.get(
                                                'type') == 'MODEL':
                                            has_model_input = True
                                            break
                                if has_model_input:
                                    category = "LoRA Models"  # If it consumes a model input, it's likely a LoRA or similar transformer
                                else:
                                    # If it produces a model output but doesn't consume one (and not covered by keywords),
                                    # it's likely a base model or a custom model source.
                                    category = "Base Models"

                            if category not in identified_inputs:
                                identified_inputs[category] = []

                            # Add only if not already present to avoid duplicates for the same node ID within a category
                            if not any(item['node_id'] == output_node_id and item.get('type') == link_type for item in
                                       identified_inputs[category]):
                                identified_inputs[category].append({
                                    "node_id": output_node_id,
                                    "node_type": model_type,
                                    "title": model_title,
                                    "type": link_type,
                                    "value": model_value
                                })
                            _traverse(output_node_id)  # Continue tracing from the model source
                    else:
                        _traverse(output_node_id)
                # elif link_type in ["MODEL", "VAE", "CLIP", "LATENT", "CFG", "SAMPLER", "SCHEDULER", "DENOISE", "STEPS"]:
                elif link_type in ["VAE", "LATENT", "CFG", "SAMPLER", "SCHEDULER", "DENOISE", "STEPS"]:
                    output_node_data = nodes.get(output_node_id)
                    if output_node_data and output_node_data.get('mode', 0) == 0: # Ensure node is enabled
                        output_type = output_node_data.get('type', 'Unknown Source')
                        output_node_title = output_node_data.get('title', f"Node {output_node_id} ({output_type})")

                        if 'widgets_values' in output_node_data and output_node_data['widgets_values']:
                            if link_type not in identified_inputs:
                                identified_inputs[link_type] = []
                            identified_inputs[link_type].append({
                                "node_id": output_node_id,
                                "node_type": output_type,
                                "title": output_node_title,
                                "type": link_type,
                                "value": output_node_data['widgets_values']
                            })
                        _traverse(output_node_id)
                    else:
                        _traverse(output_node_id) # Still traverse if node is disabled or missing to find source
                else:
                    _traverse(output_node_id) # General traversal for unknown link types

    _traverse(start_node_id)
    return identified_inputs

def process_workflow_metadata(raw_metadata):
    """
    Processes raw workflow metadata to flatten single-element lists
    and extract filenames from paths for specific categories.
    """
    processed_metadata = {}
    for category, items in raw_metadata.items():
        processed_items = []
        node_ids = []
        for item in items:
            if item.get('node_id') not in node_ids:
                if isinstance(items, list):
                    # Assuming 'item' is a dictionary with a 'value' key
                    if 'value' in item and isinstance(item['value'], list) and len(item['value']) == 1:
                        value_to_process = item['value'][0]
                        if isinstance(value_to_process, str):
                            # Apply filename extraction for relevant categories
                            # Note: 'category' here refers to the top-level key like "Base Models", "VAE"
                            # Make sure these match the keys in your `identified_inputs`
                            if category in ['Base Models', 'VAE', 'CLIP', 'Checkpoint', 'Model', 'LoRA Models']: # Add all relevant categories here
                                item['value'] = os.path.basename(value_to_process)
                            else:
                                item['value'] = value_to_process # Flatten string list
                        else:
                            item['value'] = value_to_process # Flatten non-string list (e.g., numbers)
                    # If 'value' is already a single string or not a list, keep it as is
                    processed_items.append(item)
                else:
                    # If the top-level value for a category is not a list of items,
                    # (e.g., if it's a single value directly) handle it if needed,
                    # but based on `trace_workflow_inputs`, categories usually contain lists of dicts.
                    processed_items = items # Keep as is if not a list of items

                node_ids.append(item.get('node_id'))

        processed_metadata[category] = processed_items
    return processed_metadata

def analyze_comfyui_workflow(workflow: dict): # Changed signature to accept dict
    """
    Main function to analyze a ComfyUI workflow (as a dictionary) and identify inputs.

    Args:
        workflow (dict): The parsed JSON workflow as a dictionary.

    Returns:
        dict: A dictionary of identified inputs, or None if analysis fails.
    """
    if not isinstance(workflow, dict):
        print("Error: Input workflow is not a dictionary. Aborting analysis.")
        return None

    # Handle 'nodes' being a list or a dictionary
    nodes_raw = workflow.get('nodes', {})
    nodes_dict = {}
    if isinstance(nodes_raw, dict):
        nodes_dict = {str(k): v for k, v in nodes_raw.items()}
    elif isinstance(nodes_raw, list):
        for node_data in nodes_raw:
            node_id = node_data.get('id') # Nodes in a list usually have an 'id' key
            if node_id is not None:
                nodes_dict[str(node_id)] = node_data
            else:
                print(f"Warning: Node in list format found without an 'id' field: {node_data}")
        print(f"Detected 'nodes' as a list and converted to dictionary for processing. Total nodes: {len(nodes_dict)}")
    else:
        print("Error: 'nodes' data in workflow is neither a dictionary nor a list. Aborting.")
        return None

    links = workflow.get('links', [])

    if not nodes_dict or not links:
        print("Error: Workflow JSON missing 'nodes' or 'links' data or could not parse 'nodes'.")
        return None

    # 1. Identify the image saving node
    image_save_node_id, image_save_node_data = find_image_save_node(nodes_dict)

    if not image_save_node_id:
        print("Could not find a suitable image save node to start tracing from. Aborting.")
        return None

    print(f"\nStarting input trace from Image Save Node: ID {image_save_node_id}, Type: {image_save_node_data.get('type')}")

    # 2. Trace back inputs from the image saving node
    identified_inputs = trace_workflow_inputs(image_save_node_id, workflow)

    # 3. Process the identified inputs to flatten lists and extract filenames
    processed_identified_inputs = process_workflow_metadata(identified_inputs)

    return processed_identified_inputs

def print_identified_inputs(inputs):
    """
    Prints the identified inputs in a structured, readable format.
    """
    if not inputs:
        print("\nNo specific inputs identified for the output image.")
        return

    print("\n--- Identified Workflow Inputs ---")
    for category, items in inputs.items():
        print(f"\nCategory: {category}")
        node_ids = []
        for item in items:
            if item.get('node_id') not in node_ids:
                print(f"  Node ID: {item.get('node_id')}")
                print(f"  Node Type: {item.get('node_type')}")
                if 'title' in item:
                    print(f"  Title: {item.get('title')}")
                if 'type' in item:
                    print(f"  Type: {item.get('type')}")
                if 'value' in item:
                    print(f"  Value: {item.get('value')}")
                if 'parameters' in item:
                    print(f"  Parameters:")
                    for param_idx, param_val in enumerate(item['parameters']):
                        print(f"    - [{param_idx}]: {param_val}")
                if 'description' in item:
                    print(f"  Description: {item.get('description')}")
                print("-" * 30)
                node_ids.append(item.get('node_id'))

if __name__ == "__main__":
    # Example usage: Replace 'path/to/your/comfyui_workflow.json' with your file
    example_workflow_path = "C:\\Tools\\PythonProjects\\Temp\\chroma.json"

    # Load the workflow first, then pass the dictionary to analyze_comfyui_workflow
    workflow_data = load_comfyui_workflow(example_workflow_path)
    if workflow_data:
        identified_workflow_inputs = analyze_comfyui_workflow(workflow_data)

        # Print the results
        print_identified_inputs(identified_workflow_inputs)
    else:
        print(f"Failed to load workflow from {example_workflow_path}.")