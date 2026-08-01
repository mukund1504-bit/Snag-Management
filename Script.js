/* eslint-disable */
// ====== SUPABASE SYSTEM PRODUCTION ENDPOINT CONFIGURATION ======
const SUPABASE_URL = "https://vkvyzzxplzrpgiouopbx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdnl6enhwbHpycGdpb3VvcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzM3ODMsImV4cCI6MjA5Nzg0OTc4M30.n3cBqWQ4SD5LpcdLiu4G5mgF0YzFzCZrik80MLLXBzk";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

function getSafeStorage(key, defaultValue) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
        console.warn("Storage corrupt, resetting key:", key);
        localStorage.removeItem(key);
        return defaultValue;
    }
}

function resolveCategoryName(catValue) {
    if (!catValue) return "-";
    try {
        const categories = getSafeStorage("categories_list", getSafeStorage("csms_categories", []));
        if(Array.isArray(categories)) {
            const cat = categories.find(c => c.id === catValue || c.name === catValue || c.categoryId === catValue);
            if(cat) return cat.name;
        }
    } catch(e) {}
    return catValue || "-"; 
}

function resolveSpecificationName(specValue) {
    if (!specValue) return "-";
    try {
        const specs = getSafeStorage("specifications_list", getSafeStorage("csms_specifications", []));
        if(Array.isArray(specs)) {
            const spec = specs.find(s => s.id === specValue || s.name === specValue || s.specId === specValue);
            if(spec) return spec.name;
        }
    } catch(e) {}
    return specValue || "-";
}

const DEFAULT_USERS = [
    { id: "Mukund1504@gmail.com", firstName: "Mukund", middleName: "", lastName: "Admin", pass: "Abc1504@", role: "admin", projects: ["All"], permission: "edit" }
];

let USER_MATRIX = getSafeStorage("qa_users", DEFAULT_USERS);
let currentUser = null;
let defects = [];
let filteredReportData = []; 
let tempPhotos = []; 
let editTempPhotos = []; 
let currentDrilldownData = []; 
let autoSyncInterval;

// === NEW: Map readiness state (single source of truth) ===
let mapsCloudLoaded = false;       // true once first successful cloud fetch completes
let pendingMapLoadKey = null;       // remembers the key user wants to load if not ready yet

// === NEW: Cloud sync state for hierarchy and categories (multi-device realtime sync) ===
let hierarchyCloudLoaded = false;
let categoriesCloudLoaded = false;

let structuralHierarchy = getSafeStorage("qa_strict_hierarchy", {
    "Fragrance": { 
        "Tower-A": { "GF": ["Unit-1", "Unit-2"], "1st Floor": ["101", "102"], "2nd Floor": ["201", "202"] }, 
        "Tower-B": { "GF": ["B-01"], "1st Floor": ["B-101", "B-102"] }
    },
    "Eutopia": { 
        "B1": { "Basement": ["P-1"], "GF": ["G-1"] }, 
        "STP": { "Area-1": ["Zone-A"] } 
    }
});

let defectMatrix = getSafeStorage("qa_defectMatrix", {
    "RCC Structure": ["Level uneven", "Honeycomb", "Crack Shown", "Poor Quality"],
    "Plumbing Work": ["Leak", "Broken", "Clogging"]
});

let floorMaps = getSafeStorage("qa_floorMaps", {});

// === FIX #4 === Debounce + submit-lock flags to prevent auto-refresh from
// racing with user submits (e.g. hierarchy add gets wiped by concurrent
// loadHierarchyFromCloud() that fired mid-save)
let _hierarchySaveInProgress = false;
let _categorySaveInProgress = false;
let _hierarchyLoadInProgress = false;
let _categoryLoadInProgress = false;
let _lastAutoRefreshAt = 0;

// === FIX #4 === Non-blocking toast helper (replaces silent-fail patterns)
function csmsToast(message, type) {
    try {
        let container = document.getElementById('csmsToastContainer');
        if(!container) {
            container = document.createElement('div');
            container.id = 'csmsToastContainer';
            container.className = 'csms-toast-container';
            document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.className = 'csms-toast ' + (type || '');
        el.textContent = message;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 300);
        }, 3500);
    } catch(e) { console.warn("Toast failed:", e); }
}

let canvasConfig = {
    entry: { ctx: null, img: null, scale: 1, tx: 0, ty: 0, marker: null, active: true },
    modal: { ctx: null, img: null, scale: 1, tx: 0, ty: 0, marker: null, active: false }
};

window.addEventListener('online', () => { document.getElementById('networkStatus').className = "network-badge online"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi"></i> Online'; syncOfflineData(); flushHierarchyQueue(); flushCategoryQueue(); loadHierarchyFromCloud(); loadCategoriesFromCloud(); });
window.addEventListener('offline', () => { document.getElementById('networkStatus').className = "network-badge offline"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi-slash"></i> Offline'; });

window.addEventListener('storage', () => {
    structuralHierarchy = getSafeStorage("qa_strict_hierarchy", structuralHierarchy);
    defectMatrix = getSafeStorage("qa_defectMatrix", defectMatrix);
    floorMaps = getSafeStorage("qa_floorMaps", floorMaps);
    refreshDropdowns();
});

let idleTime = 0;
function resetIdleTimer() { idleTime = 0; }
document.onmousemove = resetIdleTimer;
document.onkeypress = resetIdleTimer;
setInterval(() => {
    idleTime++;
    if(idleTime >= 60 && currentUser) { 
        alert("Session Expired due to inactivity. You have been logged out securely.");
        manualLogout(); 
    }
}, 60000); 

window.addEventListener("DOMContentLoaded", () => {
    if(!navigator.onLine) { document.getElementById('networkStatus').className = "network-badge offline"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi-slash"></i> Offline'; }
    
    try {
        const savedUser = sessionStorage.getItem("qa_logged_in_user");
        if(savedUser) { 
            currentUser = JSON.parse(savedUser); 
            activateApp(); 
        }
    } catch (e) {
        console.error("Initialization error, clearing session:", e);
        sessionStorage.clear();
    }
    
    const defectForm = document.getElementById("defectForm");
    if(defectForm) {
        defectForm.addEventListener('input', saveDraftState);
        defectForm.addEventListener('change', saveDraftState);
    }

    const defecttypeEl = document.getElementById("defectcategory");
    if(defecttypeEl) {
        defecttypeEl.addEventListener('change', populateDefectList);
    }

    // === NEW: Floor change ke baad map auto-reload (existing populateFlats untouched) ===
    const floorEl = document.getElementById("floor");
    if(floorEl) {
        floorEl.addEventListener('change', () => {
            // populateFlats already called via inline onchange; we just trigger map load
            setTimeout(() => ensureMapLoaded(), 50);
        });
    }
    // Same for project/tower in case they change directly (defensive)
    const projEl = document.getElementById("project");
    if(projEl) projEl.addEventListener('change', () => setTimeout(() => ensureMapLoaded(), 50));
    const towerEl = document.getElementById("tower");
    if(towerEl) towerEl.addEventListener('change', () => setTimeout(() => ensureMapLoaded(), 50));

    ["reportProject", "reportTower", "reportCreatedBy", "reportStatus", "reportDateFrom", "reportDateTo"].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', renderReportTable);
    });

    // === FIX #4 === Wrap realtime channel subscribes with reconnect-on-close
    // so listeners auto-rebind after network drop / mobile suspension.
    function _subscribeWithReconnect(channelFactory, label) {
        let ch;
        const start = () => {
            try {
                ch = channelFactory();
                ch.subscribe((status) => {
                    if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        console.warn(`[Realtime:${label}] status=${status}, reconnecting in 3s...`);
                        try { supabaseClient.removeChannel(ch); } catch(e){}
                        setTimeout(start, 3000);
                    }
                });
            } catch(e) { console.warn(`[Realtime:${label}] subscribe failed:`, e); setTimeout(start, 5000); }
        };
        start();
    }

    _subscribeWithReconnect(() => supabaseClient.channel('public:snagmanagement').on('postgres_changes', { event: '*', schema: 'public', table: 'snagmanagement' }, payload => {
        if(navigator.onLine) {
            console.log("Realtime Sync Triggered", payload);
            loadDefectsFromCloud(true);
        }
    }), 'snagmanagement');

    // === NEW: Realtime listener for map updates (so other devices' uploads reflect instantly) ===
    _subscribeWithReconnect(() => supabaseClient.channel('public:snag_maps').on('postgres_changes', { event: '*', schema: 'public', table: 'snag_maps' }, payload => {
        if(navigator.onLine) {
            console.log("Map Sync Triggered", payload);
            loadMapsFromCloud().then(() => {
                if (pendingMapLoadKey || (document.getElementById('entry') && document.getElementById('entry').classList.contains('active'))) {
                    ensureMapLoaded();
                }
            });
        }
    }), 'snag_maps');

    // === FIX #1 === Realtime listener for STRUCTURAL HIERARCHY — skips reload
    // while a local save is in flight (prevents overwrite of freshly-added row).
    _subscribeWithReconnect(() => supabaseClient.channel('public:snag_hierarchy').on('postgres_changes', { event: '*', schema: 'public', table: 'snag_hierarchy' }, payload => {
        if(navigator.onLine && !_hierarchySaveInProgress) {
            console.log("Hierarchy Sync Triggered", payload);
            loadHierarchyFromCloud().then(() => {
                refreshDropdowns();
                if(document.getElementById('setup') && document.getElementById('setup').classList.contains('active') && currentUser && currentUser.role === "admin") {
                    renderAdminTables();
                    renderUserSetupCheckboxes();
                }
            });
        }
    }), 'snag_hierarchy');

    // === NEW: Realtime listener for DEFECT CATEGORIES & SPECIFICATIONS ===
    _subscribeWithReconnect(() => supabaseClient.channel('public:snag_categories').on('postgres_changes', { event: '*', schema: 'public', table: 'snag_categories' }, payload => {
        if(navigator.onLine && !_categorySaveInProgress) {
            console.log("Category Sync Triggered", payload);
            loadCategoriesFromCloud().then(() => {
                refreshDropdowns();
                if(document.getElementById('setup') && document.getElementById('setup').classList.contains('active') && currentUser && currentUser.role === "admin") {
                    renderAdminTables();
                }
                const catEl = document.getElementById("defectcategory");
                if(catEl && catEl.value) populateDefectList();
            });
        }
    }), 'snag_categories');

});

document.addEventListener('click', function(e) {
    const selectBox = document.getElementById('customSpecSelect');
    if (selectBox && !selectBox.contains(e.target)) {
        selectBox.classList.remove('open');
    }
});
function toggleSpecDropdown() {
    const el = document.getElementById('customSpecSelect');
    if(el) el.classList.toggle('open');
}
function updateSpecSelectText() {
    const checked = Array.from(document.querySelectorAll('.spec-chk:checked')).map(cb => cb.value);
    const textEl = document.getElementById('specSelectText');
    if(textEl) {
        if(checked.length === 0) textEl.innerText = '-- Select Specification --';
        else if(checked.length === 1) textEl.innerText = checked[0];
        else textEl.innerText = checked.length + ' Specs Selected';
    }
    saveDraftState();
}

function initDropdownsOnLoad() {
    const projects = getAllowedProjects();
    const projEl = document.getElementById("project");
    if(projEl) {
        const savedVal = projEl.value;
        projEl.innerHTML = '<option value="">-- Select Project --</option>';
        projects.forEach(p => projEl.appendChild(new Option(p, p)));
        projEl.value = savedVal;
        if(savedVal) populateTowers(); 
    }

    const catEl = document.getElementById("defectcategory");
    if(catEl) {
        const savedVal = catEl.value;
        catEl.innerHTML = '<option value="">-- Select Category --</option>';
        Object.keys(defectMatrix).forEach(type => catEl.appendChild(new Option(type, type)));
        catEl.value = savedVal;
        if(savedVal) populateDefectList(); 
    }
}

window.addEventListener('beforeunload', () => {
    saveDraftState();
});

function getFullName(u) {
    if(u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
    return u.id; 
}

function processLogin() {
    const loginStr = document.getElementById("loginEmail").value.trim().toLowerCase(); 
    const pass = document.getElementById("loginPassword").value; 
    const err = document.getElementById("loginError");
    
    const validUser = USER_MATRIX.find(u => 
        (u.id.toLowerCase() === loginStr) || 
        (u.firstName && u.lastName && (`${u.firstName} ${u.lastName}`.toLowerCase() === loginStr))
    );
    
    if(validUser && validUser.pass === pass) { 
        currentUser = validUser; sessionStorage.setItem("qa_logged_in_user", JSON.stringify(validUser)); activateApp(); 
    } else { 
        err.style.display = "block"; err.innerText = "Invalid credentials. Try full name or email."; 
    }
}

function manualLogout() { 
    sessionStorage.removeItem("qa_logged_in_user"); 
    sessionStorage.removeItem("active_section");
    location.reload(); 
}

// === FIX #2 === activateApp — runs identical init sequence for BOTH login AND
// browser refresh paths. Explicitly re-inits canvas + click handlers AFTER
// draft restoration so refresh-state === post-login-state for marker clicks.
async function activateApp() {
    document.getElementById("loginOverlay").style.display = "none"; 
    document.getElementById("appContainer").style.display = "block";
    
    initDropdownsOnLoad();

    if(currentUser.role !== "admin") { document.getElementById("navSetupBtn").style.display = "none"; }
    
    let targetSection = sessionStorage.getItem("active_section") || 'entry';
    if(currentUser.role === "user" && currentUser.permission === "view") { 
        document.getElementById("navEntryBtn").style.display = "none"; 
        if(targetSection === 'entry') targetSection = 'dashboard';
    } 
    showSection(targetSection);

    refreshDropdowns(); 
    initCanvas('entry'); 
    initCanvas('modal');

    // Step 1: ensure cloud data fully fetched (maps + defects + hierarchy + categories) BEFORE restoring form
    // Fixes Issue #1 & #2: System Setup entries now sync across ALL devices in realtime
    await Promise.all([
        loadMapsFromCloud(),
        loadDefectsFromCloud(false),
        loadHierarchyFromCloud(),
        loadCategoriesFromCloud()
    ]);
    // Refresh dropdowns now that cloud-synced hierarchy/categories are merged
    refreshDropdowns();
    initDropdownsOnLoad();

    // Step 2: restore form fields (project/tower/floor selections come back)
    restoreDraftState(); 

    // === FIX #2 === Re-init canvas AFTER restoreDraftState so the click handler
    // is guaranteed to be attached in the refresh path (identical to post-login).
    // rebindEntryCanvasHandlers is idempotent — safe to call multiple times.
    rebindEntryCanvasHandlers();
    
    // Step 3: explicitly trigger map load AFTER everything is in place.
    // Using requestAnimationFrame ensures canvas DOM is laid out (visible, has size).
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            ensureMapLoaded().then(() => {
                // Final rebind after map draws to defend against any race condition
                rebindEntryCanvasHandlers();
            });
        });
    });

    startAutoRefresh(); 
    if(currentUser.role === "admin") { renderAdminTables(); renderUserSetupCheckboxes(); renderUserTable(); }
}

