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
    canvasConfig.closed  = { ctx: null, img: null, scale: 1, tx: 0, ty: 0, marker: null, active: false, defectsOnMap: [] };
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
    if (!(p === 'edit' || p === 'close' || p === 'reopen')) return false;
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
    return p === 'edit' || p === 'editonly' || p === 'close' || p === 'reopen';
  };
  // NEW: only users with the special 'reopen' right (or admin) can re-open a
  // closed/locked defect that was closed incorrectly.
  window.canReopenDefect = function() {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return (currentUser.permission || '') === 'reopen';
  };
  window.reopenDefect = async function(id) {
    const d = (defects||[]).find(x => String(x.id) === String(id));
    if (!d) return;
    if (!canReopenDefect()) return alert('You do not have the Re-open permission for closed defects.');
    if (d.statusvector !== 'Closed') return;
    if (!confirm('Re-open this closed defect? It will become editable/closable again.')) return;
    try {
      const { error } = await supabaseClient.from('snagmanagement').update({ statusvector:'Open', closedby:'-', closeddate:'-' }).eq('id', d.id);
      if (error) throw error;
      csmsToast('Defect re-opened successfully.', 'success');
      await loadDefectsFromCloud(true);
      if (typeof renderNotifications==='function') renderNotifications();
      if (typeof clRenderTable==='function') clRenderTable();
      if (typeof clLoadMap==='function') clLoadMap();
      if (typeof renderReportTable==='function') renderReportTable();
    } catch(e){ alert('Re-open failed: ' + (e.message||e)); }
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
    const canvas2 = document.getElementById('closedCanvas');
    if (canvas2 && canvasConfig.closed && canvasConfig.closed.ctx) canvasConfig.closed.ctx.clearRect(0,0,canvas2.width,canvas2.height);
    if (canvasConfig.closed) { canvasConfig.closed.img = null; canvasConfig.closed.active = false; canvasConfig.closed.defectsOnMap = []; }
    const cnt2 = document.getElementById('cl_closed_count'); if (cnt2) cnt2.textContent = '0';
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
    _clDrawClosedMap();
    if (typeof clRenderClosedTable === 'function') clRenderClosedTable();
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

  // ---------- NEW: Closed Defects map (green dots) + summary ----------
  function _clClosedDefects() {
    const p=document.getElementById('cl_project').value, t=document.getElementById('cl_tower').value, f=document.getElementById('cl_floor').value, flat=document.getElementById('cl_flat').value;
    const cats=_msGetSelected('cl_cat_ms'), risks=_msGetSelected('cl_risk_ms');
    return (defects||[]).filter(d=>{
      if(d.statusvector!=='Closed') return false;
      if(p&&d.project!==p) return false;
      if(t&&d.tower!==t) return false;
      if(f&&d.floor!==f) return false;
      if(flat&&d.flat!==flat) return false;
      if(cats.length&&!cats.includes(d.defectcategory)) return false;
      if(risks.length&&!risks.includes(d.riskspectrum)) return false;
      return true;
    });
  }
  function _clDrawClosedMap() {
    const canvas=document.getElementById('closedCanvas'); if(!canvas) return;
    if(!canvasConfig.closed) canvasConfig.closed={ctx:null,img:null,active:false,defectsOnMap:[]};
    if(!canvasConfig.closed.ctx) canvasConfig.closed.ctx=canvas.getContext('2d');
    const img=canvasConfig.closure.img; const warn=document.getElementById('clClosedMapWarning'); const cnt=document.getElementById('cl_closed_count');
    const closed=_clClosedDefects(); canvasConfig.closed.defectsOnMap=closed; if(cnt) cnt.textContent=closed.length;
    if(!img){ if(canvasConfig.closed.ctx) canvasConfig.closed.ctx.clearRect(0,0,canvas.width,canvas.height); if(warn) warn.style.display=(canvasConfig.closure.active?'none':'block'); return; }
    if(warn) warn.style.display='none';
    canvas.width=img.width; canvas.height=img.height;
    const ctx=canvasConfig.closed.ctx; canvasConfig.closed.img=img; canvasConfig.closed.active=true;
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0);
    closed.forEach((d,idx)=>{ if(!d.mapx||!d.mapy||d.mapx==='0') return; const x=parseFloat(d.mapx),y=parseFloat(d.mapy);
      ctx.beginPath(); ctx.arc(x,y,20,0,2*Math.PI); ctx.fillStyle='rgba(16,185,129,0.9)'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 16px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(idx+1),x,y);
    });
    if(canvas._csmsClosedClick) canvas.removeEventListener('click',canvas._csmsClosedClick);
    const handler=(e)=>{ const rect=canvas.getBoundingClientRect(); const sx=canvas.width/rect.width, sy=canvas.height/rect.height; const cx=(e.clientX-rect.left)*sx, cy=(e.clientY-rect.top)*sy; for(const d of canvasConfig.closed.defectsOnMap){ if(!d.mapx||!d.mapy) continue; if(Math.hypot(parseFloat(d.mapx)-cx,parseFloat(d.mapy)-cy)<=25){ if(typeof openDefectInfoModal==='function') openDefectInfoModal(d); break; } } };
    canvas._csmsClosedClick=handler; canvas.addEventListener('click',handler);
    if(typeof attachZoomGestures==='function') attachZoomGestures('closedCanvas');
  }
  window.clRenderClosedTable = function() {
    const tbody=document.querySelector('#closedTable tbody'); if(!tbody) return;
    const closed=_clClosedDefects();
    if(!closed.length){ tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:20px;color:#64748b;">No closed defects for this selection.</td></tr>'; return; }
    tbody.innerHTML=closed.map((d,i)=>`<tr><td><span class="serial-badge-inline" style="background:#10b981;">${i+1}</span></td><td>${d.flat||'-'}</td><td><b>${d.defectcategory||'-'}</b></td><td>${d.specificationmatrix||'-'}</td><td>${d.riskspectrum||'-'}</td><td>${d.closedby||'-'}</td><td>${d.closeddate||'-'}</td><td><button class="view-btn" onclick="_notifView('${d.id}')"><i class='fas fa-eye'></i> View</button></td></tr>`).join('');
  };
  window.exportClosedExcel = function() {
    const rows=_clClosedDefects(); if(!rows.length) return alert('No closed defects to export.');
    if(typeof exportExcelWithPhotos==='function') exportExcelWithPhotos(rows); else alert('Export unavailable.');
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
    // Show the 2 new task tabs only to users who can be assigned/close (edit/close/reopen or admin)
    const canAssign = (currentUser.role==='admin') || ['edit','close','reopen'].includes(currentUser.permission||'');
    ['nt_mytasks','nt_commonclose'].forEach(id => { const b=document.getElementById(id); if(b) b.style.display = canAssign ? '' : 'none'; });
    const mt=document.getElementById('nc_mytasks'); if(mt) mt.textContent = c.direct;
    const cc=document.getElementById('nc_commonclose'); if(cc) cc.textContent = (defects||[]).filter(d=>d.statusvector!=='Closed'&&_isCommonProject(d)&&canCloseDefect(d)).length;
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
    // NEW tabs: My Tasks (by Flat) & Common (Closable) — grouped tables of defects
    // this user can close. Only relevant to users with close capability.
    if (_notifTab === 'mytasks' || _notifTab === 'commonclose') {
      const base = (_notifTab === 'mytasks')
        ? (defects||[]).filter(d => d.statusvector!=='Closed' && _isAssignedToMe(d) && canCloseDefect(d))
        : (defects||[]).filter(d => d.statusvector!=='Closed' && _isCommonProject(d) && canCloseDefect(d));
      const grp={}; base.forEach(d=>{ const k=`${d.project}|${d.tower}|${d.floor}|${d.flat}`; grp[k]=grp[k]||{p:d.project,t:d.tower,f:d.floor,fl:d.flat,n:0}; grp[k].n++; });
      const rows=Object.values(grp);
      list.innerHTML = `<div class="records-table-container"><table class="csms-pro-table"><thead><tr><th>Project</th><th>Tower</th><th>Floor</th><th>Flat</th><th>No. of Defects</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><b>${r.p}</b></td><td>${r.t}</td><td>${r.f}</td><td>${r.fl||'-'}</td><td><b>${r.n}</b></td></tr>`).join(''):'<tr><td colspan="5" style="text-align:center;padding:20px;color:#94a3b8;">No closable defects assigned.</td></tr>'}</tbody></table></div>`;
      return;
    }
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
          ${(isClosed && canReopenDefect()) ? `<button class="close-btn" style="background:#b45309;" onclick="reopenDefect('${d.id}')"><i class="fas fa-lock-open"></i> Re-open</button>` : ''}
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
    const E = (o) => encodeURIComponent(JSON.stringify(o));
    const L = (t, o, n) => `<td><a class="drill-link" style="cursor:pointer;color:#0284c7;font-weight:600;text-decoration:underline;" onclick="_biDrill('${String(t).replace(/'/g,'')}','${E(o)}')">${n}</a></td>`;
    if (filterAnalytic === 'floor') {
      tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>FLAT</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = `${d.project}_${d.tower}_${d.floor}_${d.flat}`; if(!matrixData[k]) matrixData[k]={p:d.project,t:d.tower,f:d.floor,fl:d.flat,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')matrixData[k].o++; if(d.statusvector==='In Progress')matrixData[k].ip++; if(d.statusvector==='Closed')matrixData[k].c++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td><td>${m.fl}</td>${L(m.p+' '+m.fl+' Open',{project:m.p,tower:m.t,floor:m.f,flat:m.fl,status:'Open'},m.o)}${L(m.p+' '+m.fl+' In Progress',{project:m.p,tower:m.t,floor:m.f,flat:m.fl,status:'In Progress'},m.ip)}${L(m.p+' '+m.fl+' Closed',{project:m.p,tower:m.t,floor:m.f,flat:m.fl,status:'Closed'},m.c)}${L(m.p+' '+m.fl+' All',{project:m.p,tower:m.t,floor:m.f,flat:m.fl},'<b>'+m.tot+'</b>')}</tr>`).join('');
    } else if (filterAnalytic === 'floordist') {
      tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = `${d.project}_${d.tower}_${d.floor}`; if(!matrixData[k]) matrixData[k]={p:d.project,t:d.tower,f:d.floor,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')matrixData[k].o++; if(d.statusvector==='In Progress')matrixData[k].ip++; if(d.statusvector==='Closed')matrixData[k].c++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td>${L(m.p+' '+m.f+' Open',{project:m.p,tower:m.t,floor:m.f,status:'Open'},m.o)}${L(m.p+' '+m.f+' In Progress',{project:m.p,tower:m.t,floor:m.f,status:'In Progress'},m.ip)}${L(m.p+' '+m.f+' Closed',{project:m.p,tower:m.t,floor:m.f,status:'Closed'},m.c)}${L(m.p+' '+m.f+' All',{project:m.p,tower:m.t,floor:m.f},'<b>'+m.tot+'</b>')}</tr>`).join('');
    } else if (filterAnalytic === 'tower') {
      tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = `${d.project}_${d.tower}`; if(!matrixData[k]) matrixData[k]={p:d.project,t:d.tower,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')matrixData[k].o++; if(d.statusvector==='In Progress')matrixData[k].ip++; if(d.statusvector==='Closed')matrixData[k].c++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td>${L(m.p+' '+m.t+' Open',{project:m.p,tower:m.t,status:'Open'},m.o)}${L(m.p+' '+m.t+' In Progress',{project:m.p,tower:m.t,status:'In Progress'},m.ip)}${L(m.p+' '+m.t+' Closed',{project:m.p,tower:m.t,status:'Closed'},m.c)}${L(m.p+' '+m.t+' All',{project:m.p,tower:m.t},'<b>'+m.tot+'</b>')}</tr>`).join('');
    } else if (filterAnalytic === 'defect') {
      tHead.innerHTML = `<th>PROJECT</th><th>CATEGORY</th><th>SPECIFICATION</th><th>TOTAL</th>`;
      filteredData.forEach(d => { const specs = (d.specificationmatrix||'').split(',').map(s=>s.trim()).filter(Boolean); if (specs.length===0) specs.push('-'); specs.forEach(s => { const k = `${d.project}_${d.defectcategory}_${s}`; if(!matrixData[k]) matrixData[k]={p:d.project,c:d.defectcategory,s:s,tot:0}; matrixData[k].tot++; }); });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.c}</td><td>${m.s}</td><td><b>${m.tot}</b></td></tr>`).join('');
    } else if (filterAnalytic === 'intensity') {
      tHead.innerHTML = `<th>PROJECT</th><th>LOW</th><th>MEDIUM</th><th>HIGH</th><th>TOTAL</th>`;
      filteredData.forEach(d => { let k = d.project; if(!matrixData[k]) matrixData[k]={p:d.project,l:0,m:0,h:0,tot:0}; if(d.riskspectrum==='Low')matrixData[k].l++; if(d.riskspectrum==='Medium')matrixData[k].m++; if(d.riskspectrum==='High')matrixData[k].h++; matrixData[k].tot++; });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td>${L(m.p+' Low Risk',{project:m.p,risk:'Low'},m.l)}${L(m.p+' Medium Risk',{project:m.p,risk:'Medium'},m.m)}${L(m.p+' High Risk',{project:m.p,risk:'High'},m.h)}${L(m.p+' All',{project:m.p},'<b>'+m.tot+'</b>')}</tr>`).join('');
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
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.u}</b></td>${L(m.u+' Created',{createdby:m.u},m.created)}${L(m.u+' Closed',{closedby:m.u},m.closed)}${L(m.u+' Pending',{pendingAssignee:m.u},m.pending)}</tr>`).join('');
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
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td>${L(m.p+' On Time',{project:m.p,ontimeOpen:1},m.on)}${L(m.p+' Delayed (Open)',{project:m.p,overdueOpen:1},'<span style="color:#dc2626;">'+m.del+'</span>')}${L(m.p+' Closed within SLA',{project:m.p,closedWithinSla:1},'<span style="color:#059669;">'+m.closedOk+'</span>')}${L(m.p+' Closed Late',{project:m.p,closedLate:1},'<span style="color:#dc2626;">'+m.closedLate+'</span>')}</tr>`).join('');
    } else if (filterAnalytic === 'critical') {
      tHead.innerHTML = `<th>PROJECT</th><th>HIGH RISK OPEN</th><th>OVERDUE (Open)</th><th>HIGH+OVERDUE</th><th>TOTAL OPEN</th>`;
      const now2 = new Date();
      filteredData.forEach(d => { let k=d.project; if(!matrixData[k]) matrixData[k]={p:d.project,hi:0,od:0,both:0,open:0}; if(d.statusvector!=='Closed'){ matrixData[k].open++; const isHi=d.riskspectrum==='High'; const isOd=d.sladuedate && new Date(d.sladuedate)<now2; if(isHi)matrixData[k].hi++; if(isOd)matrixData[k].od++; if(isHi&&isOd)matrixData[k].both++; } });
      tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td>${L(m.p+' High Risk Open',{project:m.p,risk:'High',openOnly:1},'<span style="color:#dc2626;">'+m.hi+'</span>')}${L(m.p+' Overdue Open',{project:m.p,overdueOpen:1},'<span style="color:#dc2626;">'+m.od+'</span>')}${L(m.p+' High & Overdue',{project:m.p,risk:'High',overdueOpen:1},'<span style="color:#dc2626;font-weight:800;">'+m.both+'</span>')}${L(m.p+' All Open',{project:m.p,openOnly:1},'<b>'+m.open+'</b>')}</tr>`).join('');
    } else if (filterAnalytic === 'monthly') {
      tHead.innerHTML = `<th>YEAR-MONTH</th><th>CREATED</th><th>CLOSED</th><th>OPEN AT END</th>`;
      const monMap = {};
      filteredData.forEach(d => {
        const m = (d.loggeddate || '').slice(0,7); if (m) { monMap[m] = monMap[m] || {created:0,closed:0}; monMap[m].created++; }
        const c = (d.closeddate || '').slice(0,7); if (c && c !== '-') { monMap[c] = monMap[c] || {created:0,closed:0}; monMap[c].closed++; }
      });
      const sortedM = Object.keys(monMap).sort();
      let running = 0;
      tBody.innerHTML = sortedM.map(m => { running += (monMap[m].created - monMap[m].closed); return `<tr><td><b>${m}</b></td>${L(m+' Created',{loggedMonth:m},monMap[m].created)}${L(m+' Closed',{closedMonth:m},monMap[m].closed)}<td><b>${running}</b></td></tr>`; }).join('');
    } else if (filterAnalytic === 'assignee') {
      tHead.innerHTML = `<th>ASSIGNEE</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
      const map = {};
      filteredData.forEach(d => {
        const assList = (d.assignedto ? d.assignedto.split('|').map(s=>s.trim()).filter(Boolean) : ['<Unassigned>']);
        assList.forEach(a => { if(!map[a]) map[a]={a,o:0,ip:0,c:0,tot:0}; if(d.statusvector==='Open')map[a].o++; if(d.statusvector==='In Progress')map[a].ip++; if(d.statusvector==='Closed')map[a].c++; map[a].tot++; });
      });
      tBody.innerHTML = Object.values(map).map(m => `<tr><td><b>${m.a}</b></td>${L(m.a+' Open',{assignee:m.a,status:'Open'},m.o)}${L(m.a+' In Progress',{assignee:m.a,status:'In Progress'},m.ip)}${L(m.a+' Closed',{assignee:m.a,status:'Closed'},m.c)}${L(m.a+' All',{assignee:m.a},'<b>'+m.tot+'</b>')}</tr>`).join('');
    }

    // Auxiliary charts
    const anaMap = { 'Low':0,'Medium':0,'High':0 }; filteredData.forEach(d => { if (anaMap[d.riskspectrum]!==undefined) anaMap[d.riskspectrum]++; });
    chartsObj.c3 = new Chart(document.getElementById('intensityChartCanvas'), { type:'polarArea', data:{ labels:Object.keys(anaMap), datasets:[{data:Object.values(anaMap), backgroundColor:['#3b82f6','#f59e0b','#ef4444']}] }, options:{ responsive:true, maintainAspectRatio:false }});
    const catMap = {}; filteredData.forEach(d => catMap[d.defectcategory] = (catMap[d.defectcategory]||0)+1);
    chartsObj.c4 = new Chart(document.getElementById('categoryChartCanvas'), { type:'bar', data:{ labels:Object.keys(catMap), datasets:[{label:'Categories', data:Object.values(catMap), backgroundColor:'#8b5cf6'}] }, options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false }});
    if (typeof renderBiExtraTables === 'function') renderBiExtraTables(filteredData);
  };

  // NEW: always-on BI summary tables (User Performance, Critical/Overdue, SLA).
  // Rendered together with the main analytics table, updated by the same filter.
  // Every number is clickable → _biDrill popup (which has Excel + PDF download).
  window.renderBiExtraTables = function(data) {
    data = data || [];
    const E = (o) => encodeURIComponent(JSON.stringify(o));
    const cell = (t, o, n, color) => `<td><a class="drill-link" style="cursor:pointer;color:${color||'#0284c7'};font-weight:600;text-decoration:underline;" onclick="_biDrill('${String(t).replace(/'/g,'')}','${E(o)}')">${n}</a></td>`;
    const now = new Date();
    const uBody = document.getElementById('biUserTableBody');
    if (uBody) {
      const users = new Set(); data.forEach(d => { if(d.createdby)users.add(d.createdby); if(d.closedby)users.add(d.closedby); });
      const rows = Array.from(users).map(u => {
        const created = data.filter(d => d.createdby===u).length;
        const closed = data.filter(d => d.closedby===u && d.statusvector==='Closed').length;
        const pending = data.filter(d => d.statusvector!=='Closed' && (d.assignedto||'').split('|').map(s=>s.trim()).includes(u)).length;
        return `<tr><td><b>${u}</b></td>${cell(u+' Created',{createdby:u},created)}${cell(u+' Closed',{closedby:u},closed)}${cell(u+' Pending',{pendingAssignee:u},pending)}</tr>`;
      }).join('');
      uBody.innerHTML = rows || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:14px;">No data</td></tr>`;
    }
    const cBody = document.getElementById('biCriticalTableBody');
    if (cBody) {
      const m = {}; data.forEach(d => { let k=d.project; if(!m[k])m[k]={p:d.project,hi:0,od:0,both:0,open:0}; if(d.statusvector!=='Closed'){ m[k].open++; const isHi=d.riskspectrum==='High'; const isOd=d.sladuedate && new Date(d.sladuedate)<now; if(isHi)m[k].hi++; if(isOd)m[k].od++; if(isHi&&isOd)m[k].both++; } });
      const rows = Object.values(m).map(x => `<tr><td><b>${x.p}</b></td>${cell(x.p+' High Risk Open',{project:x.p,risk:'High',openOnly:1},x.hi,'#dc2626')}${cell(x.p+' Overdue Open',{project:x.p,overdueOpen:1},x.od,'#dc2626')}${cell(x.p+' High & Overdue',{project:x.p,risk:'High',overdueOpen:1},x.both,'#dc2626')}${cell(x.p+' All Open',{project:x.p,openOnly:1},x.open)}</tr>`).join('');
      cBody.innerHTML = rows || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:14px;">No data</td></tr>`;
    }
    const sBody = document.getElementById('biSlaTableBody');
    if (sBody) {
      const m = {}; data.forEach(d => { let k=d.project; if(!m[k])m[k]={p:d.project,on:0,del:0,ok:0,late:0}; if(d.statusvector==='Closed'){ if(d.closeddate&&d.sladuedate&&new Date(d.closeddate)<=new Date(d.sladuedate))m[k].ok++; else m[k].late++; } else { if(d.sladuedate&&new Date(d.sladuedate)<now)m[k].del++; else m[k].on++; } });
      const rows = Object.values(m).map(x => `<tr><td><b>${x.p}</b></td>${cell(x.p+' On Time',{project:x.p,ontimeOpen:1},x.on)}${cell(x.p+' Delayed',{project:x.p,overdueOpen:1},x.del,'#dc2626')}${cell(x.p+' Closed OK',{project:x.p,closedWithinSla:1},x.ok,'#059669')}${cell(x.p+' Closed Late',{project:x.p,closedLate:1},x.late,'#dc2626')}</tr>`).join('');
      sBody.innerHTML = rows || `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:14px;">No data</td></tr>`;
    }
  };

  // Clickable drill from any BI analytics number → popup (Drilldown modal already
  // has Excel + PDF download buttons). Predicate is passed as encoded JSON.
  window._biDrill = function(title, enc) {
    let p = {}; try { p = JSON.parse(decodeURIComponent(enc)); } catch(e){}
    const f = (typeof getBiFilteredData === 'function') ? getBiFilteredData() : (defects || []);
    const now = new Date();
    const data = f.filter(d => {
      if (p.project && d.project !== p.project) return false;
      if (p.tower && d.tower !== p.tower) return false;
      if (p.floor && d.floor !== p.floor) return false;
      if (p.flat && d.flat !== p.flat) return false;
      if (p.status && d.statusvector !== p.status) return false;
      if (p.risk && d.riskspectrum !== p.risk) return false;
      if (p.category && d.defectcategory !== p.category) return false;
      if (p.openOnly && d.statusvector === 'Closed') return false;
      if (p.createdby && d.createdby !== p.createdby) return false;
      if (p.closedby && (d.closedby !== p.closedby || d.statusvector !== 'Closed')) return false;
      if (p.assignee) { const a=(d.assignedto||'').split('|').map(s=>s.trim()); if(p.assignee==='<Unassigned>'){ if(d.assignedto) return false; } else if(!a.includes(p.assignee)) return false; }
      if (p.pendingAssignee) { if(d.statusvector==='Closed') return false; const a=(d.assignedto||'').split('|').map(s=>s.trim()); if(!a.includes(p.pendingAssignee)) return false; }
      if (p.overdueOpen) { if(d.statusvector==='Closed') return false; if(!(d.sladuedate && new Date(d.sladuedate) < now)) return false; }
      if (p.ontimeOpen) { if(d.statusvector==='Closed') return false; if(d.sladuedate && new Date(d.sladuedate) < now) return false; }
      if (p.closedWithinSla) { if(d.statusvector!=='Closed') return false; if(!(d.closeddate && d.sladuedate && new Date(d.closeddate) <= new Date(d.sladuedate))) return false; }
      if (p.closedLate) { if(d.statusvector!=='Closed') return false; if(d.closeddate && d.sladuedate && new Date(d.closeddate) <= new Date(d.sladuedate)) return false; }
      if (p.loggedMonth && (d.loggeddate||'').slice(0,7) !== p.loggedMonth) return false;
      if (p.closedMonth && ((d.closeddate||'').slice(0,7) !== p.closedMonth || d.statusvector !== 'Closed')) return false;
      return true;
    });
    if (!data.length) return csmsToast('No records for this selection.', 'error');
    if (typeof openDrillModal === 'function') openDrillModal(title, data);
  };

  // Download Pending Defects Summary (Closure tab) as Excel
  window.exportClosureExcel = function() {
    const rows = (typeof _clFilteredDefects === 'function') ? _clFilteredDefects() : [];
    if (!rows || rows.length === 0) return alert('No pending defects to export.');
    if (typeof exportExcelWithPhotos === 'function') exportExcelWithPhotos(rows);
    else alert('Export function unavailable.');
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
      .page { padding:0; margin:0; }
      .defect-card-half { height:90mm; margin-bottom:2mm; overflow:hidden; border:1px solid #94a3b8; border-radius:6px; padding:7px 11px; break-inside:avoid; page-break-inside:avoid; box-sizing:border-box; display:flex; flex-direction:column; }
      .dh { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #cbd5e1; padding-bottom:5px; margin-bottom:6px; }
      .did { font-size:14px; font-weight:800; color:#0284c7; }
      .status-badge { padding:3px 8px; border-radius:12px; font-weight:700; font-size:10px; border:1px solid #cbd5e1; text-transform:uppercase; }
      .grid-info { display:grid; grid-template-columns:repeat(4,1fr); gap:4px 8px; font-size:10.5px; flex:1 1 auto; align-content:flex-start; }
      .info-box { background:#f1f5f9; padding:5px 7px; border-radius:4px; border:1px solid #e2e8f0; }
      .info-label { font-size:9px; color:#64748b; text-transform:uppercase; font-weight:700; display:block; margin-bottom:2px; }
      .info-value { font-weight:600; color:#0f172a; word-wrap:break-word; font-size:10.5px; }
      .remarks-box { grid-column:span 4; background:#fffbeb; border:1px solid #fde68a; }
      .media-section { display:grid; grid-template-columns:auto 1fr 1fr; gap:6px; margin-top:6px; }
      .media-box { border:1px solid #e2e8f0; padding:4px; border-radius:4px; }
      .media-title { font-size:9px; font-weight:700; margin-bottom:3px; text-align:center; color:#475569; }
      .img-grid { display:flex; gap:3px; flex-wrap:wrap; justify-content:center; }
      .img-grid img { width:38px; height:38px; object-fit:cover; border-radius:3px; border:1px solid #cbd5e1; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin:0; } .defect-card-half:nth-child(3n) { margin-bottom:0; break-after: page; page-break-after: always; } }
    </style>`;
    let html = '<div class="page">';
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
    if (id === 'messages') { renderMessages(); }
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

  // =========================================================
  // 5. TEAM MESSAGES / ISSUE ESCALATION  (Supabase: snag_messages)
  // =========================================================
  let _msgThreads = [];
  let _msgTab = 'all';
  function _esc2(s){ return String(s||'').replace(/</g,'&lt;').replace(/\n/g,'<br>'); }
  function _msgVisible(m){
    if (!currentUser) return false;
    if (m.author === currentUser.id) return true;
    const rec = (m.recipients||'').split('|').map(s=>s.trim()).filter(Boolean);
    if (rec.length) { return currentUser.role === 'admin' || rec.includes(currentUser.id); }
    // no explicit recipients = broadcast to whole project
    if (currentUser.role === 'admin') return true;
    if ((currentUser.projects||[]).includes('All')) return true;
    return (currentUser.projects||[]).some(x => x.startsWith(m.project+'_'));
  }
  function _msgDelay(root, replies){
    if (!root.created_at) return '';
    const start = new Date(root.created_at);
    if (root.is_resolved && root.resolved_at) return `Resolved in ${Math.round((new Date(root.resolved_at)-start)/3600000)}h`;
    if (replies[0] && replies[0].created_at) return `1st reply +${Math.round((new Date(replies[0].created_at)-start)/3600000)}h`;
    return `Awaiting ${Math.round((Date.now()-start)/3600000)}h`;
  }
  window.loadMessages = async function(){
    if (typeof supabaseClient === 'undefined') return;
    try { const { data, error } = await supabaseClient.from('snag_messages').select('*').order('created_at',{ascending:true});
      if (error) { console.warn('[CSMS] loadMessages', error.message); return; }
      _msgThreads = data || []; updateMsgBadge();
    } catch(e){ console.warn(e); }
  };
  window.updateMsgBadge = function(){
    if (!currentUser) return;
    const openForMe = _msgThreads.filter(m => !m.parent_id && !m.is_resolved && _msgVisible(m)).length;
    const b = document.getElementById('msgBadge');
    if (b) { if (openForMe>0){ b.style.display='inline-block'; b.textContent = openForMe>99?'99+':openForMe; } else b.style.display='none'; }
  };
  window.renderMessages = async function(){
    const wrap = document.getElementById('msgThreadList'); if (!wrap) return;
    await loadMessages();
    if (!window._msgSub && typeof supabaseClient !== 'undefined' && supabaseClient.channel) {
      try { window._msgSub = supabaseClient.channel('csms_msgs').on('postgres_changes',{event:'*',schema:'public',table:'snag_messages'},()=>{ loadMessages().then(()=>{ const s=document.getElementById('messages'); if(s && s.classList.contains('active')) renderMessages(); }); }).subscribe(); } catch(e){}
    }
    const projSel = document.getElementById('msg_project');
    if (projSel && projSel.options.length <= 1) getAllowedProjects().forEach(p => projSel.appendChild(new Option(p,p)));
    let roots = _msgThreads.filter(m => !m.parent_id && _msgVisible(m));
    if (_msgTab === 'sent') roots = roots.filter(r => r.author === currentUser.id);
    else if (_msgTab === 'received') roots = roots.filter(r => r.author !== currentUser.id);
    else if (_msgTab === 'pending') roots = roots.filter(r => !r.is_resolved);
    else if (_msgTab === 'closed') roots = roots.filter(r => r.is_resolved);
    roots.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    if (!roots.length){ wrap.innerHTML = '<p style="text-align:center;padding:24px;color:#94a3b8;">No messages yet. Raise an issue above to alert your project team.</p>'; return; }
    wrap.innerHTML = roots.map(r => {
      const replies = _msgThreads.filter(m => m.parent_id === r.id).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
      const resolved = r.is_resolved;
      const canResolve = !resolved && (r.author===currentUser.id || currentUser.role==='admin');
      return `<div class="msg-thread ${resolved?'resolved':'open'}">
        <div class="msg-thread-head" onclick="toggleThread('${r.id}')">
          <div><span class="msg-badge ${resolved?'ok':'warn'}">${resolved?'RESOLVED':'OPEN'}</span> <b>${_esc2(r.subject)||'(no subject)'}</b>
            <div class="msg-sub">${r.project} → ${r.tower||'-'} ${r.floor?('→ '+r.floor):''} · by <b>${r.author_name||r.author}</b> · ${(r.created_at||'').replace('T',' ').slice(0,16)}</div></div>
          <div class="msg-meta">${replies.length} repl${replies.length===1?'y':'ies'}${_msgDelay(r,replies)?(' · '+_msgDelay(r,replies)):''}</div>
        </div>
        <div class="msg-thread-body" id="thr_${r.id}" style="display:none;">
          <div class="msg-body-text">${_esc2(r.body)}</div>
          ${replies.map(rp=>`<div class="msg-reply"><b>${rp.author_name||rp.author}</b> <span class="msg-sub">${(rp.created_at||'').replace('T',' ').slice(0,16)}</span><div>${_esc2(rp.body)}</div></div>`).join('')}
          ${resolved?`<div class="msg-reply" style="background:#ecfdf5;"><i class="fas fa-check-circle" style="color:#059669;"></i> Resolved by <b>${r.resolved_by||'-'}</b> · ${(r.resolved_at||'').replace('T',' ').slice(0,16)}</div>`:''}
          <div class="msg-reply-box">
            <textarea id="reply_${r.id}" rows="2" placeholder="Type a reply..."></textarea>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
              <button class="btn-capture-tech" onclick="submitReply('${r.id}')"><i class="fas fa-reply"></i> Reply</button>
              ${canResolve?`<button class="btn-submit-tech" style="background:#059669;margin:0;width:auto;" onclick="resolveThread('${r.id}')"><i class="fas fa-check"></i> Mark Resolved</button>`:''}
              <button class="btn-export-tech pdf" onclick="msgThreadReport('${r.id}')"><i class="fas fa-file-alt"></i> Escalation Report</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  };
  window.toggleThread = function(id){ const el=document.getElementById('thr_'+id); if(el) el.style.display = el.style.display==='none'?'block':'none'; };
  window.submitMessage = async function(){
    const p=document.getElementById('msg_project').value, t=document.getElementById('msg_tower').value.trim(), f=document.getElementById('msg_floor').value.trim();
    const subj=document.getElementById('msg_subject').value.trim(), body=document.getElementById('msg_body').value.trim();
    if(!p) return alert('Select a project.');
    if(!subj||!body) return alert('Enter a subject and message.');
    try{ const {error}=await supabaseClient.from('snag_messages').insert([{project:p,tower:t||null,floor:f||null,subject:subj,body:body,author:currentUser.id,author_name:getFullName(currentUser),parent_id:null,is_resolved:false,recipients:((_msGetSelected('msg_recipients_ms')||[]).join('|'))||null}]);
      if(error) throw error;
      csmsToast('Issue raised & shared with the project team.','success');
      document.getElementById('msg_subject').value=''; document.getElementById('msg_body').value='';
      await loadMessages(); renderMessages();
    }catch(e){ alert('Failed to send (did you run snag_messages_setup.sql?): '+(e.message||e)); }
  };
  window.submitReply = async function(rootId){
    const ta=document.getElementById('reply_'+rootId); const body=(ta&&ta.value||'').trim(); if(!body) return;
    const root=_msgThreads.find(m=>String(m.id)===String(rootId)); if(!root) return;
    try{ const {error}=await supabaseClient.from('snag_messages').insert([{project:root.project,tower:root.tower,floor:root.floor,subject:root.subject,body:body,author:currentUser.id,author_name:getFullName(currentUser),parent_id:root.id,is_resolved:false}]);
      if(error) throw error; await loadMessages(); renderMessages(); const e2=document.getElementById('thr_'+rootId); if(e2) e2.style.display='block';
    }catch(e){ alert('Reply failed: '+(e.message||e)); }
  };
  window.resolveThread = async function(rootId){
    if(!confirm('Mark this issue as RESOLVED? Do this only when the problem is actually solved.')) return;
    try{ const {error}=await supabaseClient.from('snag_messages').update({is_resolved:true,resolved_by:getFullName(currentUser),resolved_at:new Date().toISOString()}).eq('id',rootId);
      if(error) throw error; csmsToast('Issue marked resolved.','success'); await loadMessages(); renderMessages();
    }catch(e){ alert('Failed: '+(e.message||e)); }
  };
  window.msgThreadReport = function(rootId){
    const root=_msgThreads.find(m=>String(m.id)===String(rootId)); if(!root) return;
    const replies=_msgThreads.filter(m=>m.parent_id===root.id).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
    const rows=[root,...replies]; let prev=new Date(root.created_at);
    const html=`<div class="modal-content" style="max-width:760px;"><h3 style="margin-top:0;"><i class="fas fa-file-alt text-cyan"></i> Escalation Report — ${_esc2(root.subject)}</h3>
      <p class="msg-sub" style="margin-bottom:12px;"><b>${root.project}</b> → ${root.tower||'-'} ${root.floor?('→ '+root.floor):''} · Status: <b>${root.is_resolved?'RESOLVED':'STILL OPEN'}</b></p>
      <div class="records-table-container"><table class="csms-pro-table"><thead><tr><th>#</th><th>Type</th><th>By</th><th>Date/Time</th><th>Gap</th><th>Message</th></tr></thead><tbody>
      ${rows.map((m,i)=>{ const dt=new Date(m.created_at); const gap=i===0?'-':Math.round((dt-prev)/3600000)+'h'; prev=dt; return `<tr><td>${i+1}</td><td>${m.parent_id?'Reply':'<b>Raised</b>'}</td><td>${m.author_name||m.author}</td><td>${(m.created_at||'').replace('T',' ').slice(0,16)}</td><td style="${(i>0 && (dt-new Date(rows[i-1].created_at))/3600000>24)?'color:#dc2626;font-weight:700;':''}">${gap}</td><td>${_esc2(m.body)}</td></tr>`; }).join('')}
      ${root.is_resolved?`<tr style="background:#ecfdf5;"><td>✓</td><td>Resolved</td><td>${root.resolved_by||'-'}</td><td>${(root.resolved_at||'').replace('T',' ').slice(0,16)}</td><td><b>${Math.round((new Date(root.resolved_at)-new Date(root.created_at))/3600000)}h total</b></td><td>Issue closed</td></tr>`:`<tr style="background:#fef2f2;"><td>!</td><td colspan="5" style="color:#dc2626;"><b>UNRESOLVED for ${Math.round((Date.now()-new Date(root.created_at))/3600000)}h</b> — escalate to senior.</td></tr>`}
      </tbody></table></div>
      <div style="text-align:right;margin-top:14px;"><button class="btn-danger-tech" onclick="document.getElementById('msgReportModal').style.display='none'">Close</button></div></div>`;
    const modal=document.getElementById('msgReportModal'); modal.innerHTML=html; modal.style.display='flex';
  };

  window.switchMsgTab = function(btn,t){ _msgTab=t; document.querySelectorAll('#msgTabs .notif-tab-btn').forEach(b=>b.classList.remove('active')); if(btn) btn.classList.add('active'); renderMessages(); };
  function _projectUsers(p){ return (USER_MATRIX||[]).filter(u=> u.id!==currentUser.id && (u.role==='admin' || (u.projects||[]).includes('All') || (p && (u.projects||[]).some(x=>x.startsWith(p+'_'))))); }
  window.populateMsgRecipients = function(){ const p=document.getElementById('msg_project').value; const users=_projectUsers(p); _msSetOptions('msg_recipients_ms', users.map(u=>u.id), {showAll:'All Project Users'}); };
  window.exportMessagesExcel = async function(){
    const roots=_msgThreads.filter(m=>!m.parent_id&&_msgVisible(m));
    if(!roots.length) return alert('No messages to export.');
    const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Messages');
    ws.columns=[{header:'Issue #',width:8},{header:'Project',width:16},{header:'Tower',width:12},{header:'Floor',width:12},{header:'Subject',width:26},{header:'Issue Detail',width:40},{header:'Raised By',width:18},{header:'Raised On',width:18},{header:'Recipients',width:24},{header:'Replies',width:8},{header:'Full Conversation',width:60},{header:'Status',width:10},{header:'Resolved By',width:16},{header:'Resolved On',width:18},{header:'Resolution (h)',width:13}];
    const hr=ws.getRow(1); hr.font={bold:true,color:{argb:'FFFFFFFF'}}; hr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F172A'}};
    roots.forEach((r,i)=>{ const reps=_msgThreads.filter(m=>m.parent_id===r.id).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')); const convo=reps.map(rp=>`[${(rp.created_at||'').replace('T',' ').slice(0,16)}] ${rp.author_name||rp.author}: ${rp.body}`).join('\n'); const resH=(r.is_resolved&&r.resolved_at)?Math.round((new Date(r.resolved_at)-new Date(r.created_at))/3600000):''; ws.addRow([i+1,r.project,r.tower||'-',r.floor||'-',r.subject||'',r.body||'',r.author_name||r.author,(r.created_at||'').replace('T',' ').slice(0,16),r.recipients||'ALL',reps.length,convo,r.is_resolved?'RESOLVED':'OPEN',r.resolved_by||'',(r.resolved_at||'').replace('T',' ').slice(0,16),resH]); });
    ws.eachRow(row=>{ row.alignment={vertical:'top',wrapText:true}; });
    const buf=await wb.xlsx.writeBuffer(); const blob=new Blob([buf],{type:'application/octet-stream'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='CSMS_Messages_Report.xlsx'; a.click();
    csmsToast('Messages Excel report downloaded.','success');
  };

  console.log('[CSMS Enhancements v2] loaded');
})();
