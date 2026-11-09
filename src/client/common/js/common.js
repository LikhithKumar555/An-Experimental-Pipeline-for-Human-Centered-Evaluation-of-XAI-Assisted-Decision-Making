// ============================================================
// Utility & shared functions – moved here to avoid duplication
// ============================================================

// ---------- Hash / shuffle (already in your file) ----------
function hashStringToSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0);
}

function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(array, rng) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---------- URL helpers ----------
function get_params_from_url() {
    const params = new URLSearchParams(window.location.search);
    return {
        participant_id: params.get('participant_id') ? decodeURIComponent(params.get('participant_id')) : null,
        study_id: params.get('study_id') ? decodeURIComponent(params.get('study_id')) : null,
        study_type: params.get('study_type') ? decodeURIComponent(params.get('study_type')) : null,
        page_nr: params.get('page_nr') ? decodeURIComponent(params.get('page_nr')) : null,
        total_pages: params.get('total_pages') ? decodeURIComponent(params.get('total_pages')) : null,
    };
}

function get_participant_id_from_url() {
    const p = get_params_from_url();
    return p.participant_id;
}

function get_study_id_from_url() {
    const p = get_params_from_url();
    return p.study_id;
}

function get_page_nr_from_url() {
    const p = get_params_from_url();
    return p.page_nr ? parseInt(p.page_nr, 10) : 1;
}

// ---------- Progress bar ----------
function set_progress(current_page_nr, total_page_count) {
    let progress_value = (current_page_nr / total_page_count) * 100;
    let progress_bar = document.querySelector(".progress-bar");
    if (progress_bar) {
        progress_bar.style.width = progress_value + "%";
    }
    const text = document.getElementById("progress-bar-text");
    if (text) {
        text.textContent = "Diagnosis " + current_page_nr + "/" + total_page_count;
    }
}

// ---------- Radio buttons ----------
function get_radio_button_status() {
    const radios = document.getElementsByName("health");
    for (const radio of radios) {
        if (radio.checked) {
            return radio.value;
        }
    }
    return null;
}

function clear_radio_buttons() {
    const radios = document.getElementsByName("health");
    for (const radio of radios) {
        radio.checked = false;
    }
}

function set_participant_diagnosis(val) {
    if (typeof val === "string") val = val.toLowerCase();
    else return false;
    if (val === "healthy") {
        const el = document.getElementById("radio-healthy");
        if (el) el.checked = true;
    } else if (val === "ocdegen") {
        const el = document.getElementById("radio-unhealthy");
        if (el) el.checked = true;
    } else {
        return false;
    }
    return true;
}

// ---------- Radio button change handler ----------
async function radio_button_changed() {
    let ret = get_radio_button_status();
    let curr_page_nr = get_page_nr_from_url();
    const up = get_params_from_url();
    let total_pages = parseInt(up.total_pages, 10) || 1;

    const btn_next = document.getElementById("button-next");
    const btn_submit = document.getElementById("submit-btn");   // fixed ID

    if (ret == null) {
        if (btn_next) btn_next.disabled = true;
        if (btn_submit) btn_submit.disabled = true;
    } else {
        if (curr_page_nr >= total_pages) {
            if (btn_next) btn_next.disabled = true;
            if (btn_submit) btn_submit.disabled = false;      // enable submit
        } else {
            if (btn_next) btn_next.disabled = false;
            if (btn_submit) btn_submit.disabled = true;
        }
    }

    // Also update the button visibility/state using our main toggle function
    if (typeof button_toggle_next_or_submit === 'function') {
        button_toggle_next_or_submit();
    }
}

// ---------- Update URL without reload ----------
function update_study_url(participant_id, study_id, study_type, page_nr, total_pages) {
    const new_url =
        `/study_id_${study_id}/index.html?` +
        `participant_id=${participant_id}&study_id=${study_id}` +
        `&study_type=${study_type}&page_nr=${page_nr}&total_pages=${total_pages}`;
    history.pushState(null, '', new_url);
}

// ---------- Log page visit ----------
async function log_page_visit(participant_id, study_id, page_nr) {
    try {
        const response = await fetch('/log_visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id, study_id, page_nr })
        });
        if (!response.ok) {
            console.error('Failed to log visit');
        }
    } catch (error) {
        console.error('Error logging visit:', error);
    }
}