function saveDraftState() {
    const formObj = {};
    ['project','tower','floor','flatNo','defectcategory','riskspectrum','statusvector','sladuedate','engineeringremarks', 'entryCoordX', 'entryCoordY'].forEach(id => {
        const el = document.getElementById(id);
        if(el) formObj[id] = el.value;
    });

    const selectedSpecs = Array.from(document.querySelectorAll('.spec-chk:checked')).map(cb => cb.value).join(', ');
    formObj['specifications_multi'] = selectedSpecs;

    sessionStorage.setItem("csms_draft_form", JSON.stringify(formObj));
}

// === UPGRADED: restoreDraftState (map-related portion only changed) ===
function restoreDraftState() {
    const draft = JSON.parse(sessionStorage.getItem("csms_draft_form"));
    if(!draft) return;
    
    if(draft.project) { document.getElementById("project").value = draft.project; populateTowers(); }
    if(draft.tower) { document.getElementById("tower").value = draft.tower; populateFloors(); }
    if(draft.floor) { document.getElementById("floor").value = draft.floor; populateFlats(); }
    
    ['flatNo','defectcategory','riskspectrum','statusvector','sladuedate','engineeringremarks'].forEach(id => {
        if(draft[id] && document.getElementById(id)) document.getElementById(id).value = draft[id];
    });
    
    if(draft.defectcategory) populateDefectList();

    if(draft.specifications_multi) {
        const specs = draft.specifications_multi.split(', ');
        setTimeout(() => {
            document.querySelectorAll('.spec-chk').forEach(cb => {
                if(specs.includes(cb.value)) cb.checked = true;
            });
            updateSpecSelectText();
        }, 100);
    }

    if (draft.entryCoordX && draft.entryCoordY) {
        document.getElementById("entryCoordX").value = draft.entryCoordX;
        document.getElementById("entryCoordY").value = draft.entryCoordY;
        canvasConfig.entry.marker = {
            x: parseFloat(draft.entryCoordX),
            y: parseFloat(draft.entryCoordY)
        };
    }
    // Map load is NOT triggered here anymore (moved to activateApp via ensureMapLoaded)
    // This avoids race condition.
}

// === UPGRADED: showSection - retrigger map load when user navigates to entry ===
function showSection(id) {
    sessionStorage.setItem("active_section", id); 
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    
    const sec = document.getElementById(id); 
    if(sec) sec.classList.add("active");
    
    // Highlight the matching nav button by its onclick target. We deliberately do
    // NOT use window.event.currentTarget: on a page refresh showSection() runs from
    // the DOMContentLoaded handler where window.event.currentTarget is window/
    // document (no .classList), which threw and ABORTED activateApp before data
    // loaded — leaving every tab blank ("Loading feed…", empty tables).
    document.querySelectorAll(".nav-btn").forEach(b => {
        const oc = b.getAttribute("onclick");
        if (oc && oc.includes(`'${id}'`)) b.classList.add("active");
    });
    
    if(id === 'report') {
        renderReportTable(); 
        loadDefectsFromCloud(true); 
    }
    if(id === 'dashboard') {
        if(typeof renderCharts === 'function') renderCharts();
        loadDefectsFromCloud(true);
    }
    if(id === 'setup' && currentUser && currentUser.role === "admin") {
        renderAdminTables(); 
        renderUserSetupCheckboxes(); 
        renderUserTable();
    }
    // NEW: when entering the control panel (entry), re-ensure map is drawn
    if(id === 'entry') {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => ensureMapLoaded());
        });
    }
}

function getAllowedProjects() { 
    if(!currentUser) return [];
    if(currentUser.role === "admin" || (currentUser.projects && currentUser.projects.includes("All"))) return Object.keys(structuralHierarchy); 
    return Array.from(new Set((currentUser.projects || []).map(p => p.split("_")[0]))); 
}

function getAllowedTowers(proj) { 
    if(!currentUser) return [];
    if(!structuralHierarchy[proj]) return [];
    if(currentUser.role === "admin" || (currentUser.projects && currentUser.projects.includes("All"))) return Object.keys(structuralHierarchy[proj]); 
    return (currentUser.projects || []).filter(p => p.startsWith(proj + "_")).map(p => p.split("_")[1]); 
}

function refreshDropdowns() {
    const allowed = getAllowedProjects();
    
    ["project", "reportProject", "dashboardProjectFilter", "mapSetupProject"].forEach(id => {
        const el = document.getElementById(id); 
        if(!el) return;
        const currentValue = el.value; 
        el.innerHTML = (id.includes("report") || id.includes("dashboard")) ? "<option value='All'>All Authorized Projects</option>" : "<option value=''>-- Select Project --</option>";
        allowed.forEach(p => el.appendChild(new Option(p, p)));
        if (currentValue && Array.from(el.options).some(opt => opt.value === currentValue)) {
            el.value = currentValue;
        }
    });
    
    const typeSel = document.getElementById("defectcategory");
    if(typeSel) { 
        const currentCatValue = typeSel.value;
        typeSel.innerHTML = "<option value=''>-- Select Category --</option>"; 
        Object.keys(defectMatrix).forEach(type => typeSel.appendChild(new Option(type, type))); 
        if (currentCatValue) typeSel.value = currentCatValue;
    }
    
    const uSel = document.getElementById("reportCreatedBy");
    if(uSel) {
        const currentSelection = uSel.value; 
        uSel.innerHTML = "<option value='All'>All Users</option>";
        
        let uniqueUsers = new Set();
        USER_MATRIX.forEach(u => uniqueUsers.add(getFullName(u)));
        
        if (defects && defects.length > 0) {
            defects.forEach(d => {
                const creator = d.createdby || d.created_by || d.createdBy;
                if(creator && creator !== "-") uniqueUsers.add(creator);
            });
        }
        
        uniqueUsers.forEach(name => uSel.appendChild(new Option(name, name)));
        if (uniqueUsers.has(currentSelection) || currentSelection === 'All') {
            uSel.value = currentSelection; 
        }
    }
}

function populateDefectList() {
    const typeVal = document.getElementById("defectcategory") ? document.getElementById("defectcategory").value : "";
    const container = document.getElementById("specCheckboxContainer");
    if(!container) return;
    
    container.innerHTML = ''; 
    
    if(typeVal && defectMatrix[typeVal]) {
        defectMatrix[typeVal].forEach(spec => {
            container.innerHTML += `<label class="spec-cb-label"><input type="checkbox" value="${spec}" class="spec-chk" onchange="updateSpecSelectText()"> ${spec}</label>`;
        });
    } else {
        container.innerHTML = '<span style="color:#94a3b8; font-size:13px; padding:10px;">-- Select Category First --</span>';
    }
    updateSpecSelectText();
}

