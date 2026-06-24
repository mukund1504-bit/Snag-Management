// ====== SUPABASE SYSTEM PRODUCTION ENDPOINT CONFIGURATION ======
const SUPABASE_URL = "https://vkvyzzxplzrpgiouopbx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdnl6enhwbHpycGdpb3VvcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzM3ODMsImV4cCI6MjA5Nzg0OTc4M30.n3cBqWQ4SD5LpcdLiu4G5mgF0YzFzCZrik80MLLXBzk";

const DEFAULT_USERS = [
    { id: "Mukund1504@gmail.com", pass: "Abc1504@", role: "admin", projects: ["All"], permission: "edit" },
    { id: "Amit@gmail.com", pass: "Abc1504@", role: "user", projects: ["Fragrance"], permission: "edit" },
    { id: "Rahul@gmail.com", pass: "Abc1504@", role: "user", projects: ["Eutopia"], permission: "view" }
];
let USER_MATRIX = JSON.parse(localStorage.getItem("qa_users")) || DEFAULT_USERS;

let currentUser = null;
let defects = [];
let tempPhotos = []; 
let editTempPhotos = []; 
let currentDrilldownData = []; 

let projects = JSON.parse(localStorage.getItem("qa_projects")) || {
    "Fragrance": ["Tower-A","Tower-B","NTA","EWS"],
    "Eutopia": ["Tower-A","B1","B2","C","D","E","F","STP","Non Tower"]
};

let defectMatrix = JSON.parse(localStorage.getItem("qa_defectMatrix")) || {
    "RCC Structure": ["Level uneven", "Honeycomb", "Crack Shown", "Poor Quality", "Other"],
    "Plumbing Work": ["Leak", "Broken", "Other"]
};

let globalFloors = JSON.parse(localStorage.getItem("qa_globalFloors")) || ["Basement-3","Basement-2","Basement-1", ...Array.from({length: 32}, (_, i) => `${i + 1} Floor`)];
let floorMaps = JSON.parse(localStorage.getItem("qa_floorMaps")) || {};

let canvasConfig = {
    entry: { ctx: null, img: null, scale: 1, marker: null, active: true },
    modal: { ctx: null, img: null, scale: 1, marker: null, active: false }
};

window.addEventListener("DOMContentLoaded", () => {
    const savedUser = sessionStorage.getItem("qa_logged_in_user");
    if(savedUser) {
        currentUser = JSON.parse(savedUser);
        activateApp();
    }
});

function processLogin() {
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPassword").value;
    const err = document.getElementById("loginError");

    const validUser = USER_MATRIX.find(u => u.id.toLowerCase() === email.toLowerCase() && u.pass === pass);
    
    if(validUser) {
        currentUser = validUser;
        sessionStorage.setItem("qa_logged_in_user", JSON.stringify(validUser));
        activateApp();
    } else {
        err.style.display = "block";
        err.innerText = "Invalid credentials or unauthorized device.";
    }
}

function processLogout() {
    sessionStorage.removeItem("qa_logged_in_user");
    location.reload();
}

function openPasswordModal() {
    document.getElementById("profileEmailDisplay").innerText = currentUser.id;
    document.getElementById("oldPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("passwordModal").style.display = "flex";
}
function closePasswordModal() { document.getElementById("passwordModal").style.display = "none"; }

function changePassword() {
    const oldP = document.getElementById("oldPassword").value;
    const newP = document.getElementById("newPassword").value;
    if(oldP !== currentUser.pass) return alert("Incorrect current password!");
    
    const userIndex = USER_MATRIX.findIndex(u => u.id === currentUser.id);
    if(userIndex !== -1) {
        USER_MATRIX[userIndex].pass = newP;
        localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX));
        currentUser.pass = newP;
        sessionStorage.setItem("qa_logged_in_user", JSON.stringify(currentUser));
        alert("Password updated securely!");
        closePasswordModal();
    }
}

