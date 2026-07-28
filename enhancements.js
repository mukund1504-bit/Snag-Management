/* eslint-disable */
/* ============================================================
 * CSMS v2 ENHANCEMENTS
 * Adds:
 *   1. Defect Closure Tab (map + summary + close popup)
 *   2. Notifications Tab (Assigned to me / Common / Closed / Mine)
 *   3. Report multi-select filters (Project, Tower, Floor, Flat, User, Status, Category, Risk)
 *   4. BI Telemetry: multi-select + Excel export + extra analytics
 *   5. Flat-level Drawing Mapping (falls back to floor-level)
 *   6. 5-level user permissions (view / editonly / create / close / edit)
 *   7. PDF with 2 defects per A4 page
 *   8. Assign Task To (multi-select) in defect create
 *   9. Realtime notifications (uses Supabase realtime subscription)
 *  10. Responsive tweaks for all new sections
 *
 * IMPORTANT — SUPABASE SCHEMA:
 *   Please add one nullable TEXT column to `snagmanagement` table:
 *      ALTER TABLE snagmanagement ADD COLUMN assignedto TEXT;
 *
 *   Existing `snag_maps.map_key` field is reused. For flat-level maps
 *   the key format is: {project}_{tower}_{floor}_{flat}
 *   Legacy floor-level keys ({project}_{tower}_{floor}) still work as fallback.
 *
 * This file DOES NOT modify Script.js — it augments/overrides globals.
 * ============================================================ */
