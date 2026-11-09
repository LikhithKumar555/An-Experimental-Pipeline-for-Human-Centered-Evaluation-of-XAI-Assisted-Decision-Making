/**
 * Description: Server logic for Evaluating Human-Centered XAI-Assisted Decision Making
 *
 * Author: V Natarjan
 */

const fs = require('fs-extra');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const project_root = "../";
const app = express();
const db_path = process.env.DB_PATH || path.join(__dirname, project_root, 'database/database.db');
const PORT = process.env.PORT || 7000;
const client_ui_web_pages_location = 'client';
let db;

// ============================================================
// 1. Server & Database Initialization
// ============================================================

function init() {
    // --- Security: allow eval/inline for development ---
    app.use((req, res, next) => {
        res.setHeader(
            'Content-Security-Policy',
            "script-src 'self' 'unsafe-eval' 'unsafe-inline';"
        );
        next();
    });

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(bodyParser.urlencoded({ extended: true }));

    // --- Serve the common index.html for ALL study pages ---
    app.get(/\/study_id_[^\/]+\/index\.html$/, (req, res) => {
        const commonPath = path.join(__dirname, project_root, client_ui_web_pages_location, 'common', 'index.html');
        res.sendFile(commonPath);
    });

    // --- Static files (images, input.json, common client assets) ---
    app.use(express.static(path.join(__dirname, project_root, client_ui_web_pages_location)));

    db_init();
}

function start_http_server(port) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
        console.log(
            `Example: http://localhost:${port}/study_id_411/index.html?participant_id=123&study_id=411&page_nr=1&total_pages=16`
        );
    });
}

// ============================================================
// 2. Database Setup
// ============================================================

function db_create_or_open() {
    db = new sqlite3.Database(db_path, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
        } else {
            console.log('Database opened (or created) successfully.');
        }
    });
    module.exports = db;
}