// ---------- Database write ----------
async function db_update_async() {
    const participant_diagnosis = get_radio_button_status();
    const participant_id = get_participant_id_from_url();
    const study_id = get_study_id_from_url();
    const page_nr = get_page_nr_from_url();

    if (!participant_id || !study_id) {
        console.log("Error: Missing participant_id or study_id");
        return;
    }

    const xray_image = document.getElementById("patient-x-ray-image")?.src || "";

    try {
        const response = await fetch('/write_db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id,
                study_id,
                xray_image,
                participant_diagnosis,
                page_nr
            })
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 400 && data.error === "DUPLICATE ENTRY") {
                console.log('Duplicate entry – moving to next page');
                db_update_duplicate_entry_action(participant_id, study_id, page_nr);
            } else {
                console.log('Database error:', data);
            }
        } else {
            db_update_success_action(participant_id, study_id, page_nr);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function db_update() {
    db_update_async();
}

// ---------- Success / duplicate handlers ----------
function db_update_success_action(participant_id, study_id, current_page_nr) {
    const total = window.csv_json_get_total_page_count ? window.csv_json_get_total_page_count() : 0;
    if (current_page_nr >= total) {
        sessionStorage.setItem(`study_done_${participant_id}_${study_id}`, 'true');
        window.location.replace(`/feedback/index.html?participant_id=${participant_id}&study_id=${study_id}`);
        return;
    }
    const next_page = current_page_nr + 1;
    const up = get_params_from_url();
    update_study_url(participant_id, study_id, up.study_type, next_page, up.total_pages);
    clear_radio_buttons();
    if (window.csv_json_get_all_attributes_and_set_in_html_page) {
        window.csv_json_get_all_attributes_and_set_in_html_page(next_page);
    }
    db_get_and_set_participant_diagnosis(participant_id, study_id, next_page);
    button_toggle_next_or_submit();
    log_page_visit(participant_id, study_id, next_page);
}

function db_update_duplicate_entry_action(participant_id, study_id, current_page_nr) {
    const total = window.csv_json_get_total_page_count ? window.csv_json_get_total_page_count() : 0;
    if (current_page_nr >= total) {
        sessionStorage.setItem(`study_done_${participant_id}_${study_id}`, 'true');
        window.location.replace(`/feedback/index.html?participant_id=${participant_id}&study_id=${study_id}`);
        return;
    }
    const next_page = current_page_nr + 1;
    const up = get_params_from_url();
    update_study_url(participant_id, study_id, up.study_type, next_page, up.total_pages);
    clear_radio_buttons();
    if (window.csv_json_get_all_attributes_and_set_in_html_page) {
        window.csv_json_get_all_attributes_and_set_in_html_page(next_page);
    }
    db_get_and_set_participant_diagnosis(participant_id, study_id, next_page);
    log_page_visit(participant_id, study_id, next_page);
}

// ---------- Read diagnosis from DB ----------
async function db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr) {
    try {
        const response = await fetch(`/read_db_prev?participant_id=${participant_id}&study_id=${study_id}&page_nr=${page_nr}`);
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
            const diagnosis = data[0].participant_diagnosis;
            set_participant_diagnosis(diagnosis);
        }
        button_toggle_next_or_submit();
    } catch (error) {
        console.error('Error fetching diagnosis:', error);
        button_toggle_next_or_submit();
    }
}

// ---------- Toggle Next/Submit buttons ----------
function button_toggle_next_or_submit() {
    const up = get_params_from_url();
    let total_pages = parseInt(up.total_pages, 10) || 1;
    let curr_page = parseInt(up.page_nr, 10) || 1;

    const btn_next = document.getElementById("button-next");
    const btn_prev = document.getElementById("button-prev");
    const btn_submit = document.getElementById("button-submit");

    // Hide Prev on first page
    if (curr_page === 1) {
        if (btn_prev) { btn_prev.style.display = 'none'; btn_prev.disabled = true; }
    } else {
        if (btn_prev) { btn_prev.style.display = 'inline-block'; btn_prev.disabled = false; }
    }

    const isLast = curr_page >= total_pages;
    const hasSelection = get_radio_button_status() !== null;

    if (isLast) {
        if (btn_next) { btn_next.style.display = 'none'; btn_next.disabled = true; }
        if (btn_submit) { btn_submit.style.display = 'inline-block'; btn_submit.disabled = !hasSelection; }
    } else {
        if (btn_next) { btn_next.style.display = 'inline-block'; btn_next.disabled = !hasSelection; }
        if (btn_submit) { btn_submit.style.display = 'none'; btn_submit.disabled = true; }
    }
}

// ---------- Override for study-specific page count ----------
window.csv_json_get_total_page_count = function() {
    return 0; // will be overridden by index.js
};

window.csv_json_get_all_attributes_and_set_in_html_page = function(pageNr) {
    console.warn('csv_json_get_all_attributes_and_set_in_html_page not overridden');
};

// ---------- Redirection if study done ----------
function redirectIfFinished() {
    const pid = get_participant_id_from_url();
    const sid = get_study_id_from_url();
    if (sessionStorage.getItem(`study_done_${pid}_${sid}`) === 'true') {
        window.location.replace(`/feedback/index.html?participant_id=${pid}&study_id=${sid}`);
        return true;
    }
    return false;
}