function clearMapCanvas() {
    if(document.getElementById("entryMapWarning")) document.getElementById("entryMapWarning").style.display = "block"; 
    canvasConfig.entry.marker = null; 
    canvasConfig.entry.img = null;
    canvasConfig.entry.active = false;
    if(canvasConfig.entry.ctx) {
        const canvas = document.getElementById('entryCanvas');
        if(canvas) canvasConfig.entry.ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if(document.getElementById("entryCoordX")) document.getElementById("entryCoordX").value = ""; 
    if(document.getElementById("entryCoordY")) document.getElementById("entryCoordY").value = "";
    drawCanvas('entry');
}

function populateTowers() {
    const p = document.getElementById("project").value; const tSel = document.getElementById("tower");
    tSel.innerHTML = '<option value="">-- Select Tower --</option>';
    if(p && structuralHierarchy[p]) { const allowedTowers = getAllowedTowers(p); allowedTowers.forEach(t => tSel.appendChild(new Option(t, t))); }
    
    document.getElementById("floor").innerHTML = '<option value="">-- Select Floor --</option>';
    document.getElementById("flatNo").innerHTML = '<option value="">-- Select Unit --</option>';
    clearMapCanvas(); 
}

function populateFloors() {
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value; const fSel = document.getElementById("floor");
    fSel.innerHTML = '<option value="">-- Select Floor --</option>';
    if(p && t && structuralHierarchy[p][t]) { Object.keys(structuralHierarchy[p][t]).forEach(f => fSel.appendChild(new Option(f, f))); }
    document.getElementById("flatNo").innerHTML = '<option value="">-- Select Unit --</option>';
    clearMapCanvas(); 
}

function populateFlats() {
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value; const f = document.getElementById("floor").value; 
    const unitSel = document.getElementById("flatNo");
    unitSel.innerHTML = '<option value="">-- Select Unit --</option>';
    if(p && t && f && structuralHierarchy[p][t][f]) {
        structuralHierarchy[p][t][f].forEach(unit => unitSel.appendChild(new Option(unit, unit)));
    }
}

// === FIX #5 === Combined transform (scale + translate) with bounds clamping so
// the map can be PANNED (dragged) within the box after being zoomed in — user
// can now move to see top/left/right/bottom corners with 1-finger drag.
function _clampPan(type) {
    const canvas = document.getElementById(`${type}Canvas`);
    if(!canvas) return;
    const wrapper = canvas.closest('.map-viewport-container') || canvas.parentElement;
    if(!wrapper) return;
    const s = canvasConfig[type].scale;
    // Canvas visual width/height at current CSS layout size (pre-transform box):
    const boxW = canvas.clientWidth  || canvas.offsetWidth  || wrapper.clientWidth;
    const boxH = canvas.clientHeight || canvas.offsetHeight || wrapper.clientHeight;
    const viewW = wrapper.clientWidth;
    const viewH = wrapper.clientHeight;

    // With transform-origin: top left and scale s, the visible content occupies
    // [tx, tx + boxW*s] x [ty, ty + boxH*s]. To keep the map covering the view
    // (no empty gap), tx must be in [viewW - boxW*s, 0], ty in [viewH - boxH*s, 0].
    // When map is smaller than view (s < viewW/boxW), we center it (tx = ty = 0
    // effectively — allow no drag).
    const contentW = boxW * s, contentH = boxH * s;
    // Center the map when it is smaller than the view (fixes "one edge stuck / gap"),
    // and allow full free panning in every direction once zoomed larger than the view.
    if (contentW <= viewW) canvasConfig[type].tx = (viewW - contentW) / 2;
    else canvasConfig[type].tx = Math.max(viewW - contentW, Math.min(0, canvasConfig[type].tx));
    if (contentH <= viewH) canvasConfig[type].ty = (viewH - contentH) / 2;
    else canvasConfig[type].ty = Math.max(viewH - contentH, Math.min(0, canvasConfig[type].ty));
}

function _applyCanvasTransform(type) {
    const el = document.getElementById(`${type}Canvas`);
    if(!el) return;
    _clampPan(type);
    const c = canvasConfig[type];
    el.style.transformOrigin = "top left";
    el.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${c.scale})`;
}

// === UPGRADED: zoomCanvas — now zoom-around-center so map doesn't jump to the
// top-left after +/- taps; also invokes clamped-pan re-apply.
function zoomCanvas(id, factor) { 
    const type = id.replace('Canvas', ''); 
    const prev = canvasConfig[type].scale;
    let next = prev * factor;
    next = Math.max(0.4, Math.min(6, next));
    const realFactor = next / prev;

    // Zoom around the visible-center of the wrapper so the current focal point stays put.
    const el = document.getElementById(id);
    if(el) {
        const wrapper = el.closest('.map-viewport-container') || el.parentElement;
        const viewW = wrapper ? wrapper.clientWidth : 0;
        const viewH = wrapper ? wrapper.clientHeight : 0;
        // Focal point in canvas-local coords (pre-transform): (cx, cy)
        const cx = (viewW/2 - canvasConfig[type].tx) / prev;
        const cy = (viewH/2 - canvasConfig[type].ty) / prev;
        canvasConfig[type].scale = next; 
        canvasConfig[type].tx = viewW/2 - cx * next;
        canvasConfig[type].ty = viewH/2 - cy * next;
    } else {
        canvasConfig[type].scale = next; 
    }
    _applyCanvasTransform(type);
}
function resetCanvas(id) { 
    const type = id.replace('Canvas', ''); 
    canvasConfig[type].scale = 1; 
    canvasConfig[type].tx = 0;
    canvasConfig[type].ty = 0;
    _applyCanvasTransform(type);
}

// === FIX #3/#5 === attachZoomGestures — proper 2-finger pinch AND 1-finger
// drag-to-pan inside the map box. After zoom, the user can drag with one
// finger (mobile) or click-drag with mouse (desktop) to move the map so
// top/bottom/left/right corners are all reachable within the wrapper.
// Idempotent: guarded by _csmsPinchBound flag to prevent duplicate handlers.
function attachZoomGestures(canvasId) {
    const canvas = document.getElementById(canvasId);
    if(!canvas) return;
    const type = canvasId.replace('Canvas','');

    // Mouse wheel zoom (laptop / desktop) — idempotent
    if(!canvas._csmsWheelBound) {
        canvas._csmsWheelBound = true;
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = (e.deltaY < 0) ? 1.12 : (1/1.12);
            zoomCanvas(canvasId, factor);
        }, { passive: false });
    }

    // Mouse drag-to-pan (desktop) — idempotent
    if(!canvas._csmsMouseDragBound) {
        canvas._csmsMouseDragBound = true;
        let mDown = false, mStartX = 0, mStartY = 0, mBaseTx = 0, mBaseTy = 0, mMoved = false;
        canvas.addEventListener('mousedown', (e) => {
            // Only pan when zoomed in (scale > 1); at scale 1 preserve click-to-mark
            if(canvasConfig[type].scale <= 1.01) return;
            mDown = true; mMoved = false;
            mStartX = e.clientX; mStartY = e.clientY;
            mBaseTx = canvasConfig[type].tx; mBaseTy = canvasConfig[type].ty;
            canvas.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if(!mDown) return;
            const dx = e.clientX - mStartX;
            const dy = e.clientY - mStartY;
            if(Math.abs(dx) + Math.abs(dy) > 3) mMoved = true;
            canvasConfig[type].tx = mBaseTx + dx;
            canvasConfig[type].ty = mBaseTy + dy;
            _applyCanvasTransform(type);
        });
        window.addEventListener('mouseup', (e) => {
            if(!mDown) return;
            mDown = false;
            canvas.style.cursor = '';
            if(mMoved) {
                // Suppress the ensuing click so pan doesn't drop a marker
                const suppress = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                canvas.addEventListener('click', suppress, { capture: true, once: true });
            }
        });
    }

    // Two-finger pinch + one-finger drag on the wrapper — idempotent
    let wrapper = canvas.closest('.map-viewport-container');
    if(!wrapper) wrapper = canvas.parentElement;
    if(!wrapper || wrapper._csmsPinchBound) return;
    wrapper._csmsPinchBound = true;

    let lastDist = 0;
    let pinchActive = false;
    // Single-finger drag state
    let dragActive = false;
    let dragStartX = 0, dragStartY = 0;
    let dragBaseTx = 0, dragBaseTy = 0;
    let dragMoved = false;

    const getDist = (touches) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    };
    const getMid = (touches) => ({
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    });

    let pinchMidStart = null;
    let pinchBaseTx = 0, pinchBaseTy = 0;

    wrapper.addEventListener('touchstart', (e) => {
        if(e.touches.length === 2) {
            e.preventDefault();
            pinchActive = true;
            dragActive = false;
            lastDist = getDist(e.touches);
            pinchMidStart = getMid(e.touches);
            pinchBaseTx = canvasConfig[type].tx;
            pinchBaseTy = canvasConfig[type].ty;
        } else if(e.touches.length === 1 && canvasConfig[type].scale > 1.01) {
            // === FIX #6 === DO NOT preventDefault on touchstart — that also
            // suppresses the browser-synthesized click on stationary taps, which
            // stops red-dot markers from opening the info popup on mobile.
            // We only arm drag state here; preventDefault happens later in
            // touchmove ONLY IF a real drag begins (movement > threshold).
            dragActive = true;
            dragMoved = false;
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            dragBaseTx = canvasConfig[type].tx;
            dragBaseTy = canvasConfig[type].ty;
        }
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e) => {
        if(e.touches.length === 2) {
            e.preventDefault();
            e.stopPropagation();
            const dist = getDist(e.touches);
            if(lastDist > 0) {
                const factor = dist / lastDist;
                zoomCanvas(canvasId, factor);
            }
            lastDist = dist;
            // Two-finger drag while pinching: shift by midpoint delta
            const mid = getMid(e.touches);
            if(pinchMidStart) {
                const dmx = mid.x - pinchMidStart.x;
                const dmy = mid.y - pinchMidStart.y;
                canvasConfig[type].tx = pinchBaseTx + dmx;
                canvasConfig[type].ty = pinchBaseTy + dmy;
                _applyCanvasTransform(type);
            }
        } else if(e.touches.length === 1 && dragActive) {
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;
            // === FIX #6 === Only preventDefault (and pan the map) AFTER movement
            // crosses the drag threshold. Small unintentional finger jitter on tap
            // stays under threshold and falls through as a normal tap → click →
            // marker popup opens. Threshold matches desktop mousemove branch (>3 px).
            if(Math.abs(dx) + Math.abs(dy) > 8) {
                dragMoved = true;
            }
            if(dragMoved) {
                e.preventDefault();
                canvasConfig[type].tx = dragBaseTx + dx;
                canvasConfig[type].ty = dragBaseTy + dy;
                _applyCanvasTransform(type);
            }
        } else if(pinchActive) {
            e.preventDefault();
        }
    }, { passive: false });

    wrapper.addEventListener('touchend', (e) => {
        if(e.touches.length < 2) {
            lastDist = 0;
            pinchActive = false;
            pinchMidStart = null;
        }
        if(e.touches.length === 0) {
            if(dragActive && dragMoved) {
                // Prevent tap-through so pan drag doesn't leave a marker
                const suppress = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
                canvas.addEventListener('click', suppress, { capture: true, once: true });
            }
            dragActive = false;
        }
    }, { passive: true });
    wrapper.addEventListener('touchcancel', () => {
        lastDist = 0;
        pinchActive = false;
        dragActive = false;
        pinchMidStart = null;
    }, { passive: true });

    // Also swallow gesture events on iOS to prevent Safari page zoom.
    ['gesturestart','gesturechange','gestureend'].forEach(ev => {
        wrapper.addEventListener(ev, (e) => { e.preventDefault(); }, { passive: false });
    });
}

// === FIX #2 === initCanvas — click handler is now REBINDABLE (removes any
// previously-attached listener before attaching fresh one). This guarantees
// that after a page refresh the click-to-open-defect-popup binding is
// identical to the post-login state. Function name & signature preserved.
function initCanvas(type) {
    const canvas = document.getElementById(`${type}Canvas`); if(!canvas) return;
    canvasConfig[type].ctx = canvas.getContext('2d');
    // Attach zoom gestures for BOTH entry and modal canvases (Issue #3)
    attachZoomGestures(`${type}Canvas`);
    if(type === 'entry') {
        // === FIX #2 === Remove old listener (if any) then attach fresh.
        // Storing the handler on the element so we can detach it on re-init.
        if(canvas._csmsClickHandler) {
            try { canvas.removeEventListener("click", canvas._csmsClickHandler); } catch(e){}
        }
        const clickHandler = (e) => {
            if(!canvasConfig.entry.active) return;
            const rect = canvas.getBoundingClientRect(); 
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX; 
            const y = (e.clientY - rect.top) * scaleY;
            
            const p = document.getElementById("project").value; 
            const t = document.getElementById("tower").value; 
            const f = document.getElementById("floor").value;
            let clickedDefect = null;
            
            for(let d of defects) {
                if(d.project === p && d.tower === t && d.floor === f && (d.flat || "") === (document.getElementById("flatNo") ? document.getElementById("flatNo").value : "") && d.statusvector !== 'Closed' && d.mapx && d.mapy && d.mapx !== "0") {
                    const dx = parseFloat(d.mapx);
                    const dy = parseFloat(d.mapy);
                    const dist = Math.sqrt(Math.pow(dx - x, 2) + Math.pow(dy - y, 2));
                    if(dist <= 22) {
                        clickedDefect = d;
                        break;
                    }
                }
            }
            
            if(clickedDefect) {
                openDefectInfoModal(clickedDefect);
                return;
            }

            canvasConfig.entry.marker = {x, y}; 
            document.getElementById("entryCoordX").value = x; 
            document.getElementById("entryCoordY").value = y; 
            drawCanvas(type);
            saveDraftState(); 
        };
        canvas._csmsClickHandler = clickHandler;
        canvas.addEventListener("click", clickHandler);
        canvas._csmsBound = true;
    }
}

// === FIX #2 === rebindEntryCanvasHandlers — called after every canvas redraw
// & from the DOMContentLoaded refresh path to guarantee marker → popup click
// binding is always present, regardless of whether user just logged in or
// refreshed the browser. Idempotent by design (initCanvas removes stale handler).
function rebindEntryCanvasHandlers() {
    initCanvas('entry');
}

function openDefectInfoModal(d) {
    const content = document.getElementById("defectInfoContent");
    const _imgCss = "width:80px; height:80px; object-fit:cover; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; box-shadow:0 2px 4px rgba(0,0,0,0.1);";
    const photos = Array.isArray(d.initialPics) && d.initialPics.length > 0 
        ? d.initialPics.map(src => `<img src="${src}" onclick="openZoomImage('${src}')" style="${_imgCss}"/>`).join(' ') 
        : '<span style="color:#94a3b8; font-size:12px;">No Evidence Found</span>';
    const fphotos = Array.isArray(d.finalPics) && d.finalPics.length > 0 
        ? d.finalPics.map(src => `<img src="${src}" onclick="openZoomImage('${src}')" style="${_imgCss}"/>`).join(' ') 
        : '<span style="color:#94a3b8; font-size:12px;">No Final Photos</span>';
    
    content.innerHTML = `
        <div style="background:#f1f5f9; padding:10px; border-radius:6px; border:1px solid #cbd5e1;">
            <p style="margin:4px 0;"><strong>Category:</strong> <span style="color:#0284c7;">${d.defectcategory || '-'}</span></p>
            <p style="margin:4px 0;"><strong>Specification:</strong> ${d.specificationmatrix || '-'}</span></p>
            <p style="margin:4px 0;"><strong>Risk Spectrum:</strong> ${d.riskspectrum || '-'}</p>
        </div>
        <div style="background:#f1f5f9; padding:10px; border-radius:6px; border:1px solid #cbd5e1;">
            <p style="margin:4px 0;"><strong>Created By:</strong> ${d.createdby || '-'}</p>
            <p style="margin:4px 0;"><strong>Logged Date:</strong> ${d.loggeddate || '-'}</p>
        </div>
        <div>
            <strong style="color:#334155;">Initial Evidence Photos:</strong><br>
            <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap;">${photos}</div>
        </div>
        <div>
            <strong style="color:#065f46;">Final Evidence Photos (Post-Repair):</strong><br>
            <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap;">${fphotos}</div>
            <p style="font-size:11px; color:#64748b; margin-top:5px;">(Click image to enlarge)</p>
        </div>
    `;
    document.getElementById("defectInfoModal").style.display = "flex";
}
function closeDefectInfoModal() {
    document.getElementById("defectInfoModal").style.display = "none";
}

// === UPGRADED: loadEntryMap — guarantees defects are loaded before drawing red dots ===
async function loadEntryMap() {
    const p = document.getElementById("project") ? document.getElementById("project").value : "";
    const t = document.getElementById("tower") ? document.getElementById("tower").value : "";
    const f = document.getElementById("floor") ? document.getElementById("floor").value : "";
    
    if(!p || !t || !f) {
        clearMapCanvas();
        return false;
    }

    const key = `${p}_${t}_${f}`;
    let base64Img = floorMaps[key];

    if(!base64Img) {
        const lsMaps = getSafeStorage("qa_floorMaps", {});
        if(lsMaps[key]) {
            floorMaps[key] = lsMaps[key];
            base64Img = lsMaps[key];
        }
    }

    const warn = document.getElementById("entryMapWarning");
    const canvas = document.getElementById('entryCanvas');
    
    if(!canvas) return false;

    if(!canvasConfig.entry.ctx) {
        canvasConfig.entry.ctx = canvas.getContext('2d');
    }

    if (!base64Img) {
        return false;
    }

    if(warn) warn.style.display = "none"; 
    canvasConfig.entry.active = true;

    // FIX: Ensure defects are loaded BEFORE drawing red dots
    // If defects array is empty but we're online, fetch them now
    if((!defects || defects.length === 0) && navigator.onLine) {
        await loadDefectsFromCloud(true);
    }

    return await new Promise((resolve) => {
        const img = new Image();
        // NEW: Storage-hosted map URLs are cross-origin; set anonymous so canvas
        // stays untainted and getMapThumbnailBase64 continues to work.
        img.crossOrigin = "anonymous";
        img.onload = () => {
            canvasConfig.entry.img = img;
            canvas.width = img.width; 
            canvas.height = img.height;
            // Draw map + dots
            drawCanvas('entry');
            // FIX: Double-draw after a micro-tick to catch any defects that arrived
            // between image load and the first draw (handles cached-image race condition)
            setTimeout(() => {
                if(canvasConfig.entry.img) drawCanvas('entry');
            }, 150);
            resolve(true);
        };
        img.onerror = () => {
            console.warn("Map image failed to decode for key:", key);
            resolve(false);
        };
        img.src = base64Img;
    });
}

// === NEW: ensureMapLoaded — single source of truth with retry + cloud fallback ===
async function ensureMapLoaded() {
    const entrySection = document.getElementById('entry');
    if(!entrySection || !entrySection.classList.contains('active')) {
        // Only relevant when entry section is visible
        return;
    }

    const p = document.getElementById("project") ? document.getElementById("project").value : "";
    const t = document.getElementById("tower") ? document.getElementById("tower").value : "";
    const f = document.getElementById("floor") ? document.getElementById("floor").value : "";

    if(!p || !t || !f) {
        clearMapCanvas();
        return;
    }

    const key = `${p}_${t}_${f}`;
    pendingMapLoadKey = key;

    // Attempt 1: load from current cache
    let ok = await loadEntryMap();
    if(ok) { pendingMapLoadKey = null; return; }

    // Attempt 2: force fresh cloud sync, then retry
    if(navigator.onLine) {
        const cloudOk = await loadMapsFromCloud();
        if(cloudOk) {
            ok = await loadEntryMap();
            if(ok) { pendingMapLoadKey = null; return; }
        }
    }

    // Attempt 3: short delayed retry (in case section just became visible / canvas sized late)
    await new Promise(r => setTimeout(r, 400));
    ok = await loadEntryMap();
    if(ok) { 
        pendingMapLoadKey = null; 
        // FIX: Final safety net — redraw dots after a brief settle
        setTimeout(() => {
            if(canvasConfig.entry.img && canvasConfig.entry.ctx) drawCanvas('entry');
        }, 200);
        return; 
    }

    // Final: keep warning visible
    clearMapCanvas();
}

function drawCanvas(type) {
    const c = canvasConfig[type]; const canvas = document.getElementById(`${type}Canvas`);
    if(!c.img || !c.ctx || !canvas) return;
    c.ctx.clearRect(0, 0, canvas.width, canvas.height); 
    c.ctx.drawImage(c.img, 0, 0);
    
    if(type === 'entry') {
        const p = document.getElementById("project") ? document.getElementById("project").value : ""; 
        const t = document.getElementById("tower") ? document.getElementById("tower").value : ""; 
        const f = document.getElementById("floor") ? document.getElementById("floor").value : "";
        defects.forEach(d => {
            if(d.project === p && d.tower === t && d.floor === f && (d.flat || "") === (document.getElementById("flatNo") ? document.getElementById("flatNo").value : "") && d.statusvector !== 'Closed' && d.mapx && d.mapy && d.mapx !== "0") {
                // Bigger red dot (Issue #3 fix): radius 16 with subtle pulse-style ring for visibility
                c.ctx.beginPath(); 
                c.ctx.arc(d.mapx, d.mapy, 16, 0, 2 * Math.PI); 
                c.ctx.fillStyle = "rgba(239, 68, 68, 0.88)"; 
                c.ctx.fill(); 
                c.ctx.lineWidth = 3; 
                c.ctx.strokeStyle = "#ffffff"; 
                c.ctx.stroke();
                // Outer ring for better visibility against busy backgrounds
                c.ctx.beginPath();
                c.ctx.arc(d.mapx, d.mapy, 19, 0, 2 * Math.PI);
                c.ctx.lineWidth = 2;
                c.ctx.strokeStyle = "rgba(220, 38, 38, 0.55)";
                c.ctx.stroke();
            }
        });
        // === FIX #2 === Ensure click handler is (still) attached after every
        // entry-canvas redraw. Idempotent — no duplicate listeners.
        rebindEntryCanvasHandlers();
    }

    if(c.marker) { 
        c.ctx.beginPath(); c.ctx.arc(c.marker.x, c.marker.y, 14, 0, 2 * Math.PI); c.ctx.fillStyle = "#3b82f6"; c.ctx.fill(); c.ctx.lineWidth = 4; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke(); 
    }
    // Center/clamp the map inside its A4 box using current scale/pan (fits A4 maps to fill box).
    requestAnimationFrame(() => { if(typeof _applyCanvasTransform === 'function') _applyCanvasTransform(type); });
}

// Legacy duplicate zoomCanvas/resetCanvas removed — upgraded versions are defined earlier in this file.

function triggerPhoto(){ if(tempPhotos.length >= 4) return alert("Max 4 photos allowed."); document.getElementById("photoInput").click(); }
function triggerEditPhoto(){ if(editTempPhotos.length >= 3) return alert("Max 3 photos allowed."); document.getElementById("editPhotoInput").click(); }
function onPhotoPicked(event){ processFile(event, tempPhotos, renderPhotoPreview); }
function onEditPhotoPicked(event){ processFile(event, editTempPhotos, renderEditPhotoPreview); }
function processFile(event, arr, renderFunc) {
    const file = event.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image(); img.onload = () => {
            const canvas = document.createElement("canvas"); let scale = Math.min(1, 600/Math.max(img.width, img.height));
            canvas.width = img.width * scale; canvas.height = img.height * scale; canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            arr.push(canvas.toDataURL("image/jpeg", 0.6)); renderFunc();
        }; img.src = ev.target.result;
    }; reader.readAsDataURL(file); event.target.value = "";
}
function renderPhotoPreview() { document.getElementById("photoPreview").innerHTML = tempPhotos.map((src, i) => `<div class="thumb"><img src="${src}" onclick="openZoomImage('${src}')"/><button type="button" class="x" onclick="removeTempPhoto(${i})">x</button></div>`).join(''); }
function renderEditPhotoPreview() { document.getElementById("editPhotoPreview").innerHTML = editTempPhotos.map((src, i) => `<div class="thumb"><img src="${src}" onclick="openZoomImage('${src}')"/><button type="button" class="x" onclick="removeEditPhoto(${i})">x</button></div>`).join(''); }
function removeTempPhoto(i){ tempPhotos.splice(i,1); renderPhotoPreview(); }
function removeEditPhoto(i){ editTempPhotos.splice(i,1); renderEditPhotoPreview(); }
function clearTempPhotos(){ tempPhotos = []; renderPhotoPreview(); }

function getMapThumbnailBase64(x, y) {
    if(!canvasConfig.entry.img || !x || !y) return "";
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = 150; canvas.height = 150;
    ctx.drawImage(canvasConfig.entry.img, x - 75, y - 75, 150, 150, 0, 0, 150, 150);
    ctx.beginPath(); ctx.arc(75, 75, 14, 0, 2 * Math.PI); ctx.fillStyle = "#ef4444"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    return canvas.toDataURL("image/jpeg", 0.7);
}

async function saveDefect(){
    if(currentUser.role === "user" && currentUser.permission === "view") return alert("View Access Only.");
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value;
    if(!p || !t) return alert("Select valid Project and Tower.");
    if(tempPhotos.length < 2) return alert("Please add at least 2 Initial Photos.");
    
    const x = document.getElementById("entryCoordX").value; const y = document.getElementById("entryCoordY").value;
    if(canvasConfig.entry.active && (!x || !y)) return alert("Please pinpoint the defect location on the map.");

    const selectedSpecs = Array.from(document.querySelectorAll('.spec-chk:checked')).map(cb => cb.value).join(', ');
    if(!selectedSpecs) return alert("Please select at least one Specification.");

    const today = new Date().toISOString().slice(0,10); 
    let dueStr = document.getElementById("sladuedate").value;
    if(!dueStr) {
        let d = new Date(); d.setDate(d.getDate() + 10);
        dueStr = d.toISOString().slice(0,10);
    }

    let delay = "On Time"; if(new Date() > new Date(dueStr)) delay = Math.floor((new Date() - new Date(dueStr))/(1000*60*60*24))+" days";
    let mapThumb = getMapThumbnailBase64(x, y);

    const payload = {
        project: p, 
        tower: t, 
        floor: document.getElementById("floor").value, 
        flat: document.getElementById("flatNo").value,
        defectcategory: document.getElementById("defectcategory").value, 
        specificationmatrix: selectedSpecs, 
        engineeringremarks: document.getElementById("engineeringremarks").value, 
        riskspectrum: document.getElementById("riskspectrum").value,
        statusvector: document.getElementById("statusvector").value, 
        sladuedate: dueStr, 
        loggeddate: today,
        initialphotos: tempPhotos.join("|||"), 
        finalphotos: "", 
        mapx: x ? parseFloat(x).toFixed(2) : "0", 
        mapy: y ? parseFloat(y).toFixed(2) : "0", 
        delayaxis: delay, 
        closeddate: document.getElementById("statusvector").value === "Closed" ? today : "-",
        createdby: getFullName(currentUser), 
        closedby: document.getElementById("statusvector").value === "Closed" ? getFullName(currentUser) : "-", 
        mapthumbnail: mapThumb
    };

    if(!navigator.onLine) {
        let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; queue.push(payload); localStorage.setItem('qa_offline_queue', JSON.stringify(queue));
        alert("Offline Mode: Record saved locally. Will auto-sync when online.");
        document.getElementById("defectForm").reset(); clearTempPhotos(); clearMapCanvas(); sessionStorage.removeItem("csms_draft_form"); return;
    }

    try {
        const btn = document.getElementById("mainSubmitBtn"); if(btn) { btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Submitting..."; }
        
        const { error } = await supabaseClient.from('snagmanagement').insert([payload]);
        
        if(!error) { 
            alert("Record Logged Successfully!"); 
            document.getElementById("defectForm").reset(); 
            clearTempPhotos(); 
            clearMapCanvas(); 
            document.getElementById("specSelectText").innerText = "-- Select Specification --";
            sessionStorage.removeItem("csms_draft_form"); 
            await loadDefectsFromCloud(true); 
        } else throw error;
    } catch(err) { alert("Error: " + JSON.stringify(err.message || err)); }
    finally { const btn = document.getElementById("mainSubmitBtn"); if(btn) { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> SUBMIT ENTRY"; } }
}

async function syncOfflineData() {
    let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; if(queue.length === 0) return;
    let successCount = 0;
    for(let payload of queue) {
        try { 
            const { error } = await supabaseClient.from('snagmanagement').insert([payload]); 
            if(!error) successCount++; 
        } catch(e) {}
    }
    localStorage.removeItem('qa_offline_queue'); if(successCount > 0) { alert(`Synced ${successCount} offline records!`); loadDefectsFromCloud(false); }
}

// === FIX #4 === startAutoRefresh — now debounced (skips a cycle if user is
// actively saving) so auto-refresh doesn't race with hierarchy/category writes.
function startAutoRefresh() { 
    autoSyncInterval = setInterval(() => { 
        if(!navigator.onLine) return;
        const now = Date.now();
        if(now - _lastAutoRefreshAt < 20000) return;           // hard debounce floor
        if(_hierarchySaveInProgress || _categorySaveInProgress) {
            console.log("[AutoRefresh] Skipped: save in progress");
            return;
        }
        _lastAutoRefreshAt = now;
        loadDefectsFromCloud(true); 
        loadMapsFromCloud(); 
        loadHierarchyFromCloud();
        loadCategoriesFromCloud();
        flushHierarchyQueue();
        flushCategoryQueue();
    }, 25000); 
}

async function loadDefectsFromCloud(isBackground = false) {
    if(!navigator.onLine) return;
    try {
        const syncBadge = document.getElementById("liveSyncBadge");
        if(!isBackground && syncBadge) syncBadge.innerHTML = "<i class='fas fa-sync fa-spin'></i> Syncing...";
        
        const { data, error } = await supabaseClient
            .from('snagmanagement')
            .select('*')
            .order('id', { ascending: false });
        
        if (error) {
            console.error("Supabase API Error:", error.message);
            alert("Database Error: Cannot fetch records. Please check Supabase RLS Policies."); 
            return;
        }
        
        if(data) {
            defects = data.map((d, i) => {
                const mappedObj = { 
                    ...d, 
                    serial: data.length - i,
                    defectcategory: d.defectcategory || d.defecttype || d.type || d.category || d.categoryId,
                    specificationmatrix: d.specificationmatrix || d.defectList || d.specification || d.specId,
                    engineeringremarks: d.engineeringremarks || d.remark,
                    riskspectrum: d.riskspectrum || d.intensity || d.risk,
                    statusvector: d.statusvector || d.status,
                    sladuedate: d.sladuedate || d.dueDate || d.sla,
                    loggeddate: d.loggeddate || d.loggedDate || d.logged_date || d.loggedAt,
                    closeddate: d.closeddate || d.closedDate || d.closed_date || d.closedAt,
                    delayaxis: d.delayaxis || d.delay,
                    initialphotos: d.initialphotos || d.photos,
                    finalphotos: d.finalphotos || d.final_photos,
                    mapx: d.mapx || d.map_x,
                    mapy: d.mapy || d.map_y,
                    createdby: d.createdby || d.created_by || d.createdBy,
                    closedby: d.closedby || d.closed_by || d.closedBy,
                    mapthumbnail: d.mapthumbnail || d.map_thumbnail
                };
                mappedObj.initialPics = mappedObj.initialphotos ? mappedObj.initialphotos.split("|||").filter(Boolean) : [];
                mappedObj.finalPics = mappedObj.finalphotos ? mappedObj.finalphotos.split("|||").filter(Boolean) : [];
                return mappedObj;
            });
            
            refreshDropdowns(); 
            
            if(document.getElementById('report') && document.getElementById('report').classList.contains('active')) renderReportTable();
            if(document.getElementById('dashboard') && document.getElementById('dashboard').classList.contains('active')) {
                if(typeof renderCharts === 'function') renderCharts();
            }
            // FIX: On entry section, redraw red dots whenever defects refresh
            // Only redraw if map image is already loaded (avoid clearing during initial load)
            if(document.getElementById('entry') && document.getElementById('entry').classList.contains('active')) {
                if(canvasConfig.entry && canvasConfig.entry.img && canvasConfig.entry.ctx) {
                    drawCanvas('entry');
                }
            }
        }
    } catch(e) { console.error("Critical Error loading defects:", e); }
    finally { 
        if(document.getElementById("liveSyncBadge")) 
            document.getElementById("liveSyncBadge").innerHTML = "<i class='fas fa-check-circle'></i> LIVE SYNC"; 
    }
}

function renderReportTable(){
    const allowedProjects = getAllowedProjects(); 
    
    const pFiltSel = document.getElementById("reportProject");
    const pFilt = pFiltSel ? pFiltSel.value : "All";
    
    const tSel = document.getElementById("reportTower");
    
    if(tSel) {
        if(pFilt !== "All" && pFilt !== tSel.getAttribute("data-proj")) {
            tSel.innerHTML = "<option value='All'>All Towers</option>";
            const allowedTowers = getAllowedTowers(pFilt);
            allowedTowers.forEach(t => tSel.appendChild(new Option(t, t)));
            tSel.setAttribute("data-proj", pFilt);
        } else if (pFilt === "All" && tSel.getAttribute("data-proj") !== "All") {
            tSel.innerHTML = "<option value='All'>All Towers</option>";
            tSel.setAttribute("data-proj", "All");
        }
    }

    const tFilt = tSel ? tSel.value : "All";
    const uSel = document.getElementById("reportCreatedBy");
    const userFilt = uSel ? uSel.value : "All";
    const statSel = document.getElementById("reportStatus");
    const statFilt = statSel ? statSel.value : "All";
    const dateFromEl = document.getElementById("reportDateFrom");
    const dateFrom = dateFromEl ? dateFromEl.value : "";
    const dateToEl = document.getElementById("reportDateTo");
    const dateTo = dateToEl ? dateToEl.value : "";

    filteredReportData = (defects || []).filter(d => {
        let match = true;
        
        const dProj = String(d.project || "").trim();
        const dTow = String(d.tower || "").trim();
        const dUser = String(d.createdby || "").trim();
        const dStat = String(d.statusvector || "").trim();
        const dLog = d.loggeddate || "";

        if(currentUser && currentUser.role !== "admin") {
            const hasProjectAccess = allowedProjects.some(p => p.toLowerCase() === dProj.toLowerCase());
            if(!hasProjectAccess) match = false;
        }
        
        if(pFilt !== "All" && dProj.toLowerCase() !== pFilt.toLowerCase()) match = false;
        if(tFilt !== "All" && dTow.toLowerCase() !== tFilt.toLowerCase()) match = false;
        if(userFilt !== "All" && dUser.toLowerCase() !== userFilt.toLowerCase()) match = false;
        if(statFilt !== "All" && dStat.toLowerCase() !== statFilt.toLowerCase()) match = false;
        
        if(dateFrom && dLog && new Date(dLog) < new Date(dateFrom)) match = false;
        if(dateTo && dLog && new Date(dLog) > new Date(dateTo)) match = false;
        
        return match;
    });
    
    const tableHead = document.querySelector("#defectsTable thead");
    if(tableHead) tableHead.innerHTML = _reportHeaderRow();
    const tableBody = document.querySelector("#defectsTable tbody");
    if(tableBody) {
        if(filteredReportData.length === 0) {
             tableBody.innerHTML = `<tr><td colspan="${REPORT_HEADER_LABELS.length}" style="text-align:center;">No records found matching criteria.</td></tr>`;
        } else {
             tableBody.innerHTML = generateTableRowsHtml(filteredReportData);
        }
    }
}

const REPORT_HEADER_LABELS = ["Sl No","Project Scope","Tower","Floor Vector","Flat/Unit","Defect Category","Specification Matrix","Engineering Remarks","Map Location","Created By","Closed By","Assigned To","Risk Spectrum","Status Vector","Logged Date","SLA Due Date","Closed Date","Delay Axis","Initial Photos","Final Photos","Actions"];
function _reportHeaderRow(){ return "<tr>" + REPORT_HEADER_LABELS.map(h => `<th>${h}</th>`).join("") + "</tr>"; }

function generateTableRowsHtml(dataArray) {
    const canEdit = currentUser && (currentUser.role === "admin" || currentUser.permission === "edit");
    return dataArray.map(d => {
        const initPics = Array.isArray(d.initialPics) ? d.initialPics.filter(p => p && String(p).trim() !== "") : [];
        const finPics = Array.isArray(d.finalPics) ? d.finalPics.filter(p => p && String(p).trim() !== "") : [];
        
        const initialHtml = `<div class="img-grid-cell">${initPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        const finalHtml = `<div class="img-grid-cell">${finPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        
        const _assignList = d.assignedto ? String(d.assignedto).split('|').map(s => s.trim()).filter(Boolean) : [];
        const _isCommon = _assignList.length === 0;
        const _meEmail = (currentUser && currentUser.id) ? String(currentUser.id).toLowerCase() : "";
        const _meName = (currentUser && currentUser.firstName && currentUser.lastName) ? (currentUser.firstName + " " + currentUser.lastName).toLowerCase() : "";
        const _isMine = _assignList.some(a => a.toLowerCase() === _meEmail || a.toLowerCase() === _meName);

        let actionHtml = `<span style="color:#94a3b8; font-size:11px;"><i class="fas fa-eye"></i> View</span>`;
        if(d.statusvector === "Closed") actionHtml = `<span style="color:#059669; font-weight:bold; font-size:11.5px; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display:inline-block;"><i class="fas fa-lock"></i> Closed</span>`;
        else if(canEdit) {
            const _clickable = currentUser.role === "admin" || _isCommon || _isMine;
            if(_clickable) {
                const _label = _isCommon ? "Common Action" : (_isMine ? "Your Action" : "Action");
                actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal('${d.id}')"><i class="fas fa-bolt"></i> ${_label}</button>`;
            } else {
                actionHtml = `<span style="color:#dc2626; font-size:11px; font-weight:700;" title="This task is assigned to another user"><i class="fas fa-ban"></i> Not your Task</span>`;
            }
        }
        
        let mapHtml = "Not Mapped"; 
        if(d.mapthumbnail) {
            mapHtml = `<img src="${d.mapthumbnail}" style="width:45px; height:45px; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${d.mapthumbnail}')" />`;
        } else if(d.mapx && d.mapy && d.mapx !== "0") {
            mapHtml = `X: ${d.mapx}, Y: ${d.mapy}`; 
        }
        
        const resolvedCategory = resolveCategoryName(d.defectcategory || "-");
        const resolvedSpec = resolveSpecificationName(d.specificationmatrix || "-");
        
        return `<tr>
                <td>${d.serial || "-"}</td><td><b>${d.project || "-"}</b></td><td>${d.tower || "-"}</td><td>${d.floor || "-"}</td><td>${d.flat || "-"}</td>
                <td style="color:#0284c7;"><b>${resolvedCategory}</b></td>
                <td>${resolvedSpec}</td>
                <td>${d.engineeringremarks || "-"}</td>
                <td>${mapHtml}</td><td><b>${d.createdby || "-"}</b></td><td><b>${d.closedby || "-"}</b></td>
                <td>${_isCommon ? '<span style="color:#0284c7; font-weight:600;">All Members</span>' : _assignList.join(', ')}</td>
                <td>${d.riskspectrum || "-"}</td><td><span class="locked-badge">${d.statusvector || "-"}</span></td>
                <td>${d.loggeddate || "-"}</td><td>${d.sladuedate || "-"}</td><td>${d.closeddate || "-"}</td><td>${d.delayaxis || "-"}</td>
                <td>${initialHtml}</td><td>${finalHtml}</td><td class="action-cell">${actionHtml}</td>
            </tr>`;
    }).join("");
}