function activateApp() {
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("appContainer").style.display = "block";
    
    if(currentUser.role !== "admin") { document.getElementById("navSetupBtn").style.display = "none"; }
    if(currentUser.role === "user" && currentUser.permission === "view") {
        document.getElementById("navEntryBtn").style.display = "none";
        showSection('dashboard');
    } else {
        showSection('entry');
    }

    refreshDropdowns(); initCanvas('entry'); initCanvas('modal'); loadDefectsFromCloud();
    if(currentUser.role === "admin") { renderAdminTables(); renderUserSetupCheckboxes(); renderUserTable(); }
}

function showSection(id) {
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    const sec = document.getElementById(id);
    if(sec) sec.classList.add("active");
    if(event && event.currentTarget) event.currentTarget.classList.add("active");
    if(id === 'report') renderReportTable();
    if(id === 'dashboard') renderCharts();
}

function getAllowedProjects() {
    if(currentUser.role === "admin" || currentUser.projects.includes("All")) return Object.keys(projects);
    return currentUser.projects.filter(p => projects[p]);
}

function refreshDropdowns() {
    const allowed = getAllowedProjects();
    ["project", "reportProject", "dashboardProjectFilter", "mapSetupProject"].forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = (id.includes("report") || id.includes("dashboard")) ? "<option value='All'>All Authorized Projects</option>" : "<option value=''>-- Select Project --</option>";
        allowed.forEach(p => el.appendChild(new Option(p, p)));
    });

    const typeSel = document.getElementById("defectType");
    if(typeSel) {
        typeSel.innerHTML = "<option value=''>-- Select Type --</option>";
        Object.keys(defectMatrix).forEach(type => typeSel.appendChild(new Option(type, type)));
    }
    populateTowers();
}

function populateTowers() {
    const p = document.getElementById("project").value;
    const tSel = document.getElementById("tower");
    tSel.innerHTML = '<option value="">-- Select Tower --</option>';
    if(p && projects[p]) projects[p].forEach(t => tSel.appendChild(new Option(t, t)));
    populateFloors();
}

function populateFloors() {
    const fSel = document.getElementById("floor");
    fSel.innerHTML = '<option value="">-- Select Floor --</option>';
    globalFloors.forEach(f => fSel.appendChild(new Option(f, f)));
    document.getElementById("entryMapWarning").style.display = "none";
    canvasConfig.entry.marker = null;
    document.getElementById("entryCoordX").value = ""; document.getElementById("entryCoordY").value = "";
}

// FIXED: Case match function name
function populateDefectlist() {
    const type = document.getElementById("defectType").value;
    const lSel = document.getElementById("defectlist"); // EXACT MATCH
    lSel.innerHTML = '<option value="">-- Select Specific Defect --</option>';
    if(defectMatrix[type]) defectMatrix[type].forEach(def => lSel.appendChild(new Option(def, def)));
}

function initCanvas(type) {
    const canvas = document.getElementById(`${type}Canvas`);
    if(!canvas) return;
    canvasConfig[type].ctx = canvas.getContext('2d');
    
    if(type === 'entry') {
        canvas.addEventListener("click", (e) => {
            if(!canvasConfig.entry.active) return;
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / canvasConfig.entry.scale;
            const y = (e.clientY - rect.top) / canvasConfig.entry.scale;
            canvasConfig.entry.marker = {x, y};
            document.getElementById("entryCoordX").value = x;
            document.getElementById("entryCoordY").value = y;
            drawCanvas(type);
        });
    }
}

function loadEntryMap() {
    const p = document.getElementById("project").value;
    const t = document.getElementById("tower").value;
    const f = document.getElementById("floor").value;
    const base64Img = floorMaps[`${p}_${t}_${f}`];
    const warn = document.getElementById("entryMapWarning");
    
    if(base64Img) {
        warn.style.display = "none"; canvasConfig.entry.active = true;
        const img = new Image();
        img.onload = () => {
            canvasConfig.entry.img = img;
            const canvas = document.getElementById('entryCanvas');
            canvas.width = img.width; canvas.height = img.height;
            drawCanvas('entry');
        };
        img.src = base64Img;
    } else {
        warn.style.display = "block"; canvasConfig.entry.active = false;
        canvasConfig.entry.img = null; canvasConfig.entry.marker = null;
        if(canvasConfig.entry.ctx) canvasConfig.entry.ctx.clearRect(0, 0, document.getElementById('entryCanvas').width, document.getElementById('entryCanvas').height);
    }
}