(function(){
  'use strict';

  // ==============================================================
  // v2.1 — USERS CROSS-DEVICE SYNC (Supabase snag_users table)
  //   Fixes: user created on laptop unable to login from phone/iOS Safari
  // ==============================================================
  const _USERS_TABLE = 'snag_users';

  window.loadUsersFromCloud = async function() {
    if (typeof supabaseClient === 'undefined') return null;
    try {
      const { data, error } = await supabaseClient.from(_USERS_TABLE).select('*');
      if (error) { console.warn('[CSMS] loadUsersFromCloud failed:', error.message); return null; }
      if (!data || data.length === 0) return null;
      // Merge into USER_MATRIX (cloud wins; keep local-only users too)
      const cloudUsers = data.map(u => ({
        id: u.email,
        firstName: u.first_name || '',
        middleName: u.middle_name || '',
        lastName: u.last_name || '',
        pass: u.pass,
        role: u.role || 'user',
        permission: u.permission || 'edit',
        projects: Array.isArray(u.projects) ? u.projects : (typeof u.projects === 'string' ? JSON.parse(u.projects) : [])
      }));
      const merged = new Map();
      (USER_MATRIX || []).forEach(u => merged.set(String(u.id).toLowerCase(), u));
      cloudUsers.forEach(u => merged.set(String(u.id).toLowerCase(), u));
      USER_MATRIX.length = 0;
      merged.forEach(u => USER_MATRIX.push(u));
      localStorage.setItem('qa_users', JSON.stringify(USER_MATRIX));
      return USER_MATRIX;
    } catch(e) { console.warn('[CSMS] loadUsersFromCloud exception:', e); return null; }
  };

  window.saveUserToCloud = async function(user) {
    if (typeof supabaseClient === 'undefined' || !user || !user.id) return false;
    try {
      const payload = {
        email: user.id,
        first_name: user.firstName || null,
        middle_name: user.middleName || null,
        last_name: user.lastName || null,
        pass: user.pass,
        role: user.role || 'user',
        permission: user.permission || 'edit',
        projects: user.projects || []
      };
      const { error } = await supabaseClient.from(_USERS_TABLE).upsert([payload], { onConflict: 'email' });
      if (error) { console.warn('[CSMS] saveUserToCloud failed:', error.message); return false; }
      return true;
    } catch(e) { console.warn('[CSMS] saveUserToCloud exception:', e); return false; }
  };

  window.deleteUserFromCloud = async function(email) {
    if (typeof supabaseClient === 'undefined' || !email) return false;
    try {
      const { error } = await supabaseClient.from(_USERS_TABLE).delete().eq('email', email);
      if (error) { console.warn('[CSMS] deleteUserFromCloud failed:', error.message); return false; }
      return true;
    } catch(e) { return false; }
  };

  // Override processLogin — ENTERPRISE cross-device / cross-browser login.
  // Always refresh users from Supabase (snag_users) when online so a user created
  // on ANY device or browser can log in immediately, and password changes
  // propagate everywhere. Chrome + Safari both use this exact same path.
  const _origProcessLogin = window.processLogin;
  window.processLogin = async function() {
    const loginStr = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pass = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginError');

    const findUser = () => (USER_MATRIX || []).find(u =>
      (u.id && u.id.toLowerCase() === loginStr) ||
      (u.firstName && u.lastName && (`${u.firstName} ${u.lastName}`.toLowerCase() === loginStr))
    );

    let validUser = findUser();

    // Refresh from cloud whenever online AND (user missing locally OR the local
    // cached password does not match) — guarantees freshest credentials so a
    // freshly-created user always works on a second browser/device.
    if (navigator.onLine && (!validUser || validUser.pass !== pass)) {
      try {
        if (err) { err.style.display = 'block'; err.style.color = '#0369a1'; err.innerText = 'Verifying credentials…'; }
        await loadUsersFromCloud();
      } catch(e) {}
      validUser = findUser();
    }

    if (validUser && validUser.pass === pass) {
      currentUser = validUser;
      sessionStorage.setItem('qa_logged_in_user', JSON.stringify(validUser));
      if (err) err.style.display = 'none';
      activateApp();
    } else {
      if (err) { err.style.display = 'block'; err.style.color = ''; err.innerText = 'Invalid credentials. Try full name or email.'; }
    }
  };

  // Override the ACTUAL user-save function used by the Security & Access form.
  // index.html calls saveSystemUser() (NOT submitUserForm), which previously
  // saved ONLY to localStorage — that is why new users never appeared in the
  // Supabase snag_users table and could not log in from another browser.
  // We capture the email BEFORE the original runs (it resets the form), then
  // push the saved user to Supabase so login works on any device & browser.
  const _origSaveSystemUser = window.saveSystemUser;
  window.saveSystemUser = async function() {
    const emailEl = document.getElementById('suEmail');
    const email = emailEl ? emailEl.value.trim() : '';
    // Original: validates + saves to USER_MATRIX/localStorage + resets the form
    if (_origSaveSystemUser) _origSaveSystemUser();
    if (!email) return;
    // Original stores id === email; match case-insensitively.
    const u = (USER_MATRIX || []).find(x => String(x.id).toLowerCase() === email.toLowerCase());
    if (!u) return; // original validation failed (e.g. no project selected)
    const ok = await saveUserToCloud(u);
    if (ok) csmsToast('User saved & synced to cloud — login works on any device & browser.', 'success');
    else csmsToast('Saved locally, but CLOUD SYNC FAILED. Check snag_users table & Supabase anon key.', 'error');
  };

  const _origDeleteUser = window.deleteUser;
  window.deleteUser = async function(email) {
    if (!confirm(`Delete access for ${email}?`)) return;
    USER_MATRIX = USER_MATRIX.filter(u => u.id !== email);
    localStorage.setItem('qa_users', JSON.stringify(USER_MATRIX));
    if (typeof renderUserTable === 'function') renderUserTable();
    await deleteUserFromCloud(email);
  };

  // ---------- Utility: create canvas config slots for new canvases ----------
  if (typeof canvasConfig !== 'undefined') {
    canvasConfig.closure = { ctx: null, img: null, scale: 1, tx: 0, ty: 0, marker: null, active: false, defectsOnMap: [] };
    canvasConfig.cd      = { ctx: null, img: null, scale: 1, tx: 0, ty: 0, marker: null, active: false };
  }

  // ---------- Utility: Permission helpers ----------
  window.canCreateDefect = function() {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const p = currentUser.permission || 'edit';
    return p === 'edit' || p === 'create';
  };
  window.canCloseDefect = function(defect) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const p = currentUser.permission || 'edit';
    if (!(p === 'edit' || p === 'close')) return false;
    // If defect is assigned to specific users, only those users can close
    if (defect && defect.assignedto && String(defect.assignedto).trim().length > 0) {
      const assignees = String(defect.assignedto).split('|').map(s => s.trim().toLowerCase());
      const meEmail = String(currentUser.id || '').toLowerCase();
      const meFullName = (currentUser.firstName && currentUser.lastName)
        ? (`${currentUser.firstName} ${currentUser.lastName}`).toLowerCase() : '';
      return assignees.includes(meEmail) || assignees.includes(meFullName);
    }
    return true;
  };
  window.canEditDefect = function(defect) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const p = currentUser.permission || 'edit';
    return p === 'edit' || p === 'editonly' || p === 'close';
  };

  // ---------- Multi-Select: generic helper ----------
  window.toggleMS = function(box) {
    const parent = box.closest('.custom-multi-select');
    if (parent) parent.classList.toggle('open');
  };
  document.addEventListener('click', function(e){
    document.querySelectorAll('.custom-multi-select.open').forEach(el => {
      if (!el.contains(e.target)) el.classList.remove('open');
    });
  });

  function _msSetOptions(msId, options, {showAll = 'All'} = {}) {
    const ms = document.getElementById(msId); if (!ms) return;
    const list = ms.querySelector('.dropdown-list-checkboxes');
    const prev = _msGetSelected(msId);
    list.innerHTML = options.map(opt => {
      const val = String(opt);
      const chk = prev.includes(val) ? 'checked' : '';
      return `<label class="spec-cb-label"><input type="checkbox" class="ms-chk" value="${_esc(val)}" ${chk} onchange="_msUpdateLabel('${msId}','${_esc(showAll)}')"> ${_esc(val)}</label>`;
    }).join('');
    // FIX (infinite recursion / stack overflow): programmatic (re)population must
    // NOT fire the bound _onChange — otherwise populateReportMS/populateBiMS call
    // _msSetOptions → _msUpdateLabel → _onChange → populateReportMS → … forever,
    // crashing init so tabs never finish loading after a refresh. Pass false.
    _msUpdateLabel(msId, showAll, false);
  }
  window._msUpdateLabel = function(msId, showAll, fireChange) {
    const ms = document.getElementById(msId); if (!ms) return;
    const chks = ms.querySelectorAll('.ms-chk:checked');
    const span = ms.querySelector('.select-box span');
    if (span) {
      if (chks.length === 0) span.textContent = showAll;
      else if (chks.length === 1) span.textContent = chks[0].value;
      else span.textContent = chks.length + ' selected';
    }
    // Fire the bound renderer ONLY on genuine user interaction (inline checkbox
    // onchange calls this with 2 args → fireChange undefined → treated as true).
    if (fireChange !== false && ms._onChange) ms._onChange();
  };
  window._msGetSelected = function(msId) {
    const ms = document.getElementById(msId); if (!ms) return [];
    return Array.from(ms.querySelectorAll('.ms-chk:checked')).map(cb => cb.value);
  };
  function _msBind(msId, onChange) {
    const ms = document.getElementById(msId); if (!ms) return;
    ms._onChange = onChange;
  }
  function _esc(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  // =========================================================
  // 1. DEFECT CLOSURE TAB
  // =========================================================
  window.clPopulateDropdowns = function() {
    const projects = getAllowedProjects();
    const projSel = document.getElementById('cl_project');
    if (projSel) {
      const cur = projSel.value;
      projSel.innerHTML = '<option value="">-- Select Project --</option>';
      projects.forEach(p => projSel.appendChild(new Option(p, p)));
      if (cur) projSel.value = cur;
    }
    // Also seed category / risk / assignee MS
    _msSetOptions('cl_cat_ms', Object.keys(defectMatrix || {}), {showAll:'All Categories'});
    _msSetOptions('cl_risk_ms', ['Low','Medium','High'], {showAll:'All Risks'});
    const allAssignees = new Set(['-']);
    (USER_MATRIX || []).forEach(u => allAssignees.add(getFullName(u)));
    (defects || []).forEach(d => {
      if (d.assignedto) String(d.assignedto).split('|').forEach(a => a && allAssignees.add(a.trim()));
    });
    _msSetOptions('cl_assign_ms', Array.from(allAssignees), {showAll:'All'});
    _msBind('cl_cat_ms', clRenderTable);
    _msBind('cl_risk_ms', clRenderTable);
    _msBind('cl_assign_ms', clRenderTable);
    const slaSel = document.getElementById('cl_sla');
    if (slaSel) slaSel.onchange = clRenderTable;
  };
  window.clPopulateTowers = function() {
    const p = document.getElementById('cl_project').value;
    const tSel = document.getElementById('cl_tower');
    tSel.innerHTML = '<option value="">-- Select Tower --</option>';
    if (p && structuralHierarchy[p]) {
      getAllowedTowers(p).forEach(t => tSel.appendChild(new Option(t, t)));
    }
    document.getElementById('cl_floor').innerHTML = '<option value="">-- Select Floor --</option>';
    document.getElementById('cl_flat').innerHTML = '<option value="">All Flats</option>';
    clClearMap();
    clRenderTable();
  };
  window.clPopulateFloors = function() {
    const p = document.getElementById('cl_project').value;
    const t = document.getElementById('cl_tower').value;
    const fSel = document.getElementById('cl_floor');
    fSel.innerHTML = '<option value="">-- Select Floor --</option>';
    if (p && t && structuralHierarchy[p] && structuralHierarchy[p][t]) {
      Object.keys(structuralHierarchy[p][t]).forEach(f => fSel.appendChild(new Option(f, f)));
    }
    document.getElementById('cl_flat').innerHTML = '<option value="">All Flats</option>';
    clClearMap();
    clRenderTable();
  };
  window.clPopulateFlats = function() {
    const p = document.getElementById('cl_project').value;
    const t = document.getElementById('cl_tower').value;
    const f = document.getElementById('cl_floor').value;
    const flatSel = document.getElementById('cl_flat');
    flatSel.innerHTML = '<option value="">All Flats</option>';
    if (p && t && f && structuralHierarchy[p] && structuralHierarchy[p][t] && structuralHierarchy[p][t][f]) {
      structuralHierarchy[p][t][f].forEach(u => flatSel.appendChild(new Option(u, u)));
    }
  };

  function _resolveMapKey(p, t, f, flat) {
    // Try flat-level first, then floor-level fallback
    if (flat) {
      const kFlat = `${p}_${t}_${f}_${flat}`;
      if (floorMaps[kFlat]) return { key: kFlat, url: floorMaps[kFlat] };
    }
    const kFloor = `${p}_${t}_${f}`;
    if (floorMaps[kFloor]) return { key: kFloor, url: floorMaps[kFloor] };
    return null;
  }

  window.clLoadMap = async function() {
    const p = document.getElementById('cl_project').value;
    const t = document.getElementById('cl_tower').value;
    const f = document.getElementById('cl_floor').value;
    const flat = document.getElementById('cl_flat').value;
    const warn = document.getElementById('clMapWarning');
    const canvas = document.getElementById('closureCanvas');
    if (!canvas) return;
    if (!canvasConfig.closure.ctx) canvasConfig.closure.ctx = canvas.getContext('2d');
    if (!p || !t || !f) { clClearMap(); clRenderTable(); return; }

    const mapRes = _resolveMapKey(p, t, f, flat);
    if (!mapRes) {
      clClearMap();
      if (warn) warn.style.display = 'block';
      clRenderTable();
      return;
    }
    if (warn) warn.style.display = 'none';

    if ((!defects || defects.length === 0) && navigator.onLine) {
      try { await loadDefectsFromCloud(true); } catch(e){}
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvasConfig.closure.img = img;
      canvasConfig.closure.active = true;
      canvas.width = img.width;
      canvas.height = img.height;
      _clDrawMap();
      _clBindClick();
      clRenderTable(); // regenerates with dot numbers
    };
    img.onerror = () => {
      // CORS fallback: try without crossOrigin
      const img2 = new Image();
      img2.onload = () => {
        canvasConfig.closure.img = img2;
        canvasConfig.closure.active = true;
        canvas.width = img2.width; canvas.height = img2.height;
        _clDrawMap();
        _clBindClick();
        clRenderTable();
      };
      img2.onerror = () => { clClearMap(); if (warn) { warn.style.display = 'block'; warn.textContent = 'Map found but failed to load (check bucket public access).'; } };
      img2.src = mapRes.url;
    };
    img.src = mapRes.url;
  };

  function _clDrawMap() {
    const c = canvasConfig.closure;
    const canvas = document.getElementById('closureCanvas');
    if (!c.img || !c.ctx || !canvas) return;
    c.ctx.clearRect(0,0,canvas.width,canvas.height);
    c.ctx.drawImage(c.img, 0, 0);
    const pending = _clFilteredDefects();
    c.defectsOnMap = pending;
    pending.forEach((d, idx) => {
      if (!d.mapx || !d.mapy || d.mapx === '0') return;
      const x = parseFloat(d.mapx), y = parseFloat(d.mapy);
      // Bigger red dot
      c.ctx.beginPath();
      c.ctx.arc(x, y, 20, 0, 2*Math.PI);
      c.ctx.fillStyle = 'rgba(239,68,68,0.9)';
      c.ctx.fill();
      c.ctx.lineWidth = 3;
      c.ctx.strokeStyle = '#ffffff';
      c.ctx.stroke();
      // Number label inside
      c.ctx.fillStyle = '#ffffff';
      c.ctx.font = 'bold 16px system-ui';
      c.ctx.textAlign = 'center';
      c.ctx.textBaseline = 'middle';
      c.ctx.fillText(String(idx+1), x, y);
    });
    document.getElementById('cl_map_count').textContent = pending.length;
  }

  function _clBindClick() {
    const canvas = document.getElementById('closureCanvas'); if (!canvas) return;
    if (canvas._csmsCloseClick) canvas.removeEventListener('click', canvas._csmsCloseClick);
    const handler = (e) => {
      const c = canvasConfig.closure;
      if (!c.active || !c.img) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * sx;
      const y = (e.clientY - rect.top) * sy;
      let hit = null;
      for (let i=0; i<c.defectsOnMap.length; i++) {
        const d = c.defectsOnMap[i];
        if (!d.mapx || !d.mapy) continue;
        const dx = parseFloat(d.mapx), dy = parseFloat(d.mapy);
        const dist = Math.hypot(dx-x, dy-y);
        if (dist <= 25) { hit = d; break; }
      }
      if (hit) openCloseDefectModal(hit);
    };
    canvas._csmsCloseClick = handler;
    canvas.addEventListener('click', handler);
    // Attach gestures (pinch + drag) — function comes from Script.js
    if (typeof attachZoomGestures === 'function') attachZoomGestures('closureCanvas');
  }

  window.clClearMap = function() {
    canvasConfig.closure.img = null;
    canvasConfig.closure.active = false;
    canvasConfig.closure.defectsOnMap = [];
    const canvas = document.getElementById('closureCanvas');
    if (canvas && canvasConfig.closure.ctx) {
      canvasConfig.closure.ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    const cnt = document.getElementById('cl_map_count'); if (cnt) cnt.textContent = '0';
  };

  function _clFilteredDefects() {
    const p = document.getElementById('cl_project').value;
    const t = document.getElementById('cl_tower').value;
    const f = document.getElementById('cl_floor').value;
    const flat = document.getElementById('cl_flat').value;
    const cats = _msGetSelected('cl_cat_ms');
    const risks = _msGetSelected('cl_risk_ms');
    const assigns = _msGetSelected('cl_assign_ms');
    const slaFilter = document.getElementById('cl_sla') ? document.getElementById('cl_sla').value : 'all';

    const today = new Date();
    return (defects || []).filter(d => {
      if (d.statusvector === 'Closed') return false;
      if (p && d.project !== p) return false;
      if (t && d.tower !== t) return false;
      if (f && d.floor !== f) return false;
      if (flat && d.flat !== flat) return false;
      if (cats.length && !cats.includes(d.defectcategory)) return false;
      if (risks.length && !risks.includes(d.riskspectrum)) return false;
      if (assigns.length) {
        const a = String(d.assignedto || '').split('|').map(s=>s.trim());
        const overlaps = assigns.some(x => a.includes(x));
        if (!overlaps) return false;
      }
      if (slaFilter === 'delayed') {
        if (!d.sladuedate || new Date(d.sladuedate) >= today) return false;
      } else if (slaFilter === 'ontime') {
        if (d.sladuedate && new Date(d.sladuedate) < today) return false;
      }
      return true;
    });
  }

  window.clRenderTable = function() {
    const tbody = document.querySelector('#closureTable tbody');
    if (!tbody) return;
    const pending = _clFilteredDefects();
    // Redraw map dots (numbering stays aligned)
    if (canvasConfig.closure.img) _clDrawMap();
    if (pending.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#64748b;">No pending defects.</td></tr>';
      return;
    }
    tbody.innerHTML = pending.map((d, i) => {
      const overdue = d.sladuedate && new Date(d.sladuedate) < new Date();
      const riskCls = (d.riskspectrum || '').toLowerCase();
      const closable = canCloseDefect(d);
      return `<tr>
        <td><span class="serial-badge-inline">${i+1}</span></td>
        <td>${d.flat || '-'}</td>
        <td><b>${d.defectcategory || '-'}</b></td>
        <td>${d.specificationmatrix || '-'}</td>
        <td><span class="notif-risk-pill risk-pill-${riskCls}">${d.riskspectrum || '-'}</span></td>
        <td style="${overdue ? 'color:#dc2626;font-weight:700;' : ''}">${d.sladuedate || '-'}${overdue?' ⚠':''}</td>
        <td style="font-size:11.5px;">${d.assignedto || '<i style="color:#94a3b8;">Common</i>'}</td>
        <td>${closable ? `<button class="close-btn-inline" onclick="openCloseDefectModal(defects.find(x=>x.id=='${d.id}'))"><i class="fas fa-check"></i> Close</button>` : '<span style="color:#94a3b8;font-size:11px;">Not assigned to you</span>'}</td>
      </tr>`;
    }).join('');
  };

  // =========================================================
  // CLOSE DEFECT MODAL
  // =========================================================
  let _cdCurrent = null;
  let _cdFinalPhotos = [];

  window.openCloseDefectModal = function(d) {
    if (!d) return;
    if (!canCloseDefect(d)) { alert('You do not have permission to close this defect.'); return; }
    _cdCurrent = d;
    _cdFinalPhotos = [];
    document.getElementById('cd_defectId').value = d.id;
    document.getElementById('cd_meta').innerHTML = `
      <b>${d.project} / ${d.tower} / ${d.floor} / ${d.flat}</b><br>
      <b>Category:</b> ${d.defectcategory || '-'} — <b>Spec:</b> ${d.specificationmatrix || '-'}<br>
      <b>Risk:</b> ${d.riskspectrum || '-'} — <b>Logged:</b> ${d.loggeddate || '-'} — <b>SLA:</b> ${d.sladuedate || '-'}<br>
      <b>Created By:</b> ${d.createdby || '-'}<br>
      <b>Remarks:</b> ${d.engineeringremarks || '-'}
    `;
    const initHtml = (d.initialPics || []).map(p =>
      `<div class="thumb"><img src="${p}" onclick="openZoomImage('${p}')"/></div>`).join('') || '<span style="color:#94a3b8;font-size:12px;">No photos.</span>';
    document.getElementById('cd_initialPhotos').innerHTML = initHtml;
    document.getElementById('cd_finalPreview').innerHTML = '';
    document.getElementById('cd_remarks').value = '';
    document.getElementById('closeDefectModal').style.display = 'flex';

    // Load map for this defect on cd canvas
    const canvas = document.getElementById('cdCanvas');
    if (canvas) {
      if (!canvasConfig.cd.ctx) canvasConfig.cd.ctx = canvas.getContext('2d');
      const mapRes = _resolveMapKey(d.project, d.tower, d.floor, d.flat);
      if (mapRes && d.mapx && d.mapy) {
        canvasConfig.cd.marker = { x: parseFloat(d.mapx), y: parseFloat(d.mapy) };
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          canvasConfig.cd.img = img;
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvasConfig.cd.ctx;
          ctx.clearRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(img, 0, 0);
          const m = canvasConfig.cd.marker;
          ctx.beginPath(); ctx.arc(m.x, m.y, 18, 0, 2*Math.PI);
          ctx.fillStyle = 'rgba(239,68,68,0.9)'; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
        };
        img.src = mapRes.url;
        if (typeof attachZoomGestures === 'function') attachZoomGestures('cdCanvas');
      } else {
        canvasConfig.cd.img = null;
        if (canvasConfig.cd.ctx) canvasConfig.cd.ctx.clearRect(0,0,100,100);
      }
    }
  };

  window.closeCdModal = function() {
    document.getElementById('closeDefectModal').style.display = 'none';
    _cdCurrent = null;
    _cdFinalPhotos = [];
  };

  window.cdTriggerPhoto = function() {
    if (_cdFinalPhotos.length >= 3) return alert('Max 3 photos.');
    document.getElementById('cd_photoInput').click();
  };
  window.cdOnPhotoPicked = function(evt) {
    const file = evt.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 600/Math.max(img.width, img.height));
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        _cdFinalPhotos.push(canvas.toDataURL('image/jpeg', 0.6));
        _cdRenderPhotos();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file); evt.target.value = '';
  };
  function _cdRenderPhotos() {
    document.getElementById('cd_finalPreview').innerHTML = _cdFinalPhotos.map((s,i) =>
      `<div class="thumb"><img src="${s}" onclick="openZoomImage('${s}')"/><button type="button" class="x" onclick="_cdRemove(${i})">x</button></div>`).join('');
  }
  window._cdRemove = function(i){ _cdFinalPhotos.splice(i,1); _cdRenderPhotos(); };

  window.cdSubmit = async function() {
    if (!_cdCurrent) return;
    if (_cdFinalPhotos.length === 0) return alert('Please add at least 1 final photo to close.');
    if (!confirm('Closing will LOCK the record. Proceed?')) return;
    const btn = document.getElementById('cd_submitBtn');
    btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Closing...";
    try {
      const remarks = document.getElementById('cd_remarks').value.trim();
      const existingRem = _cdCurrent.engineeringremarks || '';
      const combined = remarks
        ? `${existingRem}${existingRem ? '\n' : ''}[Closure] ${remarks}`
        : existingRem;
      const payload = {
        statusvector: 'Closed',
        finalphotos: _cdFinalPhotos.join('|||'),
        closeddate: new Date().toISOString().slice(0,10),
        closedby: getFullName(currentUser),
        engineeringremarks: combined
      };
      const { error } = await supabaseClient.from('snagmanagement').update(payload).eq('id', _cdCurrent.id);
      if (error) throw error;
      csmsToast('Defect closed & locked.', 'success');
      closeCdModal();
      await loadDefectsFromCloud(true);
      if (typeof clRenderTable === 'function') clRenderTable();
      if (typeof clLoadMap === 'function') clLoadMap();
      if (typeof renderNotifications === 'function') renderNotifications();
    } catch(e) {
      alert('Failed to close: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.innerHTML = "<i class='fas fa-check-circle'></i> Close & Lock Defect";
    }
  };

  // =========================================================
  // 2. NOTIFICATIONS TAB
  // =========================================================
  let _notifTab = 'direct';
  window.switchNotifTab = function(el, tab) {
    document.querySelectorAll('.notif-tab-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    _notifTab = tab;
    renderNotifications();
  };

  function _isAssignedToMe(d) {
    if (!d.assignedto) return false;
    const list = String(d.assignedto).split('|').map(s => s.trim().toLowerCase()).filter(Boolean);
    const meEmail = String(currentUser.id || '').toLowerCase();
    const meName  = (currentUser.firstName && currentUser.lastName)
      ? (`${currentUser.firstName} ${currentUser.lastName}`).toLowerCase() : '';
    return list.includes(meEmail) || (meName && list.includes(meName));
  }
  function _isCommonProject(d) {
    if (d.assignedto && String(d.assignedto).trim().length > 0) return false;
    // check if user has access to project+tower
    if (currentUser.role === 'admin') return true;
    if (currentUser.projects && currentUser.projects.includes('All')) return true;
    return (currentUser.projects || []).includes(`${d.project}_${d.tower}`);
  }
  function _isCreatedByMe(d) {
    const meName = (currentUser.firstName && currentUser.lastName)
      ? `${currentUser.firstName} ${currentUser.lastName}` : '';
    return d.createdby === meName || d.createdby === currentUser.id;
  }
  function _isRecentlyClosed(d) {
    if (d.statusvector !== 'Closed' || !d.closeddate) return false;
    const daysSince = (Date.now() - new Date(d.closeddate).getTime()) / 86400000;
    if (daysSince > 30) return false;
    // Only show if user is involved (created, assigned, or has project access)
    return _isAssignedToMe(d) || _isCommonProject(d) || _isCreatedByMe(d);
  }

  function _slaLabel(d) {
    if (!d.sladuedate) return { label: '-', overdue: false };
    const due = new Date(d.sladuedate);
    const days = Math.ceil((due - Date.now()) / 86400000);
    if (d.statusvector === 'Closed') return { label: 'Closed', overdue: false };
    if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, overdue: true };
    if (days === 0) return { label: 'Due today', overdue: true };
    return { label: `${days}d left`, overdue: false };
  }

  function _computeNotifCounts() {
    if (!currentUser) return { direct:0, common:0, closed:0, mine:0 };
    const open = (defects || []).filter(d => d.statusvector !== 'Closed');
    return {
      direct: open.filter(_isAssignedToMe).length,
      common: open.filter(_isCommonProject).length,
      closed: (defects || []).filter(_isRecentlyClosed).length,
      mine: open.filter(_isCreatedByMe).length,
    };
  }

  window.updateNotifCounts = function() {
    if (!currentUser) return;
    const c = _computeNotifCounts();
    ['direct','common','closed','mine'].forEach(k => {
      const el = document.getElementById('nc_' + k);
      if (el) el.textContent = c[k];
    });
    const total = c.direct + c.common;
    const badge = document.getElementById('notifBadge');
    if (badge) {
      if (total > 0) { badge.style.display = 'inline-block'; badge.textContent = total > 99 ? '99+' : total; }
      else badge.style.display = 'none';
    }
  };

  window.renderNotifications = function() {
    if (!currentUser) return;
    updateNotifCounts();
    const list = document.getElementById('notifList');
    if (!list) return;
    let items;
    if (_notifTab === 'direct') items = (defects||[]).filter(d => d.statusvector !== 'Closed' && _isAssignedToMe(d));
    else if (_notifTab === 'common') items = (defects||[]).filter(d => d.statusvector !== 'Closed' && _isCommonProject(d));
    else if (_notifTab === 'closed') items = (defects||[]).filter(_isRecentlyClosed);
    else items = (defects||[]).filter(d => d.statusvector !== 'Closed' && _isCreatedByMe(d));

    const q = (document.getElementById('notif_search').value || '').toLowerCase();
    if (q) items = items.filter(d =>
      (d.defectcategory||'').toLowerCase().includes(q) ||
      (d.specificationmatrix||'').toLowerCase().includes(q) ||
      (d.flat||'').toLowerCase().includes(q) ||
      (d.tower||'').toLowerCase().includes(q) ||
      (d.project||'').toLowerCase().includes(q) ||
      (d.engineeringremarks||'').toLowerCase().includes(q)
    );
    const risk = document.getElementById('notif_risk').value;
    if (risk !== 'All') items = items.filter(d => d.riskspectrum === risk);
    const sort = document.getElementById('notif_sort').value;
    if (sort === 'new') items.sort((a,b) => (b.loggeddate||'').localeCompare(a.loggeddate||''));
    else if (sort === 'sla') items.sort((a,b) => (a.sladuedate||'9999').localeCompare(b.sladuedate||'9999'));
    else if (sort === 'risk') { const r = {High:0,Medium:1,Low:2}; items.sort((a,b) => (r[a.riskspectrum]||9)-(r[b.riskspectrum]||9)); }

    if (items.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:30px; color:#64748b;">No notifications to show.</p>';
      return;
    }
    list.innerHTML = items.map(d => {
      const sla = _slaLabel(d);
      const isClosed = d.statusvector === 'Closed';
      const riskCls = (d.riskspectrum || 'low').toLowerCase();
      const canClose = canCloseDefect(d) && !isClosed;
      return `<div class="notif-card ${riskCls}-risk ${isClosed?'closed':''}">
        <div class="notif-card-head">
          <span class="notif-cat-pill">${d.defectcategory || 'Defect'}</span>
          <span class="notif-risk-pill risk-pill-${riskCls}">${d.riskspectrum || '-'}</span>
        </div>
        <div class="notif-loc"><b>${d.project}</b> → ${d.tower} → ${d.floor} → <b>${d.flat || '-'}</b></div>
        <div class="notif-desc">${d.specificationmatrix || ''}${d.engineeringremarks ? ' — ' + d.engineeringremarks : ''}</div>
        <div class="notif-meta-row">
          <span>By: <b>${d.createdby || '-'}</b> · ${d.loggeddate || '-'}</span>
          <span class="notif-sla-badge ${sla.overdue?'overdue':'ontime'}">${sla.label}</span>
        </div>
        ${d.assignedto ? `<div style="font-size:11px; color:#0284c7; margin-top:6px;"><i class="fas fa-user-check"></i> Assigned: ${d.assignedto.replace(/\|/g,', ')}</div>` : `<div style="font-size:11px; color:#94a3b8; margin-top:6px;"><i class="fas fa-users"></i> Common project task</div>`}
        ${isClosed ? `<div style="font-size:11px; color:#059669; margin-top:6px;"><i class="fas fa-lock"></i> Closed by ${d.closedby || '-'} on ${d.closeddate || '-'}</div>` : ''}
        <div class="notif-actions">
          <button class="view-btn" onclick="_notifView('${d.id}')"><i class="fas fa-eye"></i> View</button>
          ${canClose ? `<button class="close-btn" onclick="openCloseDefectModal(defects.find(x=>x.id=='${d.id}'))"><i class="fas fa-check"></i> Close</button>` : ''}
        </div>
      </div>`;
    }).join('');
  };

  window._notifView = function(id) {
    const d = (defects || []).find(x => String(x.id) === String(id));
    if (!d) return;
    if (typeof openDefectInfoModal === 'function') openDefectInfoModal(d);
  };

  // =========================================================
  // 3. REPORT MULTI-SELECT FILTERS
  // =========================================================
  window.populateReportMS = function() {
    const projects = getAllowedProjects();
    _msSetOptions('rf_project_ms', projects, {showAll:'All Projects'});
    // Towers derived from selected projects (or all allowed)
    const selectedProjects = _msGetSelected('rf_project_ms');
    const projSet = selectedProjects.length ? selectedProjects : projects;
    const towerSet = new Set();
    projSet.forEach(p => getAllowedTowers(p).forEach(t => towerSet.add(t)));
    _msSetOptions('rf_tower_ms', Array.from(towerSet), {showAll:'All Towers'});
    // Floors + Flats derived
    const selTowers = _msGetSelected('rf_tower_ms');
    const towers = selTowers.length ? selTowers : Array.from(towerSet);
    const floorSet = new Set();
    projSet.forEach(p => {
      if (!structuralHierarchy[p]) return;
      towers.forEach(t => {
        if (structuralHierarchy[p][t]) Object.keys(structuralHierarchy[p][t]).forEach(f => floorSet.add(f));
      });
    });
    _msSetOptions('rf_floor_ms', Array.from(floorSet), {showAll:'All Floors'});
    const selFloors = _msGetSelected('rf_floor_ms');
    const floors = selFloors.length ? selFloors : Array.from(floorSet);
    const flatSet = new Set();
    projSet.forEach(p => {
      if (!structuralHierarchy[p]) return;
      towers.forEach(t => {
        if (!structuralHierarchy[p][t]) return;
        floors.forEach(f => {
          if (structuralHierarchy[p][t][f]) structuralHierarchy[p][t][f].forEach(u => flatSet.add(u));
        });
      });
    });
    _msSetOptions('rf_flat_ms', Array.from(flatSet), {showAll:'All Flats'});
    // Users
    const users = new Set();
    (USER_MATRIX || []).forEach(u => users.add(getFullName(u)));
    (defects || []).forEach(d => { if (d.createdby) users.add(d.createdby); });
    _msSetOptions('rf_user_ms', Array.from(users), {showAll:'All Users'});
    _msSetOptions('rf_status_ms', ['Open','In Progress','Closed'], {showAll:'All Status'});
    _msSetOptions('rf_cat_ms', Object.keys(defectMatrix || {}), {showAll:'All Categories'});
    _msSetOptions('rf_risk_ms', ['Low','Medium','High'], {showAll:'All Risks'});

    ['rf_project_ms','rf_tower_ms','rf_floor_ms','rf_flat_ms','rf_user_ms','rf_status_ms','rf_cat_ms','rf_risk_ms'].forEach(id => {
      _msBind(id, () => { populateReportMS(); renderReportTable(); });
    });
  };

  window.clearAllReportFilters = function() {
    ['rf_project_ms','rf_tower_ms','rf_floor_ms','rf_flat_ms','rf_user_ms','rf_status_ms','rf_cat_ms','rf_risk_ms'].forEach(id => {
      document.querySelectorAll(`#${id} .ms-chk`).forEach(cb => cb.checked = false);
    });
    document.getElementById('reportDateFrom').value = '';
    document.getElementById('reportDateTo').value = '';
    populateReportMS();
    renderReportTable();
  };

  // Override renderReportTable to use multi-select
  const _origRenderReportTable = window.renderReportTable;
  window.renderReportTable = function() {
    // If MS containers don't exist yet, fall back
    if (!document.getElementById('rf_project_ms')) {
      if (typeof _origRenderReportTable === 'function') return _origRenderReportTable();
    }
    const allowedProjects = getAllowedProjects();
    const selProjs = _msGetSelected('rf_project_ms');
    const selTowers = _msGetSelected('rf_tower_ms');
    const selFloors = _msGetSelected('rf_floor_ms');
    const selFlats  = _msGetSelected('rf_flat_ms');
    const selUsers  = _msGetSelected('rf_user_ms');
    const selStatus = _msGetSelected('rf_status_ms');
    const selCats   = _msGetSelected('rf_cat_ms');
    const selRisks  = _msGetSelected('rf_risk_ms');
    const dFrom = (document.getElementById('reportDateFrom') || {}).value || '';
    const dTo   = (document.getElementById('reportDateTo') || {}).value || '';

    filteredReportData = (defects || []).filter(d => {
      if (currentUser && currentUser.role !== 'admin') {
        const hasAccess = allowedProjects.some(p => p.toLowerCase() === String(d.project||'').toLowerCase());
        if (!hasAccess) return false;
      }
      if (selProjs.length && !selProjs.includes(d.project)) return false;
      if (selTowers.length && !selTowers.includes(d.tower)) return false;
      if (selFloors.length && !selFloors.includes(d.floor)) return false;
      if (selFlats.length && !selFlats.includes(d.flat)) return false;
      if (selUsers.length && !selUsers.includes(d.createdby)) return false;
      if (selStatus.length && !selStatus.includes(d.statusvector)) return false;
      if (selCats.length && !selCats.includes(d.defectcategory)) return false;
      if (selRisks.length && !selRisks.includes(d.riskspectrum)) return false;
      if (dFrom && d.loggeddate && new Date(d.loggeddate) < new Date(dFrom)) return false;
      if (dTo && d.loggeddate && new Date(d.loggeddate) > new Date(dTo)) return false;
      return true;
    });

    const tbody = document.querySelector('#defectsTable tbody');
    if (tbody) {
      tbody.innerHTML = filteredReportData.length === 0
        ? '<tr><td colspan="20" style="text-align:center;">No records found matching criteria.</td></tr>'
        : generateTableRowsHtml(filteredReportData);
    }
  };

  // =========================================================
  // 4. BI TELEMETRY: multi-select + Excel + extra analytics
  // =========================================================
  window.populateBiMS = function() {
    const projects = getAllowedProjects();
    _msSetOptions('bi_project_ms', projects, {showAll:'All Authorized Projects'});
    const selP = _msGetSelected('bi_project_ms');
    const pool = selP.length ? selP : projects;
    const towerSet = new Set();
    pool.forEach(p => getAllowedTowers(p).forEach(t => towerSet.add(t)));
    _msSetOptions('bi_tower_ms', Array.from(towerSet), {showAll:'All Towers'});
    _msSetOptions('bi_status_ms', ['Open','In Progress','Closed'], {showAll:'All Status'});
    _msSetOptions('bi_risk_ms', ['Low','Medium','High'], {showAll:'All Risks'});
    _msSetOptions('bi_cat_ms', Object.keys(defectMatrix || {}), {showAll:'All Categories'});
    ['bi_project_ms','bi_tower_ms','bi_status_ms','bi_risk_ms','bi_cat_ms'].forEach(id => {
      _msBind(id, () => { populateBiMS(); renderCharts(); });
    });
  };

  window.clearAllBiFilters = function() {
    ['bi_project_ms','bi_tower_ms','bi_status_ms','bi_risk_ms','bi_cat_ms'].forEach(id => {
      document.querySelectorAll(`#${id} .ms-chk`).forEach(cb => cb.checked = false);
    });
    document.getElementById('biDateFrom').value = '';
    document.getElementById('biDateTo').value = '';
    populateBiMS(); renderCharts();
  };

  window.getBiFilteredData = function() {
    const allowedProjects = getAllowedProjects();
    const selP = _msGetSelected('bi_project_ms');
    const selT = _msGetSelected('bi_tower_ms');
    const selS = _msGetSelected('bi_status_ms');
    const selR = _msGetSelected('bi_risk_ms');
    const selC = _msGetSelected('bi_cat_ms');
    const dFrom = (document.getElementById('biDateFrom') || {}).value || '';
    const dTo   = (document.getElementById('biDateTo') || {}).value || '';
    return (defects || []).filter(d => {
      if (currentUser && currentUser.role !== 'admin' && !allowedProjects.includes(d.project)) return false;
      if (selP.length && !selP.includes(d.project)) return false;
      if (selT.length && !selT.includes(d.tower)) return false;
      if (selS.length && !selS.includes(d.statusvector)) return false;
      if (selR.length && !selR.includes(d.riskspectrum)) return false;
      if (selC.length && !selC.includes(d.defectcategory)) return false;
      if (dFrom && d.loggeddate && new Date(d.loggeddate) < new Date(dFrom)) return false;
      if (dTo && d.loggeddate && new Date(d.loggeddate) > new Date(dTo)) return false;
      return true;
    });
  };

  // Override renderCharts (keep original behaviour but use new filter + extra analytics)
  const _origRenderCharts = window.renderCharts;
  window.renderCharts = function() {
    if (!document.getElementById('bi_project_ms')) { if (_origRenderCharts) return _origRenderCharts(); }
    const filteredData = getBiFilteredData();
    // Destroy previous charts
    if (typeof chartsObj !== 'undefined') Object.keys(chartsObj).forEach(k => { if (chartsObj[k]) chartsObj[k].destroy(); });

    // Primary + Status charts
    const projMap = {}, statMap = { 'Open':0,'In Progress':0,'Closed':0 };
    filteredData.forEach(d => { projMap[d.project] = (projMap[d.project]||0)+1; if (statMap[d.statusvector]!==undefined) statMap[d.statusvector]++; });
    chartsObj.c1 = new Chart(document.getElementById('primaryChart'), { type:'bar', data:{ labels:Object.keys(projMap), datasets:[{label:'Total Defects', data:Object.values(projMap), backgroundColor:'#0284c7'}] }, options:{ responsive:true, maintainAspectRatio:false, onClick:(e,el)=>{ if(el.length>0) openDrillModal(Object.keys(projMap)[el[0].index], filteredData.filter(x=>x.project===Object.keys(projMap)[el[0].index])); } }});
    chartsObj.c2 = new Chart(document.getElementById('statusChart'), { type:'doughnut', data:{ labels:Object.keys(statMap), datasets:[{data:Object.values(statMap), backgroundColor:['#ef4444','#f59e0b','#10b981']}] }, options:{ responsive:true, maintainAspectRatio:false, onClick:(e,el)=>{ if(el.length>0) openDrillModal(Object.keys(statMap)[el[0].index], filteredData.filter(x=>x.statusvector===Object.keys(statMap)[el[0].index])); } }});

    // Analytic table
    const tHead = document.getElementById('analyticsTableHeader');
    const tBody = document.getElementById('analyticsTableBody');
    const filterAnalytic = document.getElementById('dashboardAnalyticFilter').value;
    let matrixData = {};
    if (filterAnalytic === 'floor') {
      tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>FLAT</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = `${d.project}_${d.tower}_${d.floor}_${d.flat}`; if(!matrixData[k]) matrixData[k]={p:d.project,t:d.tower,f:d.floor,fl:d.flat,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')matrixData[k].o++; if(d.statusvector==='In Progress')matrixData[k].ip++; if(d.statusvector==='Closed')matrixData[k].c++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td><td>${m.fl}</td><td>${m.o}</td><td>${m.ip}</td><td>${m.c}</td><td><b>${m.tot}</b></td></tr>`).join('');
    } else if (filterAnalytic === 'tower') {
      tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = `${d.project}_${d.tower}`; if(!matrixData[k]) matrixData[k]={p:d.project,t:d.tower,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')matrixData[k].o++; if(d.statusvector==='In Progress')matrixData[k].ip++; if(d.statusvector==='Closed')matrixData[k].c++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.o}</td><td>${m.ip}</td><td>${m.c}</td><td><b>${m.tot}</b></td></tr>`).join('');
    } else if (filterAnalytic === 'defect') {
      tHead.innerHTML = `<th>PROJECT</th><th>CATEGORY</th><th>SPECIFICATION</th><th>TOTAL</th>`;
      filteredData.forEach(d => { const specs = (d.specificationmatrix||'').split(',').map(s=>s.trim()).filter(Boolean); if (specs.length===0) specs.push('-'); specs.forEach(s => { const k = `${d.project}_${d.defectcategory}_${s}`; if(!matrixData[k]) matrixData[k]={p:d.project,c:d.defectcategory,s:s,tot:0}; matrixData[k].tot++; }); });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.c}</td><td>${m.s}</td><td><b>${m.tot}</b></td></tr>`).join('');
    } else if (filterAnalytic === 'intensity') {
      tHead.innerHTML = `<th>PROJECT</th><th>LOW</th><th>MEDIUM</th><th>HIGH</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = d.project; if(!matrixData[k]) matrixData[k]={p:d.project,l:0,m:0,h:0,tot:0}; if(d.riskspectrum==='Low')matrixData[k].l++; if(d.riskspectrum==='Medium')matrixData[k].m++; if(d.riskspectrum==='High')matrixData[k].h++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.l}</td><td>${m.m}</td><td>${m.h}</td><td><b>${m.tot}</b></td></tr>`).join('');
    } else if (filterAnalytic === 'user') {
      tHead.innerHTML = `<th>USER</th><th>CREATED</th><th>CLOSED</th><th>PENDING (Assigned)</th>`;
      const users = new Set();
      filteredData.forEach(d => { if (d.createdby) users.add(d.createdby); if (d.closedby) users.add(d.closedby); });
      Array.from(users).forEach(u => {
        const created = filteredData.filter(d => d.createdby === u).length;
        const closed = filteredData.filter(d => d.closedby === u && d.statusvector === 'Closed').length;
        const pending = filteredData.filter(d => d.statusvector !== 'Closed' && (d.assignedto || '').split('|').map(s=>s.trim()).includes(u)).length;
        matrixData[u] = { u, created, closed, pending };
      });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.u}</b></td><td>${m.created}</td><td>${m.closed}</td><td>${m.pending}</td></tr>`).join('');
    } else if (filterAnalytic === 'sla') {
      tHead.innerHTML = `<th>PROJECT</th><th>ON TIME</th><th>DELAYED (Open)</th><th>CLOSED WITHIN SLA</th><th>CLOSED LATE</th>`;
      filteredData.forEach(d => {
        let k = d.project; if(!matrixData[k]) matrixData[k]={p:d.project, on:0, del:0, closedOk:0, closedLate:0};
        if (d.statusvector === 'Closed') {
          if (d.closeddate && d.sladuedate && new Date(d.closeddate) <= new Date(d.sladuedate)) matrixData[k].closedOk++;
          else matrixData[k].closedLate++;
        } else {
          if (d.sladuedate && new Date(d.sladuedate) < new Date()) matrixData[k].del++;
          else matrixData[k].on++;
        }
      });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.on}</td><td style="color:#dc2626;">${m.del}</td><td style="color:#059669;">${m.closedOk}</td><td style="color:#dc2626;">${m.closedLate}</td></tr>`).join('');
    } else if (filterAnalytic === 'monthly') {
      tHead.innerHTML = `<th>YEAR-MONTH</th><th>CREATED</th><th>CLOSED</th><th>OPEN AT END</th>`;
      const monMap = {};
      filteredData.forEach(d => {
        const m = (d.loggeddate || '').slice(0,7); if (m) { monMap[m] = monMap[m] || {created:0,closed:0}; monMap[m].created++; }
        const c = (d.closeddate || '').slice(0,7); if (c && c !== '-') { monMap[c] = monMap[c] || {created:0,closed:0}; monMap[c].closed++; }
      });
      const sortedM = Object.keys(monMap).sort();
      let running = 0;
      tBody.innerHTML = sortedM.map(m => { running += (monMap[m].created - monMap[m].closed); return `<tr><td>${m}</td><td>${monMap[m].created}</td><td>${monMap[m].closed}</td><td>${running}</td></tr>`; }).join('');
    } else if (filterAnalytic === 'assignee') {
      tHead.innerHTML = `<th>ASSIGNEE</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      const map = {};
      filteredData.forEach(d => {
        const assList = (d.assignedto ? d.assignedto.split('|').map(s=>s.trim()).filter(Boolean) : ['<Unassigned>']);
        assList.forEach(a => { if(!map[a]) map[a]={a,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')map[a].o++; if(d.statusvector==='In Progress')map[a].ip++; if(d.statusvector==='Closed')map[a].c++; map[a].tot++; });
      });
      tBody.innerHTML = Object.values(map).map(m => `<tr><td><b>${m.a}</b></td><td>${m.o}</td><td>${m.ip}</td><td>${m.c}</td><td><b>${m.tot}</b></td></tr>`).join('');
    }

    // Auxiliary charts
    const anaMap = { 'Low':0,'Medium':0,'High':0 }; filteredData.forEach(d => { if (anaMap[d.riskspectrum]!==undefined) anaMap[d.riskspectrum]++; });
    chartsObj.c3 = new Chart(document.getElementById('intensityChartCanvas'), { type:'polarArea', data:{ labels:Object.keys(anaMap), datasets:[{data:Object.values(anaMap), backgroundColor:['#3b82f6','#f59e0b','#ef4444']}] }, options:{ responsive:true, maintainAspectRatio:false }});
    const catMap = {}; filteredData.forEach(d => catMap[d.defectcategory] = (catMap[d.defectcategory]||0)+1);
    chartsObj.c4 = new Chart(document.getElementById('categoryChartCanvas'), { type:'bar', data:{ labels:Object.keys(catMap), datasets:[{label:'Categories', data:Object.values(catMap), backgroundColor:'#8b5cf6'}] }, options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false }});
  };

  // Excel export of analytics table
  window.exportAnalyticsTableXlsx = async function() {
    const tbl = document.getElementById('analyticsTable');
    if (!tbl) return;
    const rows = Array.from(tbl.querySelectorAll('tr'));
    if (rows.length === 0) return alert('No data.');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BI Analytics');
    rows.forEach((tr, idx) => {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(td => td.textContent.trim());
      const r = ws.addRow(cells);
      if (idx === 0) {
        r.font = { bold: true, color: { argb:'FFFFFF' } };
        r.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'0F172A' } };
      }
    });
    ws.columns.forEach(c => { c.width = 22; });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'CSMS_BI_Analytics.xlsx'; a.click();
  };

  // =========================================================
  // 5. FLAT-LEVEL DRAWING MAP (Setup) + populateMapSetupFlats
  // =========================================================
  window.populateMapSetupFlats = function() {
    const p = document.getElementById('mapSetupProject').value;
    const t = document.getElementById('mapSetupTower').value;
    const f = document.getElementById('mapSetupFloor').value;
    const flatSel = document.getElementById('mapSetupFlat');
    if (!flatSel) return;
    flatSel.innerHTML = '<option value="">-- Select Flat --</option>';
    if (p && t && f && structuralHierarchy[p] && structuralHierarchy[p][t] && structuralHierarchy[p][t][f]) {
      structuralHierarchy[p][t][f].forEach(u => flatSel.appendChild(new Option(u, u)));
    }
  };

  // Override submitMapDrawing — REQUIRE flat-level (no more floor-level uploads)
  const _origSubmitMapDrawing = window.submitMapDrawing;
  window.submitMapDrawing = async function() {
    const p = document.getElementById('mapSetupProject').value;
    const t = document.getElementById('mapSetupTower').value;
    const f = document.getElementById('mapSetupFloor').value;
    const flat = document.getElementById('mapSetupFlat') ? document.getElementById('mapSetupFlat').value : '';
    const base64 = document.getElementById('tempMapBase64').value;
    if (!p || !t || !f) return alert('Please select Project, Tower, and Floor.');
    if (!flat) return alert('Please select a Flat / Unit. Drawings are now uploaded per flat.');
    if (!base64) return alert('Please upload a blueprint file first.');
    const mapKey = `${p}_${t}_${f}_${flat}`;
    const btn = document.getElementById('btnSubmitMap');
    try {
      btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Uploading...";
      const publicUrl = await uploadMapToStorage(mapKey, base64);
      btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving reference...";
      const payload = { map_key: mapKey, image_url: publicUrl, base64_image: null };
      const { error } = await supabaseClient.from('snag_maps').upsert([payload], { onConflict: 'map_key' });
      if (error) throw error;
      floorMaps[mapKey] = publicUrl;
      localStorage.setItem('qa_floorMaps', JSON.stringify(floorMaps));
      alert('Drawing uploaded & saved for flat: ' + flat);
      renderMapTable();
      document.getElementById('tempMapBase64').value = ''; document.getElementById('mapSetupFile').value = '';
    } catch(e) { alert('Error: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend"; }
  };

  // Override renderMapTable to show flat column
  window.renderMapTable = function() {
    const fBody = document.querySelector('#floorMapTable tbody');
    if (!fBody) return;
    fBody.innerHTML = Object.keys(floorMaps).map(k => {
      const parts = k.split('_');
      const proj = parts[0] || '-', twr = parts[1] || '-', flr = parts[2] || '-';
      const flat = parts.slice(3).join('_') || '<i style="color:#94a3b8;">Floor-level</i>';
      return `<tr><td>${proj}</td><td>${twr}</td><td>${flr}</td><td>${flat}</td><td><img src="${floorMaps[k]}" width="40" height="40" style="object-fit:cover; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${floorMaps[k]}')"></td><td><button class="action-icon-btn del-btn" onclick="delMap('${k}')">Del</button></td></tr>`;
    }).join('');
  };

  // =========================================================
  // 6. PATCH loadEntryMap to prefer flat-level then fallback floor-level
  // =========================================================
  const _origLoadEntryMap = window.loadEntryMap;
  window.loadEntryMap = async function() {
    const p = document.getElementById('project') ? document.getElementById('project').value : '';
    const t = document.getElementById('tower') ? document.getElementById('tower').value : '';
    const f = document.getElementById('floor') ? document.getElementById('floor').value : '';
    const flat = document.getElementById('flatNo') ? document.getElementById('flatNo').value : '';

    if (!p || !t || !f) { clearMapCanvas(); return false; }

    // Also check localStorage cached maps (in case cloud not yet synced)
    if (!floorMaps || Object.keys(floorMaps).length === 0) {
      try {
        const cached = JSON.parse(localStorage.getItem('qa_floorMaps') || '{}');
        Object.assign(floorMaps, cached);
      } catch(e) {}
    }

    const mapRes = _resolveMapKey(p, t, f, flat);
    const warn = document.getElementById('entryMapWarning');
    const canvas = document.getElementById('entryCanvas'); if (!canvas) return false;
    if (!canvasConfig.entry.ctx) canvasConfig.entry.ctx = canvas.getContext('2d');

    if (!mapRes) {
      // No map found → clear canvas + show warning
      canvasConfig.entry.img = null;
      canvasConfig.entry.active = false;
      canvasConfig.entry.marker = null;
      if (canvasConfig.entry.ctx) canvasConfig.entry.ctx.clearRect(0, 0, canvas.width || 100, canvas.height || 100);
      if (warn) warn.style.display = 'block';
      return false;
    }
    if (warn) warn.style.display = 'none';
    canvasConfig.entry.active = true;

    if ((!defects || defects.length === 0) && navigator.onLine) {
      await loadDefectsFromCloud(true);
    }
    return await new Promise((resolve) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvasConfig.entry.img = img;
        canvas.width = img.width; canvas.height = img.height;
        drawCanvas('entry');
        setTimeout(() => { if (canvasConfig.entry.img) drawCanvas('entry'); }, 150);
        resolve(true);
      };
      img.onerror = () => {
        console.warn('[CSMS] Map image failed to load:', mapRes.url);
        // Retry without crossOrigin — some CDNs/buckets serve without CORS headers
        const img2 = new Image();
        img2.onload = () => {
          canvasConfig.entry.img = img2;
          canvas.width = img2.width; canvas.height = img2.height;
          drawCanvas('entry');
          resolve(true);
        };
        img2.onerror = () => {
          if (warn) { warn.style.display = 'block'; warn.textContent = 'Map found but failed to load (check bucket public access).'; }
          resolve(false);
        };
        img2.src = mapRes.url;
      };
      img.src = mapRes.url;
    });
  };

  // =========================================================
  // 7. ASSIGN TO multi-select in defect form
  // =========================================================
  window.toggleAssignDropdown = function() { document.getElementById('customAssignSelect').classList.toggle('open'); };
  window.updateAssignSelectText = function() {
    const chks = document.querySelectorAll('.assign-chk:checked');
    const text = document.getElementById('assignSelectText');
    if (!text) return;
    if (chks.length === 0) text.textContent = '-- Unassigned (Visible to all with project rights) --';
    else if (chks.length === 1) text.textContent = chks[0].value;
    else text.textContent = chks.length + ' users assigned';
  };

  function _populateAssignList() {
    const p = document.getElementById('project').value;
    const t = document.getElementById('tower').value;
    const cont = document.getElementById('assignCheckboxContainer');
    if (!cont) return;
    if (!p) { cont.innerHTML = '<span style="color:#94a3b8; font-size:13px; padding:10px;">-- Select Project First --</span>'; return; }
    // Users who have access to this project (or admin)
    const candidates = (USER_MATRIX || []).filter(u => {
      if (u.role === 'admin' || (u.projects && u.projects.includes('All'))) return true;
      if (!t) return (u.projects || []).some(x => x.startsWith(p + '_'));
      return (u.projects || []).includes(`${p}_${t}`);
    });
    cont.innerHTML = candidates.map(u => `<label class="spec-cb-label"><input type="checkbox" class="assign-chk" value="${_esc(getFullName(u))}" onchange="updateAssignSelectText()"> ${_esc(getFullName(u))}</label>`).join('') || '<span style="color:#94a3b8; font-size:13px; padding:10px;">No eligible users.</span>';
    updateAssignSelectText();
  }

  // Hook into project/tower change
  ['project','tower'].forEach(id => {
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => setTimeout(_populateAssignList, 50));
    });
  });

  // Override saveDefect to include assignedto
  const _origSaveDefect = window.saveDefect;
  window.saveDefect = async function() {
    // Permission gate
    if (!canCreateDefect()) return alert('You do not have Create Defect permission.');
    // Basic validations mirror original
    const p = document.getElementById('project').value; const t = document.getElementById('tower').value;
    if (!p || !t) return alert('Select valid Project and Tower.');
    if (tempPhotos.length < 2) return alert('Please add at least 2 Initial Photos.');
    const x = document.getElementById('entryCoordX').value; const y = document.getElementById('entryCoordY').value;
    if (canvasConfig.entry.active && (!x || !y)) return alert('Please pinpoint the defect location on the map.');
    const selectedSpecs = Array.from(document.querySelectorAll('.spec-chk:checked')).map(cb => cb.value).join(', ');
    if (!selectedSpecs) return alert('Please select at least one Specification.');
    const assignees = Array.from(document.querySelectorAll('.assign-chk:checked')).map(cb => cb.value).join('|');

    const today = new Date().toISOString().slice(0,10);
    let dueStr = document.getElementById('sladuedate').value;
    if (!dueStr) { let d = new Date(); d.setDate(d.getDate() + 10); dueStr = d.toISOString().slice(0,10); }
    let delay = 'On Time'; if (new Date() > new Date(dueStr)) delay = Math.floor((new Date() - new Date(dueStr))/(1000*60*60*24)) + ' days';
    let mapThumb = getMapThumbnailBase64(x, y);

    const payload = {
      project: p, tower: t,
      floor: document.getElementById('floor').value,
      flat: document.getElementById('flatNo').value,
      defectcategory: document.getElementById('defectcategory').value,
      specificationmatrix: selectedSpecs,
      engineeringremarks: document.getElementById('engineeringremarks').value,
      riskspectrum: document.getElementById('riskspectrum').value,
      statusvector: document.getElementById('statusvector').value,
      sladuedate: dueStr, loggeddate: today,
      initialphotos: tempPhotos.join('|||'), finalphotos: '',
      mapx: x ? parseFloat(x).toFixed(2) : '0',
      mapy: y ? parseFloat(y).toFixed(2) : '0',
      delayaxis: delay,
      closeddate: document.getElementById('statusvector').value === 'Closed' ? today : '-',
      createdby: getFullName(currentUser),
      closedby: document.getElementById('statusvector').value === 'Closed' ? getFullName(currentUser) : '-',
      mapthumbnail: mapThumb,
      assignedto: assignees || null
    };

    if (!navigator.onLine) {
      let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || [];
      queue.push(payload); localStorage.setItem('qa_offline_queue', JSON.stringify(queue));
      alert('Offline: saved locally.'); document.getElementById('defectForm').reset(); clearTempPhotos(); clearMapCanvas(); sessionStorage.removeItem('csms_draft_form'); return;
    }
    try {
      const btn = document.getElementById('mainSubmitBtn'); if (btn) { btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Submitting..."; }
      let { error } = await supabaseClient.from('snagmanagement').insert([payload]);
      if (error && String(error.message||'').toLowerCase().includes('assignedto')) {
        // Column missing — retry without assignedto and warn
        console.warn('assignedto column missing — inserting without it.');
        delete payload.assignedto;
        const retry = await supabaseClient.from('snagmanagement').insert([payload]);
        error = retry.error;
        if (!error) csmsToast('Saved (add `assignedto` TEXT column to snagmanagement for assignment feature).', 'error');
      }
      if (!error) {
        alert('Record Logged Successfully!');
        document.getElementById('defectForm').reset();
        clearTempPhotos(); clearMapCanvas();
        document.getElementById('specSelectText').innerText = '-- Select Specification --';
        document.querySelectorAll('.assign-chk').forEach(cb => cb.checked = false);
        updateAssignSelectText();
        sessionStorage.removeItem('csms_draft_form');
        await loadDefectsFromCloud(true);
        renderNotifications();
      } else throw error;
    } catch(err) { alert('Error: ' + JSON.stringify(err.message || err)); }
    finally { const btn = document.getElementById('mainSubmitBtn'); if (btn) { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> SUBMIT ENTRY"; } }
  };

  // =========================================================
  // 8. PDF: 2 defects per A4 page
  // =========================================================
  const _origExportPDF = window.exportPDF;
  window.exportPDF = function(dataToExport) {
    if (!dataToExport || dataToExport.length === 0) return alert('No data to export.');
    const win = window.open('', '', 'width=1200,height=800');
    const style = `<style>
      @page { size: A4 portrait; margin: 10mm; }
      body { font-family:'Segoe UI',Tahoma,sans-serif; margin:0; padding:0; background:#fff; color:#334155; }
      h1 { text-align:center; color:#0f172a; border-bottom:3px solid #0284c7; padding-bottom:8px; margin:0 0 15px 0; font-size:18px; text-transform:uppercase; }
      .page { padding:5mm; display:flex; flex-direction:column; gap:6mm; }
      .defect-card-half { border:1px solid #94a3b8; border-radius:6px; padding:8px 12px; page-break-inside:avoid; break-inside:avoid; box-sizing:border-box; }
      .dh { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cbd5e1; padding-bottom:5px; margin-bottom:6px; }
      .did { font-size:14px; font-weight:800; color:#0284c7; }
      .status-badge { padding:3px 8px; border-radius:12px; font-weight:700; font-size:10px; border:1px solid #cbd5e1; text-transform:uppercase; }
      .grid-info { display:grid; grid-template-columns:repeat(4,1fr); gap:4px 8px; font-size:10.5px; }
      .info-box { background:#f1f5f9; padding:5px 7px; border-radius:4px; border:1px solid #e2e8f0; }
      .info-label { font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700; display:block; margin-bottom:2px; }
      .info-value { font-weight:600; color:#0f172a; word-wrap:break-word; font-size:10.5px; }
      .remarks-box { grid-column:span 4; background:#fffbeb; border:1px solid #fde68a; }
      .media-section { display:grid; grid-template-columns:auto 1fr 1fr; gap:6px; margin-top:6px; }
      .media-box { border:1px solid #e2e8f0; padding:4px; border-radius:4px; }
      .media-title { font-size:9px; font-weight:700; margin-bottom:3px; text-align:center; color:#475569; }
      .img-grid { display:flex; gap:3px; flex-wrap:wrap; justify-content:center; }
      .img-grid img { width:48px; height:48px; object-fit:cover; border-radius:3px; border:1px solid #cbd5e1; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .defect-card-half:nth-child(2n) { break-after: page; page-break-after: always; } }
    </style>`;
    let html = '<div class="page"><h1>Consolidated Defect Audit Report</h1>';
    dataToExport.forEach((d, i) => {
      const initPics = (d.initialPics || []).slice(0,2).map(s => `<img src="${s}"/>`).join('');
      const finPics = (d.finalPics || []).slice(0,2).map(s => `<img src="${s}"/>`).join('');
      const mapHtml = d.mapthumbnail ? `<img src="${d.mapthumbnail}" style="width:70px;height:70px;"/>` : '<span style="font-size:10px;color:#94a3b8;">Not Mapped</span>';
      const badgeColor = d.statusvector === 'Closed' ? '#d1fae5' : '#fef3c7';
      html += `<div class="defect-card-half">
        <div class="dh"><div class="did">Audit Ref: #${d.serial || 'N/A'}</div><div class="status-badge" style="background:${badgeColor}">${d.statusvector || '-'}</div></div>
        <div class="grid-info">
          <div class="info-box"><span class="info-label">Project</span><span class="info-value">${d.project || '-'}</span></div>
          <div class="info-box"><span class="info-label">Tower</span><span class="info-value">${d.tower || '-'}</span></div>
          <div class="info-box"><span class="info-label">Floor</span><span class="info-value">${d.floor || '-'}</span></div>
          <div class="info-box"><span class="info-label">Flat</span><span class="info-value">${d.flat || '-'}</span></div>
          <div class="info-box"><span class="info-label">Category</span><span class="info-value">${d.defectcategory || '-'}</span></div>
          <div class="info-box"><span class="info-label">Spec</span><span class="info-value">${d.specificationmatrix || '-'}</span></div>
          <div class="info-box"><span class="info-label">Risk</span><span class="info-value">${d.riskspectrum || '-'}</span></div>
          <div class="info-box"><span class="info-label">Delay</span><span class="info-value">${d.delayaxis || '-'}</span></div>
          <div class="info-box"><span class="info-label">Created By</span><span class="info-value">${d.createdby || '-'}</span></div>
          <div class="info-box"><span class="info-label">Logged</span><span class="info-value">${d.loggeddate || '-'}</span></div>
          <div class="info-box"><span class="info-label">Closed By</span><span class="info-value">${d.closedby || '-'}</span></div>
          <div class="info-box"><span class="info-label">Closed Date</span><span class="info-value">${d.closeddate || '-'}</span></div>
          <div class="info-box remarks-box"><span class="info-label">Remarks / Assigned</span><span class="info-value">${(d.engineeringremarks || 'No remarks.')}${d.assignedto?' — Assigned: '+d.assignedto.replace(/\|/g,', '):''}</span></div>
        </div>
        <div class="media-section">
          <div class="media-box"><div class="media-title">Location</div><div class="img-grid">${mapHtml}</div></div>
          <div class="media-box"><div class="media-title">Initial</div><div class="img-grid">${initPics || '<span style="font-size:10px;color:#94a3b8;">-</span>'}</div></div>
          <div class="media-box"><div class="media-title">Final</div><div class="img-grid">${finPics || '<span style="font-size:10px;color:#94a3b8;">-</span>'}</div></div>
        </div>
      </div>`;
    });
    html += '</div>';
    win.document.write(style + html);
    win.document.close();
    setTimeout(() => { win.print(); }, 1500);
  };

  // =========================================================
  // 9. Override showSection to init new tabs
  // =========================================================
  const _origShowSection = window.showSection;
  window.showSection = function(id) {
    if (_origShowSection) _origShowSection(id);
    else {
      sessionStorage.setItem('active_section', id);
      document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      const sec = document.getElementById(id); if (sec) sec.classList.add('active');
    }
    if (id === 'closure') { clPopulateDropdowns(); clRenderTable(); }
    if (id === 'notifications') { renderNotifications(); }
    if (id === 'report') { populateReportMS(); renderReportTable(); }
    if (id === 'dashboard') { populateBiMS(); renderCharts(); }
    if (id === 'setup') { setTimeout(() => { if (typeof renderAdminTables === 'function') renderAdminTables(); if (typeof renderUserSetupCheckboxes === 'function') renderUserSetupCheckboxes(); if (typeof renderUserTable === 'function') renderUserTable(); }, 100); }
  };

  // =========================================================
  // 10. Override edit modal / actions for granular permissions
  // =========================================================
  const _origGenerateTableRowsHtml = window.generateTableRowsHtml;
  window.generateTableRowsHtml = function(dataArray) {
    return dataArray.map(d => {
      const initPics = Array.isArray(d.initialPics) ? d.initialPics.filter(p => p && String(p).trim() !== '') : [];
      const finPics = Array.isArray(d.finalPics) ? d.finalPics.filter(p => p && String(p).trim() !== '') : [];
      const initialHtml = `<div class="img-grid-cell">${initPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
      const finalHtml = `<div class="img-grid-cell">${finPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
      let actionHtml = `<span style="color:#94a3b8; font-size:11px;"><i class="fas fa-eye"></i> View</span>`;
      if (d.statusvector === 'Closed') {
        actionHtml = `<span style="color:#059669; font-weight:bold; font-size:11.5px; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display:inline-block;"><i class="fas fa-lock"></i> Closed</span>`;
      } else if (canEditDefect(d) || canCloseDefect(d)) {
        actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal('${d.id}')"><i class="fas fa-bolt"></i> Action</button>`;
      }
      let mapHtml = 'Not Mapped';
      if (d.mapthumbnail) mapHtml = `<img src="${d.mapthumbnail}" style="width:45px; height:45px; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${d.mapthumbnail}')" />`;
      else if (d.mapx && d.mapy && d.mapx !== '0') mapHtml = `X: ${d.mapx}, Y: ${d.mapy}`;
      const resolvedCategory = (typeof resolveCategoryName === 'function' ? resolveCategoryName(d.defectcategory || '-') : d.defectcategory || '-');
      const resolvedSpec = (typeof resolveSpecificationName === 'function' ? resolveSpecificationName(d.specificationmatrix || '-') : d.specificationmatrix || '-');
      return `<tr>
          <td>${d.serial || '-'}</td><td><b>${d.project || '-'}</b></td><td>${d.tower || '-'}</td><td>${d.floor || '-'}</td><td>${d.flat || '-'}</td>
          <td style="color:#0284c7;"><b>${resolvedCategory}</b></td>
          <td>${resolvedSpec}</td>
          <td>${d.engineeringremarks || '-'}</td>
          <td>${mapHtml}</td><td><b>${d.createdby || '-'}</b></td><td><b>${d.closedby || '-'}</b></td>
          <td>${d.riskspectrum || '-'}</td><td><span class="locked-badge">${d.statusvector || '-'}</span></td>
          <td>${d.loggeddate || '-'}</td><td>${d.sladuedate || '-'}</td><td>${d.closeddate || '-'}</td><td>${d.delayaxis || '-'}</td>
          <td>${initialHtml}</td><td>${finalHtml}</td><td class="action-cell">${actionHtml}</td>
        </tr>`;
    }).join('');
  };

  // Guard openEditModal against permissions
  const _origOpenEditModal = window.openEditModal;
  window.openEditModal = function(id) {
    const d = (defects || []).find(x => String(x.id) === String(id));
    if (!d) return;
    if (d.statusvector === 'Closed') return alert('This defect has been closed and locked.');
    if (!canEditDefect(d) && !canCloseDefect(d)) return alert('You do not have permission for this action.');
    return _origOpenEditModal ? _origOpenEditModal(id) : null;
  };

  // Guard submitEditDefect against close permission specifically
  const _origSubmitEditDefect = window.submitEditDefect;
  window.submitEditDefect = async function() {
    const id = document.getElementById('editDefectId').value;
    const stat = document.getElementById('editstatusvector').value;
    const d = (defects || []).find(x => String(x.id) === String(id));
    if (stat === 'Closed' && d && !canCloseDefect(d)) return alert('This defect is assigned to another user. You cannot close it.');
    return _origSubmitEditDefect ? _origSubmitEditDefect() : null;
  };

  // =========================================================
  // 11a. UserTable: 5-level permission label + editable
  // =========================================================
  const _permLabel = { edit:'Full Rights', create:'Create Only', close:'Close Only', editonly:'Edit Only', view:'View Only' };
  const _origRenderUserTable = window.renderUserTable;
  window.renderUserTable = function() {
    const tbody = document.querySelector('#usersTable tbody'); if (!tbody) return;
    tbody.innerHTML = USER_MATRIX.map(u => {
      const permTxt = u.role === 'admin' ? 'ADMIN' : (_permLabel[u.permission] || u.permission || 'Full');
      const permCls = (u.permission === 'view') ? '#6b7280' : (u.permission === 'edit' ? '#059669' : '#0284c7');
      return `<tr>
        <td><b>${getFullName(u)}</b><br><small>${u.id}</small></td>
        <td>${u.role.toUpperCase()}</td>
        <td style="white-space:normal; max-width:180px;">${u.role === 'admin' ? '<span class="tech-badge" style="background:#0284c7; color:white;">Global All</span>' : (u.projects || []).join(', ')}</td>
        <td><span class="tech-badge" style="background:${permCls}; color:white;">${permTxt}</span></td>
        <td>${u.id === currentUser.id ? '<i>(You)</i>' : `<button class="action-icon-btn edit-btn" onclick="editUser('${u.id}')">Edit</button><button class="action-icon-btn del-btn" onclick="deleteUser('${u.id}')">Del</button>`}</td>
      </tr>`;
    }).join('');
  };

  // =========================================================
  // 11. Notifications realtime + auto-refresh
  const _origLoadDefects = window.loadDefectsFromCloud;
  let _lastKnownDefectIds = new Set();
  window.loadDefectsFromCloud = async function(isBg) {
    const r = _origLoadDefects ? await _origLoadDefects(isBg) : null;
    try {
      // Detect new-defect events and toast/notify current user (only after first load)
      if (_lastKnownDefectIds.size > 0 && currentUser && Array.isArray(defects)) {
        const nowIds = new Set(defects.map(d => String(d.id)));
        const brandNew = defects.filter(d => !_lastKnownDefectIds.has(String(d.id)));
        brandNew.forEach(d => {
          const forMe = _isAssignedToMe(d);
          const common = !d.assignedto && _isCommonProject(d);
          if ((forMe || common) && d.createdby !== getFullName(currentUser)) {
            csmsToast(`🔔 New defect ${forMe ? 'assigned to you' : 'on your project'}: ${d.defectcategory} — ${d.flat}`, 'success');
          }
        });
      }
      if (Array.isArray(defects)) _lastKnownDefectIds = new Set(defects.map(d => String(d.id)));
      updateNotifCounts();
      // FIX (refresh: all tabs auto-load with data): once cloud defects arrive,
      // re-render whichever tab is currently active so it fills with full data —
      // no matter which section was restored on refresh. Race-free: this never
      // switches sections, it only refreshes the content of the active one.
      const _isActive = (id) => { const s = document.getElementById(id); return !!(s && s.classList.contains('active')); };
      if (_isActive('notifications')) renderNotifications();
      if (_isActive('closure')) clRenderTable();
      if (_isActive('report') && typeof renderReportTable === 'function') { populateReportMS(); renderReportTable(); }
      if (_isActive('dashboard') && typeof renderCharts === 'function') { populateBiMS(); renderCharts(); }
      if (_isActive('entry') && typeof ensureMapLoaded === 'function') ensureMapLoaded();
    } catch(e) {}
    return r;
  };

  // =========================================================
  // 12. Init hooks — run when app activates
  // =========================================================
  let _didPreloadUsers = false;
  function _bootstrapEnhancements() {
    // Try to preload users from cloud (once) — enables cross-device login
    if (!_didPreloadUsers && typeof supabaseClient !== 'undefined' && navigator.onLine) {
      _didPreloadUsers = true;
      loadUsersFromCloud().catch(() => {});
    }
    // Wait until user logged in
    if (!currentUser) { setTimeout(_bootstrapEnhancements, 500); return; }
    // Hide sections user can't access based on rights
    if (currentUser.role !== 'admin') {
      // Setup already hidden by original code
      // Hide Control Center if view-only
      if (currentUser.permission === 'view') {
        const eb = document.getElementById('navEntryBtn'); if (eb) eb.style.display = 'none';
      }
      // Hide Closure tab if not allowed to close
      if (!(currentUser.permission === 'edit' || currentUser.permission === 'close' || currentUser.permission === 'admin')) {
        const cb = document.getElementById('navClosureBtn'); if (cb) cb.style.display = 'none';
      }
    }
    // Populate assign list on load
    setTimeout(_populateAssignList, 300);
    // Hook project/tower change
    const p = document.getElementById('project'); if (p) p.addEventListener('change', () => setTimeout(_populateAssignList, 50));
    const t = document.getElementById('tower'); if (t) t.addEventListener('change', () => setTimeout(_populateAssignList, 50));
    // Populate closure & report MS on first tick
    setTimeout(() => {
      if (document.getElementById('cl_project')) clPopulateDropdowns();
      if (document.getElementById('rf_project_ms')) populateReportMS();
      if (document.getElementById('bi_project_ms')) populateBiMS();
      updateNotifCounts();
    }, 800);
    // Auto refresh notifications every 30s
    setInterval(() => { try { updateNotifCounts(); } catch(e){} }, 30000);
  }
  window.addEventListener('DOMContentLoaded', () => { setTimeout(_bootstrapEnhancements, 1200); });
  // Also run on login (activateApp finishes async)
  const _origActivate = window.activateApp;
  if (_origActivate) {
    window.activateApp = async function() {
      const r = await _origActivate.apply(this, arguments);
      setTimeout(_bootstrapEnhancements, 500);
      return r;
    };
  }

  console.log('[CSMS Enhancements v2] loaded');
})();