function openEditModal(id) {
    if(currentUser.role === "user" && currentUser.permission === "view") return;
    const d = defects.find(x => x.id == id); if(!d) return;
    if(d.statusvector === "Closed") return alert("This defect has been closed and locked.");
    if(currentUser.role !== "admin" && typeof canCloseDefect === "function" && !canCloseDefect(d)) {
        if(typeof openDefectInfoModal === "function") return openDefectInfoModal(d);
        return alert("This defect is assigned to another user. You can only view it.");
    }

    document.getElementById("editDefectId").value = id; document.getElementById("editstatusvector").value = "Closed";
    
    const initPics = Array.isArray(d.initialPics) ? d.initialPics.filter(Boolean) : [];
    document.getElementById("editInitialPhotoWrap").innerHTML = initPics.map(p => `<div class="thumb"><img src="${p}" onclick="openZoomImage('${p}')"/></div>`).join('');
    
    editTempPhotos = Array.isArray(d.finalPics) ? [...d.finalPics.filter(Boolean)] : []; 
    renderEditPhotoPreview();

    const base64Img = floorMaps[`${d.project}_${d.tower}_${d.floor}_${d.flat}`] || floorMaps[`${d.project}_${d.tower}_${d.floor}`];
    if(base64Img && d.mapx && d.mapy) {
        canvasConfig.modal.marker = {x: parseFloat(d.mapx), y: parseFloat(d.mapy)};
        const img = new Image();
        img.crossOrigin = "anonymous"; // NEW: support Storage-hosted URLs (cross-origin)
        img.onload = () => { canvasConfig.modal.img = img; document.getElementById('modalCanvas').width = img.width; document.getElementById('modalCanvas').height = img.height; drawCanvas('modal'); };
        img.src = base64Img;
    } else { canvasConfig.modal.img = null; if(document.getElementById('modalCanvas') && document.getElementById('modalCanvas').getContext('2d')) document.getElementById('modalCanvas').getContext('2d').clearRect(0,0,100,100); }
    document.getElementById("editModal").style.display = "flex";
}
function closeEditModal() { document.getElementById("editModal").style.display = "none"; }