function db_table_init() {
    db.serialize(() => {
        // Create study table with TEXT study_id to support alphanumeric IDs
        db.run(`CREATE TABLE IF NOT EXISTS study (
            study_id TEXT PRIMARY KEY,
            study_type INTEGER CHECK(study_type IN (1, 2, 3, 4, 5)),
            total_pages INTEGER
        )`);

        // participant_feedback: study_id as TEXT
        db.run(`CREATE TABLE IF NOT EXISTS participant_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id TEXT NOT NULL,
            study_id TEXT NOT NULL,
            xray_image TEXT,
            participant_diagnosis TEXT NOT NULL,
            page_nr INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )`);

        // access_times: study_id as TEXT
        db.run(`CREATE TABLE IF NOT EXISTS access_times (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            participant_id TEXT NOT NULL,
            study_id TEXT NOT NULL,
            page_nr INTEGER NOT NULL,
            last_access_ms INTEGER NOT NULL,
            last_update_ms INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )`);

        // Unique index to prevent duplicate feedback entries
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_feedback ON participant_feedback(study_id, participant_id, page_nr);`);
    });

    // Triggers
    db.serialize(() => {
        db.run(`DROP TRIGGER IF EXISTS set_timestamp1;`);
        db.run(`CREATE TRIGGER set_timestamp1
                AFTER UPDATE ON participant_feedback
                FOR EACH ROW
                BEGIN
                    UPDATE participant_feedback
                    SET updated_at = (strftime('%s', 'now'))
                    WHERE id = OLD.id;
                END;`);

        db.run(`DROP TRIGGER IF EXISTS set_timestamp2;`);
        db.run(`CREATE TRIGGER set_timestamp2
                AFTER UPDATE ON access_times
                FOR EACH ROW
                BEGIN
                    UPDATE access_times
                    SET updated_at = (strftime('%s', 'now'))
                    WHERE id = OLD.id;
                END;`);
    });
}

function db_init() {
    db_create_or_open();
    db_table_init();
}

// ============================================================
// 3. Validation Middleware
// ============================================================
function validateFeedback(req, res, next) {
  const { participant_id, study_id, xray_image, participant_diagnosis, page_nr } = req.body;
  // Only require participant_id, study_id, participant_diagnosis, page_nr.
  // xray_image may be empty.
  if (!participant_id || !study_id || !participant_diagnosis || page_nr === undefined) {
    return res.status(400).json({ error: 'Missing required fields (participant_id, study_id, participant_diagnosis, page_nr)' });
  }
  if (!['healthy', 'unhealthy'].includes(participant_diagnosis)) {
    return res.status(400).json({ error: 'Invalid diagnosis (must be "healthy" or "unhealthy")' });
  }
  next();
}

// ----- Create Study Route -----
const multer = require('multer');
const csv = require('csv-parser');
const AdmZip = require('adm-zip');

const upload = multer({ storage: multer.memoryStorage() });

app.post('/create-study', upload.fields([
  { name: 'csv', maxCount: 1 },
  { name: 'zip', maxCount: 1 }
]), async (req, res) => {
  try {
    const { study_id, study_type } = req.body;
    if (!study_id || !study_type) {
      return res.status(400).json({ error: 'Missing study_id or study_type' });
    }
    if (!req.files || !req.files.csv || !req.files.zip) {
      return res.status(400).json({ error: 'CSV and ZIP files are required' });
    }

    const csvBuffer = req.files.csv[0].buffer;
    const zipBuffer = req.files.zip[0].buffer;

    // 1. Parse CSV
    const csvData = await parseCSV(csvBuffer);
    if (csvData.length === 0) {
      return res.status(400).json({ error: 'CSV is empty or invalid' });
    }

    const columns = Object.keys(csvData[0]);
    const dataObj = {};
    columns.forEach(col => {
      dataObj[col] = csvData.map(row => row[col] || '');
    });

    const totalPages = csvData.length;

    // 2. Build layout based on study_type and columns
    const layout = buildLayout(study_type, columns);

    // 3. Create study folder and input.json
    const studyFolder = path.join(__dirname, project_root, client_ui_web_pages_location, `study_id_${study_id}`);
    await fs.ensureDir(studyFolder);
    const imgFolder = path.join(studyFolder, 'img');
    await fs.ensureDir(imgFolder);

    const inputJson = {
      study_id: study_id,
      study_type: parseInt(study_type),
      total_pages: totalPages,
      layout: layout,
      data: dataObj
    };
    await fs.writeFile(path.join(studyFolder, 'input.json'), JSON.stringify(inputJson, null, 2));

    // 4. Extract ZIP and flatten – ignore folder structure
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (!entry.isDirectory) {
        const fileName = path.basename(entry.entryName);
        const filePath = path.join(imgFolder, fileName);
        const content = entry.getData();
        fs.writeFileSync(filePath, content);
      }
    }

    // 5. Insert into study table
    const insertStmt = db.prepare("INSERT OR REPLACE INTO study (study_id, study_type, total_pages) VALUES (?, ?, ?)");
    insertStmt.run(study_id, study_type, totalPages);
    insertStmt.finalize();

    res.json({ success: true, message: 'Study created successfully', study_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: parse CSV buffer
function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const parser = csv();
    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(parser)
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// Helper: build layout based on study_type and columns
// Helper: build layout based on study_type and columns
function buildLayout(study_type, columns) {
  // Start with patient image
  let row1 = [{ type: 'patient_image', id_field: 'PATIENT_ID', image_field: 'X_RAY_IMAGE' }];
  let row1_columns = 1;

  // Helper to find a column (with or without _Salience suffix)
  function findColumn(baseName) {
    if (columns.includes(baseName)) return baseName;
    if (columns.includes(baseName + '_Salience')) return baseName + '_Salience';
    return null;
  }

  // Helper to add counterfactual cards for a given base name (e.g., 'Example1' or 'Concept1')
  function addCounterfactualCards(baseNames) {
    baseNames.forEach((base, i) => {
      const imgField = findColumn(base);
      const captionField = base + '_Caption';
      if (imgField && columns.includes(captionField)) {
        row1.push({
          type: 'counterfactual',
          image_field: imgField,
          caption_field: captionField,
          title: `Counterfactual ${i+1}`
        });
      }
    });
  }

  if (study_type == 2) {
    // Try SHAP first
    if (columns.includes('Shap') && columns.includes('Shap_Caption')) {
      row1.push({
        type: 'shap_image',
        image_field: 'Shap',
        caption_field: 'Shap_Caption',
        title: 'Important Features',
        colorbar: '/common/imgs/colorbar.png'
      });
      row1_columns = 2;
    } else {
      // Fallback to Concept1 or Example1
      const imgField = findColumn('Concept1') || findColumn('Example1');
      if (imgField && columns.includes('Concept1_Caption') || columns.includes('Example1_Caption')) {
        const captionField = columns.includes('Concept1_Caption') ? 'Concept1_Caption' : 'Example1_Caption';
        row1.push({
          type: 'counterfactual',
          image_field: imgField,
          caption_field: captionField,
          title: 'Counterfactual 1'
        });
        row1_columns = 2;
      }
    }
  } else if (study_type == 3) {
    // Try Example1, Example2 OR Concept1, Concept2
    const baseNames = ['Example1', 'Example2'];
    addCounterfactualCards(baseNames);
    // If no Example columns found, try Concept1, Concept2
    if (row1.length === 1) {
      addCounterfactualCards(['Concept1', 'Concept2']);
    }
    row1_columns = row1.length;
  } else if (study_type == 4) {
    const baseNames = ['Example1', 'Example2', 'Example3'];
    addCounterfactualCards(baseNames);
    if (row1.length === 1) {
      addCounterfactualCards(['Concept1', 'Concept2', 'Concept3']);
    }
    row1_columns = row1.length;
  } else if (study_type == 5) {
    const baseNames = ['Example1', 'Example2', 'Example3', 'Example4'];
    addCounterfactualCards(baseNames);
    if (row1.length === 1) {
      addCounterfactualCards(['Concept1', 'Concept2', 'Concept3', 'Concept4']);
    }
    row1_columns = row1.length;
  }

  // Ensure we have at least 1 column
  if (row1_columns < 1) row1_columns = 1;

  const row2 = [
    { type: 'symptoms_list', symptoms: ['Strong Spine Bend', 'Strong Bone Variation', 'Tucked Head', 'Main Bones Mutation'] },
    { type: 'diagnosis_card', show_true: true, show_present: true, ai_field: 'SUGGESTED_DIAG', true_field: 'TRUE_DIAG', present_field: 'X_RAY_TRAIT' },
    { type: 'warning_card' }
  ];

  return { row1_columns, row1, row2 };
}
// ============================================================
// 4. Database Route Handlers
// ============================================================

function cb_event_write_db(req, res) {
    const { participant_id, study_id, xray_image, participant_diagnosis, page_nr } = req.body;
    console.log('📩 Received body:', req.body);
    console.log(`Writing DB: participant=${participant_id}, study=${study_id}, page=${page_nr}`);

    const p_diagnosis = (participant_diagnosis === "healthy") ? "Healthy" : "OCDegen";

    db.get(
        `SELECT * FROM participant_feedback WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
        [study_id, participant_id, page_nr],
        (err, row) => {
            if (err) {
                console.error(err.message);
                return res.status(500).send('Database error');
            }

            if (row) {
                const oldDiagnosis = row.participant_diagnosis;
                if (oldDiagnosis === p_diagnosis) {
                    console.log("Diagnosis unchanged, skipping update.");
                    return res.json({ message: "Diagnosis unchanged, no update needed." });
                }

                db.run(
                    `UPDATE participant_feedback
                     SET participant_diagnosis = ?, xray_image = ?
                     WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                    [p_diagnosis, xray_image || '', study_id, participant_id, page_nr],
                    (updateErr) => {
                        if (updateErr) {
                            console.error(updateErr.message);
                            return res.status(500).send('Error updating data');
                        }
                        db.run(
                            `UPDATE access_times
                             SET last_update_ms = CAST(strftime('%s','now') AS INTEGER)*1000
                             WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                            [study_id, participant_id, page_nr],
                            (err2) => {
                                if (err2) {
                                    console.error(err2.message);
                                    return res.status(500).send('Error updating access time');
                                }
                                return res.json({ message: "Data updated successfully!" });
                            }
                        );
                    }
                );
            } else {
                db.run(
                    `INSERT INTO participant_feedback (participant_id, study_id, xray_image, participant_diagnosis, page_nr)
                     VALUES (?, ?, ?, ?, ?)`,
                    [participant_id, study_id, xray_image || '', p_diagnosis, page_nr],
                    (insertErr) => {
                        if (insertErr) {
                            console.error(insertErr.message);
                            return res.status(500).send('Error saving data');
                        }
                        db.run(
                            `UPDATE access_times
                             SET last_update_ms = CAST(strftime('%s','now') AS INTEGER)*1000
                             WHERE study_id = ? AND participant_id = ? AND page_nr = ?`,
                            [study_id, participant_id, page_nr],
                            (err2) => {
                                if (err2) {
                                    console.error(err2.message);
                                    return res.status(500).send('Error updating access time');
                                }
                                return res.json({ message: "Data stored successfully!" });
                            }
                        );
                    }
                );
            }
        }
    );
}

