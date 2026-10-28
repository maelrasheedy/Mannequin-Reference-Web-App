import os
import random
import shutil
from pathlib import Path

# --- CONFIGURATION ---
RAW_DATA_DIR = "./raw_images"       # Root folder containing group_set_a, group_set_b, group_set_c
OUTPUT_DIR = "./assets/image_set"   # Your target root folder
SPLITS = {"set": 0.80, "val": 0.20} # 80/20 train/val split
SEED = 42                           # Ensures reproducibility

def setup_dataset():
    random.seed(SEED)
    raw_path = Path(RAW_DATA_DIR)
    out_path = Path(OUTPUT_DIR)
    
    if not raw_path.exists():
        print(f"Error: Base directory '{RAW_DATA_DIR}' not found.")
        return
        
    target_groups = ["group_set_a", "group_set_b", "group_set_c"]
    available_groups = [f for f in raw_path.iterdir() if f.is_dir() and f.name in target_groups]
    
    if not available_groups:
        print(f"Error: None of the target folders {target_groups} were found inside '{RAW_DATA_DIR}'.")
        return
        
    print(f"Found group sets: {[g.name for g in available_groups]}\n")

    # Build target directories tree: assets/image_set/{set,val}/{group_set_a,b,c}
    for split in SPLITS.keys():
        for group in target_groups:
            (out_path / split / group).mkdir(parents=True, exist_ok=True)

    # Write custom README documentation to prevent data mixing mistakes
    if "set" in SPLITS:
        with open(out_path / "set" / "README_Group_Set.txt", "w") as f:
            f.write("This directory contains the main training dataset (group_set_a, group_set_b, and group_set_c).\n")
        
    if "val" in SPLITS:
        with open(out_path / "val" / "README_Validation.txt", "w") as f:
            f.write("This directory contains the validation dataset (group_set_a, group_set_b, and group_set_c).\n")

    # Distribute the copyright-free mannequin files randomly
    for group_dir in available_groups:
        group_name = group_dir.name
        
        # Gather all web-compatible e-commerce images within this group
        images = [f for f in group_dir.iterdir() if f.suffix.lower() in ['.jpg', '.jpeg', '.png', '.webp']]
        
        random.shuffle(images)
        total_imgs = len(images)
        if total_imgs == 0:
            print(f"Warning: Group '{group_name}' has zero images. Skipping.")
            continue
            
        # Calculate split index
        set_end = max(1, int(total_imgs * SPLITS["set"])) if total_imgs > 1 else 1
        
        split_map = {
            "set": images[:set_end],
            "val": images[set_end:]
        }
        
        # Copy files over cleanly preserving metadata
        for split, file_list in split_map.items():
            for file in file_list:
                dest_path = out_path / split / group_name / file.name
                shutil.copy2(file, dest_path)
                
        print(f"Processed '{group_name}': {len(split_map['set'])} images -> set, {len(split_map['val'])} images -> val.")

if __name__ == "__main__":
    setup_dataset()