async function submitEditDefect() {
    const id = document.getElementById("editDefectId").value;
    const stat = document.getElementById("editstatusvector").value;
    if(stat === "Closed" && editTempPhotos.length === 0) return alert("Must add Final Verification Photo to close and lock the defect.");
    
    if(stat === "Closed") { 
        if(!confirm("Warning: Closing this defect will LOCK the record. Proceed?")) return; 
    }

    let payload = { statusvector: stat, finalphotos: editTempPhotos.join("|||"), closeddate: stat === "Closed" ? new Date().toISOString().slice(0,10) : "-" };
    if(stat === "Closed") payload.closedby = getFullName(currentUser);

    try {
        const btn = document.getElementById("editSubmitBtn"); if(btn) { btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving..."; }
        
        const { error } = await supabaseClient.from('snagmanagement').update(payload).eq('id', id);
        
        if(!error) { alert("Defect Updated Successfully!"); closeEditModal(); await loadDefectsFromCloud(false); } 
        else throw error;
    } catch(e) { alert("Network error. Update Failed: " + JSON.stringify(e.message || e)); }
    finally { const btn = document.getElementById("editSubmitBtn"); if(btn) { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Save Updates"; } }
}

function openZoomImage(url) { document.getElementById("zoomedImage").src = url; document.getElementById("imageZoomModal").style.display = "flex"; }
function closeImageZoom() { document.getElementById("imageZoomModal").style.display = "none"; }

function openDrillModal(title, data) {
    currentDrilldownData = data; document.getElementById("modalTitle").innerHTML = `<i class="fas fa-search-plus text-cyan"></i> Drill-Down: ${title} (${data.length})`;
    let html = generateTableRowsHtml(data); 
    const drillHead = document.querySelector("#drilldownTable thead");
    if(drillHead) drillHead.innerHTML = _reportHeaderRow();
    const drillBody = document.querySelector("#drilldownTable tbody");
    if(drillBody) drillBody.innerHTML = html; 
    document.getElementById("drilldownModal").style.display = "flex";
}
function closeDrillModal() { document.getElementById("drilldownModal").style.display = "none"; }

let chartsObj = {};
function renderCharts() {
    const allowedProjects = getAllowedProjects(); const filterProj = document.getElementById("dashboardProjectFilter").value; const filterAnalytic = document.getElementById("dashboardAnalyticFilter").value;
    const filteredData = (defects || []).filter(d => (currentUser.role === "admin" || allowedProjects.includes(d.project)) && (filterProj === "All" || d.project === filterProj));
    Object.keys(chartsObj).forEach(k => { if(chartsObj[k]) chartsObj[k].destroy(); });
    
    const projMap = {}; const statMap = { "Open": 0, "In Progress": 0, "Closed": 0 };
    filteredData.forEach(d => { projMap[d.project] = (projMap[d.project] || 0) + 1; if(statMap[d.statusvector]!==undefined) statMap[d.statusvector]++; });

    chartsObj.c1 = new Chart(document.getElementById("primaryChart"), { type: 'bar', data: { labels: Object.keys(projMap), datasets: [{ label: 'Total Defects', data: Object.values(projMap), backgroundColor: '#0284c7' }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(projMap)[elements[0].index], filteredData.filter(x=>x.project===Object.keys(projMap)[elements[0].index])); } }});
    chartsObj.c2 = new Chart(document.getElementById("statusChart"), { type: 'doughnut', data: { labels: Object.keys(statMap), datasets: [{ data: Object.values(statMap), backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(statMap)[elements[0].index], filteredData.filter(x=>x.statusvector===Object.keys(statMap)[elements[0].index])); } }});

    const tHead = document.getElementById("analyticsTableHeader");
    const tBody = document.getElementById("analyticsTableBody");
    let matrixData = {};

    if(filterAnalytic === "floor") {
        tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>FLAT</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.tower}_${d.floor}_${d.flat}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, f:d.floor, fl:d.flat, o:0, ip:0, c:0, tot:0 };
            if(d.statusvector === 'Open') matrixData[k].o++; if(d.statusvector === 'In Progress') matrixData[k].ip++; if(d.statusvector === 'Closed') matrixData[k].c++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td><td>${m.fl}</td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','Open')">${m.o}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','In Progress')">${m.ip}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','Closed')">${m.c}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','All')">${m.tot}</a></td></tr>`).join('');
    } 
    else if(filterAnalytic === "tower") {
        tHead.innerHTML = `<th>PROJECT NAME</th><th>TOWER REF</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>SUBTOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.tower}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, o:0, ip:0, c:0, tot:0 };
            if(d.statusvector === 'Open') matrixData[k].o++; if(d.statusvector === 'In Progress') matrixData[k].ip++; if(d.statusvector === 'Closed') matrixData[k].c++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','Open')">${m.o}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','In Progress')">${m.ip}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','Closed')">${m.c}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','All')">${m.tot}</a></td></tr>`).join('');
    }
    else if(filterAnalytic === "defect") {
        tHead.innerHTML = `<th>PROJECT TARGET</th><th>CLASSIFICATION CATEGORY</th><th>TOTAL COUNT</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.defectcategory}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.defectcategory, tot:0 };
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><a class="drill-link" onclick="openAnaDrillCat('${m.p}','${m.t}')">${m.tot}</a></td></tr>`).join('');
    }
    else if(filterAnalytic === "intensity") {
        tHead.innerHTML = `<th>PROJECT TARGET NAME</th><th>LOW RISK</th><th>MEDIUM RISK</th><th>HIGH RISK</th><th>TOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, l:0, m:0, h:0, tot:0 };
            if(d.riskspectrum === 'Low') matrixData[k].l++; if(d.riskspectrum === 'Medium') matrixData[k].m++; if(d.riskspectrum === 'High') matrixData[k].h++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','Low')">${m.l}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','Medium')">${m.m}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','High')">${m.h}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','All')">${m.tot}</a></td></tr>`).join('');
    }

    const anaMap = { "Low":0, "Medium":0, "High":0 }; filteredData.forEach(d => { if(anaMap[d.riskspectrum]!==undefined) anaMap[d.riskspectrum]++; });
    chartsObj.c3 = new Chart(document.getElementById("intensityChartCanvas"), { type: 'polarArea', data: { labels: Object.keys(anaMap), datasets: [{ data: Object.values(anaMap), backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444'] }] }, options: { responsive:true, maintainAspectRatio:false }});
    const catMap = {}; filteredData.forEach(d => catMap[d.defectcategory] = (catMap[d.defectcategory]||0)+1);
    chartsObj.c4 = new Chart(document.getElementById("categoryChartCanvas"), { type: 'bar', data: { labels: Object.keys(catMap), datasets: [{ label: 'Categories', data: Object.values(catMap), backgroundColor: '#8b5cf6' }] }, options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false }});
}

function openAnaDrillFloor(p,t,f,fl,stat) { const data = defects.filter(d=>d.project===p && d.tower===t && d.floor===f && d.flat===fl && (stat==="All"||d.statusvector===stat)); openDrillModal(`${p} - ${t} - ${stat}`, data); }
function openAnaDrillTower(p,t,stat) { const data = defects.filter(d=>d.project===p && d.tower===t && (stat==="All"||d.statusvector===stat)); openDrillModal(`${p} - ${t} - ${stat}`, data); }
function openAnaDrillCat(p,t) { const data = defects.filter(d=>d.project===p && d.defectcategory===t); openDrillModal(`${p} - ${t}`, data); }
function openAnaDrillRisk(p,risk) { const data = defects.filter(d=>d.project===p && (risk==="All"||d.riskspectrum===risk)); openDrillModal(`${p} - ${risk} Risk`, data); }

function renderAdminTables() {
    const hBody = document.querySelector("#hierarchyTable tbody");
    if(hBody) {
        let hHtml = "";
        Object.keys(structuralHierarchy).forEach(p => { 
            Object.keys(structuralHierarchy[p]).forEach(t => {
                Object.keys(structuralHierarchy[p][t]).forEach(f => {
                    hHtml += `<tr><td><b>${p}</b></td><td>${t}</td><td>${f}</td><td style="white-space:normal; max-width:200px;">${structuralHierarchy[p][t][f].join(", ")}</td><td><button class="action-icon-btn del-btn" onclick="delHierarchy('${p}','${t}','${f}')">Del Floor</button></td></tr>`;
                });
            }); 
        }); 
        hBody.innerHTML = hHtml;
    }
    const cBody = document.querySelector("#categoryTable tbody");
    if(cBody) cBody.innerHTML = Object.keys(defectMatrix).map(c => `<tr><td><b>${c}</b></td><td style="white-space:normal; max-width:200px;">${defectMatrix[c].join(", ")}</td><td><button class="action-icon-btn del-btn" onclick="delCategory('${c}')">Del Cat</button></td></tr>`).join('');
    
    renderMapTable();
}

function renderMapTable() {
    const fBody = document.querySelector("#floorMapTable tbody");
    if(fBody) {
        fBody.innerHTML = Object.keys(floorMaps).map(k => {
            const parts = k.split('_'); return `<tr><td>${parts[0]}</td><td>${parts[1]}</td><td>${parts[2]}</td><td><img src="${floorMaps[k]}" width="40" height="40" style="object-fit:cover; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${floorMaps[k]}')"></td><td><button class="action-icon-btn del-btn" onclick="delMap('${k}')">Del</button></td></tr>`;
        }).join('');
    }
}

async function saveHierarchy() {
    const p = document.getElementById("setupProjName").value.trim(); 
    const t = document.getElementById("setupTowerName").value.trim(); 
    const f = document.getElementById("setupFloorName").value.trim();
    const flats = document.getElementById("setupFlats").value.split(",").map(s=>s.trim()).filter(Boolean);
    
    if(!p || !t || !f || flats.length === 0) return alert("All fields are required including at least one unit/flat.");

    // === FIX #1 === Write-first ordering: push to Supabase BEFORE mutating local
    // state / UI so that if an auto-refresh fires it does not see stale local data.
    // Also raise the _hierarchySaveInProgress flag so concurrent realtime/auto-refresh
    // handlers skip loadHierarchyFromCloud() during this critical section.
    const btn = document.getElementById("btnSaveHierarchy");
    if(btn) { btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving..."; }
    _hierarchySaveInProgress = true;

    const row = { project: p, tower: t, floor: f, flats: flats.join(",") };
    let cloudOk = false;

    try {
        if(navigator.onLine) {
            const { error } = await supabaseClient.from('snag_hierarchy').upsert(
                [row],
                { onConflict: 'project,tower,floor' }
            );
            if(error) throw error;
            cloudOk = true;
        }
    } catch(err) {
        console.warn("Hierarchy cloud upsert failed:", err);
        // Queue for later so it isn't lost
        let queue = JSON.parse(localStorage.getItem('qa_hierarchy_queue')) || [];
        queue.push(row);
        localStorage.setItem('qa_hierarchy_queue', JSON.stringify(queue));
        csmsToast("Saved locally, cloud sync will retry.", "error");
    }

    // === FIX #1 === Now that cloud is confirmed (or safely queued), update local
    // in-memory state + localStorage + UI. This ordering guarantees local + cloud
    // are consistent by the time UI refreshes.
    if(!structuralHierarchy[p]) structuralHierarchy[p] = {}; 
    if(!structuralHierarchy[p][t]) structuralHierarchy[p][t] = {};
    structuralHierarchy[p][t][f] = flats;
    localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); 

    refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); 
    resetHierarchyForm();

    if(cloudOk) {
        csmsToast("Floor mapping saved & synced.", "success");
    } else if(!navigator.onLine) {
        let queue = JSON.parse(localStorage.getItem('qa_hierarchy_queue')) || [];
        queue.push(row);
        localStorage.setItem('qa_hierarchy_queue', JSON.stringify(queue));
        csmsToast("Offline: Floor mapping queued, will auto-sync.", "error");
    }

    if(btn) { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Save Floor"; }
    // Release the guard after a short debounce so realtime echo doesn't immediately re-fetch.
    setTimeout(() => { _hierarchySaveInProgress = false; }, 1500);
}
async function delHierarchy(p, t, f) { 
    if(confirm(`Delete Floor ${f} from ${t}?`)) { 
        // === FIX #1 === Delete cloud row FIRST, then local — otherwise realtime
        // reload can re-populate the local state before Supabase confirms delete.
        _hierarchySaveInProgress = true;
        try {
            if(navigator.onLine) {
                const { error } = await supabaseClient.from('snag_hierarchy').delete().eq('project', p).eq('tower', t).eq('floor', f);
                if(error) throw error;
            }
        } catch(e) { 
            console.warn("Cloud delete hierarchy failed:", e); 
            csmsToast("Cloud delete failed, removed locally only.", "error");
        }
        delete structuralHierarchy[p][t][f]; 
        if(Object.keys(structuralHierarchy[p][t]).length === 0) delete structuralHierarchy[p][t]; 
        if(Object.keys(structuralHierarchy[p]).length === 0) delete structuralHierarchy[p];
        localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); 
        refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes();
        setTimeout(() => { _hierarchySaveInProgress = false; }, 1500);
    } 
}
function resetHierarchyForm() { 
    document.getElementById("setupFloorName").value = "";
    document.getElementById("setupFlats").value = "";
}

async function saveCategory() {
    const c = document.getElementById("setupCatName").value.trim(); 
    const s = document.getElementById("setupSpecName").value.trim(); 
    
    if(!c || !s) return alert("Category and Spec are required.");

    // === FIX #1 === Cloud-first ordering + save-in-progress guard (mirrors saveHierarchy)
    const btn = document.getElementById("btnSaveCategory");
    if(btn) { btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving..."; }
    _categorySaveInProgress = true;

    const row = { category: c, spec: s };
    let cloudOk = false;

    try {
        if(navigator.onLine) {
            const { error } = await supabaseClient.from('snag_categories').upsert(
                [row],
                { onConflict: 'category,spec' }
            );
            if(error) throw error;
            cloudOk = true;
        }
    } catch(err) {
        console.warn("Category cloud upsert failed:", err);
        let queue = JSON.parse(localStorage.getItem('qa_category_queue')) || [];
        queue.push(row);
        localStorage.setItem('qa_category_queue', JSON.stringify(queue));
        csmsToast("Saved locally, cloud sync will retry.", "error");
    }

    // Now safe to update local state / UI
    if(!defectMatrix[c]) defectMatrix[c] = [];
    if(!defectMatrix[c].includes(s)) defectMatrix[c].push(s);
    localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); 

    try {
        let csmsSpecs = getSafeStorage("csms_specifications", getSafeStorage("specifications_list", []));
        const specExists = csmsSpecs.some(spec => {
            if (typeof spec === 'object' && spec !== null) { return spec.id === s || spec.name === s || spec.specId === s; } return spec === s;
        });
        if (!specExists) {
            csmsSpecs.push({ id: s, name: s, specId: s });
            localStorage.setItem("csms_specifications", JSON.stringify(csmsSpecs));
            localStorage.setItem("specifications_list", JSON.stringify(csmsSpecs));
        }

        let csmsCats = getSafeStorage("csms_categories", getSafeStorage("categories_list", []));
        const catExists = csmsCats.some(cat => {
            if (typeof cat === 'object' && cat !== null) { return cat.id === c || cat.name === c || cat.categoryId === c; } return cat === c;
        });
        if (!catExists) {
            csmsCats.push({ id: c, name: c, categoryId: c });
            localStorage.setItem("csms_categories", JSON.stringify(csmsCats));
            localStorage.setItem("categories_list", JSON.stringify(csmsCats));
        }
    } catch(err) { console.error("Format schema mapping synchronization error:", err); }

    refreshDropdowns(); renderAdminTables(); 
    document.getElementById("setupSpecName").value = ""; 

    if(cloudOk) csmsToast("Specification saved & synced.", "success");
    else if(!navigator.onLine) {
        let queue = JSON.parse(localStorage.getItem('qa_category_queue')) || [];
        queue.push(row);
        localStorage.setItem('qa_category_queue', JSON.stringify(queue));
        csmsToast("Offline: Spec queued, will auto-sync.", "error");
    }

    if(btn) { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Add Spec"; }
    setTimeout(() => { _categorySaveInProgress = false; }, 1500);
}
async function delCategory(c) { 
    if(confirm(`Delete Complete Category: ${c}?`)) { 
        // === FIX #1 === Cloud-first delete + guard to prevent realtime overwrite
        _categorySaveInProgress = true;
        try {
            if(navigator.onLine) {
                const { error } = await supabaseClient.from('snag_categories').delete().eq('category', c);
                if(error) throw error;
            }
        } catch(e) { 
            console.warn("Cloud delete category failed:", e); 
            csmsToast("Cloud delete failed, removed locally only.", "error");
        }
        delete defectMatrix[c]; 
        localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); 
        refreshDropdowns(); renderAdminTables(); 
        setTimeout(() => { _categorySaveInProgress = false; }, 1500);
    } 
}
function resetCategoryForm() { document.getElementById("categoryForm").reset(); }

// === FIX #1/#4 === loadMapsFromCloud — now SAFE-MERGES with local cache
// so an empty/errored cloud response never wipes locally cached maps.
async function loadMapsFromCloud() {
    if(!navigator.onLine) return false;
    try {
        const { data, error } = await supabaseClient.from('snag_maps').select('*');
        if(error) {
            console.warn("Map cloud sync error:", error.message);
            csmsToast("Map sync error (keeping local cache).", "error");
            return false;
        }
        if(data) {
            const legacyRows = [];  // rows still on base64 — will auto-migrate in background
            // MERGE: overlay cloud rows into existing floorMaps rather than replacing
            data.forEach(m => {
                const src = m.image_url || m.base64_image;
                if(src) floorMaps[m.map_key] = src;
                if(!m.image_url && m.base64_image) legacyRows.push(m);
            });
            // Cache to localStorage (skip huge base64 blobs to avoid quota errors)
            try {
                const trimmed = {};
                Object.keys(floorMaps).forEach(k => {
                    const v = floorMaps[k];
                    if(typeof v === 'string' && (v.startsWith('http') || v.length < 500000)) trimmed[k] = v;
                });
                localStorage.setItem("qa_floorMaps", JSON.stringify(trimmed));
            } catch(e) { console.warn("localStorage quota hit, cache skipped:", e); }
            mapsCloudLoaded = true;
            if(document.getElementById('setup') && document.getElementById('setup').classList.contains('active') && currentUser && currentUser.role === "admin") renderMapTable();

            if(currentUser && currentUser.role === "admin" && legacyRows.length > 0) {
                migrateLegacyMapsToStorage(legacyRows); // fire-and-forget
            }
            return true;
        }
        return false;
    } catch(e) { 
        console.error("Map sync exception:", e);
        csmsToast("Map sync failed (keeping local cache).", "error");
        return false;
    }
}

// === NEW: One-time background migration of legacy base64 maps → Storage ===
let _migrationInProgress = false;
async function migrateLegacyMapsToStorage(legacyRows) {
    if(_migrationInProgress) return;
    _migrationInProgress = true;
    console.log(`[MapMigration] Starting for ${legacyRows.length} legacy row(s)...`);
    for(const row of legacyRows) {
        try {
            if(!row.base64_image || !row.base64_image.startsWith('data:image')) continue;
            const publicUrl = await uploadMapToStorage(row.map_key, row.base64_image);
            const { error } = await supabaseClient
                .from('snag_maps')
                .update({ image_url: publicUrl, base64_image: null })
                .eq('map_key', row.map_key);
            if(error) { console.warn(`[MapMigration] Update failed for ${row.map_key}:`, error.message); continue; }
            floorMaps[row.map_key] = publicUrl;
            console.log(`[MapMigration] Migrated: ${row.map_key}`);
            // Small pause between uploads so we don't hammer the API
            await new Promise(r => setTimeout(r, 400));
        } catch(e) {
            console.warn(`[MapMigration] Skipped ${row.map_key}:`, e.message || e);
        }
    }
    console.log("[MapMigration] Done.");
    _migrationInProgress = false;
    // Refresh admin map table view if visible
    if(document.getElementById('setup') && document.getElementById('setup').classList.contains('active') && currentUser && currentUser.role === "admin") {
        renderMapTable();
    }
}

// === FIX #1 === Load Structural Hierarchy from Supabase with SAFE MERGE.
// Behaviour changes:
//  - Never wipes local hierarchy on empty cloud response or fetch error.
//  - Merges cloud rows INTO existing local structure (union, not replace).
//  - Skips reload while a local save is in progress (guard in caller).
//  - Persists merged result to localStorage as durable fallback.
async function loadHierarchyFromCloud() {
    if(!navigator.onLine) return false;
    if(_hierarchyLoadInProgress) return false;                     // debounce
    if(_hierarchySaveInProgress) { console.log("[Hierarchy] load skipped: save in progress"); return false; }
    _hierarchyLoadInProgress = true;
    try {
        const { data, error } = await supabaseClient.from('snag_hierarchy').select('*');
        if(error) {
            console.warn("Hierarchy cloud sync error:", error.message);
            csmsToast("Hierarchy sync error (keeping local copy).", "error");
            return false;
        }
        if(data && Array.isArray(data)) {
            // Build a canonical map from cloud rows
            const cloudMap = {};
            data.forEach(row => {
                if(!row.project || !row.tower || !row.floor) return;
                if(!cloudMap[row.project]) cloudMap[row.project] = {};
                if(!cloudMap[row.project][row.tower]) cloudMap[row.project][row.tower] = {};
                cloudMap[row.project][row.tower][row.floor] = (row.flats || "").split(",").map(s=>s.trim()).filter(Boolean);
            });

            const cloudProjectCount = Object.keys(cloudMap).length;

            if(cloudProjectCount === 0) {
                // Cloud is empty. Do NOT wipe local. Instead, if we have local data,
                // push it up (one-time bootstrap so it isn't lost on other devices).
                const localKeys = Object.keys(structuralHierarchy || {});
                if(localKeys.length > 0) {
                    const rows = [];
                    localKeys.forEach(p => {
                        Object.keys(structuralHierarchy[p]).forEach(t => {
                            Object.keys(structuralHierarchy[p][t]).forEach(f => {
                                rows.push({ project: p, tower: t, floor: f, flats: structuralHierarchy[p][t][f].join(",") });
                            });
                        });
                    });
                    if(rows.length > 0) {
                        try { await supabaseClient.from('snag_hierarchy').upsert(rows, { onConflict: 'project,tower,floor' }); }
                        catch(e) { console.warn("Initial hierarchy migration push failed:", e); }
                    }
                }
                // keep local as-is; still counts as a successful load
            } else {
                // === SAFE MERGE === Take cloud as authoritative, but overlay any
                // local-only entries that may not have synced yet (queued/offline).
                // We also keep any local queued row while it's waiting to flush.
                const merged = JSON.parse(JSON.stringify(cloudMap));
                const pendingQueue = JSON.parse(localStorage.getItem('qa_hierarchy_queue') || '[]');
                const pendingSet = new Set(pendingQueue.map(r => `${r.project}|${r.tower}|${r.floor}`));

                Object.keys(structuralHierarchy || {}).forEach(p => {
                    Object.keys(structuralHierarchy[p] || {}).forEach(t => {
                        Object.keys(structuralHierarchy[p][t] || {}).forEach(f => {
                            const key = `${p}|${t}|${f}`;
                            const existsInCloud = merged[p] && merged[p][t] && merged[p][t][f];
                            // Preserve local row only when:
                            //   (a) it's in the pending write queue (not yet synced), OR
                            //   (b) something is currently being saved locally (paranoia)
                            if(!existsInCloud && (pendingSet.has(key) || _hierarchySaveInProgress)) {
                                if(!merged[p]) merged[p] = {};
                                if(!merged[p][t]) merged[p][t] = {};
                                merged[p][t][f] = structuralHierarchy[p][t][f];
                            }
                        });
                    });
                });

                structuralHierarchy = merged;
                try { localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); } catch(e) {}
            }
            hierarchyCloudLoaded = true;
            await flushHierarchyQueue();
            return true;
        }
        return false;
    } catch(e) {
        console.error("Hierarchy sync exception:", e);
        csmsToast("Hierarchy sync failed (keeping local copy).", "error");
        return false;
    } finally {
        _hierarchyLoadInProgress = false;
    }
}

// === FIX #1/#4 === Load Defect Categories & Specs with SAFE MERGE (same
// contract as loadHierarchyFromCloud — never wipe local on empty/error).
async function loadCategoriesFromCloud() {
    if(!navigator.onLine) return false;
    if(_categoryLoadInProgress) return false;
    if(_categorySaveInProgress) { console.log("[Categories] load skipped: save in progress"); return false; }
    _categoryLoadInProgress = true;
    try {
        const { data, error } = await supabaseClient.from('snag_categories').select('*');
        if(error) {
            console.warn("Category cloud sync error:", error.message);
            csmsToast("Category sync error (keeping local copy).", "error");
            return false;
        }
        if(data && Array.isArray(data)) {
            const cloudMap = {};
            data.forEach(row => {
                if(!row.category || !row.spec) return;
                if(!cloudMap[row.category]) cloudMap[row.category] = [];
                if(!cloudMap[row.category].includes(row.spec)) cloudMap[row.category].push(row.spec);
            });

            if(Object.keys(cloudMap).length === 0) {
                // Bootstrap: push local defectMatrix up if cloud is empty; do NOT wipe local.
                const rows = [];
                Object.keys(defectMatrix || {}).forEach(c => {
                    (defectMatrix[c] || []).forEach(s => rows.push({ category: c, spec: s }));
                });
                if(rows.length > 0) {
                    try { await supabaseClient.from('snag_categories').upsert(rows, { onConflict: 'category,spec' }); }
                    catch(e) { console.warn("Initial categories migration push failed:", e); }
                }
            } else {
                // MERGE — take cloud, then union in any pending queue items still to flush
                const merged = JSON.parse(JSON.stringify(cloudMap));
                const pendingQueue = JSON.parse(localStorage.getItem('qa_category_queue') || '[]');
                pendingQueue.forEach(r => {
                    if(!r.category || !r.spec) return;
                    if(!merged[r.category]) merged[r.category] = [];
                    if(!merged[r.category].includes(r.spec)) merged[r.category].push(r.spec);
                });
                defectMatrix = merged;
                try { localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); } catch(e) {}
            }
            categoriesCloudLoaded = true;
            await flushCategoryQueue();
            return true;
        }
        return false;
    } catch(e) {
        console.error("Category sync exception:", e);
        csmsToast("Category sync failed (keeping local copy).", "error");
        return false;
    } finally {
        _categoryLoadInProgress = false;
    }
}