function cb_event_log_visit(req, res) {
    const { participant_id, study_id, page_nr } = req.body;
    console.log(`Logging visit: participant=${participant_id}, study=${study_id}, page=${page_nr}`);

    if (!participant_id || !study_id || page_nr == null) {
        return res.status(400).json({ error: 'missing fields' });
    }

    db.run(
        `INSERT INTO access_times
            (participant_id, study_id, page_nr, last_access_ms, last_update_ms)
            VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER)*1000, CAST(strftime('%s','now') AS INTEGER)*1000)`,
        [participant_id, study_id, page_nr],
        function (err) {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'db insert failed' });
            }
            return res.json({ success: true, id: this.lastID });
        }
    );
}

function cb_event_read_db(req, res) {
    db.all("SELECT * FROM participant_feedback", [], (err, rows) => {
        if (err) {
            console.error("Database Error:", err);
            res.status(500).json({ error: "Error reading data" });
            return;
        }
        res.json(rows);
    });
}

function cb_event_read_db_prev(req, res) {
    const { participant_id, study_id, page_nr } = req.query;
    console.log(`Reading DB: participant=${participant_id}, study=${study_id}, page=${page_nr}`);

    const query = `SELECT * FROM participant_feedback WHERE participant_id = ? AND study_id = ? AND page_nr = ?`;
    db.all(query, [participant_id, study_id, page_nr], (err, rows) => {
        if (err) {
            console.error("Database Error:", err);
            res.status(500).json({ error: "Error reading data" });
            return;
        }
        res.json(rows);
    });
}

