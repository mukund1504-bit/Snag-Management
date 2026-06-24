// ====== SUPABASE SYSTEM PRODUCTION ENDPOINT CONFIGURATION ======
const SUPABASE_URL = "https://vkvyzzxplzrpgiouopbx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdnl6enhwbHpycGdpb3VvcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzM3ODMsImV4cCI6MjA5Nzg0OTc4M30.n3cBqWQ4SD5LpcdLiu4G5mgF0YzFzCZrik80MLLXBzk";

const DEFAULT_USERS = [
    { id: "Mukund1504@gmail.com", pass: "Abc1504@", role: "admin", projects: ["All"], permission: "edit" }
];
let USER_MATRIX = JSON.parse(localStorage.getItem("qa_users")) || DEFAULT_USERS;

let currentUser = null;
let defects = [];
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

function processLogin() {
    const email = document.getElementById("loginEmail").value.trim(); const pass = document.getElementById("loginPassword").value; const err = document.getElementById("loginError");
    const validUser = USER_MATRIX.find(u => u.id.toLowerCase() === email.toLowerCase() && u.pass === pass);
    if(validUser) { currentUser = validUser; sessionStorage.setItem("qa_logged_in_user", JSON.stringify(validUser)); activateApp(); } 
    else { err.style.display = "block"; err.innerText = "Invalid credentials."; }
}
function processLogout() { sessionStorage.removeItem("qa_logged_in_user"); location.reload(); }

function activateApp() {
    document.getElementById("loginOverlay").style.display = "none"; document.getElementById("appContainer").style.display = "block";
    if(currentUser.role !== "admin") { document.getElementById("navSetupBtn").style.display = "none"; }
    if(currentUser.role === "user" && currentUser.permission === "view") { document.getElementById("navEntryBtn").style.display = "none"; showSection('dashboard'); } 
    else { showSection('entry'); }

    refreshDropdowns(); initCanvas('entry'); initCanvas('modal');
    loadDefectsFromCloud(false); startAutoRefresh(); 
    if(currentUser.role === "admin") { renderAdminTables(); renderUserSetupCheckboxes(); renderUserTable(); }
}

function showSection(id) {
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    const sec = document.getElementById(id); if(sec) sec.classList.add("active");
    if(event && event.currentTarget) event.currentTarget.classList.add("active");
    if(id === 'report') renderReportTable();
    if(id === 'dashboard') renderCharts();
}

function getAllowedProjects() { if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(structuralHierarchy); return currentUser.projects.filter(p => structuralHierarchy[p]); }

function refreshDropdowns() {
    const allowed = getAllowedProjects();
    ["project", "reportProject", "dashboardProjectFilter", "mapSetupProject"].forEach(id => {
        const el = document.getElementById(id); if(!el) return;
        el.innerHTML = (id.includes("report") || id.includes("dashboard")) ? "<option value='All'>All Authorized Projects</option>" : "<option value=''>-- Select Project --</option>";
        allowed.forEach(p => el.appendChild(new Option(p, p)));
    });
    const typeSel = document.getElementById("defectType");
    if(typeSel) { typeSel.innerHTML = "<option value=''>-- Select Type --</option>"; Object.keys(defectMatrix).forEach(type => typeSel.appendChild(new Option(type, type))); }
    populateTowers();
}