// === NEW: Flush queued offline hierarchy/category writes on reconnect ===
async function flushHierarchyQueue() {
    if(!navigator.onLine) return;
    let queue = JSON.parse(localStorage.getItem('qa_hierarchy_queue')) || [];
    if(queue.length === 0) return;
    try {
        const { error } = await supabaseClient.from('snag_hierarchy').upsert(queue, { onConflict: 'project,tower,floor' });
        if(!error) localStorage.removeItem('qa_hierarchy_queue');
    } catch(e) { console.warn("Flush hierarchy queue failed:", e); }
}
async function flushCategoryQueue() {
    if(!navigator.onLine) return;
    let queue = JSON.parse(localStorage.getItem('qa_category_queue')) || [];
    if(queue.length === 0) return;
    try {
        const { error } = await supabaseClient.from('snag_categories').upsert(queue, { onConflict: 'category,spec' });
        if(!error) localStorage.removeItem('qa_category_queue');
    } catch(e) { console.warn("Flush category queue failed:", e); }
}


function populateMapSetupTowers() { const p = document.getElementById("mapSetupProject").value; const tSel = document.getElementById("mapSetupTower"); tSel.innerHTML = '<option value="">Tower</option>'; if(p && structuralHierarchy[p]) Object.keys(structuralHierarchy[p]).forEach(t => tSel.appendChild(new Option(t, t))); }
function populateMapSetupFloors() { const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const fSel = document.getElementById("mapSetupFloor"); fSel.innerHTML = '<option value="">Floor</option>'; if(p && t && structuralHierarchy[p][t]) Object.keys(structuralHierarchy[p][t]).forEach(f => fSel.appendChild(new Option(f, f))); }