function drawCanvas(type) {
    const c = canvasConfig[type];
    const canvas = document.getElementById(`${type}Canvas`);
    if(!c.img || !c.ctx) return;
    
    c.ctx.clearRect(0, 0, canvas.width, canvas.height);
    c.ctx.drawImage(c.img, 0, 0);

    if(c.marker) {
        c.ctx.beginPath(); c.ctx.arc(c.marker.x, c.marker.y, 15, 0, 2 * Math.PI);
        c.ctx.fillStyle = "#ef4444"; c.ctx.fill();
        c.ctx.lineWidth = 4; c.ctx.strokeStyle = "#ffffff"; c.ctx.stroke();
    }
}

function zoomCanvas(canvasId, factor) {
    const type = canvasId.replace('Canvas', '');
    canvasConfig[type].scale *= factor;
    document.getElementById(canvasId).style.transform = `scale(${canvasConfig[type].scale})`;
}
function resetCanvas(canvasId) {
    const type = canvasId.replace('Canvas', '');
    canvasConfig[type].scale = 1;
    document.getElementById(canvasId).style.transform = `scale(1)`;
}

function triggerPhoto(){ if(tempPhotos.length >= 4) return alert("Max 4 photos allowed."); document.getElementById("photoInput").click(); }
function triggerEditPhoto(){ if(editTempPhotos.length >= 3) return alert("Max 3 photos allowed."); document.getElementById("editPhotoInput").click(); }

function onPhotoPicked(event){ processFile(event, tempPhotos, renderPhotoPreview); }
function onEditPhotoPicked(event){ processFile(event, editTempPhotos, renderEditPhotoPreview); }

function processFile(event, arr, renderFunc) {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            let scale = Math.min(1, 600/Math.max(img.width, img.height));
            canvas.width = img.width * scale; canvas.height = img.height * scale;
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            arr.push(canvas.toDataURL("image/jpeg", 0.6));
            renderFunc();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

function renderPhotoPreview() { renderThumbs("photoPreview", tempPhotos, removeTempPhoto); }
function renderEditPhotoPreview() { renderThumbs("editPhotoPreview", editTempPhotos, removeEditPhoto); }
function renderThumbs(id, arr, removeFunc) {
    const wrap = document.getElementById(id);
    if(!wrap) return;
    wrap.innerHTML = arr.map((src, i) => `<div class="thumb"><img src="${src}" onclick="openZoomImage('${src}')"/><button type="button" class="x" onclick="${removeFunc.name}(${i})">x</button></div>`).join('');
}
function removeTempPhoto(i){ tempPhotos.splice(i,1); renderPhotoPreview(); }
function removeEditPhoto(i){ editTempPhotos.splice(i,1); renderEditPhotoPreview(); }
function clearTempPhotos(){ tempPhotos = []; renderPhotoPreview(); }

// FIXED: Prevention of Multiple Submissions & Data Alignment
async function saveDefect(){
    if(currentUser.role === "user" && currentUser.permission === "view") return alert("You only have View Access.");

    const p = document.getElementById("project").value;
    const t = document.getElementById("tower").value;
    if(!p || !t || !projects[p] || !projects[p].includes(t)) return alert("Select valid Project and Tower.");
    if(tempPhotos.length < 2) return alert("Please add at least 2 Initial Photos.");
    
    const x = document.getElementById("entryCoordX").value;
    const y = document.getElementById("entryCoordY").value;
    if(canvasConfig.entry.active && (!x || !y)) return alert("Please pinpoint the defect location on the map.");

    const today = new Date().toISOString().slice(0,10);
    const dueStr = document.getElementById("duedate").value;
    let delay = "On Time";
    if(dueStr && new Date() > new Date(dueStr)) delay = Math.floor((new Date() - new Date(dueStr))/(1000*60*60*24))+" days";

    // Getting Button & Disabling
    const submitBtn = document.getElementById("mainSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> TRANSMITTING DATA...';

    const payload = {
        project: p, tower: t, floor: document.getElementById("floor").value, flat: document.getElementById("flatNo").value,
        Type: document.getElementById("defectType").value, defectlist: document.getElementById("defectlist").value, // EXACT MAPPING
        remark: document.getElementById("remark").value, intensity: document.getElementById("intensity").value,
        status: document.getElementById("status").value, duedate: dueStr, loggeddate: today,
        photos: tempPhotos.join("|||"), final_photos: "", 
        map_x: x ? parseFloat(x).toFixed(2) : "0", map_y: y ? parseFloat(y).toFixed(2) : "0", delay: delay, closeddate: document.getElementById("status").value === "Closed" ? today : "-"
    };

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/defect`, {
            method: "POST", headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if(res.ok) {
            alert("Record Logged Successfully!");
            document.getElementById("defectForm").reset();
            clearTempPhotos(); canvasConfig.entry.marker = null; drawCanvas('entry');
            await loadDefectsFromCloud();
        } else throw await res.json();
    } catch(err) { 
        alert("Error: " + JSON.stringify(err)); 
    } finally {
        // Re-enable button
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-network-wired"></i> TRANSMIT ENTRY';
    }
}

async function loadDefectsFromCloud(){
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/defect?select=*&order=id.asc`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }});
        if(res.ok) {
            const data = await res.json();
            defects = data.map((d, i) => ({ ...d, serial: i + 1, initialPics: d.photos ? d.photos.split("|||") : [], finalPics: d.final_photos ? d.final_photos.split("|||") : [] }));
            renderReportTable();
        }
    } catch(e) { console.error(e); }
}

