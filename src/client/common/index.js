// src/client/common/index.js
let studyConfig = null;
let currentPage = 1;
let totalPages = 0;
let shuffledIndices = [];

function createCard(compDef, data, pageIndex) {
  const idx = shuffledIndices[pageIndex - 1];
  const card = document.createElement('div');
  card.className = 'card-row1-col2-3-4-5';

  console.log('🃏 Creating card:', compDef.type, 'for page', pageIndex, 'idx', idx);

  switch (compDef.type) {
    case 'patient_image': {
      const id = data[compDef.id_field]?.[idx] || 'Unknown';
      const img = 'img/' + (data[compDef.image_field]?.[idx] || '');
      card.innerHTML = `
        <div class="title">${id}</div>
        <img class="image" src="${img}" alt="Patient">
        <div class="caption" style="display:none"></div>
      `;
      break;
    }
    case 'shap_image': {
      const shap = 'img/' + (data[compDef.image_field]?.[idx] || '');
      const caption = data[compDef.caption_field]?.[idx] || '';
      const colorbar = compDef.colorbar || '';
      card.innerHTML = `
        <div class="title">${compDef.title || 'Important Features'}</div>
        <div class="image-wrapper">
          <img class="shap-img" src="${shap}" alt="SHAP">
          ${colorbar ? `<img class="colorbar-img" src="${colorbar}" alt="Colorbar">` : ''}
        </div>
        <div class="caption"><b>${caption}</b></div>
      `;
      break;
    }
    case 'counterfactual': {
      const cfImg = 'img/' + (data[compDef.image_field]?.[idx] || '');
      const cfCaption = data[compDef.caption_field]?.[idx] || '';
      const title = compDef.title || 'Counterfactual';
      card.innerHTML = `
        <div class="title">${title}</div>
        <img class="image" src="${cfImg}" alt="Counterfactual">
        <div class="caption"><b>${cfCaption}</b></div>
      `;
      break;
    }
    case 'concept_list': {
      // ----- FIX: ensure bullet_fields exist and data is loaded -----
      const bulletFields = compDef.bullet_fields || [];
      console.log('📋 Bullet fields:', bulletFields);

      const listItems = bulletFields
        .map(field => data[field]?.[idx] || '')
        .filter(text => text.trim() !== '');

      console.log('📋 List items:', listItems);

      const ul = document.createElement('ul');
      ul.className = 'concept-list';

      if (listItems.length === 0) {
        // Fallback message
        const li = document.createElement('li');
        li.textContent = 'No concept data available.';
        ul.appendChild(li);
      } else {
        listItems.forEach(text => {
          const li = document.createElement('li');
          li.className = text.toLowerCase().includes('ocdegen') ? 'unhealthy-li' : 'healthy-li';
          li.innerHTML = text; // safe because we control the HTML
          ul.appendChild(li);
        });
      }

      card.innerHTML = `<div class="title">${compDef.title || 'Concept Contributions'}</div>`;
      card.appendChild(ul);
      break;
    }
    default:
      card.textContent = 'Unknown component: ' + compDef.type;
  }
  return card;
}