async function previewMapDrawing(e) {
    const file = e.target.files[0]; if(!file) return; 
    const btn = document.getElementById("btnSubmitMap");
    btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Processing File...";

    try {
        if(file.type === "application/pdf") {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                const typedarray = new Uint8Array(this.result);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                const page = await pdf.getPage(1); 
                const viewport = page.getViewport({ scale: 2.0 }); 
                
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width; canvas.height = viewport.height;
                const ctx = canvas.getContext("2d");
                
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                document.getElementById("tempMapBase64").value = canvas.toDataURL("image/jpeg", 0.7);
                btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend";
                alert("PDF Processed Successfully! You can now submit it.");
            };
            fileReader.readAsArrayBuffer(file);
        } else {
            const reader = new FileReader(); 
            reader.onload = ev => { 
                const img = new Image(); img.onload = () => { 
                    const canvas = document.createElement("canvas"); let scale = Math.min(1, 1200/Math.max(img.width, img.height)); 
                    canvas.width = img.width * scale; canvas.height = img.height * scale; canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height); 
                    document.getElementById("tempMapBase64").value = canvas.toDataURL("image/jpeg", 0.7); 
                    btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend";
                }; 
                img.src = ev.target.result; 
            }; 
            reader.readAsDataURL(file);
        }
    } catch(err) {
        alert("Error processing file.");
        btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend";
    }
}

// === NEW: Helper — sanitize map key for use as a Storage filename ===
function sanitizeMapKey(k) {
    // Storage keys me / allowed hai, but hum special chars ko safe rakhna chahte hain
    return String(k).replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// === NEW: Convert data-URL / base64 to Blob so we can upload to Storage ===
async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
}

// === NEW: Upload a floor-map image to Supabase Storage; returns public URL ===
async function uploadMapToStorage(mapKey, dataUrl) {
    const blob = await dataUrlToBlob(dataUrl);
    const filename = sanitizeMapKey(mapKey) + '.jpg';
    const { error } = await supabaseClient.storage
        .from('snag-maps')
        .upload(filename, blob, {
            contentType: blob.type || 'image/jpeg',
            upsert: true,
            cacheControl: '3600'
        });
    if(error) throw error;
    // Add a cache-buster so re-uploaded maps refresh on all devices
    const { data: urlData } = supabaseClient.storage.from('snag-maps').getPublicUrl(filename);
    if(!urlData || !urlData.publicUrl) throw new Error("Public URL not returned by Storage");
    return urlData.publicUrl + '?v=' + Date.now();
}

// === NEW: Delete a floor-map image from Supabase Storage ===
async function deleteMapFromStorage(mapKey) {
    const filename = sanitizeMapKey(mapKey) + '.jpg';
    try {
        await supabaseClient.storage.from('snag-maps').remove([filename]);
    } catch(e) { console.warn("Storage delete failed (safe to ignore if never uploaded):", e); }
}

async function submitMapDrawing() {
    const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const f = document.getElementById("mapSetupFloor").value; 
    const base64 = document.getElementById("tempMapBase64").value;
    if(!p || !t || !f || !base64) return alert("Select Project, Tower, Floor and upload an image/pdf first!");
    const mapKey = `${p}_${t}_${f}`;
    
    const btn = document.getElementById("btnSubmitMap");
    try {
        btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Uploading to Storage...";

        // NEW: Upload image bytes to Supabase Storage bucket (efficient — no more base64 in DB row)
        const publicUrl = await uploadMapToStorage(mapKey, base64);

        btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving reference...";

        // Store only the URL in the table (compact ~150 bytes vs ~1MB base64)
        // We explicitly set base64_image to null to purge any legacy value
        const payload = { map_key: mapKey, image_url: publicUrl, base64_image: null };
        const { error } = await supabaseClient.from('snag_maps').upsert([payload], { onConflict: 'map_key' });
        
        if(!error) { 
            floorMaps[mapKey] = publicUrl; 
            localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); 
            alert("Floor Map Successfully Uploaded to Storage & Saved!"); 
            renderMapTable(); 
            document.getElementById("tempMapBase64").value = ""; document.getElementById("mapSetupFile").value = "";
        } else throw error;
    } catch(err) { alert("Error saving map: " + JSON.stringify(err.message || err)); }
    finally { btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend"; }
}

