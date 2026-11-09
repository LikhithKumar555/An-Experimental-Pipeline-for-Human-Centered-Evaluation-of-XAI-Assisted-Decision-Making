//  Utility functions for consistent randomization based on participant ID
function hashStringToSeed(str) {
    // A simple hash function to convert a string to a numeric seed for randomization of data samples
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0); // force unsigned 32-bit
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
    const a = array.slice(); // copy
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// page setup functions
function get_page_nr_from_url() {
    const url_params = get_params_from_url();
    if (url_params.page_nr == null) {
        return 1; //if page_nr is null in the url it should be the first page ( or page refresh happened without url encoding details )
    }

    return parseInt(url_params.page_nr);
}

function get_study_id_from_url() {
    const url_params = get_params_from_url();
    return url_params.study_id;
}

function get_participant_id_from_url() {
    const url_params = get_params_from_url();
    return url_params.participant_id;
}

function get_params_from_url() {
    const params = new URLSearchParams(window.location.search);

    return {
        participant_id: params.get('participant_id') ? decodeURIComponent(params.get('participant_id')) : null,
        study_id: params.get('study_id') ? decodeURIComponent(params.get('study_id')) : null,
        study_type: params.get('study_id') ? decodeURIComponent(params.get('study_type')) : null,
        page_nr: params.get('page_nr') ? decodeURIComponent(params.get('page_nr')) : null,
        total_pages: params.get('page_nr') ? decodeURIComponent(params.get('total_pages')) : null,
    };
}

async function init_page() {
    if (input == null) {
        console.log('Input is null, returning.');
        return;
    }

    const up = get_params_from_url();
    let n_correct;
    let start_indices;
    if (up.total_pages === '30') {
        n_correct = 6
        start_indices = [0, 1, 2, 3, 4, 5];
    } else {
        n_correct = 4   
        start_indices = [0, 1, 2, 3];
    }

    console.log('App is running!');
    let participant_id = get_participant_id_from_url();
    let study_id = get_study_id_from_url();
    let page_nr = get_page_nr_from_url();

    // randomize study indices for counterbalancing
    const totalPages = Math.max(0, parseInt(up.total_pages, 10) || 0);
    const indices = Array.from({ length: totalPages - n_correct }, (_, idx) => idx + n_correct);

    // 2) Seed from participant ID
    const seed = hashStringToSeed(participant_id);
    const rand = mulberry32(seed);

    // 3) Shuffle deterministically
    let shuffledIndicesStart = [];
    let shuffledIndices = [];
    if (up.study_id === 10) {
        // no need to shuffle for tutorial phase
        shuffledIndicesStart = start_indices;
        shuffledIndices = indices;
    } else {
        shuffledIndicesStart = shuffle(start_indices, rand);
        shuffledIndices = shuffle(indices, rand);
    }
    console.log(shuffledIndices);

    // concatenate the two arrays
    window.shuffledIndices = [...shuffledIndicesStart, ...shuffledIndices];
    console.log('Final shuffled indices:', window.shuffledIndices);

    db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr);
    csv_json_get_all_attributes_and_set_in_html_page(page_nr);
    log_page_visit(participant_id, study_id, page_nr);
}

function showError(msg) {
    console.error(msg);

    disableNextButton();

    const existing = document.getElementById('seq-error-box');
    if (existing) {
        existing.remove();
    }

    const box = document.createElement('div');
    box.id = 'seq-error-box';
    box.style.maxWidth = '700px';
    box.style.margin = '20px auto';
    box.style.padding = '16px 20px';
    box.style.border = '1px solid #d9a3a3';
    box.style.borderLeft = '4px solid #b00020';
    box.style.background = '#fff8f8';
    box.style.borderRadius = '6px';
    box.style.color = '#333';
    box.style.fontSize = '16px';
    box.style.lineHeight = '1.5';

    const title = document.createElement('div');
    title.textContent = 'We encoutered a problem.';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '8px';
    title.style.color = '#7a0015';

    const message = document.createElement('div');
    message.textContent = msg;
    message.style.marginBottom = '8px';

    const help = document.createElement('div');
    help.textContent = 'Unfortunately, we could not load your study condition. Please contact the researcher via Prolific with the contents of this error message.';

    box.appendChild(title);
    box.appendChild(message);
    box.appendChild(help);

    const target =
        document.querySelector('form') ||
        document.querySelector('.group-container') ||
        document.querySelector('#limesurvey') ||
        document.body;

    target.prepend(box);
}

// Progress bar
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

// Radio buttons
function get_radio_button_status() {
    const radios = document.getElementsByName("health");
    for (const radio of radios) {
        if (radio.checked) return radio.value;
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
    if (val === "healthy") {
        document.getElementById("radio-healthy").checked = true;
    } else if (val === "ocdegen") {
        document.getElementById("radio-unhealthy").checked = true;
    } else {
        console.error("Invalid diagnosis value:", val);
        return false;
    }
    return true;
}

// Navigation
function button_toggle_next_or_submit() {
    const up = get_params_from_url();
    let total_pages = parseInt(up.total_pages, 10);
    let curr_page = parseInt(up.page_nr, 10);
    if (isNaN(curr_page) || curr_page < 1) curr_page = 1;
    if (isNaN(total_pages) || total_pages < 1) total_pages = 1;

    const button_next = document.getElementById("button-next");
    const button_prev = document.getElementById("button-prev");
    const button_submit = document.getElementById("button-submit");

    button_prev.style.display = 'none';
    button_prev.disabled = true;
    button_next.style.display = 'inline-block';
    button_next.disabled = get_radio_button_status() === null;
    button_submit.disabled = true;

    if (curr_page === 1) {
        button_prev.disabled = true;
        return;
    }
    if (curr_page === total_pages) {
        button_next.disabled = true;
        return;
    }
}

// Database functions (simplified – your original should have these)
async function db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr) {
    // Placeholder – should fetch from server and call set_participant_diagnosis
    // For now, do nothing or log
    console.log("db_get_and_set_participant_diagnosis called");
}

// Placeholder for log_page_visit if missing
async function log_page_visit(participant_id, study_id, page_nr) {
    console.log("log_page_visit called");
}