function createRow2Card(compDef, data, pageIndex) {
  const idx = shuffledIndices[pageIndex - 1];
  const card = document.createElement('div');

  switch (compDef.type) {
    case 'symptoms_list': {
      card.className = 'card-row2-col1';
      const symptoms = compDef.symptoms || [];
      let listItems = symptoms.map(s => `<li>${s}</li>`).join('');
      card.innerHTML = `
        <h3 class="title">OCDegen Symptoms</h3>
        <ul class="biomarkers-list">${listItems}</ul>
      `;
      break;
    }
    case 'diagnosis_card': {
      card.className = 'card-row2-col2';
      const ai = data[compDef.ai_field]?.[idx] || '';
      const trueDiag = compDef.show_true ? data[compDef.true_field]?.[idx] : null;
      const present = compDef.show_present ? data[compDef.present_field]?.[idx] : null;
      const aiClass = ai === 'OCDegen' ? 'unhealthy' : 'healthy';
      card.innerHTML = `
        <h3 class="title">Blocky Diagnosis</h3>
        <div class="card-content">
          <div class="left-content">
            <p><b>AI Diagnosis:</b> <span class="${aiClass}">${ai}</span></p>
            ${trueDiag ? `<p><b>True Diagnosis:</b> <span class="${trueDiag === 'OCDegen' ? 'unhealthy' : 'healthy'}">${trueDiag}</span></p>` : ''}
            ${present ? `<p><b>Present Symptoms:</b> <span id="X_RAY_Trait">${present}</span></p>` : ''}
          </div>
          <div class="right-options">
            <h4>Your Diagnosis:</h4>
            <label class="healthy-label">
              <input id="radio-healthy" type="radio" name="health" value="healthy"> Healthy
            </label>
            <label class="unhealthy-label">
              <input id="radio-unhealthy" type="radio" name="health" value="unhealthy"> OCDegen
            </label>
          </div>
        </div>
      `;
      break;
    }
    case 'warning_card': {
      card.className = 'card-row2-col1';
      const warnings = compDef.warnings || [
        '<strong>Incorrect answers</strong> reduce your bonus.',
        '<strong>OCDegen can be fatal</strong> if not treated early.',
        'Treatment is <strong>costly and highly invasive</strong>.',
        '<strong>Verify all diagnoses</strong> before finalizing.'
      ];
      const listItems = warnings.map(w => `<li>${w}</li>`).join('');
      card.innerHTML = `
        <h3 class="card-warning">Important</h3>
        <div class="card-warning-text">
          <ul class="card-warning-list">${listItems}</ul>
        </div>
      `;
      break;
    }
    default:
      card.textContent = 'Unknown row2 component';
  }
  return card;
}

function renderPage(pageNr) {
  console.log('🔁 renderPage called with page:', pageNr);
  if (!studyConfig) {
    console.warn('studyConfig is null – cannot render');
    return;
  }
  const layout = studyConfig.layout;
  if (!layout) {
    console.error('No layout in input.json');
    return;
  }

  const row1 = document.getElementById('row1-container');
  if (!row1) {
    console.error('row1-container not found');
    return;
  }
  row1.innerHTML = '';
  layout.row1.forEach(compDef => {
    const card = createCard(compDef, studyConfig.data, pageNr);
    row1.appendChild(card);
  });
  document.documentElement.style.setProperty('--grid-row1-ncolumns', layout.row1.length);

  const row2 = document.getElementById('row2-container');
  if (!row2) {
    console.error('row2-container not found');
    return;
  }
  row2.innerHTML = '';
  (layout.row2 || []).forEach(compDef => {
    const card = createRow2Card(compDef, studyConfig.data, pageNr);
    row2.appendChild(card);
  });

  totalPages = studyConfig.total_pages || studyConfig.data?.PATIENT_ID?.length || 1;
  set_progress(pageNr, totalPages);

  const radios = document.querySelectorAll('input[name="health"]');
  radios.forEach(r => r.addEventListener('change', radio_button_changed));

  const pid = get_participant_id_from_url();
  const sid = get_study_id_from_url();
  db_get_and_set_participant_diagnosis(pid, sid, pageNr);
  button_toggle_next_or_submit(pageNr, totalPages);
}

