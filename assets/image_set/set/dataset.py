import os
import random
import shutil
from pathlib import Path

# --- CONFIGURATION ---
RAW_DATA_DIR = "./raw_images"       # Folder containing raw class folders (e.g., group_set_a) (Change Here Later!)
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
        
    classes = [f.name for f in raw_path.iterdir() if f.is_dir()]
    print(f"Found classes: {classes}\n")

    # Build target directories tree
    for split in SPLITS.keys():
        for cls in classes:
            (out_path / split / cls).mkdir(parents=True, exist_ok=True)

    # Write custom README files into the root of each split dynamically
    if "set" in SPLITS:
        with open(out_path / "set" / "README_Group_Set.txt", "w") as f:
            f.write("This directory contains the main training dataset (group_set_a, etc.).\n")
        
    if "val" in SPLITS:
        with open(out_path / "val" / "README_Validation.txt", "w") as f:
            f.write("This directory contains the verification/validation dataset.\n")

    # Distribute the files randomly
    for cls in classes:
        cls_dir = raw_path / cls
        images = [f for f in cls_dir.iterdir() if f.suffix.lower() in ['.jpg', '.jpeg', '.png', '.webp']]
        
        random.shuffle(images)
        total_imgs = len(images)
        if total_imgs == 0:
            print(f"Warning: Class '{cls}' has zero images. Skipping.")
            continue
            
        set_end = max(1, int(total_imgs * SPLITS["set"])) if total_imgs > 1 else 1
        
        split_map = {
            "set": images[:set_end],
            "val": images[set_end:]
        }
        
        for split, file_list in split_map.items():
            for file in file_list:
                dest = out_path / split / cls / file.name
                shutil.copy2(file, dest)
                
        print(f"Class '{cls}': Distributed {len(split_map['set'])} to set/ and {len(split_map['val'])} to val/ (Total: {total_imgs})")

if __name__ == "__main__":
    setup_dataset()
    print(f"\nTree successfully populated at {OUTPUT_DIR}!")