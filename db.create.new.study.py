import sqlite3
import sys
import csv
import json
import os
import shutil
from tabulate import tabulate

DATABASE = "database/database.db"
CLIENT_ROOT = "src/client"

def create_study_table(conn):
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS study (
            study_id INTEGER PRIMARY KEY,
            study_type INTEGER CHECK(study_type IN (1, 2, 3, 4, 5)),
            total_pages INTEGER
        )
    ''')
    conn.commit()

def insert_study_record(conn, study_id, study_type, total_pages):
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO study (study_id, study_type, total_pages) VALUES (?, ?, ?)",
                       (study_id, study_type, total_pages))
        conn.commit()
        print("Record inserted successfully.")
    except sqlite3.IntegrityError:
        print("Error: Study ID already exists.")
        sys.exit(3)

def read_csv_data(csv_file):
    data = {}
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        # Read all rows into a list of dicts
        rows = list(reader)
        # Build a dict of lists for each column
        for col in reader.fieldnames:
            data[col] = [row[col] for row in rows]
    return data, len(rows)

def build_layout(study_type, csv_columns):
    """
    Based on study_type and available columns, define the layout.
    study_type: 1=one image, 2=two images, 3=three images, 4=four images.
    We also detect if SHAP or counterfactual columns exist.
    """
    layout = {"row1": [], "row2": []}
    
    # Row 1: always start with patient image
    layout["row1"].append({
        "type": "patient_image",
        "id_field": "PATIENT_ID",
        "image_field": "X_RAY_IMAGE"
    })
    
    # Add additional cards based on study_type and available columns
    if study_type >= 2:
        # Check for SHAP columns
        if "Shap" in csv_columns and "Shap_Caption" in csv_columns:
            layout["row1"].append({
                "type": "shap_image",
                "image_field": "Shap",
                "caption_field": "Shap_Caption",
                "title": "Important Features",
                "colorbar": "../shared_assets/imgs/colorbar.png"
            })
        # Check for counterfactual columns (Example1, Example2, Example3)
        elif "Example1" in csv_columns:
            for i in range(1, study_type):  # we already have 1 card, so add study_type-1 more
                if f"Example{i}" in csv_columns:
                    layout["row1"].append({
                        "type": "counterfactual",
                        "image_field": f"Example{i}",
                        "caption_field": f"Example{i}_Caption",
                        "title": f"Counterfactual {i}"
                    })
        # If neither, maybe it's a concept list? Check for Concept1_Description
        elif "Concept1_Description" in csv_columns:
            # We'll add a concept list card
            bullet_fields = []
            # Find all Concept*_Description columns
            for col in csv_columns:
                if col.startswith("Concept") and col.endswith("_Description"):
                    bullet_fields.append(col)
            if bullet_fields:
                layout["row1"].append({
                    "type": "concept_list",
                    "title": "Concept Contributions",
                    "bullet_fields": bullet_fields
                })
        else:
            # Fallback: just repeat patient image? but better to warn
            print("Warning: Unknown additional columns for study_type > 1. Using default patient image only.")
    
    # Row 2: fixed components
    layout["row2"] = [
        {
            "type": "symptoms_list",
            "symptoms": ["Strong Spine Bend", "Strong Bone Variation", "Tucked Head", "Main Bones Mutation"]
        },
        {
            "type": "diagnosis_card",
            "show_true": True,   # you can decide based on study type
            "show_present": True,
            "ai_field": "SUGGESTED_DIAG",
            "true_field": "TRUE_DIAG",
            "present_field": "X_RAY_TRAIT"
        },
        {
            "type": "warning_card"
        }
    ]
    return layout

def create_study_folder(study_id):
    study_folder = os.path.join(CLIENT_ROOT, f"study_id_{study_id}")
    os.makedirs(study_folder, exist_ok=True)
    img_folder = os.path.join(study_folder, "img")
    os.makedirs(img_folder, exist_ok=True)
    return study_folder, img_folder

def copy_images(src_dir, dest_img_dir, image_filenames):
    for fname in image_filenames:
        src_path = os.path.join(src_dir, fname)
        if os.path.exists(src_path):
            shutil.copy2(src_path, dest_img_dir)
        else:
            print(f"Warning: Image {fname} not found in {src_dir}")

def write_input_json(study_folder, layout, data, total_pages):
    input_json_path = os.path.join(study_folder, "input.json")
    config = {
        "study_id": int(study_id),   # we need to know study_id
        "study_type": int(study_type),
        "total_pages": total_pages,
        "layout": layout,
        "data": data
    }
    with open(input_json_path, 'w') as f:
        json.dump(config, f, indent=2)

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Usage: python db.create.new.study.py <study_id> <study_type> <input_csv_file> <image_source_dir>")
        sys.exit(1)
    
    study_id = int(sys.argv[1])
    study_type = int(sys.argv[2])
    csv_file = sys.argv[3]
    image_dir = sys.argv[4]
    
    # 1. Read CSV
    data, total_pages = read_csv_data(csv_file)
    if total_pages <= 0:
        print("Error: CSV has no data rows.")
        sys.exit(2)
    
    # 2. Build layout
    layout = build_layout(study_type, list(data.keys()))
    
    # 3. Create study folder and img folder
    study_folder, img_folder = create_study_folder(study_id)
    
    # 4. Copy images (list from X_RAY_IMAGE column)
    image_filenames = data.get("X_RAY_IMAGE", [])
    # Also copy additional images if any (Shap, Example*, etc.) – we'll just copy all files from image_dir
    # to be safe, we copy everything from image_dir to img_folder
    if os.path.exists(image_dir):
        for file in os.listdir(image_dir):
            src = os.path.join(image_dir, file)
            dst = os.path.join(img_folder, file)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
    else:
        print(f"Warning: Image source directory {image_dir} does not exist.")
    
    # 5. Write input.json
    write_input_json(study_folder, layout, data, total_pages)
    
    # 6. Insert into study table
    conn = sqlite3.connect(DATABASE)
    create_study_table(conn)
    insert_study_record(conn, study_id, study_type, total_pages)
    conn.close()
    
    print(f"Study {study_id} created successfully.")
    print(f"Folder: {study_folder}")
    print(f"Total pages: {total_pages}")