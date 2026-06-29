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

let canvasConfig = {
    entry: { ctx: null, img: null, scale: 1, marker: null, active: true },
    modal: { ctx: null, img: null, scale: 1, marker: null, active: false }
};

window.addEventListener('online', () => { document.getElementById('networkStatus').className = "network-badge online"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi"></i> Online'; syncOfflineData(); });
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

    supabaseClient.channel('public:snagmanagement').on('postgres_changes', { event: '*', schema: 'public', table: 'snagmanagement' }, payload => {
        if(navigator.onLine) {
            console.log("Realtime Sync Triggered", payload);
            loadDefectsFromCloud(true);
        }
    }).subscribe();

    // === NEW: Realtime listener for map updates (so other devices' uploads reflect instantly) ===
    supabaseClient.channel('public:snag_maps').on('postgres_changes', { event: '*', schema: 'public', table: 'snag_maps' }, payload => {
        if(navigator.onLine) {
            console.log("Map Sync Triggered", payload);
            loadMapsFromCloud().then(() => {
                // If user is on entry section and waiting for a map, retry
                if (pendingMapLoadKey || (document.getElementById('entry') && document.getElementById('entry').classList.contains('active'))) {
                    ensureMapLoaded();
                }
            });
        }
    }).subscribe();
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

// === UPGRADED: activateApp with strict map-ready sequencing ===
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

    // Step 1: ensure cloud data fully fetched (maps + defects) BEFORE restoring form
    await Promise.all([
        loadMapsFromCloud(),
        loadDefectsFromCloud(false)
    ]);

    // Step 2: restore form fields (project/tower/floor selections come back)
    restoreDraftState(); 
    
    // Step 3: explicitly trigger map load AFTER everything is in place.
    // Using requestAnimationFrame ensures canvas DOM is laid out (visible, has size).
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            ensureMapLoaded();
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
    
    if(window.event && window.event.currentTarget) window.event.currentTarget.classList.add("active");
    else {
        const btns = document.querySelectorAll(".nav-btn");
        btns.forEach(b => { if(b.getAttribute("onclick") && b.getAttribute("onclick").includes(`'${id}'`)) b.classList.add("active"); });
    }
    
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
    if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(structuralHierarchy); 
    return Array.from(new Set(currentUser.projects.map(p => p.split("_")[0]))); 
}

function getAllowedTowers(proj) { 
    if(!structuralHierarchy[proj]) return [];
    if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(structuralHierarchy[proj]); 
    return currentUser.projects.filter(p => p.startsWith(proj + "_")).map(p => p.split("_")[1]); 
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

// === UPGRADED: initCanvas - defensive against null ctx ===
function initCanvas(type) {
    const canvas = document.getElementById(`${type}Canvas`); if(!canvas) return;
    canvasConfig[type].ctx = canvas.getContext('2d');
    if(type === 'entry') {
        // Remove previous listener if any to avoid duplicates on re-init
        if (canvas._csmsBound) return;
        canvas._csmsBound = true;
        canvas.addEventListener("click", (e) => {
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
                if(d.project === p && d.tower === t && d.floor === f && d.statusvector !== 'Closed' && d.mapx && d.mapy && d.mapx !== "0") {
                    const dx = parseFloat(d.mapx);
                    const dy = parseFloat(d.mapy);
                    const dist = Math.sqrt(Math.pow(dx - x, 2) + Math.pow(dy - y, 2));
                    if(dist <= 15) {
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
        });
    }
}

function openDefectInfoModal(d) {
    const content = document.getElementById("defectInfoContent");
    const photos = Array.isArray(d.initialPics) && d.initialPics.length > 0 
        ? d.initialPics.map(src => `<img src="${src}" onclick="openZoomImage('${src}')" style="width:80px; height:80px; object-fit:cover; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition:transform 0.2s;"/>`).join(' ') 
        : '<span style="color:#94a3b8; font-size:12px;">No Evidence Found</span>';
    
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
            <p style="font-size:11px; color:#64748b; margin-top:5px;">(Click image to enlarge)</p>
        </div>
    `;
    document.getElementById("defectInfoModal").style.display = "flex";
}
function closeDefectInfoModal() {
    document.getElementById("defectInfoModal").style.display = "none";
}

// === UPGRADED: loadEntryMap (async, awaits image, returns success) ===
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

    // Defensive: also try fresh localStorage read (storage event might be lagging)
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

    // Re-init ctx if missing (defensive against any earlier failure)
    if(!canvasConfig.entry.ctx) {
        canvasConfig.entry.ctx = canvas.getContext('2d');
    }

    if (!base64Img) {
        // Map not found locally — remember and bail; caller (ensureMapLoaded) will retry via cloud
        return false;
    }

    if(warn) warn.style.display = "none"; 
    canvasConfig.entry.active = true;

    return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            canvasConfig.entry.img = img;
            canvas.width = img.width; 
            canvas.height = img.height;
            drawCanvas('entry');
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
    if(ok) { pendingMapLoadKey = null; return; }

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
            if(d.project === p && d.tower === t && d.floor === f && d.statusvector !== 'Closed' && d.mapx && d.mapy && d.mapx !== "0") {
                c.ctx.beginPath(); c.ctx.arc(d.mapx, d.mapy, 10, 0, 2 * Math.PI); c.ctx.fillStyle = "rgba(239, 68, 68, 0.85)"; c.ctx.fill(); c.ctx.lineWidth = 2; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke();
            }
        });
    }

    if(c.marker) { 
        c.ctx.beginPath(); c.ctx.arc(c.marker.x, c.marker.y, 14, 0, 2 * Math.PI); c.ctx.fillStyle = "#3b82f6"; c.ctx.fill(); c.ctx.lineWidth = 4; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke(); 
    }
}

function zoomCanvas(id, factor) { const type = id.replace('Canvas', ''); canvasConfig[type].scale *= factor; document.getElementById(id).style.transform = `scale(${canvasConfig[type].scale})`; }
function resetCanvas(id) { const type = id.replace('Canvas', ''); canvasConfig[type].scale = 1; document.getElementById(id).style.transform = `scale(1)`; }

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
    ctx.beginPath(); ctx.arc(75, 75, 10, 0, 2 * Math.PI); ctx.fillStyle = "#ef4444"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
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

function startAutoRefresh() { 
    autoSyncInterval = setInterval(() => { 
        if(navigator.onLine) { 
            loadDefectsFromCloud(true); 
            loadMapsFromCloud(); 
        } 
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
            if(document.getElementById('entry') && document.getElementById('entry').classList.contains('active')) drawCanvas('entry');
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
    
    const tableBody = document.querySelector("#defectsTable tbody");
    if(tableBody) {
        if(filteredReportData.length === 0) {
             tableBody.innerHTML = '<tr><td colspan="20" style="text-align:center;">No records found matching criteria.</td></tr>';
        } else {
             tableBody.innerHTML = generateTableRowsHtml(filteredReportData);
        }
    }
}

function generateTableRowsHtml(dataArray) {
    const canEdit = currentUser && (currentUser.role === "admin" || currentUser.permission === "edit");
    return dataArray.map(d => {
        const initPics = Array.isArray(d.initialPics) ? d.initialPics.filter(p => p && String(p).trim() !== "") : [];
        const finPics = Array.isArray(d.finalPics) ? d.finalPics.filter(p => p && String(p).trim() !== "") : [];
        
        const initialHtml = `<div class="img-grid-cell">${initPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        const finalHtml = `<div class="img-grid-cell">${finPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        
        let actionHtml = `<span style="color:#94a3b8; font-size:11px;"><i class="fas fa-eye"></i> View</span>`;
        if(d.statusvector === "Closed") actionHtml = `<span style="color:#059669; font-weight:bold; font-size:11.5px; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display:inline-block;"><i class="fas fa-lock"></i> Closed</span>`;
        else if(canEdit) actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal('${d.id}')"><i class="fas fa-bolt"></i> Action</button>`;
        
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

    document.getElementById("editDefectId").value = id; document.getElementById("editstatusvector").value = d.statusvector;
    
    const initPics = Array.isArray(d.initialPics) ? d.initialPics.filter(Boolean) : [];
    document.getElementById("editInitialPhotoWrap").innerHTML = initPics.map(p => `<div class="thumb"><img src="${p}" onclick="openZoomImage('${p}')"/></div>`).join('');
    
    editTempPhotos = Array.isArray(d.finalPics) ? [...d.finalPics.filter(Boolean)] : []; 
    renderEditPhotoPreview();

    const base64Img = floorMaps[`${d.project}_${d.tower}_${d.floor}`];
    if(base64Img && d.mapx && d.mapy) {
        canvasConfig.modal.marker = {x: parseFloat(d.mapx), y: parseFloat(d.mapy)};
        const img = new Image(); img.onload = () => { canvasConfig.modal.img = img; document.getElementById('modalCanvas').width = img.width; document.getElementById('modalCanvas').height = img.height; drawCanvas('modal'); };
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

function saveHierarchy() {
    const p = document.getElementById("setupProjName").value.trim(); 
    const t = document.getElementById("setupTowerName").value.trim(); 
    const f = document.getElementById("setupFloorName").value.trim();
    const flats = document.getElementById("setupFlats").value.split(",").map(s=>s.trim()).filter(Boolean);
    
    if(!p || !t || !f || flats.length === 0) return alert("All fields are required including at least one unit/flat.");

    if(!structuralHierarchy[p]) structuralHierarchy[p] = {}; 
    if(!structuralHierarchy[p][t]) structuralHierarchy[p][t] = {};
    
    structuralHierarchy[p][t][f] = flats;
    
    localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); 
    refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); 
    alert("Floor Mapping Saved Successfully!"); 
    resetHierarchyForm();
}
function delHierarchy(p, t, f) { 
    if(confirm(`Delete Floor ${f} from ${t}?`)) { 
        delete structuralHierarchy[p][t][f]; 
        if(Object.keys(structuralHierarchy[p][t]).length === 0) delete structuralHierarchy[p][t]; 
        if(Object.keys(structuralHierarchy[p]).length === 0) delete structuralHierarchy[p];
        localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); 
        refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes();
    } 
}
function resetHierarchyForm() { 
    document.getElementById("setupFloorName").value = "";
    document.getElementById("setupFlats").value = "";
}

function saveCategory() {
    const c = document.getElementById("setupCatName").value.trim(); 
    const s = document.getElementById("setupSpecName").value.trim(); 
    
    if(!c || !s) return alert("Category and Spec are required.");

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
    alert("Specification Added Successfully!"); 
    document.getElementById("setupSpecName").value = ""; 
}
function delCategory(c) { 
    if(confirm(`Delete Complete Category: ${c}?`)) { 
        delete defectMatrix[c]; 
        localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); 
        refreshDropdowns(); renderAdminTables(); 
    } 
}
function resetCategoryForm() { document.getElementById("categoryForm").reset(); }

// === UPGRADED: loadMapsFromCloud — now returns boolean success ===
async function loadMapsFromCloud() {
    if(!navigator.onLine) return false;
    try {
        const { data, error } = await supabaseClient.from('snag_maps').select('*');
        if(error) {
            console.warn("Map cloud sync error:", error.message);
            return false;
        }
        if(data) {
            data.forEach(m => { floorMaps[m.map_key] = m.base64_image; });
            localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps));
            mapsCloudLoaded = true;
            if(document.getElementById('setup') && document.getElementById('setup').classList.contains('active') && currentUser && currentUser.role === "admin") renderMapTable();
            return true;
        }
        return false;
    } catch(e) { 
        console.error("Map sync exception:", e); 
        return false;
    }
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

async function submitMapDrawing() {
    const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const f = document.getElementById("mapSetupFloor").value; 
    const base64 = document.getElementById("tempMapBase64").value;
    if(!p || !t || !f || !base64) return alert("Select Project, Tower, Floor and upload an image/pdf first!");
    const mapKey = `${p}_${t}_${f}`;
    
    try {
        const btn = document.getElementById("btnSubmitMap"); btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Submitting...";
        const payload = { map_key: mapKey, base64_image: base64 };
        const { error } = await supabaseClient.from('snag_maps').upsert([payload], { onConflict: 'map_key' });
        
        if(!error) { 
            floorMaps[mapKey] = base64; localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); 
            alert("Floor Map Successfully Saved to Backend!"); 
            renderMapTable(); 
            document.getElementById("tempMapBase64").value = ""; document.getElementById("mapSetupFile").value = "";
        } else throw error;
    } catch(err) { alert("Error saving map: " + JSON.stringify(err.message || err)); }
    finally { const btn = document.getElementById("btnSubmitMap"); btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Submit Map to Backend"; }
}

async function delMap(k) { 
    if(!confirm("Delete Floor Map from Database?")) return;
    try {
        const { error } = await supabaseClient.from('snag_maps').delete().eq('map_key', k);
        if(!error) {
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
        const row = sheet.addRow({ ...d, map: "", initial: "", final: "" }); 
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
                sheet.addImage(mapId, { tl: { col: 16, row: row.number - 1 }, ext: { width: 70, height: 70 }, editAs: 'oneCell' });
            } catch(e) {}
        }
        addImgGridToCell(d.initialPics, 18);
        addImgGridToCell(d.finalPics, 19);
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