/**
 * ============================================================================
 * MAIN.JS - Klinik Naseha Hybrid App Frontend Logic
 * ============================================================================
 * Komunikasi ke backend GAS via /api/proxy (Vercel Serverless).
 * Semua fitur dari versi lama dipertahankan:
 *  - Registrasi antrean + tiket cetak
 *  - Konsol loket (panggil, ulang, layani, lewati, batal)
 *  - Konsol dokter (mulai & selesaikan pemeriksaan)
 *  - Master data poli & dokter
 *  - TTS pemanggil otomatis
 *  - Laporan CSV
 *  - Polling sinkronisasi multi-client
 *
 * FIX: Bug "antrean terhapus dan terulang dari awal"
 *  - Penyebab: tanggal client (UTC) tidak match dengan filter tanggal server (Asia/Jakarta)
 *    sehingga antrean "tak terlihat" saat polling → nomor reset ke A-001.
 *  - Solusi: gunakan getLocalDateStr() di client & server override date/waktuDaftar.
 * ============================================================================
 */

const API_URL = '/api/proxy';
const POLL_INTERVAL_MS = 15000;
const STATE_KEY = 'klinik_naseha_state_v2';

// ============================================================
// GLOBAL STATE
// ============================================================
let appState = {
    services: [],
    doctors: [],
    queues: [],
    activeCall: null
};

let isPolling = false;
let isSubmitting = false;
let connStatus = 'loading';