function populateTowers() {
    const p = document.getElementById("project").value; const tSel = document.getElementById("tower");
    tSel.innerHTML = '<option value="">-- Select Tower --</option>';
    if(p && structuralHierarchy[p]) { Object.keys(structuralHierarchy[p]).forEach(t => tSel.appendChild(new Option(t, t))); }
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
    lSel.innerHTML = '<option value="">-- Select Specific Defect --</option>';
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

// ====== 1. MAP MARKER PERSISTENCE UPGRADE ======
function drawCanvas(type) {
    const c = canvasConfig[type]; const canvas = document.getElementById(`${type}Canvas`);
    if(!c.img || !c.ctx) return;
    c.ctx.clearRect(0, 0, canvas.width, canvas.height); 
    c.ctx.drawImage(c.img, 0, 0);
    
    // Draw existing historical markers
    if(type === 'entry') {
        const p = document.getElementById("project").value;
        const t = document.getElementById("tower").value;
        const f = document.getElementById("floor").value;
        
        defects.forEach(d => {
            if(d.project === p && d.tower === t && d.floor === f && d.status !== 'Closed' && d.map_x && d.map_y && d.map_x !== "0") {
                c.ctx.beginPath();
                c.ctx.arc(d.map_x, d.map_y, 10, 0, 2 * Math.PI);
                c.ctx.fillStyle = "rgba(239, 68, 68, 0.85)"; // RED for existing issues
                c.ctx.fill();
                c.ctx.lineWidth = 2;
                c.ctx.strokeStyle = "#ffffff";
                c.ctx.stroke();
            }
        });
    }

    // Draw active placing marker
    if(c.marker) { 
        c.ctx.beginPath(); 
        c.ctx.arc(c.marker.x, c.marker.y, 14, 0, 2 * Math.PI); 
        c.ctx.fillStyle = "#3b82f6"; // BLUE for new placement
        c.ctx.fill(); 
        c.ctx.lineWidth = 4; 
        c.ctx.strokeStyle = "#ffffff"; 
        c.ctx.stroke(); 
    }
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

// Offline / Online Saving
async function saveDefect(){
    if(currentUser.role === "user" && currentUser.permission === "view") return alert("View Access Only.");
    const p = document.getElementById("project").value; const t = document.getElementById("tower").value;
    if(!p || !t) return alert("Select valid Project and Tower.");
    if(tempPhotos.length < 2) return alert("Please add at least 2 Initial Photos.");
    
    const x = document.getElementById("entryCoordX").value; const y = document.getElementById("entryCoordY").value;
    if(canvasConfig.entry.active && (!x || !y)) return alert("Please pinpoint the defect location on the map.");

    const today = new Date().toISOString().slice(0,10); const dueStr = document.getElementById("dueDate").value || null;
    let delay = "On Time"; if(dueStr && new Date() > new Date(dueStr)) delay = Math.floor((new Date() - new Date(dueStr))/(1000*60*60*24))+" days";

    const payload = {
        project: p, tower: t, floor: document.getElementById("floor").value, flat: document.getElementById("flatNo").value,
        Type: document.getElementById("defectType").value, defectList: document.getElementById("defectList").value,
        remark: document.getElementById("remark").value, intensity: document.getElementById("intensity").value,
        status: document.getElementById("status").value, dueDate: dueStr, loggedDate: today,
        photos: tempPhotos.join("|||"), final_photos: "", 
        map_x: x ? parseFloat(x).toFixed(2) : "0", map_y: y ? parseFloat(y).toFixed(2) : "0", delay: delay, closedDate: document.getElementById("status").value === "Closed" ? today : "-"
    };

    if(!navigator.onLine) {
        let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; queue.push(payload); localStorage.setItem('qa_offline_queue', JSON.stringify(queue));
        alert("Offline Mode: Record saved locally. Will auto-sync when online.");
        document.getElementById("defectForm").reset(); clearTempPhotos(); canvasConfig.entry.marker = null; drawCanvas('entry'); return;
    }

    try {
        const btn = document.getElementById("mainSubmitBtn"); btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Submitting...";
        const res = await fetch(`${SUPABASE_URL}/rest/v1/defect`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if(res.ok) { alert("Record Logged Successfully!"); document.getElementById("defectForm").reset(); clearTempPhotos(); canvasConfig.entry.marker = null; drawCanvas('entry'); await loadDefectsFromCloud(true); } else throw await res.json();
    } catch(err) { alert("Error: " + JSON.stringify(err)); }
    finally { const btn = document.getElementById("mainSubmitBtn"); btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> SUBMIT ENTRY"; }
}

async function syncOfflineData() {
    let queue = JSON.parse(localStorage.getItem('qa_offline_queue')) || []; if(queue.length === 0) return;
    let successCount = 0;
    for(let payload of queue) {
        try { const res = await fetch(`${SUPABASE_URL}/rest/v1/defect`, { method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if(res.ok) successCount++; } catch(e) {}
    }
    localStorage.removeItem('qa_offline_queue'); if(successCount > 0) { alert(`Synced ${successCount} offline records!`); loadDefectsFromCloud(false); }
}

function startAutoRefresh() { autoSyncInterval = setInterval(() => { if(navigator.onLine) loadDefectsFromCloud(true); }, 20000); }

async function loadDefectsFromCloud(isBackground = false) {
    if(!navigator.onLine) return;
    try {
        if(!isBackground) document.getElementById("liveSyncBadge").innerHTML = "<i class='fas fa-sync fa-spin'></i> Loading...";
        const res = await fetch(`${SUPABASE_URL}/rest/v1/defect?select=*&order=id.desc`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }});
        if(res.ok) {
            const data = await res.json();
            defects = data.map((d, i) => ({ ...d, serial: data.length - i, initialPics: d.photos ? d.photos.split("|||") : [], finalPics: d.final_photos ? d.final_photos.split("|||") : [] }));
            if(document.getElementById('report').classList.contains('active')) renderReportTable();
            if(document.getElementById('dashboard').classList.contains('active')) renderCharts();
            // Redraw entry map to show any new markers if active
            if(document.getElementById('entry').classList.contains('active')) drawCanvas('entry');
        }
    } catch(e) { console.error(e); }
    finally { setTimeout(()=> document.getElementById("liveSyncBadge").innerHTML = "<i class='fas fa-check-circle'></i> LIVE SYNC", 1000); }
}

// Generate Table Rows Html with Status Lock logic
function generateTableRowsHtml(dataArray) {
    const canEdit = currentUser.role === "admin" || currentUser.permission === "edit";
    return dataArray.map(d => {
        const initialHtml = `<div class="img-grid-cell">${d.initialPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        const finalHtml = `<div class="img-grid-cell">${d.finalPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        
        let actionHtml = `<span style="color:#94a3b8; font-size:11px;"><i class="fas fa-eye"></i> View</span>`;
        if(d.status === "Closed") {
            // Lock the button if closed
            actionHtml = `<span style="color:#059669; font-weight:bold; font-size:11.5px; background: #d1fae5; padding: 4px 8px; border-radius: 4px; display:inline-block;"><i class="fas fa-lock"></i> Closed</span>`;
        } else if(canEdit) {
            actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal(${d.id})"><i class="fas fa-bolt"></i> Action</button>`;
        }
        
        let mapText = "Not Mapped"; if(d.map_x && d.map_y && d.map_x !== "0") mapText = `X: ${d.map_x}, Y: ${d.map_y}`;
        
        return `<tr>
                <td>${d.serial}</td><td><b>${d.project}</b></td><td>${d.tower}</td><td>${d.floor}</td><td>${d.flat}</td>
                <td><b>${d.Type}</b></td><td>${d.defectList}</td><td>${d.remark || "-"}</td>
                <td><span class="map-badge"><i class="fas fa-map-marker-alt text-cyan"></i> ${mapText}</span></td>
                <td>${d.intensity}</td><td><span class="locked-badge">${d.status}</span></td>
                <td>${d.loggedDate}</td><td>${d.dueDate || "-"}</td><td>${d.closedDate}</td><td>${d.delay}</td>
                <td>${initialHtml}</td><td>${finalHtml}</td><td class="action-cell">${actionHtml}</td>
            </tr>`;
    }).join("");
}

function renderReportTable(){
    const allowedProjects = getAllowedProjects(); const pFilt = document.getElementById("reportProject").value;
    const filtered = defects.filter(d => (currentUser.role === "admin" || allowedProjects.includes(d.project)) && (pFilt === "All" || d.project === pFilt));
    document.querySelector("#defectsTable tbody").innerHTML = generateTableRowsHtml(filtered);
}

// Modal Logics
function openEditModal(id) {
    if(currentUser.role === "user" && currentUser.permission === "view") return;
    const d = defects.find(x => x.id === id); if(!d) return;
    
    // Prevent accidental opening if status is closed somehow
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

    if(stat === "Closed") {
        if(!confirm("Warning: Closing this defect will LOCK the record and prevent further edits. Proceed?")) return;
    }

    let payload = { status: stat, final_photos: editTempPhotos.join("|||"), closedDate: stat === "Closed" ? new Date().toISOString().slice(0,10) : "-" };
    const finalUrl = SUPABASE_URL.includes('/rest/v1') ? `${SUPABASE_URL}/defect?id=eq.${id}` : `${SUPABASE_URL}/rest/v1/defect?id=eq.${id}`;

    try {
        const btn = document.getElementById("editSubmitBtn"); btn.disabled = true; btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Saving...";
        const res = await fetch(finalUrl, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }, body: JSON.stringify(payload) });
        if(res.ok) { alert("Defect Updated Successfully!"); closeEditModal(); await loadDefectsFromCloud(false); } 
        else throw await res.json();
    } catch(e) { alert("Network error. Update Failed."); }
    finally { const btn = document.getElementById("editSubmitBtn"); btn.disabled = false; btn.innerHTML = "<i class='fas fa-save'></i> Save Updates"; }
}

function openZoomImage(url) { document.getElementById("zoomedImage").src = url; document.getElementById("imageZoomModal").style.display = "flex"; }
function closeImageZoom() { document.getElementById("imageZoomModal").style.display = "none"; }
function openDrillModal(title, data) {
    currentDrilldownData = data; document.getElementById("modalTitle").innerHTML = `<i class="fas fa-search-plus text-cyan"></i> Drill-Down: ${title} (${data.length})`;
    let html = generateTableRowsHtml(data).replace(/<td class="action-cell">.*?<\/td>/g, ""); 
    document.querySelector("#drilldownTable tbody").innerHTML = html; document.getElementById("drilldownModal").style.display = "flex";
}
function closeDrillModal() { document.getElementById("drilldownModal").style.display = "none"; }


// ====== 2. BI TELEMETRY MATRICES UPGRADE ======
let chartsObj = {};
function renderCharts() {
    const allowedProjects = getAllowedProjects(); const filterProj = document.getElementById("dashboardProjectFilter").value; const filterAnalytic = document.getElementById("dashboardAnalyticFilter").value;
    const filteredData = defects.filter(d => (currentUser.role === "admin" || allowedProjects.includes(d.project)) && (filterProj === "All" || d.project === filterProj));
    Object.keys(chartsObj).forEach(k => { if(chartsObj[k]) chartsObj[k].destroy(); });
    
    const projMap = {}; const statMap = { "Open": 0, "In Progress": 0, "Closed": 0 };
    filteredData.forEach(d => { projMap[d.project] = (projMap[d.project] || 0) + 1; if(statMap[d.status]!==undefined) statMap[d.status]++; });

    chartsObj.c1 = new Chart(document.getElementById("primaryChart"), { type: 'bar', data: { labels: Object.keys(projMap), datasets: [{ label: 'Total Defects', data: Object.values(projMap), backgroundColor: '#0284c7' }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(projMap)[elements[0].index], filteredData.filter(x=>x.project===Object.keys(projMap)[elements[0].index])); } }});
    chartsObj.c2 = new Chart(document.getElementById("statusChart"), { type: 'doughnut', data: { labels: Object.keys(statMap), datasets: [{ data: Object.values(statMap), backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }] }, options: { responsive:true, maintainAspectRatio:false, onClick: (e, elements) => { if(elements.length>0) openDrillModal(Object.keys(statMap)[elements[0].index], filteredData.filter(x=>x.status===Object.keys(statMap)[elements[0].index])); } }});

    // Pivot Table Matrix Generation Logic
    const tHead = document.getElementById("analyticsTableHeader");
    const tBody = document.getElementById("analyticsTableBody");
    let matrixData = {};

    if(filterAnalytic === "floor") {
        tHead.innerHTML = `<th>PROJECT</th><th>TOWER</th><th>FLOOR</th><th>FLAT</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>TOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.tower}_${d.floor}_${d.flat}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, f:d.floor, fl:d.flat, o:0, ip:0, c:0, tot:0 };
            if(d.status === 'Open') matrixData[k].o++; if(d.status === 'In Progress') matrixData[k].ip++; if(d.status === 'Closed') matrixData[k].c++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td>${m.f}</td><td>${m.fl}</td><td><span class="tech-badge" style="background:#e0f2fe;color:#0369a1;">${m.o}</span></td><td><span class="tech-badge" style="background:#fef3c7;color:#d97706;">${m.ip}</span></td><td><span class="tech-badge" style="background:#d1fae5;color:#059669;">${m.c}</span></td><td><b>${m.tot}</b></td></tr>`).join('');
    } 
    else if(filterAnalytic === "tower") {
        tHead.innerHTML = `<th>PROJECT NAME</th><th>TOWER REF</th><th>OPEN</th><th>IN PROGRESS</th><th>CLOSED</th><th>SUBTOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.tower}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.tower, o:0, ip:0, c:0, tot:0 };
            if(d.status === 'Open') matrixData[k].o++; if(d.status === 'In Progress') matrixData[k].ip++; if(d.status === 'Closed') matrixData[k].c++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><span class="tech-badge" style="background:#e0f2fe;color:#0369a1;">${m.o}</span></td><td><span class="tech-badge" style="background:#fef3c7;color:#d97706;">${m.ip}</span></td><td><span class="tech-badge" style="background:#d1fae5;color:#059669;">${m.c}</span></td><td><b>${m.tot}</b></td></tr>`).join('');
    }
    else if(filterAnalytic === "defect") {
        tHead.innerHTML = `<th>PROJECT TARGET</th><th>CLASSIFICATION CATEGORY</th><th>TOTAL COUNT</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}_${d.Type}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, t:d.Type, tot:0 };
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td>${m.t}</td><td><span class="tech-badge" style="background:#f1f5f9;color:#334155;">${m.tot}</span></td></tr>`).join('');
    }
    else if(filterAnalytic === "intensity") {
        tHead.innerHTML = `<th>PROJECT TARGET NAME</th><th>LOW RISK</th><th>MEDIUM RISK</th><th>HIGH RISK</th><th>TOTAL</th>`;
        filteredData.forEach(d => {
            let k = `${d.project}`;
            if(!matrixData[k]) matrixData[k] = { p:d.project, l:0, m:0, h:0, tot:0 };
            if(d.intensity === 'Low') matrixData[k].l++; if(d.intensity === 'Medium') matrixData[k].m++; if(d.intensity === 'High') matrixData[k].h++;
            matrixData[k].tot++;
        });
        tBody.innerHTML = Object.values(matrixData).map(m => `<tr><td><b>${m.p}</b></td><td><span class="tech-badge" style="background:#e0f2fe;color:#0369a1;">${m.l}</span></td><td><span class="tech-badge" style="background:#fef3c7;color:#d97706;">${m.m}</span></td><td><span class="tech-badge" style="background:#fee2e2;color:#b91c1c;">${m.h}</span></td><td><b>${m.tot}</b></td></tr>`).join('');
    }

    const anaMap = {}; filteredData.forEach(d => { anaMap[d.intensity] = (anaMap[d.intensity] || 0) + 1; });
    chartsObj.c3 = new Chart(document.getElementById("intensityChartCanvas"), { type: 'polarArea', data: { labels: Object.keys(anaMap), datasets: [{ data: Object.values(anaMap), backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6'] }] }, options: { responsive:true, maintainAspectRatio:false }});
    const catMap = {}; filteredData.forEach(d => catMap[d.Type] = (catMap[d.Type]||0)+1);
    chartsObj.c4 = new Chart(document.getElementById("categoryChartCanvas"), { type: 'bar', data: { labels: Object.keys(catMap), datasets: [{ label: 'Categories', data: Object.values(catMap), backgroundColor: '#8b5cf6' }] }, options: { indexAxis: 'y', responsive:true, maintainAspectRatio:false }});
}

function openAnaDrill(key, val) {
    const allowedProjects = getAllowedProjects(); const filterProj = document.getElementById("dashboardProjectFilter").value;
    const filtered = defects.filter(d => (currentUser.role === "admin" || allowedProjects.includes(d.project)) && (filterProj === "All" || d.project === filterProj) && d[key] === val);
    openDrillModal(`${val} Insights`, filtered);
}

function renderAdminTables() {
    const hBody = document.querySelector("#hierarchyTable tbody");
    if(hBody) {
        let hHtml = "";
        Object.keys(structuralHierarchy).forEach(p => { Object.keys(structuralHierarchy[p]).forEach(t => {
            hHtml += `<tr><td><b>${p}</b></td><td>${t}</td><td style="white-space:normal; max-width:200px;">${structuralHierarchy[p][t].join(", ")}</td><td><button class="action-icon-btn edit-btn" onclick="editHierarchy('${p}','${t}')">Edit</button><button class="action-icon-btn del-btn" onclick="delHierarchy('${p}','${t}')">Del</button></td></tr>`;
        }); }); hBody.innerHTML = hHtml;
    }
    const cBody = document.querySelector("#categoryTable tbody");
    if(cBody) cBody.innerHTML = Object.keys(defectMatrix).map(c => `<tr><td><b>${c}</b></td><td style="white-space:normal; max-width:200px;">${defectMatrix[c].join(", ")}</td><td><button class="action-icon-btn edit-btn" onclick="editCategory('${c}')">Edit</button><button class="action-icon-btn del-btn" onclick="delCategory('${c}')">Del</button></td></tr>`).join('');
    const fBody = document.querySelector("#floorMapTable tbody");
    if(fBody) {
        fBody.innerHTML = Object.keys(floorMaps).map(k => {
            const parts = k.split('_'); return `<tr><td>${parts[0]}</td><td>${parts[1]}</td><td>${parts[2]}</td><td><img src="${floorMaps[k]}" width="40" height="40" style="object-fit:cover; border-radius:4px; cursor:pointer;" onclick="openZoomImage('${floorMaps[k]}')"></td><td><button class="action-icon-btn del-btn" onclick="delMap('${k}')">Del</button></td></tr>`;
        }).join('');
    }
}

function saveHierarchy() {
    const p = document.getElementById("setupProjName").value.trim(); const t = document.getElementById("setupTowerName").value.trim(); const f = document.getElementById("setupFloors").value.split(",").map(s=>s.trim()).filter(Boolean); const editKey = document.getElementById("editHierarchyKey").value;
    if(editKey) { const [oldP, oldT] = editKey.split("|||"); if(oldP !== p || oldT !== t) delete structuralHierarchy[oldP][oldT]; }
    if(!structuralHierarchy[p]) structuralHierarchy[p] = {}; structuralHierarchy[p][t] = f;
    localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); alert("Hierarchy Saved!"); resetHierarchyForm();
}
function editHierarchy(p, t) { document.getElementById("setupProjName").value = p; document.getElementById("setupTowerName").value = t; document.getElementById("setupFloors").value = structuralHierarchy[p][t].join(", "); document.getElementById("editHierarchyKey").value = `${p}|||${t}`; document.getElementById("btnSaveHierarchy").innerHTML = "<i class='fas fa-save'></i> Update"; }
function delHierarchy(p, t) { if(confirm(`Delete ${t} from ${p}?`)) { delete structuralHierarchy[p][t]; if(Object.keys(structuralHierarchy[p]).length === 0) delete structuralHierarchy[p]; localStorage.setItem("qa_strict_hierarchy", JSON.stringify(structuralHierarchy)); refreshDropdowns(); renderAdminTables(); } }
function resetHierarchyForm() { document.getElementById("hierarchyForm").reset(); document.getElementById("editHierarchyKey").value=""; document.getElementById("btnSaveHierarchy").innerHTML="<i class='fas fa-save'></i> Save"; }

function saveCategory() {
    const c = document.getElementById("setupCatName").value.trim(); const s = document.getElementById("setupSpecs").value.split(",").map(x=>x.trim()).filter(Boolean); const editKey = document.getElementById("editCategoryKey").value;
    if(editKey && editKey !== c) delete defectMatrix[editKey]; defectMatrix[c] = s; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); refreshDropdowns(); renderAdminTables(); alert("Category Saved!"); resetCategoryForm();
}
function editCategory(c) { document.getElementById("setupCatName").value = c; document.getElementById("setupSpecs").value = defectMatrix[c].join(", "); document.getElementById("editCategoryKey").value = c; document.getElementById("btnSaveCategory").innerHTML = "<i class='fas fa-save'></i> Update"; }
function delCategory(c) { if(confirm("Delete Category?")) { delete defectMatrix[c]; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); refreshDropdowns(); renderAdminTables(); } }
function resetCategoryForm() { document.getElementById("categoryForm").reset(); document.getElementById("editCategoryKey").value=""; document.getElementById("btnSaveCategory").innerHTML="<i class='fas fa-save'></i> Save"; }

function populateMapSetupTowers() { const p = document.getElementById("mapSetupProject").value; const tSel = document.getElementById("mapSetupTower"); tSel.innerHTML = '<option value="">Tower</option>'; if(p && structuralHierarchy[p]) Object.keys(structuralHierarchy[p]).forEach(t => tSel.appendChild(new Option(t, t))); }
function populateMapSetupFloors() { const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const fSel = document.getElementById("mapSetupFloor"); fSel.innerHTML = '<option value="">Floor</option>'; if(p && t && structuralHierarchy[p][t]) structuralHierarchy[p][t].forEach(f => fSel.appendChild(new Option(f, f))); }
function saveMapDrawing(e) {
    const p = document.getElementById("mapSetupProject").value; const t = document.getElementById("mapSetupTower").value; const f = document.getElementById("mapSetupFloor").value; if(!p || !t || !f) { alert("Select Project, Tower and Floor first!"); e.target.value=""; return; }
    const file = e.target.files[0]; if(!file) return; const reader = new FileReader(); reader.onload = ev => { const img = new Image(); img.onload = () => { const canvas = document.createElement("canvas"); let scale = Math.min(1, 1200/Math.max(img.width, img.height)); canvas.width = img.width * scale; canvas.height = img.height * scale; canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height); floorMaps[`${p}_${t}_${f}`] = canvas.toDataURL("image/jpeg", 0.7); localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); alert("Floor Map Successfully Saved!"); renderAdminTables(); }; img.src = ev.target.result; }; reader.readAsDataURL(file);
}
function delMap(k) { if(confirm("Delete Floor Map?")) { delete floorMaps[k]; localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps)); renderAdminTables(); } }

