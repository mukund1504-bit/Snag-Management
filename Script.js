// ====== SUPABASE SYSTEM PRODUCTION ENDPOINT CONFIGURATION ======
const SUPABASE_URL = "https://vkvyzzxplzrpgiouopbx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdnl6enhwbHpycGdpb3VvcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzM3ODMsImV4cCI6MjA5Nzg0OTc4M30.n3cBqWQ4SD5LpcdLiu4G5mgF0YzFzCZrik80MLLXBzk";

const DEFAULT_USERS = [
    { id: "Mukund1504@gmail.com", firstName: "Mukund", middleName: "", lastName: "Admin", pass: "Abc1504@", role: "admin", projects: ["All"], permission: "edit" }
];
let USER_MATRIX = JSON.parse(localStorage.getItem("qa_users")) || DEFAULT_USERS;

let currentUser = null;
let defects = [];
let filteredReportData = [];
let tempPhotos = []; 
let editTempPhotos = []; 
let currentDrilldownData = []; 
let autoSyncInterval;

let structuralHierarchy = JSON.parse(localStorage.getItem("qa_strict_hierarchy")) || {
    "Fragrance": { "Tower-A": ["GF", "1st Floor", "2nd Floor"], "Tower-B": ["GF", "1st Floor"] },
    "Eutopia": { "B1": ["Basement", "GF"], "STP": ["Area-1"] }
};

let defectMatrix = JSON.parse(localStorage.getItem("qa_defectMatrix")) || {
    "RCC Structure": ["Level uneven", "Honeycomb", "Crack Shown", "Poor Quality"],
    "Plumbing Work": ["Leak", "Broken", "Clogging"]
};

let floorMaps = JSON.parse(localStorage.getItem("qa_floorMaps")) || {};

let hubConfig = JSON.parse(localStorage.getItem("csms_hub_config")) || {
    aboutTitle: "About CSMS System",
    aboutDesc: "Construction Snag Management System (CSMS) provides centralized enterprise engineering tracking mechanisms designed to minimize construction liability, accelerate compliance checking, and structure site-wide inspection analytics efficiently.",
    productDesc: "Equipped with real-time digital coordinate blueprint mapping capabilities, interactive multi-photo structural logs, encrypted credential systems, and deep integration configurations matching advanced corporate standards.",
    whyDesc: "Our framework eliminates legacy offline documentation gaps by maintaining multi-tenant visibility layers, tracking precise SLA closure delays, and delivering crystal-clear graphical analytics dashboards directly onto your web ecosystem."
};

let canvasConfig = {
    entry: { ctx: null, img: null, scale: 1, marker: null, active: true },
    modal: { ctx: null, img: null, scale: 1, marker: null, active: false }
};