async function delMap(k) { 
    if(!confirm("Delete Floor Map from Database?")) return;
    try {
        // Delete DB row first, then storage object
        const { error } = await supabaseClient.from('snag_maps').delete().eq('map_key', k);
        if(!error) {
            await deleteMapFromStorage(k);
            delete floorMaps[k]; localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); renderMapTable();
        }
    } catch(e) { console.error("Could not delete from backend", e); }
}

function toggleProjectRights() { document.getElementById("projectRightsContainer").style.display = (document.getElementById("suRole").value === "admin") ? "none" : "block"; }
function renderUserSetupCheckboxes() { 
    const cont = document.getElementById("projectCheckboxes"); if(!cont) return;
    let html = "";
    Object.keys(structuralHierarchy).forEach(p => { 
        Object.keys(structuralHierarchy[p]).forEach(t => {
            html += `<label><input type="checkbox" class="proj-chk" value="${p}_${t}"> <b>${p}</b> - ${t}</label>`;
        });
    });
    cont.innerHTML = html;
}
function saveSystemUser() {
    const fName = document.getElementById("suFirst").value.trim(); const lName = document.getElementById("suLast").value.trim(); const mName = document.getElementById("suMiddle").value.trim();
    const email = document.getElementById("suEmail").value.trim(); const pass = document.getElementById("suPass").value; const role = document.getElementById("suRole").value; const rights = document.getElementById("suRights").value; let selProjects = [];
    if(role === "admin") selProjects = ["All"]; else { document.querySelectorAll(".proj-chk:checked").forEach(cb => selProjects.push(cb.value)); if(selProjects.length === 0) return alert("Select at least one project/tower."); }
    
    const existIdx = USER_MATRIX.findIndex(u => u.id.toLowerCase() === email.toLowerCase()); 
    const newUser = { id: email, firstName: fName, middleName: mName, lastName: lName, pass: pass, role: role, projects: selProjects, permission: rights };
    
    if(existIdx >= 0) USER_MATRIX[existIdx] = newUser; else USER_MATRIX.push(newUser); 
    localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); alert("User Access Saved!"); resetUserForm(); renderUserTable(); refreshDropdowns();
}
function resetUserForm() {
    document.getElementById("suFirst").value = ""; document.getElementById("suLast").value = ""; document.getElementById("suMiddle").value = "";
    document.getElementById("suEmail").value = ""; document.getElementById("suPass").value = ""; document.getElementById("editUserKey").value = "";
    document.querySelectorAll(".proj-chk").forEach(cb => cb.checked = false); const saveBtn = document.getElementById("btnSaveUser"); if(saveBtn) saveBtn.innerHTML = "<i class='fas fa-user-plus'></i> Save User";
}
function editUser(email) {
    const u = USER_MATRIX.find(x => x.id === email); if(!u) return;
    document.getElementById("suFirst").value = u.firstName || ""; document.getElementById("suLast").value = u.lastName || ""; document.getElementById("suMiddle").value = u.middleName || "";
    document.getElementById("suEmail").value = u.id; document.getElementById("suPass").value = u.pass; document.getElementById("suRole").value = u.role; toggleProjectRights();
    document.getElementById("suRights").value = u.permission; document.getElementById("editUserKey").value = u.id;
    document.querySelectorAll(".proj-chk").forEach(cb => { if(u.projects.includes("All") || u.projects.includes(cb.value)) cb.checked = true; else cb.checked = false; });
    const saveBtn = document.getElementById("btnSaveUser"); if(saveBtn) saveBtn.innerHTML = "<i class='fas fa-save'></i> Update User";
}
function renderUserTable() {
    const tbody = document.querySelector("#usersTable tbody"); if(!tbody) return;
    tbody.innerHTML = USER_MATRIX.map(u => { return `<tr><td><b>${getFullName(u)}</b><br><small>${u.id}</small></td><td>${u.role.toUpperCase()}</td><td style="white-space:normal; max-width:150px;">${u.role === "admin" ? `<span class="tech-badge" style="background:#0284c7; color:white;">Global All</span>` : u.projects.join(", ")}</td><td>${u.permission === "edit" ? "Full" : "View"}</td><td>${u.id === currentUser.id ? "<i>(You)</i>" : `<button class="action-icon-btn edit-btn" onclick="editUser('${u.id}')">Edit</button><button class="action-icon-btn del-btn" onclick="deleteUser('${u.id}')">Del</button>`}</td></tr>`; }).join('');
}
function deleteUser(email) { if(confirm(`Delete access for ${email}?`)) { USER_MATRIX = USER_MATRIX.filter(u => u.id !== email); localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); renderUserTable(); } }

function openPasswordModal() { document.getElementById("profileEmailDisplay").innerText = getFullName(currentUser); document.getElementById("passwordModal").style.display = "flex"; }
function closePasswordModal() { document.getElementById("passwordModal").style.display = "none"; }
function changePassword() {
    const oldP = document.getElementById("oldPassword").value; const newP = document.getElementById("newPassword").value; if(oldP !== currentUser.pass) return alert("Incorrect current password!");
    const userIndex = USER_MATRIX.findIndex(u => u.id === currentUser.id);
    if(userIndex !== -1) { USER_MATRIX[userIndex].pass = newP; localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); currentUser.pass = newP; sessionStorage.setItem("qa_logged_in_user", JSON.stringify(currentUser)); alert("Password updated securely!"); closePasswordModal(); }
}

async function exportExcelWithPhotos(dataToExport) { 
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    
    const workbook = new ExcelJS.Workbook(); 
    const sheet = workbook.addWorksheet('CSMS Defect Report');
    
    sheet.columns = [ 
        { header: 'ID', key: 'serial', width: 8 }, { header: 'Project', key: 'project', width: 16 }, 
        { header: 'Tower', key: 'tower', width: 12 }, { header: 'Floor', key: 'floor', width: 12 }, 
        { header: 'Flat', key: 'flat', width: 12 }, { header: 'Category', key: 'defectcategory', width: 20 }, 
        { header: 'Specification', key: 'specificationmatrix', width: 25 }, { header: 'Remarks', key: 'engineeringremarks', width: 30 }, 
        { header: 'Created By', key: 'createdby', width: 18 }, { header: 'Closed By', key: 'closedby', width: 18 },
        { header: 'Assigned To', key: 'assignedto', width: 20 },
        { header: 'Risk', key: 'riskspectrum', width: 12 }, { header: 'Status', key: 'statusvector', width: 12 }, 
        { header: 'Logged Date', key: 'loggeddate', width: 15 }, { header: 'SLA Date', key: 'sladuedate', width: 15 }, 
        { header: 'Closed Date', key: 'closeddate', width: 15 }, { header: 'Delay', key: 'delayaxis', width: 12 },
        { header: 'Map Location View', key: 'map', width: 20 },
        { header: 'Initial Photo Evidence', key: 'initial', width: 20 },
        { header: 'Final Photo Evidence', key: 'final', width: 20 }
    ];
    
    sheet.columns.forEach(col => { col.alignment = { vertical: 'middle', wrapText: true }; });

    const hRow = sheet.getRow(1); 
    hRow.font = { bold: true, color: { argb: 'FFFFFF' } }; 
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    hRow.alignment = { vertical: 'middle', horizontal: 'center' };
    
    dataToExport.forEach((d) => { 
        const row = sheet.addRow({ ...d, assignedto: (d.assignedto ? String(d.assignedto).replace(/\|/g, ', ') : 'All Members'), map: "", initial: "", final: "" }); 
        row.height = 75; 
        
        const addImgGridToCell = (picsArray, colIdx) => {
            if(!picsArray || picsArray.length === 0) return;
            picsArray.forEach((base64Str, i) => {
                if(base64Str && base64Str.startsWith('data:image')) {
                    try {
                        const imageId = workbook.addImage({ base64: base64Str, extension: 'jpeg' });
                        let colOffset = (i % 2) * 0.48; 
                        let rowOffset = Math.floor(i / 2) * 0.48;
                        
                        sheet.addImage(imageId, {
                            tl: { col: colIdx - 1 + colOffset + 0.05, row: row.number - 1 + rowOffset + 0.05 },
                            ext: { width: 35, height: 35 }, 
                            editAs: 'oneCell'
                        });
                    } catch(e) {}
                }
            });
        };

        if(d.mapthumbnail) {
            try {
                const mapId = workbook.addImage({ base64: d.mapthumbnail, extension: 'jpeg' });
                sheet.addImage(mapId, { tl: { col: 17, row: row.number - 1 }, ext: { width: 70, height: 70 }, editAs: 'oneCell' });
            } catch(e) {}
        }
        addImgGridToCell(d.initialPics, 19);
        addImgGridToCell(d.finalPics, 20);
    });
    
    const buf = await workbook.xlsx.writeBuffer(); 
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `CSMS_Report_Detailed.xlsx`; a.click();
}

function exportPDF(dataToExport) {
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    const windowObj = window.open("", "", "width=1200,height=800");
    const style = `<style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #f8fafc; color: #334155; }
        h1 { text-align: center; color: #0f172a; border-bottom: 3px solid #0284c7; padding-bottom: 10px; margin-bottom: 30px; text-transform: uppercase; letter-spacing: 1px; }
        .defect-card { background: white; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 25px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); page-break-inside: avoid; }
        .defect-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
        .defect-id { font-size: 18px; font-weight: bold; color: #0284c7; }
        .status-badge { padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 12px; border: 1px solid #cbd5e1; text-transform: uppercase; }
        .grid-info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 15px; font-size: 13px; }
        .info-box { background: #f1f5f9; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; }
        .info-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; display: block; }
        .info-value { font-weight: 600; color: #0f172a; word-wrap: break-word; }
        .remarks-box { grid-column: span 4; background: #fffbeb; border: 1px solid #fde68a; }
        .media-section { display: grid; grid-template-columns: auto 1fr 1fr; gap: 15px; margin-top: 15px; }
        .media-box { border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; }
        .media-title { font-size: 12px; font-weight: 700; margin-bottom: 8px; text-align: center; color: #475569; }
        .img-grid { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .img-grid img { width: 90px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid #cbd5e1; }
        @media print {
            body { background: white; padding: 0; }
            .defect-card { box-shadow: none; border: 1px solid #94a3b8; margin-bottom: 20px; }
            .defect-card { page-break-inside: avoid; } 
        }
    </style>`;
    
    let html = `<h1>Consolidated Defect Audit Report</h1>`;
    
    dataToExport.forEach(d => {
        const initPics = (d.initialPics || []).map(src => `<img src="${src}" />`).join("");
        const finPics = (d.finalPics || []).map(src => `<img src="${src}" />`).join("");
        const mapHtml = d.mapthumbnail ? `<img src="${d.mapthumbnail}" style="width:90px; height:90px;"/>` : `<span style="font-size:12px;color:#94a3b8;">Not Mapped</span>`;
        
        let badgeColor = '#fef3c7'; 
        if (d.statusvector === 'Closed') badgeColor = '#d1fae5';
        
        html += `
        <div class="defect-card">
            <div class="defect-header">
                <div class="defect-id">Audit Ref: #${d.serial || 'N/A'}</div>
                <div class="status-badge" style="background:${badgeColor}">${d.statusvector}</div>
            </div>
            
            <div class="grid-info">
                <div class="info-box"><span class="info-label">Project</span><span class="info-value">${d.project || '-'}</span></div>
                <div class="info-box"><span class="info-label">Tower</span><span class="info-value">${d.tower || '-'}</span></div>
                <div class="info-box"><span class="info-label">Floor Vector</span><span class="info-value">${d.floor || '-'}</span></div>
                <div class="info-box"><span class="info-label">Flat / Unit</span><span class="info-value">${d.flat || '-'}</span></div>
                
                <div class="info-box"><span class="info-label">Category</span><span class="info-value">${d.defectcategory || '-'}</span></div>
                <div class="info-box"><span class="info-label">Specification Matrix</span><span class="info-value">${d.specificationmatrix || '-'}</span></div>
                <div class="info-box"><span class="info-label">Risk Spectrum</span><span class="info-value">${d.riskspectrum || '-'}</span></div>
                <div class="info-box"><span class="info-label">Delay Axis</span><span class="info-value">${d.delayaxis || '-'}</span></div>
                
                <div class="info-box"><span class="info-label">Created By</span><span class="info-value">${d.createdby || '-'}</span></div>
                <div class="info-box"><span class="info-label">Logged Date</span><span class="info-value">${d.loggeddate || '-'}</span></div>
                <div class="info-box"><span class="info-label">Closed By</span><span class="info-value">${d.closedby || '-'}</span></div>
                <div class="info-box"><span class="info-label">Closed Date</span><span class="info-value">${d.closeddate || '-'}</span></div>
                
                <div class="info-box remarks-box">
                    <span class="info-label">Engineering Remarks</span>
                    <span class="info-value">${d.engineeringremarks || 'No remarks provided.'}</span>
                </div>
            </div>
            
            <div class="media-section">
                <div class="media-box">
                    <div class="media-title">Location Map</div>
                    <div class="img-grid">${mapHtml}</div>
                </div>
                <div class="media-box">
                    <div class="media-title">Initial Evidence</div>
                    <div class="img-grid">${initPics || '<span style="font-size:12px;color:#94a3b8;">No Evidence</span>'}</div>
                </div>
                <div class="media-box">
                    <div class="media-title">Final Evidence</div>
                    <div class="img-grid">${finPics || '<span style="font-size:12px;color:#94a3b8;">No Evidence</span>'}</div>
                </div>
            </div>
        </div>`;
    });
    
    windowObj.document.write(style + html); 
    windowObj.document.close(); 
    
    setTimeout(() => { 
        windowObj.print(); 
    }, 1500);
}