function toggleProjectRights() { document.getElementById("projectRightsContainer").style.display = (document.getElementById("suRole").value === "admin") ? "none" : "block"; }
function renderUserSetupCheckboxes() { const cont = document.getElementById("projectCheckboxes"); if(cont) cont.innerHTML = Object.keys(structuralHierarchy).map(p => `<label><input type="checkbox" class="proj-chk" value="${p}"> ${p}</label>`).join(''); }
function saveSystemUser() {
    const email = document.getElementById("suEmail").value.trim(); const pass = document.getElementById("suPass").value; const role = document.getElementById("suRole").value; const rights = document.getElementById("suRights").value; let selProjects = [];
    if(role === "admin") selProjects = ["All"]; else { document.querySelectorAll(".proj-chk:checked").forEach(cb => selProjects.push(cb.value)); if(selProjects.length === 0) return alert("Select at least one project."); }
    const existIdx = USER_MATRIX.findIndex(u => u.id.toLowerCase() === email.toLowerCase()); const newUser = { id: email, pass: pass, role: role, projects: selProjects, permission: rights };
    if(existIdx >= 0) USER_MATRIX[existIdx] = newUser; else USER_MATRIX.push(newUser); localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); alert("User Access Saved!"); document.getElementById("suEmail").value = ""; document.getElementById("suPass").value = ""; renderUserTable();
}
function renderUserTable() {
    const tbody = document.querySelector("#usersTable tbody"); if(!tbody) return;
    tbody.innerHTML = USER_MATRIX.map(u => { return `<tr><td><b>${u.id}</b></td><td>${u.role.toUpperCase()}</td><td style="white-space:normal; max-width:150px;">${u.role === "admin" ? `<span class="tech-badge" style="background:#0284c7; color:white;">Global All</span>` : u.projects.join(", ")}</td><td>${u.permission === "edit" ? "Full" : "View"}</td><td>${u.id === currentUser.id ? "<i>(You)</i>" : `<button class="action-icon-btn del-btn" onclick="deleteUser('${u.id}')">Del</button>`}</td></tr>`; }).join('');
}
function deleteUser(email) { if(confirm(`Delete access for ${email}?`)) { USER_MATRIX = USER_MATRIX.filter(u => u.id !== email); localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); renderUserTable(); } }