async function initPage() {
  console.log('🚀 initPage called');
  try {
    const response = await fetch('input.json');
    if (!response.ok) throw new Error('Failed to load input.json');
    const json = await response.json();
    studyConfig = json;
    console.log('✅ Loaded study config:', studyConfig);

    // Ensure shuffledIndices is always an array
    const len = studyConfig.data?.PATIENT_ID?.length || studyConfig.total_pages || 1;
    shuffledIndices = Array.from({ length: len }, (_, i) => i);
    console.log('🔀 shuffledIndices:', shuffledIndices);

    const params = get_params_from_url();
    let page = parseInt(params.page_nr, 10);
    if (isNaN(page) || page < 1) page = 1;
    currentPage = page;
    renderPage(currentPage);
  } catch (err) {
    console.error('❌ Error loading study config:', err);
    const main = document.querySelector('main');
    if (main) {
      main.innerHTML = `<div style="padding:2rem;color:red;font-weight:bold;">Error loading study: ${err.message}</div>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', initPage);

window.csv_json_get_total_page_count = () => studyConfig ? studyConfig.total_pages || studyConfig.data?.PATIENT_ID?.length || 0 : 0;
window.csv_json_get_all_attributes_and_set_in_html_page = (pageNr) => renderPage(pageNr);
window.init_page = initPage;

window.addEventListener('popstate', () => {
  const pid = get_participant_id_from_url();
  const sid = get_study_id_from_url();
  if (sessionStorage.getItem(`study_done_${pid}_${sid}`) === 'true') {
    window.location.replace(`/feedback/index.html?participant_id=${pid}&study_id=${sid}`);
    return;
  }
  const pageNr = get_page_nr_from_url();
  if (pageNr) {
    renderPage(parseInt(pageNr, 10));
  }
});

// ---------- Button Toggle Logic ----------
function button_toggle_next_or_submit(page, total) {
  const pageNr = page || get_page_nr_from_url();
  const totalPages = total || parseInt(get_params_from_url().total_pages, 10) || 1;

  const nextBtn = document.getElementById("button-next");
  const submitBtn = document.getElementById("submit-btn");
  const prevBtn = document.getElementById("button-prev");

  console.log(`🔘 Toggle buttons: page=${pageNr}, total=${totalPages}`);

  if (pageNr <= 1) {
    if (prevBtn) { prevBtn.style.display = 'none'; prevBtn.disabled = true; }
  } else {
    if (prevBtn) { prevBtn.style.display = 'inline-block'; prevBtn.disabled = false; }
  }

  const isLast = pageNr >= totalPages;
  const hasSelection = get_radio_button_status() !== null;

  if (isLast) {
    if (nextBtn) { nextBtn.style.display = 'none'; nextBtn.disabled = true; }
    if (submitBtn) {
      submitBtn.classList.remove('hidden');
      submitBtn.style.display = 'inline-block';
      submitBtn.disabled = !hasSelection;
    }
  } else {
    if (nextBtn) {
      nextBtn.style.display = 'inline-block';
      nextBtn.disabled = !hasSelection;
    }
    if (submitBtn) {
      submitBtn.classList.add('hidden');
      submitBtn.style.display = 'none';
      submitBtn.disabled = true;
    }
  }
}

// ---------- Next / Submit button actions ----------
function next_button_action() {
    const ret = get_radio_button_status();
    if (ret == null) {
        alert("Please select an option before proceeding to the next page.");
        return;
    }
    db_update();
}

function prev_button_action() {
    const participant_id = get_participant_id_from_url();
    const study_id = get_study_id_from_url();
    const curr_page_nr = get_page_nr_from_url();
    if (curr_page_nr <= 1) {
        console.log("Already on the first page");
        return;
    }
    const prev_page = curr_page_nr - 1;
    const up = get_params_from_url();
    update_study_url(participant_id, study_id, up.study_type, prev_page, up.total_pages);
    clear_radio_buttons();
    renderPage(prev_page);
    db_get_and_set_participant_diagnosis(participant_id, study_id, prev_page);
    button_toggle_next_or_submit(prev_page, parseInt(up.total_pages, 10));
    log_page_visit(participant_id, study_id, prev_page);
}

// ---------- Attach event listeners ----------
document.addEventListener('DOMContentLoaded', function() {
    const btnNext = document.getElementById("button-next");
    const btnSubmit = document.getElementById("submit-btn");
    const btnPrev = document.getElementById("button-prev");

    if (btnNext) btnNext.addEventListener("click", next_button_action);
    if (btnSubmit) btnSubmit.addEventListener("click", next_button_action);
    if (btnPrev) btnPrev.addEventListener("click", prev_button_action);
});

// ---------- Keyboard Navigation ----------
document.addEventListener('keydown', (event) => {
  const prevBtn = document.getElementById('button-prev');
  const nextBtn = document.getElementById('button-next');
  const submitBtn = document.getElementById('submit-btn');

  if (event.target.tagName === 'INPUT') return;

  if (event.key === 'Enter' || event.key === 'ArrowRight') {
    if (submitBtn && submitBtn.style.display !== 'none' && !submitBtn.disabled) {
      event.preventDefault();
      submitBtn.click();
    } else if (nextBtn && nextBtn.style.display !== 'none' && !nextBtn.disabled) {
      event.preventDefault();
      nextBtn.click();
    }
  }

  if (event.key === 'Escape' || event.key === 'ArrowLeft') {
    if (prevBtn && prevBtn.style.display !== 'none' && !prevBtn.disabled) {
      event.preventDefault();
      prevBtn.click();
    }
  }
});