// NETWORK MONITORING
window.addEventListener('online', () => { document.getElementById('networkStatus').className = "network-badge online"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi"></i> Online'; syncOfflineData(); });
window.addEventListener('offline', () => { document.getElementById('networkStatus').className = "network-badge offline"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi-slash"></i> Offline'; });

window.addEventListener("DOMContentLoaded", () => {
    if(!navigator.onLine) { document.getElementById('networkStatus').className = "network-badge offline"; document.getElementById('networkStatus').innerHTML = '<i class="fas fa-wifi-slash"></i> Offline'; }
    const savedUser = sessionStorage.getItem("qa_logged_in_user");
    if(savedUser) { currentUser = JSON.parse(savedUser); activateApp(); }
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
function processLogout() { sessionStorage.removeItem("qa_logged_in_user"); location.reload(); }

function activateApp() {
    document.getElementById("loginOverlay").style.display = "none"; document.getElementById("appContainer").style.display = "block";
    document.getElementById("displayUserLabel").innerText = getFullName(currentUser);
    document.getElementById("profileNameDisplay").innerText = getFullName(currentUser);
    document.getElementById("profileRoleDisplay").innerText = currentUser.role.toUpperCase();

    if(currentUser.role !== "admin") { document.getElementById("navSetupBtn").style.display = "none"; }
    else { document.getElementById("adminModuleContainer").style.display = "block"; document.getElementById("superAdminSectionContainer").style.display = "grid"; }

    loadDynamicHubContent();
    document.getElementById("hierarchyConfigTextarea").value = JSON.stringify(structuralHierarchy, null, 2);

    refreshDropdowns(); initCanvas('entry'); initCanvas('modal');
    loadDefectsFromCloud(false); loadMapsFromCloud(); startAutoRefresh(); 
    
    // FULLY RESTORED ADMIN RENDER
    if(currentUser.role === "admin") { 
        renderAdminTables();
        renderUserSetupCheckboxes(); 
        renderUserTable(); 
    }
}

function switchHubSection(section) {
    document.getElementById("enterpriseLandingHub").style.display = "none";
    document.getElementById("workspaceContentModules").style.display = "block";
    if(section === 'control') showSection('entry', document.querySelectorAll('.nav-pill')[0]);
    if(section === 'matrix') showSection('report', document.querySelectorAll('.nav-pill')[1]);
    if(section === 'telemetry') showSection('dashboard', document.querySelectorAll('.nav-pill')[2]);
    if(section === 'profile') showSection('setup', document.querySelectorAll('.nav-pill')[3]);
}

function returnToHubPortal() {
    document.getElementById("workspaceContentModules").style.display = "none";
    document.getElementById("enterpriseLandingHub").style.display = "block";
    document.querySelectorAll('.nav-pill').forEach(b => b.classList.remove("active"));
}

function loadDynamicHubContent() {
    document.getElementById("lblAboutTitle").innerText = hubConfig.aboutTitle;
    document.getElementById("txtAboutDesc").innerText = hubConfig.aboutDesc;
    document.getElementById("txtProductDesc").innerText = hubConfig.productDesc;
    document.getElementById("txtWhyDesc").innerText = hubConfig.whyDesc;
    
    if(document.getElementById("cfgAboutTitle")) {
        document.getElementById("cfgAboutTitle").value = hubConfig.aboutTitle;
        document.getElementById("cfgAboutDesc").value = hubConfig.aboutDesc;
        document.getElementById("cfgProductDesc").value = hubConfig.productDesc;
        document.getElementById("cfgWhyDesc").value = hubConfig.whyDesc;
    }
}

function saveDynamicHubContent() {
    hubConfig.aboutTitle = document.getElementById("cfgAboutTitle").value;
    hubConfig.aboutDesc = document.getElementById("cfgAboutDesc").value;
    hubConfig.productDesc = document.getElementById("cfgProductDesc").value;
    hubConfig.whyDesc = document.getElementById("cfgWhyDesc").value;
    localStorage.setItem("csms_hub_config", JSON.stringify(hubConfig));
    loadDynamicHubContent();
    alert("Enterprise Hub Content Updated Successfully!");
}

function commitCustomHierarchyJSON() {
    try {
        const rawJson = document.getElementById("hierarchyConfigTextarea").value;
        structuralHierarchy = JSON.parse(rawJson);
        localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy));
        refreshDropdowns();
        renderAdminTables();
        renderUserSetupCheckboxes();
        alert("Structural Hierarchy successfully compiled and injected!");
    } catch(e) { alert("Invalid JSON Schema format. Please verify braces."); }
}

function showSection(id, element) {
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-pill").forEach(b => b.classList.remove("active"));
    const sec = document.getElementById(id); if(sec) sec.classList.add("active");
    if(element) element.classList.add("active"); else if (event && event.currentTarget) event.currentTarget.classList.add("active");
    
    if(id === 'report') renderReportTable();
    if(id === 'dashboard') renderCharts();
}

function getAllowedProjects() { if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(structuralHierarchy); return Array.from(new Set(currentUser.projects.map(p => p.split("_")[0]))); }
function getAllowedTowers(proj) { if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(structuralHierarchy[proj]); return currentUser.projects.filter(p => p.startsWith(proj + "_")).map(p => p.split("_")[1]); }

function refreshDropdowns() {
    const allowed = getAllowedProjects();
    ["project", "reportProject", "dashboardProjectFilter", "mapSetupProject"].forEach(id => {
        const el = document.getElementById(id); if(!el) return;
        el.innerHTML = (id.includes("report") || id.includes("dashboard")) ? "<option value='All'>All Authorized Projects</option>" : "<option value=''>-- Select Project --</option>";
        allowed.forEach(p => el.appendChild(new Option(p, p)));
    });
    const typeSel = document.getElementById("defectType");
    if(typeSel) { typeSel.innerHTML = "<option value=''>-- Select Category --</option>"; Object.keys(defectMatrix).forEach(type => typeSel.appendChild(new Option(type, type))); }
    
    const uSel = document.getElementById("reportCreatedBy");
    if(uSel) {
        uSel.innerHTML = "<option value='All'>All Users</option>";
        USER_MATRIX.forEach(u => uSel.appendChild(new Option(getFullName(u), getFullName(u))));
    }
    populateTowers();
}

function populateTowers() {
    const p = document.getElementById("project").value; const tSel = document.getElementById("tower");
    tSel.innerHTML = '<option value="">-- Select Tower --</option>';
    if(p && structuralHierarchy[p]) { const allowedTowers = getAllowedTowers(p); allowedTowers.forEach(t => tSel.appendChild(new Option(t, t))); }
    populateFloors();
}
function populateFloors() {
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value; const fSel = document.getElementById("floor");
    fSel.innerHTML = '<option value="">-- Select Floor --</option>';
    if(p && t && structuralHierarchy[p][t]) { structuralHierarchy[p][t].forEach(f => fSel.appendChild(new Option(f, f))); }
    document.getElementById("entryMapWarning").style.display = "none"; canvasConfig.entry.marker = null; drawCanvas('entry'); document.getElementById("entryCoordX").value = ""; document.getElementById("entryCoordY").value = "";
}
function populateDefectList() {
    const type = document.getElementById("defectType").value; const lSel = document.getElementById("defectList");
    lSel.innerHTML = '<option value="">-- Select Specification --</option>';
    if(defectMatrix[type]) defectMatrix[type].forEach(def => lSel.appendChild(new Option(def, def)));
}

function initCanvas(type) {
    const canvas = document.getElementById(`${type}Canvas`); if(!canvas) return;
    canvasConfig[type].ctx = canvas.getContext('2d');
    if(type === 'entry') {
        canvas.addEventListener("click", (e) => {
            if(!canvasConfig.entry.active) return;
            const rect = canvas.getBoundingClientRect(); const x = (e.clientX - rect.left) / canvasConfig.entry.scale; const y = (e.clientY - rect.top) / canvasConfig.entry.scale;
            canvasConfig.entry.marker = {x, y}; document.getElementById("entryCoordX").value = x; document.getElementById("entryCoordY").value = y; drawCanvas(type);
        });
    }
}
function loadEntryMap() {
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value; const f = document.getElementById("floor").value;
    const base64Img = floorMaps[`${p}_${t}_${f}`]; const warn = document.getElementById("entryMapWarning");
    if(base64Img) {
        warn.style.display = "none"; canvasConfig.entry.active = true;
        const img = new Image(); img.onload = () => { canvasConfig.entry.img = img; const canvas = document.getElementById('entryCanvas'); canvas.width = img.width; canvas.height = img.height; drawCanvas('entry'); }; img.src = base64Img;
    } else {
        warn.style.display = "block"; canvasConfig.entry.active = false; canvasConfig.entry.img = null; canvasConfig.entry.marker = null;
        if(canvasConfig.entry.ctx) canvasConfig.entry.ctx.clearRect(0, 0, document.getElementById('entryCanvas').width, document.getElementById('entryCanvas').height);
    }
}
function drawCanvas(type) {
    const c = canvasConfig[type]; const canvas = document.getElementById(`${type}Canvas`);
    if(!c.img || !c.ctx) return;
    c.ctx.clearRect(0, 0, canvas.width, canvas.height); 
    c.ctx.drawImage(c.img, 0, 0);
    if(type === 'entry') {
        const p = document.getElementById("project").value; const t = document.getElementById("tower").value; const f = document.getElementById("floor").value;
        defects.forEach(d => {
            if(d.project === p && d.tower === t && d.floor === f && d.status !== 'Closed' && d.map_x && d.map_y && d.map_x !== "0") {
                c.ctx.beginPath(); c.ctx.arc(d.map_x, d.map_y, 10, 0, 2 * Math.PI); c.ctx.fillStyle = "rgba(239, 68, 68, 0.85)"; c.ctx.fill(); c.ctx.lineWidth = 2; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke();
            }
        });
    }
    if(c.marker) { c.ctx.beginPath(); c.ctx.arc(c.marker.x, c.marker.y, 14, 0, 2 * Math.PI); c.ctx.fillStyle = "#3b82f6"; c.ctx.fill(); c.ctx.lineWidth = 4; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke(); }
}
function zoomCanvas(id, factor) { const type = id.replace('Canvas', ''); canvasConfig[type].scale *= factor; document.getElementById(id).style.transform = `scale(${canvasConfig[type].scale})`; }
function resetCanvas(id) { const type = id.replace('Canvas', ''); canvasConfig[type].scale = 1; document.getElementById(id).style.transform = `scale(1)`; }

// Photos Logic
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

async function uploadImageToSupabase(base64Str, prefix) {
    if (!base64Str || !base64Str.startsWith('data:image')) return base64Str;
    try {
        const res = await fetch(base64Str); const blob = await res.blob();
        const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/snag_management/${fileName}`;
        const uploadRes = await fetch(uploadUrl, { method: 'POST', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
        if (uploadRes.ok) return `${SUPABASE_URL}/storage/v1/object/public/snag_management/${fileName}`;
    } catch(e) { console.error("Upload error", e); }
    return base64Str; 
}

async function saveDefect(){
    if(currentUser.role === "user" && currentUser.permission === "view") return alert("View Access Only.");
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value;
    if(!p || !t) return alert("Select valid Project and Tower.");
    if(tempPhotos.length < 2) return alert("Please add at least 2 Initial Photos.");
    
    const x = document.getElementById("entryCoordX").value; const y = document.getElementById("entryCoordY").value;
    if(canvasConfig.entry.active && (!x || !y)) return alert("Please pinpoint the defect location on the map.");

    const today = new Date().toISOString().slice(0,10); const dueStr = document.getElementById("dueDate").value || null;
    let delay = "On Time"; if(dueStr && new Date() > new Date(dueStr)) delay = Math.floor((new Date() - new Date(dueStr))/(1000*60*60*24))+" days";

    let mapThumb = getMapThumbnailBase64(x, y);

    if(!navigator.onLine) {
        const payload = {
            project: p, tower: t, floor: document.getElementById("floor").value, flat: document.getElementById("flatNo").value,
            Type: document.getElementById("defectType").value, defectList: document.getElementById("defectList").value,
            remark: document.getElementById("remark").value, intensity: document.getElementById("intensity").value,
            status: document.getElementById("status").value, dueDate: dueStr, loggedDate: today,
            photos: tempPhotos.join("|||"), final_photos: "", 
            map_x: x ? parseFloat(x).toFixed(2) : "0", map_y: y ? parseFloat(y).toFixed(2) : "0", delay: delay, closedDate: document.getElementById("status").value === "Closed" ? today : "-",
            created_by: getFullName(currentUser), closed_by: document.getElementById("status").value === "Closed" ? getFullName(currentUser) : "-", map_thumbnail: mapThumb
        };
        let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; queue.push(payload); localStorage.setItem('qa_offline_queue', JSON.stringify(queue));
        alert("Offline Mode: Record saved locally. Will auto-sync when online.");
        document.getElementById("defectForm").reset(); clearTempPhotos(); canvasConfig.entry.marker = null; drawCanvas('entry'); return;
    }

    try {
        const btn = document.getElementById("mainSubmitBtn"); btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Processing...";
        let uploadedPhotos = [];
        for(let b64 of tempPhotos) { uploadedPhotos.push(await uploadImageToSupabase(b64, 'init')); }
        let uploadedThumb = await uploadImageToSupabase(mapThumb, 'map_thumb');

        const payload = {
            project: p, tower: t, floor: document.getElementById("floor").value, flat: document.getElementById("flatNo").value,
            Type: document.getElementById("defectType").value, defectList: document.getElementById("defectList").value,
            remark: document.getElementById("remark").value, intensity: document.getElementById("intensity").value,
            status: document.getElementById("status").value, dueDate: dueStr, loggedDate: today,
            photos: uploadedPhotos.join("|||"), final_photos: "", 
            map_x: x ? parseFloat(x).toFixed(2) : "0", map_y: y ? parseFloat(y).toFixed(2) : "0", delay: delay, closedDate: document.getElementById("status").value === "Closed" ? today : "-",
            created_by: getFullName(currentUser), closed_by: document.getElementById("status").value === "Closed" ? getFullName(currentUser) : "-", map_thumbnail: uploadedThumb
        };

        const res = await fetch(`${SUPABASE_URL}/rest/v1/snag_management`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if(res.ok) { alert("Record Logged Successfully!"); document.getElementById("defectForm").reset(); clearTempPhotos(); canvasConfig.entry.marker = null; drawCanvas('entry'); await loadDefectsFromCloud(true); } else throw await res.json();
    } catch(err) { alert("Error: " + JSON.stringify(err)); }
    finally { const btn = document.getElementById("mainSubmitBtn"); btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Commit Record to CSMS Server"; }
}

async function syncOfflineData() {
    let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; if(queue.length === 0) return;
    let successCount = 0;
    for(let payload of queue) {
        try { 
            if (payload.photos) {
                let pArr = payload.photos.split("|||"); let nArr = [];
                for(let b of pArr) nArr.push(await uploadImageToSupabase(b, 'init_sync'));
                payload.photos = nArr.join("|||");
            }
            if (payload.map_thumbnail) payload.map_thumbnail = await uploadImageToSupabase(payload.map_thumbnail, 'map_sync');

            const res = await fetch(`${SUPABASE_URL}/rest/v1/snag_management`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); 
            if(res.ok) successCount++; 
        } catch(e) { console.error("Sync error", e); }
    }
    localStorage.removeItem('qa_offline_queue'); if(successCount > 0) { alert(`Synced ${successCount} offline records!`); loadDefectsFromCloud(false); }
}

function startAutoRefresh() { autoSyncInterval = setInterval(() => { if(navigator.onLine) loadDefectsFromCloud(true); }, 25000); }

async function loadDefectsFromCloud(isBackground = false) {
    if(!navigator.onLine) return;
    try {
        if(!isBackground) document.getElementById("liveSyncBadge").innerHTML = "<i class='fas fa-sync fa-spin'></i> Loading...";
        const res = await fetch(`${SUPABASE_URL}/rest/v1/snag_management?select=*&order=id.desc&nocache=${Date.now()}`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }});
        if(res.ok) {
            const data = await res.json();
            defects = data.map((d, i) => ({ ...d, serial: data.length - i, initialPics: d.photos ? d.photos.split("|||") : [], finalPics: d.final_photos ? d.final_photos.split("|||") : [] }));
            if(document.getElementById('report').classList.contains('active')) renderReportTable();
            if(document.getElementById('dashboard').classList.contains('active')) renderCharts();
            if(document.getElementById('entry').classList.contains('active')) drawCanvas('entry');
        }
    } catch(e) { console.error(e); }
    finally { setTimeout(()=> document.getElementById("liveSyncBadge").innerHTML = "<i class='fas fa-check-circle'></i> LIVE SYNC", 1000); }
}

function generateTableRowsHtml(dataArray) {
    const canEdit = currentUser.role === "admin" || currentUser.permission === "edit";
    return dataArray.map(d => {
        const initialHtml = `<div class="img-grid-cell">${d.initialPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        const finalHtml = `<div class="img-grid-cell">${d.finalPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        
        let actionHtml = `<span style="color:#94a3b8; font-size:11px;"><i class="fas fa-eye"></i> View</span>`;
        if(d.status === "Closed") actionHtml = `<span style="color:#059669; font-weight:bold; font-size:11.5px; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display:inline-block;"><i class="fas fa-lock"></i> Closed</span>`;
        else if(canEdit) actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal(${d.id})"><i class="fas fa-bolt"></i> Action</button>`;
        
        let mapHtml = "Not Mapped"; 
        if(d.map_thumbnail) {
            mapHtml = `<img src="${d.map_thumbnail}" class="report-map-img" onclick="openZoomImage('${d.map_thumbnail}')" />`;
        } else if(d.map_x && d.map_y && d.map_x !== "0") {
            mapHtml = `X: ${d.map_x}, Y: ${d.map_y}`; 
        }
        
        return `<tr>
                <td>${d.serial}</td><td><b>${d.project}</b></td><td>${d.tower}</td><td>${d.floor}</td><td>${d.flat}</td>
                <td><b>${d.Type}</b></td><td>${d.defectList}</td><td>${d.remark || "-"}</td>
                <td>${mapHtml}</td><td><b>${d.created_by || "-"}</b></td><td><b>${d.closed_by || "-"}</b></td>
                <td>${d.intensity}</td><td><span class="locked-badge">${d.status}</span></td>
                <td>${d.loggedDate}</td><td>${d.dueDate || "-"}</td><td>${d.closedDate}</td><td>${d.delay}</td>
                <td>${initialHtml}</td><td>${finalHtml}</td><td class="action-cell">${actionHtml}</td>
            </tr>`;
    }).join("");
}

function renderReportTable(){
    const allowedProjects = getAllowedProjects(); 
    const pFilt = document.getElementById("reportProject").value;
    const tFilt = document.getElementById("reportTower") ? document.getElementById("reportTower").value : "All";
    const userFilt = document.getElementById("reportCreatedBy") ? document.getElementById("reportCreatedBy").value : "All";
    const statFilt = document.getElementById("reportStatus") ? document.getElementById("reportStatus").value : "All";
    const dateFrom = document.getElementById("reportDateFrom") ? document.getElementById("reportDateFrom").value : "";
    const dateTo = document.getElementById("reportDateTo") ? document.getElementById("reportDateTo").value : "";

    const tSel = document.getElementById("reportTower");
    if(pFilt !== "All" && pFilt !== tSel.getAttribute("data-proj")) {
        tSel.innerHTML = "<option value='All'>All Towers</option>";
        const allowedTowers = getAllowedTowers(pFilt);
        allowedTowers.forEach(t => tSel.appendChild(new Option(t, t)));
        tSel.setAttribute("data-proj", pFilt);
    } else if (pFilt === "All") {
        tSel.innerHTML = "<option value='All'>All Towers</option>";
        tSel.setAttribute("data-proj", "All");
    }

    filteredReportData = defects.filter(d => {
        let match = true;
        if(currentUser.role !== "admin" && !allowedProjects.includes(d.project)) match = false;
        if(pFilt !== "All" && d.project !== pFilt) match = false;
        if(tFilt !== "All" && d.tower !== tFilt) match = false;
        if(userFilt !== "All" && d.created_by !== userFilt) match = false;
        if(statFilt !== "All" && d.status !== statFilt) match = false;
        if(dateFrom && new Date(d.loggedDate) < new Date(dateFrom)) match = false;
        if(dateTo && new Date(d.loggedDate) > new Date(dateTo)) match = false;
        return match;
    });
    document.querySelector("#defectsTable tbody").innerHTML = generateTableRowsHtml(filteredReportData);
}

function openEditModal(id) {
    if(currentUser.role === "user" && currentUser.permission === "view") return;
    const d = defects.find(x => x.id === id); if(!d) return;
    if(d.status === "Closed") return alert("This defect has been closed and locked.");

    document.getElementById("editDefectId").value = id; document.getElementById("editStatus").value = d.status;
    document.getElementById("editInitialPhotoWrap").innerHTML = d.initialPics.map(p => `<div class="thumb"><img src="${p}" onclick="openZoomImage('${p}')"/></div>`).join('');
    editTempPhotos = [...d.finalPics]; renderEditPhotoPreview();

    const base64Img = floorMaps[`${d.project}_${d.tower}_${d.floor}`];
    if(base64Img && d.map_x && d.map_y) {
        canvasConfig.modal.marker = {x: parseFloat(d.map_x), y: parseFloat(d.map_y)};
        const img = new Image(); img.onload = () => { canvasConfig.modal.img = img; document.getElementById('modalCanvas').width = img.width; document.getElementById('modalCanvas').height = img.height; drawCanvas('modal'); };
        img.src = base64Img;
    } else { canvasConfig.modal.img = null; if(document.getElementById('modalCanvas').getContext('2d')) document.getElementById('modalCanvas').getContext('2d').clearRect(0,0,100,100); }
    document.getElementById("editModal").style.display = "flex";
}
function closeEditModal() { document.getElementById("editModal").style.display = "none"; }

async function submitEditDefect() {
    const id = parseInt(document.getElementById("editDefectId").value);
    const stat = document.getElementById("editStatus").value;
    if(stat === "Closed" && editTempPhotos.length === 0) return alert("Must add Final Verification Photo to close and lock the defect.");
    if(stat === "Closed") { if(!confirm("Warning: Closing this defect will LOCK the record and prevent further edits. Proceed?")) return; }

    const btn = document.getElementById("editSubmitBtn"); 
    try {
        btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Uploading...";
        let uploadedFinal = [];
        for (let b64 of editTempPhotos) { uploadedFinal.push(await uploadImageToSupabase(b64, 'final')); }

        let payload = { status: stat, final_photos: uploadedFinal.join("|||"), closedDate: stat === "Closed" ? new Date().toISOString().slice(0,10) : "-" };
        if(stat === "Closed") payload.closed_by = getFullName(currentUser);

        const finalUrl = SUPABASE_URL.includes('/rest/v1') ? `${SUPABASE_URL}/snag_management?id=eq.${id}` : `${SUPABASE_URL}/rest/v1/snag_management?id=eq.${id}`;
        const res = await fetch(finalUrl, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify(payload) });
        if(res.ok) { alert("Defect Updated Successfully!"); closeEditModal(); await loadDefectsFromCloud(false); } 
        else throw await res.json();
    } catch(e) { alert("Network error. Update Failed."); }
    finally { btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Save Updates"; }
}

function openZoomImage(url) { document.getElementById("zoomedImage").src = url; document.getElementById("imageZoomModal").style.display = "flex"; }
function closeImageZoom() { document.getElementById("imageZoomModal").style.display = "none"; }
function openDrillModal(title, data) { currentDrilldownData = data; document.getElementById("modalTitle").innerHTML = `<i class="fas fa-search-plus text-cyan"></i> Drill-Down: ${title} (${data.length})`; let html = generateTableRowsHtml(data); document.querySelector("#drilldownTable tbody").innerHTML = html; document.getElementById("drilldownModal").style.display = "flex"; }
function closeDrillModal() { document.getElementById("drilldownModal").style.display = "none"; }

let chartsObj = {};
function renderCharts() {
    const allowedProjects = getAllowedProjects(); const filterProj = document.getElementById("dashboardProjectFilter").value; const filterAnalytic = document.getElementById("dashboardAnalyticFilter").value;
    const filteredData = defects.filter(d => (currentUser.role === "admin" || allowedProjects.includes(d.project)) && (filterProj === "All" || d.project === filterProj));
    Object.keys(chartsObj).forEach(k => { if(chartsObj[k]) chartsObj[k].destroy(); });
    
    const projMap = {}; const statMap = { "Open": 0, "In Progress": 0, "Closed": 0 };
    filteredData.forEach(d => { projMap[d.project] = (projMap[d.project] || 0) + 1; if(statMap[d.status]!==undefined) statMap[d.status]++; });

    chartsObj.c1 = new Chart(document.getElementById("primaryChart"), { type: 'bar', data: { labels: Object.keys(projMap), datasets: [{ label: 'Total Defects', data: Object.values(projMap), backgroundColor: '#0284c7' }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(projMap)[elements[0].index], filteredData.filter(x=>x.project===Object.keys(projMap)[elements[0].index])); } }});
    chartsObj.c2 = new Chart(document.getElementById("statusChart"), { type: 'doughnut', data: { labels: Object.keys(statMap), datasets: [{ data: Object.values(statMap), backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(statMap)[elements[0].index], filteredData.filter(x=>x.status===Object.keys(statMap)[elements[0].index])); } }});

    const tHead = document.getElementById("analyticsTableHeader");
    const tBody = document.getElementById("analyticsTableBody");
    let matrixData = {};

    if(filterAnalytic === "floor") {
        tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>FLAT</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
        filteredData.forEach(d => { let k = `${d.project}_${d.tower}_${d.floor}_${d.flat}`; if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, f:d.floor, fl:d.flat, o:0, ip:0, c:0, tot:0 }; if(d.status === 'Open') matrixData[k].o++; if(d.status === 'In Progress') matrixData[k].ip++; if(d.status === 'Closed') matrixData[k].c++; matrixData[k].tot++; });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td><td>${m.fl}</td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','Open')">${m.o}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','In Progress')">${m.ip}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','Closed')">${m.c}</a></td><td><a class="drill-link" onclick="openAnaDrillFloor('${m.p}','${m.t}','${m.f}','${m.fl}','All')">${m.tot}</a></td></tr>`).join('');
    } 
    else if(filterAnalytic === "tower") {
        tHead.innerHTML = `<th>PROJECT NAME</th><th>TOWER REF</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>SUBTOTAL</th>`;
        filteredData.forEach(d => { let k = `${d.project}_${d.tower}`; if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, o:0, ip:0, c:0, tot:0 }; if(d.status === 'Open') matrixData[k].o++; if(d.status === 'In Progress') matrixData[k].ip++; if(d.status === 'Closed') matrixData[k].c++; matrixData[k].tot++; });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','Open')">${m.o}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','In Progress')">${m.ip}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','Closed')">${m.c}</a></td><td><a class="drill-link" onclick="openAnaDrillTower('${m.p}','${m.t}','All')">${m.tot}</a></td></tr>`).join('');
    }
    else if(filterAnalytic === "defect") {
        tHead.innerHTML = `<th>PROJECT TARGET</th><th>CLASSIFICATION CATEGORY</th><th>TOTAL COUNT</th>`;
        filteredData.forEach(d => { let k = `${d.project}_${d.Type}`; if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.Type, tot:0 }; matrixData[k].tot++; });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><a class="drill-link" onclick="openAnaDrillCat('${m.p}','${m.t}')">${m.tot}</a></td></tr>`).join('');
    }
    else if(filterAnalytic === "intensity") {
        tHead.innerHTML = `<th>PROJECT TARGET NAME</th><th>LOW RISK</th><th>MEDIUM RISK</th><th>HIGH RISK</th><th>TOTAL</th>`;
        filteredData.forEach(d => { let k = `${d.project}`; if(!matrixData[k]) matrixData[k] = { p:d.project, l:0, m:0, h:0, tot:0 }; if(d.intensity === 'Low') matrixData[k].l++; if(d.intensity === 'Medium') matrixData[k].m++; if(d.intensity === 'High') matrixData[k].h++; matrixData[k].tot++; });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','Low')">${m.l}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','Medium')">${m.m}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','High')">${m.h}</a></td><td><a class="drill-link" onclick="openAnaDrillRisk('${m.p}','All')">${m.tot}</a></td></tr>`).join('');
    }

    const anaMap = { "Low":0, "Medium":0, "High":0 }; filteredData.forEach(d => { if(anaMap[d.intensity]!==undefined) anaMap[d.intensity]++; });
    chartsObj.c3 = new Chart(document.getElementById("intensityChartCanvas"), { type: 'polarArea', data: { labels: Object.keys(anaMap), datasets: [{ data: Object.values(anaMap), backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444'] }] }, options: { responsive:true, maintainAspectRatio:false }});
    const catMap = {}; filteredData.forEach(d => catMap[d.Type] = (catMap[d.Type]||0)+1);
    chartsObj.c4 = new Chart(document.getElementById("categoryChartCanvas"), { type: 'bar', data: { labels: Object.keys(catMap), datasets: [{ label: 'Categories', data: Object.values(catMap), backgroundColor: '#8b5cf6' }] }, options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false }});
}

function openAnaDrillFloor(p,t,f,fl,stat) { const data = defects.filter(d=>d.project===p && d.tower===t && d.floor===f && d.flat===fl && (stat==="All"||d.status===stat)); openDrillModal(`${p} - ${t} - ${stat}`, data); }
function openAnaDrillTower(p,t,stat) { const data = defects.filter(d=>d.project===p && d.tower===t && (stat==="All"||d.status===stat)); openDrillModal(`${p} - ${t} - ${stat}`, data); }
function openAnaDrillCat(p,t) { const data = defects.filter(d=>d.project===p && d.Type===t); openDrillModal(`${p} - ${t}`, data); }
function openAnaDrillRisk(p,risk) { const data = defects.filter(d=>d.project===p && (risk==="All"||d.intensity===risk)); openDrillModal(`${p} - ${risk} Risk`, data); }

// ==========================================
// RESTORED: ADMIN TABLES & SETUP FUNCTIONS
// ==========================================
function renderAdminTables() {
    const hBody = document.querySelector("#hierarchyTable tbody");
    if(hBody) {
        let hHtml = "";
        Object.keys(structuralHierarchy).forEach(p => { 
            Object.keys(structuralHierarchy[p]).forEach(t => {
                hHtml += `<tr><td><b>${p}</b></td><td>${t}</td><td style="white-space:normal; max-width:200px;">${structuralHierarchy[p][t].join(", ")}</td><td><button class="action-icon-btn edit-btn" onclick="editHierarchy('${p}','${t}')">Edit</button><button class="action-icon-btn del-btn" onclick="delHierarchy('${p}','${t}')">Del</button></td></tr>`;
            }); 
        }); 
        hBody.innerHTML = hHtml;
    }
    const cBody = document.querySelector("#categoryTable tbody");
    if(cBody) {
        cBody.innerHTML = Object.keys(defectMatrix).map(c => `<tr><td><b>${c}</b></td><td style="white-space:normal; max-width:200px;">${defectMatrix[c].join(", ")}</td><td><button class="action-icon-btn edit-btn" onclick="editCategory('${c}')">Edit</button><button class="action-icon-btn del-btn" onclick="delCategory('${c}')">Del</button></td></tr>`).join('');
    }
    renderMapTable();
}

// Hierarchy Management
function saveHierarchy() {
    const p = document.getElementById("setupProjName").value.trim(); const t = document.getElementById("setupTowerName").value.trim(); const f = document.getElementById("setupFloors").value.split(",").map(s=>s.trim()).filter(Boolean); const editKey = document.getElementById("editHierarchyKey").value;
    if(editKey) { const [oldP, oldT] = editKey.split("|||"); if(oldP !== p || oldT !== t) delete structuralHierarchy[oldP][oldT]; }
    if(!structuralHierarchy[p]) structuralHierarchy[p] = {}; structuralHierarchy[p][t] = f;
    localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); alert("Hierarchy Saved!"); resetHierarchyForm();
    document.getElementById("hierarchyConfigTextarea").value = JSON.stringify(structuralHierarchy, null, 2);
}
function editHierarchy(p, t) { document.getElementById("setupProjName").value = p; document.getElementById("setupTowerName").value = t; document.getElementById("setupFloors").value = structuralHierarchy[p][t].join(", "); document.getElementById("editHierarchyKey").value = `${p}|||${t}`; document.getElementById("btnSaveHierarchy").innerHTML = "<i class='fas fa-save'></i> Update"; }
function delHierarchy(p, t) { if(confirm(`Delete ${t} from ${p}?`)) { delete structuralHierarchy[p][t]; if(Object.keys(structuralHierarchy[p]).length === 0) delete structuralHierarchy[p]; localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); refreshDropdowns(); renderAdminTables(); document.getElementById("hierarchyConfigTextarea").value = JSON.stringify(structuralHierarchy, null, 2); } }
function resetHierarchyForm() { document.getElementById("hierarchyForm").reset(); document.getElementById("editHierarchyKey").value=""; document.getElementById("btnSaveHierarchy").innerHTML="<i class='fas fa-save'></i> Save"; }

// Category Management
function saveCategory() {
    const c = document.getElementById("setupCatName").value.trim(); const s = document.getElementById("setupSpecs").value.split(",").map(x=>x.trim()).filter(Boolean); const editKey = document.getElementById("editCategoryKey").value;
    if(editKey && editKey !== c) delete defectMatrix[editKey]; defectMatrix[c] = s; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); refreshDropdowns(); renderAdminTables(); alert("Category Saved!"); resetCategoryForm();
}
function editCategory(c) { document.getElementById("setupCatName").value = c; document.getElementById("setupSpecs").value = defectMatrix[c].join(", "); document.getElementById("editCategoryKey").value = c; document.getElementById("btnSaveCategory").innerHTML = "<i class='fas fa-save'></i> Update"; }
function delCategory(c) { if(confirm("Delete Category?")) { delete defectMatrix[c]; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); refreshDropdowns(); renderAdminTables(); } }
function resetCategoryForm() { document.getElementById("categoryForm").reset(); document.getElementById("editCategoryKey").value=""; document.getElementById("btnSaveCategory").innerHTML="<i class='fas fa-save'></i> Save"; }