// ============================================================
// DATE HELPER (LOCAL, BUKAN UTC)
// ============================================================
function getLocalDateStr(dateObj) {
    const d = dateObj || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// ============================================================
// API HELPERS
// ============================================================
async function apiGet(action, params = {}) {
    try {
        const query = new URLSearchParams({ action, ...params }).toString();
        const res = await fetch(`${API_URL}?${query}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setConnectionStatus(data && data.success === false ? 'offline' : 'online');
        return data;
    } catch (err) {
        setConnectionStatus('offline');
        return { success: false, message: err.message };
    }
}

async function apiPost(action, params = {}) {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...params })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setConnectionStatus(data && data.success === false ? 'offline' : 'online');
        return data;
    } catch (err) {
        setConnectionStatus('offline');
        return { success: false, message: err.message };
    }
}

function setConnectionStatus(status) {
    connStatus = status;
    const dot = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (dot) {
        dot.classList.remove('online', 'offline', 'loading');
        dot.classList.add(status);
    }
    if (label) {
        if (status === 'online')       label.innerText = 'Terhubung ke Server (Real-time)';
        else if (status === 'offline') label.innerText = 'Koneksi Terputus — Mode Cache';
        else                            label.innerText = 'Menghubungkan...';
    }
}

// ============================================================
// LOCAL PERSISTENCE
// ============================================================
function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(appState)); }
    catch (e) { console.warn('saveState failed:', e); }
}

function loadState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            appState.services   = parsed.services || [];
            appState.doctors    = parsed.doctors || [];
            appState.queues     = parsed.queues || [];
            appState.activeCall = appState.queues.find(q => q.status === 'Dipanggil') || null;
        }
    } catch (e) { console.warn('loadState failed:', e); }
}

// ============================================================
// SERVER SYNC
// ============================================================
async function fetchServerData() {
    if (isPolling) return;
    isPolling = true;
    try {
        const response = await apiGet('initialData');
        if (response && response.success) {
            if (Array.isArray(response.services)) appState.services = response.services;
            if (Array.isArray(response.doctors))  appState.doctors  = response.doctors;
            if (Array.isArray(response.queues))   appState.queues   = response.queues;
            appState.activeCall = appState.queues.find(q => q.status === 'Dipanggil') || null;
            saveState();
            renderAllViews();
            populateFormOptions();
        }
    } catch (err) {
        console.warn('fetchServerData warning:', err);
        setConnectionStatus('offline');
    } finally {
        isPolling = false;
    }
}

function manualRefresh() {
    showToast('Menyegarkan data dari server...', 'info');
    fetchServerData();
}

// ============================================================
// LIFECYCLE
// ============================================================
window.onload = function () {
    loadState();
    startClock();
    populateFormOptions();
    renderAllViews();
    setConnectionStatus('loading');
    fetchServerData();
    setInterval(fetchServerData, POLL_INTERVAL_MS);
};

function startClock() {
    function update() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
        const dateStr = now.toLocaleDateString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
        });
        const t = document.getElementById('clock-time');
        const d = document.getElementById('clock-date');
        if (t) t.innerText = timeStr;
        if (d) d.innerText = dateStr;
    }
    update();
    setInterval(update, 1000);
}

// ============================================================
// NAVIGATION
// ============================================================
function switchTab(tabId) {
    const tabs = ['display', 'register', 'loket', 'dokter', 'admin'];
    tabs.forEach(t => {
        const pageEl = document.getElementById(`page-${t}`);
        const tabBtn = document.getElementById(`tab-${t}`);
        if (t === tabId) {
            if (pageEl) pageEl.classList.remove('hidden');
            if (tabBtn) {
                tabBtn.classList.add('bg-white/20', 'text-white', 'border-white');
                tabBtn.classList.remove('text-blue-100', 'border-transparent');
            }
        } else {
            if (pageEl) pageEl.classList.add('hidden');
            if (tabBtn) {
                tabBtn.classList.remove('bg-white/20', 'text-white', 'border-white');
                tabBtn.classList.add('text-blue-100', 'border-transparent');
            }
        }
    });
    renderAllViews();
}

// ============================================================
// RENDER: ALL
// ============================================================
function renderAllViews() {
    renderDisplayBoard();
    renderLoketConsole();
    renderDokterConsole();
    renderAdminView();
}

// ---------------- DISPLAY BOARD ----------------
function renderDisplayBoard() {
    const callNumber = document.getElementById('call-number');
    const callName   = document.getElementById('call-patient-name');
    const callServ   = document.getElementById('call-service-name');
    const callTarget = document.getElementById('call-target-text');

    if (appState.activeCall) {
        if (callNumber) callNumber.innerText = appState.activeCall.no;
        if (callName)   callName.innerText   = appState.activeCall.name;
        const s = appState.services.find(x => x.id === appState.activeCall.serviceId);
        const d = appState.doctors.find(x => x.id === appState.activeCall.doctorId);
        if (callServ)   callServ.innerText   = s ? s.name : 'Poli Umum';
        if (callTarget) callTarget.innerText = d ? `Menuju ${d.name}` : 'Menuju Loket Pelayanan';
    } else {
        if (callNumber) callNumber.innerText = '---';
        if (callName)   callName.innerText   = 'Silakan Menunggu Panggilan';
        if (callServ)   callServ.innerText   = 'Klinik Naseha';
        if (callTarget) callTarget.innerText = 'Loket Pelayanan';
    }

    const poliContainer = document.getElementById('display-poli-cards');
    if (poliContainer) {
        if (appState.services.length === 0) {
            poliContainer.innerHTML = `<div class="bg-white p-4 rounded-2xl border border-slate-200 text-xs text-slate-400 text-center">Belum ada data layanan. Jalankan Setup DB.</div>`;
        } else {
            poliContainer.innerHTML = appState.services.map(serv => {
                const countWaiting = appState.queues.filter(q => q.serviceId === serv.id && q.status === 'Menunggu').length;
                const activeInPoli = appState.queues.find(q => q.serviceId === serv.id && (q.status === 'Dipanggil' || q.status === 'Dilayani'));
                return `
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <div class="text-xs font-bold text-slate-400">${escapeHtml(serv.name)}</div>
                            <div class="text-lg font-black text-slate-800 font-mono mt-0.5">${activeInPoli ? escapeHtml(activeInPoli.no) : '---'}</div>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Menunggu</span>
                            <div class="text-sm font-extrabold text-amber-600">${countWaiting} Pasien</div>
                        </div>
                    </div>`;
            }).join('');
        }
    }

    const servingList = appState.queues.filter(q => q.status === 'Dilayani');
    const badgeServing = document.getElementById('badge-count-serving');
    if (badgeServing) badgeServing.innerText = servingList.length;

    const tableServing = document.getElementById('table-display-serving');
    if (tableServing) {
        if (servingList.length === 0) {
            tableServing.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 text-xs">Belum ada pasien dilayani</td></tr>`;
        } else {
            tableServing.innerHTML = servingList.map(q => {
                const serv = appState.services.find(s => s.id === q.serviceId);
                return `
                    <tr class="hover:bg-slate-50">
                        <td class="p-3 font-mono font-bold text-emerald-700">${escapeHtml(q.no)}</td>
                        <td class="p-3 font-medium text-slate-800">${escapeHtml(q.name)}</td>
                        <td class="p-3 text-slate-500">${serv ? escapeHtml(serv.name) : '-'}</td>
                        <td class="p-3 text-right font-mono text-xs text-slate-400">${escapeHtml(q.waktuPanggil || '-')}</td>
                    </tr>`;
            }).join('');
        }
    }

    const waitingList = appState.queues.filter(q => q.status === 'Menunggu');
    const badgeWaiting = document.getElementById('badge-count-waiting');
    if (badgeWaiting) badgeWaiting.innerText = waitingList.length;

    const tableWaiting = document.getElementById('table-display-waiting');
    if (tableWaiting) {
        if (waitingList.length === 0) {
            tableWaiting.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400 text-xs">Antrean kosong</td></tr>`;
        } else {
            tableWaiting.innerHTML = waitingList.map(q => {
                const serv = appState.services.find(s => s.id === q.serviceId);
                return `
                    <tr class="hover:bg-slate-50">
                        <td class="p-3 font-mono font-bold text-slate-700">${escapeHtml(q.no)}</td>
                        <td class="p-3 font-medium text-slate-800">${escapeHtml(q.name)}</td>
                        <td class="p-3 text-slate-500">${serv ? escapeHtml(serv.name) : '-'}</td>
                        <td class="p-3 text-right">
                            <span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-bold">Menunggu</span>
                        </td>
                    </tr>`;
            }).join('');
        }
    }
}

// ---------------- LOKET CONSOLE ----------------
function renderLoketConsole() {
    const filterLoket = document.getElementById('filter-loket-service');
    const filterServ = filterLoket ? filterLoket.value : 'ALL';

    let list = appState.queues;
    if (filterServ && filterServ !== 'ALL') {
        list = list.filter(q => q.serviceId === filterServ);
    }

    const curNo = document.getElementById('loket-current-no');
    const curName = document.getElementById('loket-current-name');
    const curPoli = document.getElementById('loket-current-poli');

    if (appState.activeCall) {
        if (curNo) curNo.innerText = appState.activeCall.no;
        if (curName) curName.innerText = appState.activeCall.name;
        const serv = appState.services.find(s => s.id === appState.activeCall.serviceId);
        if (curPoli) curPoli.innerText = serv ? serv.name : '--';
    } else {
        if (curNo) curNo.innerText = '---';
        if (curName) curName.innerText = 'Belum Ada Panggilan';
        if (curPoli) curPoli.innerText = '--';
    }

    const tbody = document.getElementById('table-loket-list');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Tidak ada data antrean.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(q => {
        const serv = appState.services.find(s => s.id === q.serviceId);
        const doc = appState.doctors.find(d => d.id === q.doctorId);

        let badgeClass = 'bg-slate-100 text-slate-600';
        if (q.status === 'Menunggu')  badgeClass = 'bg-amber-100 text-amber-800';
        if (q.status === 'Dipanggil') badgeClass = 'bg-blue-100 text-blue-800 font-bold animate-pulse';
        if (q.status === 'Dilayani')  badgeClass = 'bg-emerald-100 text-emerald-800 font-bold';
        if (q.status === 'Selesai')   badgeClass = 'bg-slate-200 text-slate-700';
        if (q.status === 'Dilewati' || q.status === 'Batal') badgeClass = 'bg-rose-100 text-rose-800';

        const canCall = q.status === 'Menunggu' || q.status === 'Dilewati';

        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3 font-mono font-bold text-md-primary">${escapeHtml(q.no)}</td>
                <td class="p-3 text-slate-500 text-xs">${escapeHtml(q.waktuDaftar)}</td>
                <td class="p-3 font-bold text-slate-800">${escapeHtml(q.name)}</td>
                <td class="p-3 text-slate-600 text-xs">${serv ? escapeHtml(serv.name) : ''} / ${doc ? escapeHtml(doc.name) : ''}</td>
                <td class="p-3"><span class="px-2 py-1 rounded-full text-[10px] ${badgeClass}">${escapeHtml(q.status)}</span></td>
                <td class="p-3 text-right">
                    ${canCall ? `<button onclick="directCallQueue('${escapeHtml(q.id)}')" class="px-2.5 py-1 bg-md-primary hover:bg-blue-700 text-white font-bold text-[11px] rounded-lg transition">
                        <i class="fa-solid fa-bullhorn"></i> Panggil
                    </button>` : `<span class="text-[10px] text-slate-400">—</span>`}
                </td>
            </tr>`;
    }).join('');
}

// ---------------- DOKTER CONSOLE ----------------
function renderDokterConsole() {
    const docSelect = document.getElementById('filter-dokter-select');
    const docId = docSelect ? docSelect.value : (appState.doctors[0]?.id || '');

    const activePeriksa = appState.queues.find(q =>
        q.doctorId === docId && (q.status === 'Dilayani' || q.status === 'Dipanggil')
    );

    const docNo   = document.getElementById('doc-active-no');
    const docName = document.getElementById('doc-active-name');
    const docInfo = document.getElementById('doc-active-info');

    if (activePeriksa) {
        if (docNo)   docNo.innerText   = activePeriksa.no;
        if (docName) docName.innerText = activePeriksa.name;
        if (docInfo) docInfo.innerText = `NIK: ${activePeriksa.nik || '-'} | Telp: ${activePeriksa.phone || '-'}`;
    } else {
        if (docNo)   docNo.innerText   = '---';
        if (docName) docName.innerText = 'Tidak Ada Pasien';
        if (docInfo) docInfo.innerText = 'Pilih panggilan pasien dari tabel di sebelah kanan.';
    }

    const list = appState.queues.filter(q =>
        q.doctorId === docId && q.status !== 'Selesai' && q.status !== 'Batal'
    );
    const tbody = document.getElementById('table-dokter-list');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Tidak ada antrean pasien untuk dokter ini.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map(q => {
        let badgeClass = 'bg-amber-100 text-amber-800';
        if (q.status === 'Dipanggil') badgeClass = 'bg-blue-100 text-blue-800';
        if (q.status === 'Dilayani')  badgeClass = 'bg-emerald-100 text-emerald-800';

        return `
            <tr class="hover:bg-slate-50">
                <td class="p-3 font-mono font-bold text-md-primary">${escapeHtml(q.no)}</td>
                <td class="p-3 font-semibold text-slate-800">${escapeHtml(q.name)}</td>
                <td class="p-3"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${badgeClass}">${escapeHtml(q.status)}</span></td>
                <td class="p-3 text-right">
                    <button onclick="startDoctorCall('${escapeHtml(q.id)}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition">
                        <i class="fa-solid fa-stethoscope"></i> Periksa
                    </button>
                </td>
            </tr>`;
    }).join('');
}

// ---------------- ADMIN ----------------
function renderAdminView() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set('stat-total',   appState.queues.length);
    set('stat-waiting', appState.queues.filter(q => q.status === 'Menunggu').length);
    set('stat-serving', appState.queues.filter(q => q.status === 'Dilayani' || q.status === 'Dipanggil').length);
    set('stat-done',    appState.queues.filter(q => q.status === 'Selesai').length);

    const tServ = document.getElementById('table-master-services');
    if (tServ) {
        if (appState.services.length === 0) {
            tServ.innerHTML = `<tr><td colspan="3" class="p-3 text-center text-slate-400 text-xs">Belum ada layanan.</td></tr>`;
        } else {
            tServ.innerHTML = appState.services.map(s => `
                <tr>
                    <td class="p-2.5 font-mono font-bold text-md-primary">${escapeHtml(s.prefix)}</td>
                    <td class="p-2.5 font-semibold text-slate-800">${escapeHtml(s.name)}</td>
                    <td class="p-2.5 text-right">
                        <button onclick="deleteService('${escapeHtml(s.id)}')" class="text-rose-600 hover:underline"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`).join('');
        }
    }

    const tDoc = document.getElementById('table-master-doctors');
    if (tDoc) {
        if (appState.doctors.length === 0) {
            tDoc.innerHTML = `<tr><td colspan="3" class="p-3 text-center text-slate-400 text-xs">Belum ada dokter.</td></tr>`;
        } else {
            tDoc.innerHTML = appState.doctors.map(d => {
                const s = appState.services.find(serv => serv.id === d.serviceId);
                return `
                    <tr>
                        <td class="p-2.5 font-bold text-slate-800">${escapeHtml(d.name)}</td>
                        <td class="p-2.5 text-slate-500">${s ? escapeHtml(s.name) : '-'}</td>
                        <td class="p-2.5 text-right">
                            <button onclick="deleteDoctor('${escapeHtml(d.id)}')" class="text-rose-600 hover:underline"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>`;
            }).join('');
        }
    }
}

// ============================================================
// FORM OPTIONS
// ============================================================
function populateFormOptions() {
    const servSelect = document.getElementById('reg-service');
    const filterLoket = document.getElementById('filter-loket-service');

    if (servSelect) {
        servSelect.innerHTML = appState.services.length === 0
            ? `<option value="">-- Belum ada layanan --</option>`
            : appState.services.map(s => `<option value="${escapeHtml(s.id)}">[${escapeHtml(s.prefix)}] ${escapeHtml(s.name)}</option>`).join('');
    }
    if (filterLoket) {
        const currentVal = filterLoket.value;
        filterLoket.innerHTML = `<option value="ALL">Semua Poli / Layanan</option>` +
            appState.services.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
        if (currentVal && appState.services.some(s => s.id === currentVal)) filterLoket.value = currentVal;
    }

    updateDoctorOptions();
}

function updateDoctorOptions() {
    const servSelect = document.getElementById('reg-service');
    const selectedServ = servSelect ? servSelect.value : (appState.services[0]?.id || '');

    const docSelect = document.getElementById('reg-doctor');
    const docFilter = document.getElementById('filter-dokter-select');

    const filtered = appState.doctors.filter(d => d.serviceId === selectedServ);
    if (docSelect) {
        docSelect.innerHTML = filtered.length === 0
            ? `<option value="">-- Tidak ada dokter untuk layanan ini --</option>`
            : filtered.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
    }
    if (docFilter) {
        const prevVal = docFilter.value;
        docFilter.innerHTML = appState.doctors.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
        if (prevVal && appState.doctors.some(d => d.id === prevVal)) docFilter.value = prevVal;
    }
}

// ============================================================
// ACTION: REGISTER QUEUE
// ============================================================
async function submitQueue(e) {
    e.preventDefault();
    if (isSubmitting) return;

    const nameInput  = document.getElementById('reg-nama');
    const nikInput   = document.getElementById('reg-nik');
    const phoneInput = document.getElementById('reg-phone');
    const servSelect = document.getElementById('reg-service');
    const docSelect  = document.getElementById('reg-doctor');

    const name      = (nameInput.value || '').trim();
    const nik       = (nikInput.value || '').trim();
    const phone     = (phoneInput.value || '').trim();
    const serviceId = servSelect.value;
    const doctorId  = docSelect.value;

    if (!name)      return showToast('Nama pasien wajib diisi.', 'warning');
    if (!serviceId) return showToast('Pilih layanan poli terlebih dahulu.', 'warning');
    if (!doctorId)  return showToast('Pilih dokter terlebih dahulu.', 'warning');
    if (nik && !/^\d{8,16}$/.test(nik)) return showToast('NIK harus 8-16 digit angka.', 'warning');
    if (phone && !/^[0-9+\-\s]{8,15}$/.test(phone)) return showToast('Format No. HP tidak valid.', 'warning');

    const service = appState.services.find(s => s.id === serviceId);
    const doctor  = appState.doctors.find(d => d.id === doctorId);

    const countInPrefix = appState.queues.filter(q => q.serviceId === serviceId).length + 1;
    const noAntrean = `${service ? service.prefix : 'A'}-${String(countInPrefix).padStart(3, '0')}`;

    const newQueue = {
        id: 'Q-' + Date.now(),
        no: noAntrean,
        date: getLocalDateStr(),        // ✅ tanggal lokal, bukan UTC
        name, nik, phone, serviceId, doctorId,
        status: 'Menunggu',
        waktuDaftar: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        waktuPanggil: '',
        catatan: ''
    };

    isSubmitting = true;
    const btn = document.getElementById('btn-submit-queue');
    if (btn) btn.disabled = true;

    const result = await apiPost('saveQueue', { data: newQueue });

    isSubmitting = false;
    if (btn) btn.disabled = false;

    if (!result || !result.success) {
        showToast(result?.message || 'Gagal menyimpan antrean ke server.', 'error');
        return;
    }

    // ✅ Gunakan data yang SUDAH dinormalisasi server (server yang generate date & waktuDaftar)
    const savedQueue = result.data || newQueue;
    appState.queues.push(savedQueue);
    saveState();
    renderAllViews();

    document.getElementById('modal-ticket-no').innerText      = savedQueue.no;
    document.getElementById('modal-ticket-service').innerText = service ? service.name : '';
    document.getElementById('modal-ticket-name').innerText    = savedQueue.name;
    document.getElementById('modal-ticket-doctor').innerText  = doctor ? doctor.name : '';
    document.getElementById('modal-ticket-time').innerText    = savedQueue.waktuDaftar;
    document.getElementById('modal-ticket').classList.remove('hidden');

    document.getElementById('form-register').reset();
    populateFormOptions();
    showToast('Nomor antrean berhasil dicetak!', 'success');
}

function closeTicketModal() {
    document.getElementById('modal-ticket').classList.add('hidden');
}

// ============================================================
// ACTION: LOKET
// ============================================================
async function loketAction(type) {
    if (type === 'next') {
        const nextItem = appState.queues.find(q => q.status === 'Menunggu');
        if (!nextItem) return showToast('Tidak ada antrean pasien menunggu.', 'warning');
        return directCallQueue(nextItem.id);
    }

    if (type === 'recall') {
        if (!appState.activeCall) return showToast('Tidak ada antrean aktif yang sedang dipanggil.', 'warning');
        triggerTTS(appState.activeCall);
        return showToast(`Memanggil ulang antrean ${appState.activeCall.no}`, 'info');
    }

    if (!appState.activeCall) return showToast('Tidak ada antrean aktif.', 'warning');
    const active = appState.activeCall;

    if (type === 'serve') {
        const res = await apiPost('updateStatus', {
            id: active.id, status: 'Dilayani', waktuPanggil: active.waktuPanggil, catatan: ''
        });
        if (!res || !res.success) return showToast(res?.message || 'Gagal update status.', 'error');

        const idx = appState.queues.findIndex(q => q.id === active.id);
        if (idx !== -1) {
            appState.queues[idx].status = 'Dilayani';
            appState.activeCall = appState.queues[idx];
        }
        saveState();
        renderAllViews();
        return showToast(`Pasien ${active.no} sedang dilayani.`, 'success');
    }

    if (type === 'skip') {
        const res = await apiPost('updateStatus', { id: active.id, status: 'Dilewati', catatan: '' });
        if (!res || !res.success) return showToast(res?.message || 'Gagal update status.', 'error');

        const idx = appState.queues.findIndex(q => q.id === active.id);
        if (idx !== -1) appState.queues[idx].status = 'Dilewati';
        appState.activeCall = null;
        saveState();
        renderAllViews();
        return showToast('Antrean berhasil dilewati.', 'info');
    }

    if (type === 'cancel') {
        const res = await apiPost('updateStatus', { id: active.id, status: 'Batal', catatan: '' });
        if (!res || !res.success) return showToast(res?.message || 'Gagal update status.', 'error');

        const idx = appState.queues.findIndex(q => q.id === active.id);
        if (idx !== -1) appState.queues[idx].status = 'Batal';
        appState.activeCall = null;
        saveState();
        renderAllViews();
        return showToast('Antrean dibatalkan.', 'error');
    }
}

async function directCallQueue(queueId) {
    const target = appState.queues.find(q => q.id === queueId);
    if (!target) return;

    const waktuPanggil = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const res = await apiPost('updateStatus', { id: target.id, status: 'Dipanggil', waktuPanggil });

    if (!res || !res.success) {
        showToast(res?.message || 'Gagal memanggil antrean.', 'error');
        return;
    }

    const idx = appState.queues.findIndex(q => q.id === queueId);
    if (idx !== -1) {
        appState.queues[idx].status = 'Dipanggil';
        appState.queues[idx].waktuPanggil = waktuPanggil;
        appState.activeCall = appState.queues[idx];
    }
    saveState();
    renderAllViews();
    triggerTTS(target);
    showToast(`Memanggil antrean ${target.no}`, 'success');
}

// ============================================================
// ACTION: DOKTER
// ============================================================
async function startDoctorCall(queueId) {
    const target = appState.queues.find(q => q.id === queueId);
    if (!target) return;

    const res = await apiPost('updateStatus', {
        id: target.id, status: 'Dilayani', waktuPanggil: target.waktuPanggil || ''
    });
    if (!res || !res.success) return showToast(res?.message || 'Gagal update status.', 'error');

    const idx = appState.queues.findIndex(q => q.id === queueId);
    if (idx !== -1) {
        appState.queues[idx].status = 'Dilayani';
        appState.activeCall = appState.queues[idx];
    }
    saveState();
    renderAllViews();
    triggerTTS(target);
    showToast(`Pasien ${target.name} dipanggil masuk ruang periksa.`, 'info');
}

async function finishDoctorCheck() {
    const docSelect = document.getElementById('filter-dokter-select');
    const docId = docSelect ? docSelect.value : '';
    const active = appState.queues.find(q =>
        q.doctorId === docId && (q.status === 'Dilayani' || q.status === 'Dipanggil')
    );

    if (!active) return showToast('Tidak ada pasien yang sedang diperiksa.', 'warning');

    const notesEl = document.getElementById('doc-notes');
    const notes = notesEl ? notesEl.value.trim() : '';

    const res = await apiPost('updateStatus', {
        id: active.id, status: 'Selesai', waktuPanggil: active.waktuPanggil, catatan: notes
    });
    if (!res || !res.success) return showToast(res?.message || 'Gagal menyelesaikan pemeriksaan.', 'error');

    const idx = appState.queues.findIndex(q => q.id === active.id);
    if (idx !== -1) {
        appState.queues[idx].status = 'Selesai';
        appState.queues[idx].catatan = notes;
    }
    if (appState.activeCall && appState.activeCall.id === active.id) appState.activeCall = null;
    if (notesEl) notesEl.value = '';

    saveState();
    renderAllViews();
    showToast(`Pemeriksaan pasien ${active.name} telah selesai.`, 'success');
}

// ============================================================
// ACTION: MASTER DATA
// ============================================================
async function promptAddService() {
    const name = prompt('Masukkan Nama Poli / Layanan Baru:');
    if (!name) return;
    const prefix = prompt('Masukkan Huruf Prefix Kode (Contoh: E):', 'E');
    if (!prefix) return;

    const res = await apiPost('addService', { data: { name: name.trim(), prefix: prefix.trim().toUpperCase() } });
    if (!res || !res.success) return showToast(res?.message || 'Gagal menambah layanan.', 'error');

    appState.services.push(res.data);
    saveState();
    populateFormOptions();
    renderAllViews();
    showToast('Layanan Poli berhasil ditambahkan.', 'success');
}

async function deleteService(id) {
    if (!confirm('Hapus layanan ini? Pastikan tidak ada dokter/antrean aktif yang menggunakannya.')) return;

    const res = await apiPost('deleteService', { id });
    if (!res || !res.success) return showToast(res?.message || 'Gagal hapus layanan.', 'error');

    appState.services = appState.services.filter(s => s.id !== id);
    saveState();
    populateFormOptions();
    renderAllViews();
    showToast('Layanan Poli dihapus.', 'info');
}

async function promptAddDoctor() {
    const name = prompt('Masukkan Nama Dokter Baru (beserta Gelar):');
    if (!name) return;

    if (appState.services.length === 0) {
        return showToast('Tambahkan layanan poli terlebih dahulu.', 'warning');
    }

    const options = appState.services.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const choice = prompt(`Pilih layanan poli (ketik angka):\n${options}`, '1');
    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= appState.services.length) {
        return showToast('Pilihan layanan tidak valid.', 'warning');
    }

    const serviceId = appState.services[idx].id;
    const res = await apiPost('addDoctor', { data: { name: name.trim(), serviceId } });
    if (!res || !res.success) return showToast(res?.message || 'Gagal menambah dokter.', 'error');

    appState.doctors.push(res.data);
    saveState();
    populateFormOptions();
    renderAllViews();
    showToast('Dokter berhasil ditambahkan.', 'success');
}

async function deleteDoctor(id) {
    if (!confirm('Hapus dokter ini? Pastikan tidak ada antrean aktif untuk dokter ini.')) return;

    const res = await apiPost('deleteDoctor', { id });
    if (!res || !res.success) return showToast(res?.message || 'Gagal hapus dokter.', 'error');

    appState.doctors = appState.doctors.filter(d => d.id !== id);
    saveState();
    populateFormOptions();
    renderAllViews();
    showToast('Data Dokter dihapus.', 'info');
}

async function triggerSetupDatabase() {
    showToast('Sedang menyiapkan Google Sheets...', 'info');
    const res = await apiPost('setupDatabase');
    if (res && res.success) {
        showToast(res.message || 'Setup DB berhasil.', 'success');
        fetchServerData();
    } else {
        showToast(res?.message || 'Gagal Setup Database.', 'error');
    }
}

// ============================================================
// TTS
// ============================================================
function triggerTTS(queueObj) {
    if (!('speechSynthesis' in window)) {
        console.warn('Browser tidak mendukung Speech Synthesis TTS.');
        return;
    }
    window.speechSynthesis.cancel();

    const service = appState.services.find(s => s.id === queueObj.serviceId);
    const noSpelled = String(queueObj.no).replace('-', ' ');
    const text = `Nomor antrean ${noSpelled}, ${queueObj.name}, silakan menuju ${service ? service.name : 'Loket Pelayanan'}.`;

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'id-ID';
    utt.rate = 0.9;
    utt.pitch = 1.0;
    window.speechSynthesis.speak(utt);
}

function replayCurrentCall() {
    if (appState.activeCall) triggerTTS(appState.activeCall);
    else testTTS();
}

function testTTS() {
    if (!('speechSynthesis' in window)) return showToast('Browser tidak mendukung TTS.', 'warning');
    const utt = new SpeechSynthesisUtterance('Nomor antrean A 0 0 1, silakan menuju Poli Umum Klinik Naseha.');
    utt.lang = 'id-ID';
    window.speechSynthesis.speak(utt);
}

// ============================================================
// CSV EXPORT
// ============================================================
function exportReportCSV() {
    if (appState.queues.length === 0) return showToast('Belum ada data antrean untuk diekspor.', 'warning');

    let csv = 'ID Antrean,No Antrean,Tanggal,Nama Pasien,NIK,No HP,Poli,Dokter,Status,Waktu Daftar,Waktu Panggil,Catatan\n';
    appState.queues.forEach(q => {
        const s = appState.services.find(serv => serv.id === q.serviceId);
        const d = appState.doctors.find(doc => doc.id === q.doctorId);
        const row = [
            q.id, q.no, q.date,
            `"${(q.name || '').replace(/"/g, '""')}"`,
            `"${(q.nik || '').replace(/"/g, '""')}"`,
            `"${(q.phone || '').replace(/"/g, '""')}"`,
            `"${(s ? s.name : '').replace(/"/g, '""')}"`,
            `"${(d ? d.name : '').replace(/"/g, '""')}"`,
            q.status, q.waktuDaftar, q.waktuPanggil,
            `"${(q.catatan || '').replace(/"/g, '""')}"`
        ].join(',');
        csv += row + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laporan_Antrean_Klinik_Naseha_${getLocalDateStr()}.csv`;  // ✅ lokal
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Laporan CSV berhasil diunduh!', 'success');
}

// ============================================================
// UI HELPERS
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    let bg = 'bg-slate-800 text-white';
    if (type === 'success') bg = 'bg-emerald-600 text-white';
    if (type === 'warning') bg = 'bg-amber-500 text-slate-900 font-bold';
    if (type === 'error')   bg = 'bg-rose-600 text-white';

    el.className = `${bg} px-4 py-3 rounded-2xl shadow-lg text-xs font-semibold flex items-center gap-2 pointer-events-auto toast-enter`;
    el.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('toast-show'));
    setTimeout(() => {
        el.classList.remove('toast-show');
        setTimeout(() => el.remove(), 300);
    }, 3200);
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}