function openPasswordModal() { document.getElementById("profileEmailDisplay").innerText = currentUser.id; document.getElementById("passwordModal").style.display = "flex"; }
function closePasswordModal() { document.getElementById("passwordModal").style.display = "none"; }
function changePassword() {
    const oldP = document.getElementById("oldPassword").value; const newP = document.getElementById("newPassword").value; if(oldP !== currentUser.pass) return alert("Incorrect current password!");
    const userIndex = USER_MATRIX.findIndex(u => u.id === currentUser.id);
    if(userIndex !== -1) { USER_MATRIX[userIndex].pass = newP; localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX)); currentUser.pass = newP; sessionStorage.setItem("qa_logged_in_user", JSON.stringify(currentUser)); alert("Password updated securely!"); closePasswordModal(); }
}

// ====== 3. EXCEL NATIVE IMAGE EXPORT UPGRADE ======
async function exportExcelWithPhotos(dataToExport) { 
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    
    const workbook = new ExcelJS.Workbook(); 
    const sheet = workbook.addWorksheet('PMC Defect Report');
    
    // Notice the final columns are dedicated to embedding images natively
    sheet.columns = [ 
        { header: 'ID', key: 'serial', width: 8 }, { header: 'Project', key: 'project', width: 16 }, 
        { header: 'Tower', key: 'tower', width: 12 }, { header: 'Floor', key: 'floor', width: 12 }, 
        { header: 'Flat', key: 'flat', width: 12 }, { header: 'Category', key: 'Type', width: 20 }, 
        { header: 'Specification', key: 'defectList', width: 25 }, { header: 'Remarks', key: 'remark', width: 30 }, 
        { header: 'Map Coord', key: 'map', width: 15 }, { header: 'Risk', key: 'intensity', width: 12 }, 
        { header: 'Status', key: 'status', width: 12 }, { header: 'Logged Date', key: 'loggedDate', width: 15 }, 
        { header: 'SLA Date', key: 'dueDate', width: 15 }, { header: 'Closed Date', key: 'closedDate', width: 15 }, 
        { header: 'Delay', key: 'delay', width: 12 },
        { header: 'Initial Photo Evidence', key: 'initial', width: 25 },
        { header: 'Final Photo Evidence', key: 'final', width: 25 }
    ];
    
    const hRow = sheet.getRow(1); 
    hRow.font = { bold: true, color: { argb: 'FFFFFF' } }; 
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    
    dataToExport.forEach((d) => { 
        let mapText = "N/A"; 
        if(d.map_x && d.map_y && d.map_x !== "0") mapText = `X:${d.map_x}, Y:${d.map_y}`; 
        
        const row = sheet.addRow({ ...d, map: mapText, initial: "", final: "" }); 
        row.height = 70; // Set row height big enough for pictures
        
        // Helper to convert Base64 directly to Excel workbook memory
        const addImgToCell = (base64Str, colIdx) => {
            if(base64Str && base64Str.startsWith('data:image')) {
                try {
                    const imageId = workbook.addImage({ base64: base64Str, extension: 'jpeg' });
                    sheet.addImage(imageId, {
                        tl: { col: colIdx - 1, row: row.number - 1 },
                        ext: { width: 60, height: 60 },
                        editAs: 'oneCell'
                    });
                } catch(e) { console.error('Image processing skipped', e); }
            }
        };

        // Append the very first image attached to the entry
        if(d.initialPics && d.initialPics.length > 0) addImgToCell(d.initialPics[0], 16);
        if(d.finalPics && d.finalPics.length > 0) addImgToCell(d.finalPics[0], 17);
    });
    
    const buf = await workbook.xlsx.writeBuffer(); 
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(blob); 
    a.download = `PMC_Report_Detailed.xlsx`; 
    a.click();
}

function exportPDF(dataToExport){ 
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    const windowObj = window.open("", "", "width=950,height=750");
    const style = `<style>body{font-family:sans-serif; padding:15px;} .card{border:1px solid #ccc; padding:14px; margin-bottom:16px;} .grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px;} img{width:140px; height:140px; object-fit:cover; margin-right:10px;}</style>`;
    let html = `<h1>PMC Quality Audit</h1>`;
    dataToExport.forEach((d)=>{ html += `<div class="card"><div class="grid"><div><b>Project:</b> ${d.project} | <b>Tower:</b> ${d.tower} | <b>Floor:</b> ${d.floor}<br/><b>Category:</b> ${d.Type}</div><div><b>Status:</b> ${d.status}<br/><b>Dates:</b> ${d.loggedDate}</div></div><div style="margin-top:10px;"><b>Initial: </b>${d.initialPics.map(src=> `<img src="${src}" />`).join("")}</div></div>`; });
    windowObj.document.write(style + html); windowObj.document.close(); setTimeout(() => { windowObj.print(); windowObj.close(); }, 800);
}