async function loadMapsFromCloud() {
    if(!navigator.onLine) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/snag_maps?nocache=${Date.now()}`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }});
        if(res.ok) {
            const data = await res.json();
            data.forEach(m => { floorMaps[m.map_key] = m.base64_image; });
            localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps));
            if(document.getElementById('setup').classList.contains('active') && currentUser.role === "admin") renderMapTable();
        }
    } catch(e) { console.error("Map sync error", e); }
}

function renderMapTable() {
    const fBody = document.querySelector("#floorMapTable tbody");
    if(fBody) {
        fBody.innerHTML = Object.keys(floorMaps).map(k => {
            const parts = k.split('_'); return `<tr><td>${parts[0]}</td><td>${parts[1]}</td><td>${parts[2]}</td><td><img src="${floorMaps[k]}" width="40" height="40" style="object-fit:cover; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${floorMaps[k]}')"></td><td><button class="action-icon-btn del-btn" onclick="delMap('${k}')">Del</button></td></tr>`;
        }).join('');
    }
}

function populateMapSetupTowers() { const p = document.getElementById("mapSetupProject").value; const tSel = document.getElementById("mapSetupTower"); tSel.innerHTML = '<option value="">Tower</option>'; if(p && structuralHierarchy[p]) Object.keys(structuralHierarchy[p]).forEach(t => tSel.appendChild(new Option(t, t))); }
function populateMapSetupFloors() { const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const fSel = document.getElementById("mapSetupFloor"); fSel.innerHTML = '<option value="">Floor</option>'; if(p && t && structuralHierarchy[p][t]) structuralHierarchy[p][t].forEach(f => fSel.appendChild(new Option(f, f))); }
function previewMapDrawing(e) {
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = ev => { const img = new Image(); img.onload = () => { const canvas = document.createElement("canvas"); let scale = Math.min(1, 1200/Math.max(img.width, img.height)); canvas.width = img.width * scale; canvas.height = img.height * scale; canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height); document.getElementById("tempMapBase64").value = canvas.toDataURL("image/jpeg", 0.7); }; img.src = ev.target.result; }; reader.readAsDataURL(file);
}
async function submitMapDrawing() {
    const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const f = document.getElementById("mapSetupFloor").value; 
    const base64 = document.getElementById("tempMapBase64").value;
    if(!p || !t || !f || !base64) return alert("Select Project, Tower, Floor and upload an image first!");
    const mapKey = `${p}_${t}_${f}`;
    
    try {
        const btn = document.getElementById("btnSubmitMap"); btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Submitting...";
        const payload = { map_key: mapKey, base64_image: base64 };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/snag_maps?on_conflict=map_key`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(payload) });
        if(res.ok) { 
            floorMaps[mapKey] = base64; localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); 
            alert("Floor Map Successfully Saved!"); 
            renderMapTable();
            document.getElementById("tempMapBase64").value = ""; document.getElementById("mapSetupFile").value = "";
        } else throw await res.json();
    } catch(err) { alert("Error saving map: " + JSON.stringify(err)); }
    finally { const btn = document.getElementById("btnSubmitMap"); btn.disabled = false; btn.innerHTML = "<i class='fas fa-upload'></i> Upload Map to CSMS"; }
}
async function delMap(k) { 
    if(!confirm("Delete Floor Map from Database?")) return;
    try {
        const finalUrl = SUPABASE_URL.includes('/rest/v1') ? `${SUPABASE_URL}/snag_maps?map_key=eq.${k}` : `${SUPABASE_URL}/rest/v1/snag_maps?map_key=eq.${k}`;
        await fetch(finalUrl, { method: "DELETE", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }});
        delete floorMaps[k]; localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); renderMapTable();
    } catch(e) { console.error("Could not delete from backend", e); }
}