function generateTableRowsHtml(dataArray) {
    const canEdit = currentUser.role === "admin" || currentUser.permission === "edit";

    return dataArray.map(d => {
        const initialHtml = `<div class="img-grid-cell">${d.initialPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        const finalHtml = `<div class="img-grid-cell">${d.finalPics.map(p=>`<img src="${p}" onclick="openZoomImage('${p}')"/>`).join('')}</div>`;
        
        let actionHtml = `<span style="color:#94a3b8; font-size:11px;">View Only</span>`;
        if(canEdit) actionHtml = `<button class="btn-capture-tech action-btn" onclick="openEditModal(${d.id})">Action</button>`;

        let mapText = "Not Mapped";
        if(d.map_x && d.map_y && d.map_x !== "0") mapText = `X: ${d.map_x}, Y: ${d.map_y}`;

        return `
            <tr>
                <td>${d.serial}</td>
                <td><b>${d.project}</b></td>
                <td>${d.tower}</td>
                <td>${d.floor}</td>
                <td>${d.flat}</td>
                <td><b>${d.Type}</b></td>
                <td>${d.defectlist || "-"}</td>
                <td>${d.remark || "-"}</td>
                <td><span class="map-badge"><i class="fas fa-map-marker-alt text-cyan"></i> ${mapText}</span></td>
                <td>${d.intensity}</td>
                <td><span class="locked-badge">${d.status}</span></td>
                <td>${d.loggeddate}</td>
                <td>${d.duedate}</td>
                <td>${d.closeddate}</td>
                <td>${d.delay}</td>
                <td>${initialHtml}</td>
                <td>${finalHtml}</td>
                <td class="action-cell">${actionHtml}</td>
            </tr>`;
    }).join("");
}

function renderReportTable(){
    const allowedProjects = getAllowedProjects();
    const pFilt = document.getElementById("reportProject").value;
    
    const filtered = defects.filter(d => {
        const isAllowed = currentUser.role === "admin" || allowedProjects.includes(d.project);
        const matchDropdown = pFilt === "All" ? true : d.project === pFilt;
        return isAllowed && matchDropdown;
    });
    document.querySelector("#defectsTable tbody").innerHTML = generateTableRowsHtml(filtered);
}

function openEditModal(id) {
    if(currentUser.role === "user" && currentUser.permission === "view") return alert("View Only Access.");
    const d = defects.find(x => x.id === id);
    if(!d) return;
    
    document.getElementById("editDefectId").value = id;
    document.getElementById("editStatus").value = d.status;
    
    const initWrap = document.getElementById("editInitialPhotoWrap");
    initWrap.innerHTML = d.initialPics.map(p => `<div class="thumb"><img src="${p}" onclick="openZoomImage('${p}')"/></div>`).join('');
    
    editTempPhotos = [...d.finalPics];
    renderEditPhotoPreview();

    const mapKey = `${d.project}_${d.tower}_${d.floor}`;
    const base64Img = floorMaps[mapKey];
    if(base64Img && d.map_x && d.map_y) {
        canvasConfig.modal.marker = {x: parseFloat(d.map_x), y: parseFloat(d.map_y)};
        const img = new Image(); img.onload = () => {
            canvasConfig.modal.img = img;
            document.getElementById('modalCanvas').width = img.width; 
            document.getElementById('modalCanvas').height = img.height;
            drawCanvas('modal');
        };
        img.src = base64Img;
    } else {
        canvasConfig.modal.img = null;
        if(document.getElementById('modalCanvas').getContext('2d')) {
            document.getElementById('modalCanvas').getContext('2d').clearRect(0,0,100,100);
        }
    }
    document.getElementById("editModal").style.display = "flex";
}
function closeEditModal() { document.getElementById("editModal").style.display = "none"; }

// FIXED: Update Payload and Request Type (PATCH + Disabled Button)
async function submitEditDefect() {
    const id = parseInt(document.getElementById("editDefectId").value);
    const stat = document.getElementById("editStatus").value;
    
    if(stat === "Closed" && editTempPhotos.length === 0) return alert("Must add Final Verification Photo to close defect.");

    const editBtn = document.getElementById("editSubmitBtn");
    editBtn.disabled = true;
    editBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    let payload = { status: stat, final_photos: editTempPhotos.join("|||") };
    if(stat === "Closed") payload.closeddate = new Date().toISOString().slice(0,10);
    else payload.closeddate = "-";

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/defect?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload) // FIXED Variable Mapping
        });
        if(res.ok) { 
            alert("Record Updated!"); 
            closeEditModal(); 
            await loadDefectsFromCloud(); 
        } else throw await res.json();
    } catch(e) { 
        alert("Error updating: " + JSON.stringify(e)); 
    } finally {
        editBtn.disabled = false;
        editBtn.innerHTML = '<i class="fas fa-save"></i> Save Updates';
    }
}

function toggleProjectRights() {
    const role = document.getElementById("suRole").value;
    document.getElementById("projectRightsContainer").style.display = (role === "admin") ? "none" : "block";
}

function renderUserSetupCheckboxes() {
    const cont = document.getElementById("projectCheckboxes");
    if(!cont) return;
    cont.innerHTML = Object.keys(projects).map(p => `<label><input type="checkbox" class="proj-chk" value="${p}"> ${p}</label>`).join('');
}

function saveSystemUser() {
    const email = document.getElementById("suEmail").value.trim();
    const pass = document.getElementById("suPass").value;
    const role = document.getElementById("suRole").value;
    const rights = document.getElementById("suRights").value;
    
    let selProjects = [];
    if(role === "admin") {
        selProjects = ["All"];
    } else {
        document.querySelectorAll(".proj-chk:checked").forEach(cb => selProjects.push(cb.value));
        if(selProjects.length === 0) return alert("Select at least one project for standard user.");
    }

    const existIdx = USER_MATRIX.findIndex(u => u.id.toLowerCase() === email.toLowerCase());
    const newUser = { id: email, pass: pass, role: role, projects: selProjects, permission: rights };
    
    if(existIdx >= 0) USER_MATRIX[existIdx] = newUser;
    else USER_MATRIX.push(newUser);

    localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX));
    alert("User Access Saved Successfully!");
    document.getElementById("suEmail").value = ""; document.getElementById("suPass").value = "";
    renderUserTable();
}

function renderUserTable() {
    const tbody = document.querySelector("#usersTable tbody");
    if(!tbody) return;
    tbody.innerHTML = USER_MATRIX.map(u => {
        const pBadge = u.role === "admin" ? `<span class="tech-badge bg-blue">Global All</span>` : u.projects.join(", ");
        const rBadge = u.role === "admin" ? "Full Admin" : (u.permission === "edit" ? "Log & Edit" : "View Only");
        return `<tr>
            <td><b>${u.id}</b></td><td>${u.role.toUpperCase()}</td>
            <td style="white-space:normal; max-width:150px;">${pBadge}</td><td>${rBadge}</td>
            <td>${u.id === currentUser.id ? "<i>(You)</i>" : `<button class="btn-danger-tech pad-sm" onclick="deleteUser('${u.id}')">Del</button>`}</td>
        </tr>`;
    }).join('');
}
function deleteUser(email) {
    if(!confirm(`Delete access for ${email}?`)) return;
    USER_MATRIX = USER_MATRIX.filter(u => u.id !== email);
    localStorage.setItem("qa_users", JSON.stringify(USER_MATRIX));
    renderUserTable();
}

function renderAdminTables() {
    const hBody = document.querySelector("#hierarchyTable tbody");
    const cBody = document.querySelector("#categoryTable tbody");
    if(hBody) hBody.innerHTML = Object.keys(projects).map(p => `<tr><td><b>${p}</b></td><td style="white-space:normal;">${projects[p].join(", ")}</td><td><button class="btn-danger-tech pad-sm" onclick="delProj('${p}')">Del</button></td></tr>`).join('');
    if(cBody) cBody.innerHTML = Object.keys(defectMatrix).map(c => `<tr><td><b>${c}</b></td><td style="white-space:normal;">${defectMatrix[c].join(", ")}</td><td><button class="btn-danger-tech pad-sm" onclick="delCat('${c}')">Del</button></td></tr>`).join('');
}

function saveHierarchy() {
    const p = document.getElementById("setupProjName").value.trim();
    const t = document.getElementById("setupTowers").value.split(",").map(s=>s.trim());
    const f = document.getElementById("setupFloors").value.split(",").map(s=>s.trim()); 
    projects[p] = t; f.forEach(fl => { if(!globalFloors.includes(fl)) globalFloors.push(fl); });
    localStorage.setItem("qa_projects", JSON.stringify(projects));
    localStorage.setItem("qa_globalFloors", JSON.stringify(globalFloors));
    refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); alert("Hierarchy Saved!");
}

function saveCategory() {
    const c = document.getElementById("setupCatName").value.trim();
    const s = document.getElementById("setupSpecs").value.split(",").map(x=>x.trim());
    defectMatrix[c] = s; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix));
    refreshDropdowns(); renderAdminTables(); alert("Category Saved!");
}

function delProj(p) { if(confirm("Delete Project?")) { delete projects[p]; localStorage.setItem("qa_projects", JSON.stringify(projects)); refreshDropdowns(); renderAdminTables(); renderUserSetupCheckboxes(); } }
function delCat(c) { if(confirm("Delete Category?")) { delete defectMatrix[c]; localStorage.setItem("qa_defectMatrix", JSON.stringify(defectMatrix)); refreshDropdowns(); renderAdminTables(); } }

function populateMapSetupTowers() {
    const p = document.getElementById("mapSetupProject").value;
    const tSel = document.getElementById("mapSetupTower");
    tSel.innerHTML = '<option value="">Tower</option>';
    if(p && projects[p]) projects[p].forEach(t => tSel.appendChild(new Option(t, t)));
}

function populateMapSetupFloors() {
    const fSel = document.getElementById("mapSetupFloor");
    fSel.innerHTML = '<option value="">Floor</option>';
    globalFloors.forEach(f => fSel.appendChild(new Option(f, f)));
}

function saveMapDrawing(e) {
    const p = document.getElementById("mapSetupProject").value;
    const t = document.getElementById("mapSetupTower").value;
    const f = document.getElementById("mapSetupFloor").value;
    if(!p || !t || !f) { alert("Select Project, Tower and Floor first!"); e.target.value=""; return; }
    
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            let scale = Math.min(1, 1200/Math.max(img.width, img.height)); 
            canvas.width = img.width * scale; canvas.height = img.height * scale;
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            floorMaps[`${p}_${t}_${f}`] = canvas.toDataURL("image/jpeg", 0.7);
            localStorage.setItem("qa_floorMaps", JSON.stringify(floorMaps));
            alert("Floor Map Successfully Mapped to Database.");
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function openZoomImage(url) {
    document.getElementById("zoomedImage").src = url;
    document.getElementById("imageZoomModal").style.display = "flex";
}
function closeImageZoom() { document.getElementById("imageZoomModal").style.display = "none"; }

let pChart, sChart;
function openDrillModal(title, data) {
    currentDrilldownData = data;
    document.getElementById("modalTitle").innerHTML = `<i class="fas fa-search-plus text-cyan"></i> Deep-Drill: ${title} (${data.length} Records)`;
    let html = generateTableRowsHtml(data);
    html = html.replace(/<td class="action-cell">.*?<\/td>/g, ""); 
    document.querySelector("#drilldownTable tbody").innerHTML = html;
    document.getElementById("drilldownModal").style.display = "flex";
}
function closeDrillModal() { document.getElementById("drilldownModal").style.display = "none"; }

function renderCharts() {
    const allowedProjects = getAllowedProjects();
    const filterProj = document.getElementById("dashboardProjectFilter").value;
    
    const filteredData = defects.filter(d => {
        const isAllowed = currentUser.role === "admin" || allowedProjects.includes(d.project);
        const matchDropdown = filterProj === "All" ? true : d.project === filterProj;
        return isAllowed && matchDropdown;
    });

    const mainVolMap = {};
    const statusMap = { "Open": 0, "In Progress": 0, "Closed": 0 };

    filteredData.forEach(d => {
        mainVolMap[d.project] = (mainVolMap[d.project] || 0) + 1;
        if (statusMap[d.status] !== undefined) statusMap[d.status]++;
    });

    if (pChart) pChart.destroy();
    if (sChart) sChart.destroy();

    const c1 = document.getElementById("projectChart");
    const c2 = document.getElementById("statusChart");

    if (c1) {
        pChart = new Chart(c1, { 
            type: 'bar', 
            data: { labels: Object.keys(mainVolMap), datasets: [{ label: 'Defect Volume', data: Object.values(mainVolMap), backgroundColor: '#0284c7' }] }, 
            options: { responsive: true, maintainAspectRatio: false, onClick: (e, elements) => { if(elements.length > 0) { const idx = elements[0].index; const pName = Object.keys(mainVolMap)[idx]; openDrillModal(`Project - ${pName}`, filteredData.filter(x => x.project === pName)); } } } 
        });
    }
    if (c2) {
        sChart = new Chart(c2, { 
            type: 'pie', 
            data: { labels: Object.keys(statusMap), datasets: [{ data: Object.values(statusMap), backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }] }, 
            options: { responsive: true, maintainAspectRatio: false, onClick: (e, elements) => { if(elements.length > 0) { const idx = elements[0].index; const sName = Object.keys(statusMap)[idx]; openDrillModal(`Status - ${sName}`, filteredData.filter(x => x.status === sName)); } } } 
        });
    }
}

async function exportExcelWithPhotos(dataToExport) {
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    if (typeof ExcelJS === "undefined") return alert("ExcelJS engine missing. Please check internet connection.");
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('PMC Defect Report');

    sheet.columns = [
        { header: 'ID', key: 'serial', width: 8 }, { header: 'Project', key: 'project', width: 16 }, 
        { header: 'Tower', key: 'tower', width: 12 }, { header: 'Floor', key: 'floor', width: 12 }, 
        { header: 'Flat', key: 'flat', width: 12 }, { header: 'Category', key: 'Type', width: 20 },
        { header: 'Specification', key: 'defectlist', width: 25 }, { header: 'Remarks', key: 'remark', width: 30 }, 
        { header: 'Map Coord', key: 'map', width: 15 }, { header: 'Risk', key: 'intensity', width: 12 }, 
        { header: 'Status', key: 'status', width: 12 }, { header: 'Logged Date', key: 'loggeddate', width: 15 },
        { header: 'SLA Date', key: 'duedate', width: 15 }, { header: 'Closed Date', key: 'closeddate', width: 15 },
        { header: 'Delay', key: 'delay', width: 12 }, { header: 'Initial Photos', key: 'initial', width: 28 },
        { header: 'Final Photos', key: 'final', width: 28 }
    ];

    const hRow = sheet.getRow(1);
    hRow.font = { bold: true, color: { argb: 'FFFFFF' } }; 
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };

    dataToExport.forEach((d, i) => {
        let mapText = "N/A";
        if(d.map_x && d.map_y && d.map_x !== "0") mapText = `X:${d.map_x}, Y:${d.map_y}`;
        const rowData = { ...d, map: mapText };
        const row = sheet.addRow(rowData); row.height = 60;
        
        let pCount = 0;
        [...d.initialPics].forEach((pSrc) => {
            if(pSrc.startsWith("data:image")) {
                try { const imgId = workbook.addImage({ base64: pSrc, extension: 'jpeg' }); sheet.addImage(imgId, { tl: { col: 15 + (pCount*0.4), row: row.number-1 }, ext: { width: 50, height: 50 } }); pCount++; } catch(e){}
            }
        });
        
        pCount = 0;
        [...d.finalPics].forEach((pSrc) => {
            if(pSrc.startsWith("data:image")) {
                try { const imgId = workbook.addImage({ base64: pSrc, extension: 'jpeg' }); sheet.addImage(imgId, { tl: { col: 16 + (pCount*0.4), row: row.number-1 }, ext: { width: 50, height: 50 } }); pCount++; } catch(e){}
            }
        });
    });

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `PMC_Report_Detailed.xlsx`;
    a.click();
}

function exportPDF(dataToExport){ 
    if(!dataToExport || dataToExport.length === 0) return alert("No data to export.");
    const windowObj = window.open("", "", "width=950,height=750");
    const style = `<style>body{font-family:'Segoe UI',sans-serif; padding:15px; color:#233;} h1{border-bottom:2px solid #0284c7; padding-bottom:10px;} .card{border:1px solid #cbd5e1; border-radius:12px; padding:14px; margin-bottom:16px; page-break-inside: avoid;} .grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px;} .meta{font-size:13px; line-height:1.6} .photos{display:flex; gap:10px; margin-top:12px;} .photos img{width:140px; height:140px; object-fit:cover; border-radius:8px; border:1px solid #ccc;}</style>`;
    let html = `<h1>PMC Quality Audit Dossier</h1>`;
    
    dataToExport.forEach((d, i)=>{
        let mapText = "Not Mapped";
        if(d.map_x && d.map_y && d.map_x !== "0") mapText = `X: ${d.map_x}, Y: ${d.map_y}`;
        html += `<div class="card"><div class="grid"><div class="meta">
            <b>Sl No:</b> ${d.serial} | <b>Project:</b> ${d.project}<br/><b>Tower:</b> ${d.tower}<br/><b>Floor:</b> ${d.floor} | <b>Flat:</b> ${d.flat}<br/><b>Map Coordinate:</b> ${mapText}<br/><b>Remarks:</b> ${d.remark || "-"}<br/><b>Status:</b> ${d.status}
            </div><div class="meta"><b>Category:</b> ${d.Type}<br/><b>Specification:</b> ${d.defectlist}<br/><b>Risk:</b> ${d.intensity}<br/>
            <b>Dates -> Logged:</b> ${d.loggeddate} | <b>Closed:</b> ${d.closeddate === "-" ? "" : d.closeddate}
            </div></div><div class="photos"><b>Initial: </b>${d.initialPics.map(src=> `<img src="${src}" />`).join("")}</div>
            <div class="photos"><b>Final: </b>${d.finalPics.map(src=> `<img src="${src}" />`).join("")}</div></div>`;
    });
    
    windowObj.document.write(style + html); windowObj.document.close();
    setTimeout(() => { windowObj.print(); windowObj.close(); }, 800);
}