function get_last_updated_page_nr(participant_id, study_id) {
    console.log(`Fetching last updated page_nr for: participant=${participant_id}, study=${study_id}`);
    const query = `SELECT MAX(page_nr) AS last_updated_page_nr FROM participant_feedback WHERE participant_id = ? AND study_id = ?`;
    return new Promise((resolve, reject) => {
        db.get(query, [participant_id, study_id], (err, row) => {
            if (err) {
                console.error("Database error:", err);
                return reject(-1);
            }
            resolve(row?.last_updated_page_nr ?? 1);
        });
    });
}

function get_study_details(study_id) {
    console.log(`Fetching study details for: study_id=${study_id}`);
    const query = `SELECT study_id, study_type, total_pages FROM study WHERE study_id = ?`;
    return new Promise((resolve, reject) => {
        db.get(query, [study_id], (err, row) => {
            if (err) {
                console.error("Database error:", err);
                return reject({ study_type: -1, total_pages: -1 });
            }
            if (!row) {
                return reject({ study_type: -2, total_pages: -2 });
            }
            resolve({ study_type: parseInt(row.study_type), total_pages: parseInt(row.total_pages) });
        });
    });
}

async function cb_event_db_validation_participant_id_and_study_id(req, res) {
    const { participant_id, study_id } = req.body;
    console.log(`[CLIENT REQUEST] Validate: participant=${participant_id}, study=${study_id}`);

    try {
        const { study_type, total_pages } = await get_study_details(study_id);
        console.log(`Study Details: study_type=${study_type}, total_pages=${total_pages}`);

        if (study_type === -1) {
            return res.status(500).json({ error: "DB Error or study table does not exist" });
        } else if (study_type === -2) {
            return res.status(404).json({ error: "Record with study_id does not exist in the study table" });
        }

        let last_updated_page_nr = await get_last_updated_page_nr(participant_id, study_id);
        if (last_updated_page_nr === -1) {
            last_updated_page_nr = 1;
        }

        res.json({ participant_id, study_id, study_type, last_updated_page_nr, total_pages });
    } catch (error) {
        console.error("Unexpected server error:", error);
        res.status(500).json({ error: "Unexpected server error" });
    }
}

// ============================================================
// 5. Register Routes (with middleware correctly applied)
// ============================================================

init();

// Apply validation middleware only to /write_db
app.post('/write_db', validateFeedback, cb_event_write_db);

// Other routes
app.post('/db_validation_participant_id_and_study_id', cb_event_db_validation_participant_id_and_study_id);
app.post('/log_visit', cb_event_log_visit);
app.get('/read_db', cb_event_read_db);
app.get('/read_db_prev', cb_event_read_db_prev);

if (require.main === module) {
    start_http_server(PORT);
}

module.exports = app;


  