function toggleProjectRights() { document.getElementById("projectRightsContainer").style.display = (document.getElementById("suRole").value === "admin") ? "none" : "block"; }
function renderUserSetupCheckboxes() { 
    const cont = document.getElementById("projectCheckboxes"); if(!cont) return;
    let html = "";
    Object.keys(structuralHierarchy).forEach(p => { 
        Object.keys(structuralHierarchy[p]).forEach(t => { html += `<label><input type="checkbox" class="proj-chk" value="${p}_${t}"> <b>${p}</b> - ${t}</label>`; });
    });
    cont.innerHTML = html;
}
function saveSystemUser() {
    const fName = document.getElementById("suFirst").value.trim(); const lName = document.getElementById("suLast").value.trim(); const email = document.getElementById("suEmail").value.trim(); const pass = document.getElementById("suPass").value; const role = document.getElementById("suRole").value; const rights = document.getElementById("suRights").value; let selProjects = [];
    if(role === "admin") selProjects = ["All"]; else { document.querySelectorAll(".proj-chk:checked").forEach(cb => selProjects.push(cb.value)); if(selProjects.length === 0) return alert("Select at least one project/tower."); }
    
    const existIdx = USER_MATRIX.findIndex(u => u.id.toLowerCase() === email.toLowerCase()); 
    const newUser = { id: email, firstName: fName, lastName: lName, pass: pass, role: role, projects: selProjects, permission: rights };
    if(existIdx >= 0) USER_MATRIX[existIdx] = newUser; else USER_MATRIX.push(newUser); 
    localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); alert("User Access Saved!"); resetUserForm(); renderUserTable(); refreshDropdowns();
}
function resetUserForm() {
    document.getElementById("suFirst").value = ""; document.getElementById("suLast").value = ""; document.getElementById("suEmail").value = ""; document.getElementById("suPass").value = ""; document.getElementById("editUserKey").value = "";
    document.querySelectorAll(".proj-chk").forEach(cb => cb.checked = false); document.getElementById("btnSaveUser").innerHTML = "<i class='fas fa-user-plus'></i> Save User";
}
function renderUserTable() {
    const tbody = document.querySelector("#usersTable tbody"); if(!tbody) return;
    tbody.innerHTML = USER_MATRIX.map(u => { return `<tr><td><b>${getFullName(u)}</b><br><small>${u.id}</small></td><td>${u.role.toUpperCase()}</td><td style="white-space:normal; max-width:150px;">${u.role === "admin" ? `<span class="tech-badge" style="background:#0284c7; color:white;">Global All</span>` : u.projects.join(", ")}</td><td>${u.permission === "edit" ? "Full" : "View"}</td><td>${u.id === currentUser.id ? "<i>(You)</i>" : `<button class="action-icon-btn del-btn" onclick="deleteUser('${u.id}')">Del</button>`}</td></tr>`; }).join('');
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
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('CSMS Defect Report');
    
    sheet.columns = [ 
        { header: 'ID', key: 'serial', width: 8 }, { header: 'Project', key: 'project', width: 16 }, 
        { header: 'Tower', key: 'tower', width: 12 }, { header: 'Floor', key: 'floor', width: 12 }, 
        { header: 'Flat', key: 'flat', width: 12 }, { header: 'Category', key: 'Type', width: 20 }, 
        { header: 'Specification', key: 'defectList', width: 25 }, { header: 'Remarks', key: 'remark', width: 30 }, 
        { header: 'Created By', key: 'created_by', width: 18 }, { header: 'Closed By', key: 'closed_by', width: 18 },
        { header: 'Risk', key: 'intensity', width: 12 }, { header: 'Status', key: 'status', width: 12 }, 
        { header: 'Logged Date', key: 'loggedDate', width: 15 }, { header: 'SLA Date', key: 'dueDate', width: 15 }, 
        { header: 'Closed Date', key: 'closedDate', width: 15 }, { header: 'Delay', key: 'delay', width: 12 },
        { header: 'Map Location View', key: 'map', width: 25 },
        { header: 'Initial Photos (All)', key: 'initial', width: 28 },
        { header: 'Final Photos (All)', key: 'final', width: 28 }
    ];
    
    const hRow = sheet.getRow(1); 
    hRow.font = { bold: true, color: { argb: 'FFFFFF' } }; 
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    
    dataToExport.forEach((d) => { 
        const row = sheet.addRow({ ...d, map: "", initial: "", final: "" }); 
        row.height = 110;
        const addImgGridToCell = (picsArray, colIdx) => {
            if (!picsArray) return;
            picsArray.forEach((b64, idx) => {
                if(b64 && b64.startsWith('data:image') && idx < 4) { 
                    try {
                        const imageId = workbook.addImage({ base64: b64, extension: 'jpeg' });
                        const xOffset = (idx % 2) * 0.5; const yOffset = Math.floor(idx / 2) * 0.5;
                        sheet.addImage(imageId, { tl: { col: colIdx - 1 + xOffset, row: row.number - 1 + yOffset }, ext: { width: 55, height: 55 }, editAs: 'oneCell' });
                    } catch(e) { console.error('Image skipped', e); }
                }
            });
        };

        if(d.map_thumbnail && d.map_thumbnail.startsWith('data:image')) {
            try { const imageId = workbook.addImage({ base64: d.map_thumbnail, extension: 'jpeg' }); sheet.addImage(imageId, { tl: { col: 16, row: row.number - 1 }, ext: { width: 90, height: 90 }, editAs: 'oneCell' }); } catch(e) { console.error('Map skipped', e); }
        }
        addImgGridToCell(d.initialPics, 18); addImgGridToCell(d.finalPics, 19);
    });
    
    const buf = await workbook.xlsx.writeBuffer(); 
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `CSMS_Report_Detailed.xlsx`; a.click();
}

function exportPDF(dataToExport){ 
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    const windowObj = window.open("", "", "width=950,height=750");
    const style = `<style>body{font-family:sans-serif; padding:15px;} .card{border:1px solid #ccc; padding:14px; margin-bottom:16px;} .grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px;} img{width:140px; height:140px; object-fit:cover; margin-right:10px;}</style>`;
    let html = `<h1>CSMS Quality Audit</h1>`;
    dataToExport.forEach((d)=>{ html += `<div class="card"><div class="grid"><div><b>Project:</b> ${d.project} | <b>Tower:</b> ${d.tower} | <b>Floor:</b> ${d.floor}<br/><b>Category:</b> ${d.Type}</div><div><b>Status:</b> ${d.status}<br/><b>Dates:</b> ${d.loggedDate}</div></div><div style="margin-top:10px;"><b>Initial: </b>${d.initialPics.map(src=> `<img src="${src}" />`).join("")}</div></div>`; });
    windowObj.document.write(style + html); windowObj.document.close(); setTimeout(() => { windowObj.print(); windowObj.close(); }, 800);
}