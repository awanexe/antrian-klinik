/**
 * ============================================================================
 * BACKEND API (Code.gs) - KLINIK NASEHA SISTEM ANTREAN PASIEN
 * ============================================================================
 * Versi Hybrid: Google Apps Script sebagai REST API Backend
 * Frontend di-host di Vercel, komunikasi via JSON API (lewat Vercel Proxy)
 *
 * ENDPOINTS (GET/POST):
 *   - action=ping          : Health check
 *   - action=initialData   : Ambil semua data (services, doctors, queues)
 *   - action=setupDatabase : Setup struktur sheet + seed data
 *   - action=saveQueue     : Simpan antrean baru
 *   - action=updateStatus  : Update status antrean
 *   - action=addService    : Tambah master poli/layanan
 *   - action=deleteService : Hapus master poli/layanan
 *   - action=addDoctor     : Tambah master dokter
 *   - action=deleteDoctor  : Hapus master dokter
 * ============================================================================
 */

const SHEET_SERVICES     = 'SERVICES';
const SHEET_DOCTORS      = 'DOCTORS';
const SHEET_QUEUES       = 'QUEUES';
const SHEET_BACKUP_LOG   = 'BACKUP_LOG';
const VALID_STATUSES     = ['Menunggu', 'Dipanggil', 'Dilayani', 'Selesai', 'Dilewati', 'Batal'];
const ACTIVE_STATUSES    = ['Menunggu', 'Dipanggil', 'Dilayani'];

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================
function doGet(e) {
  return handleApiRequest(e, 'GET');
}

function doPost(e) {
  return handleApiRequest(e, 'POST');
}

function handleApiRequest(e, method) {
  try {
    let params = {};
    let action = '';

    if (method === 'POST' && e.postData && e.postData.contents) {
      try {
        params = JSON.parse(e.postData.contents);
      } catch (err) {
        return jsonResponse({ success: false, message: 'Invalid JSON body: ' + err.message });
      }
      action = params.action || '';
    } else if (e.parameter) {
      params = e.parameter;
      action = params.action || '';
    }

    switch (action) {
      case 'ping':
        return jsonResponse({ success: true, message: 'pong', time: new Date().toISOString() });

      case 'initialData':
        return jsonResponse(getInitialData());

      case 'setupDatabase':
        return jsonResponse(setupDatabase());

      case 'saveQueue':
        return jsonResponse(saveQueueServer(params.data || params.queueData));

      case 'updateStatus':
        return jsonResponse(updateQueueStatusServer(
          params.id, params.status, params.waktuPanggil, params.catatan
        ));

      case 'addService':
        return jsonResponse(addServiceServer(params.data));

      case 'deleteService':
        return jsonResponse(deleteServiceServer(params.id));

      case 'addDoctor':
        return jsonResponse(addDoctorServer(params.data));

      case 'deleteDoctor':
        return jsonResponse(deleteDoctorServer(params.id));

      default:
        return jsonResponse({
          success: true,
          message: 'Klinik Naseha API is running.',
          availableActions: [
            'ping', 'initialData', 'setupDatabase',
            'saveQueue', 'updateStatus',
            'addService', 'deleteService',
            'addDoctor', 'deleteDoctor'
          ]
        });
    }
  } catch (error) {
    Logger.log('API Error: ' + error.message + '\n' + (error.stack || ''));
    return jsonResponse({ success: false, message: 'Server error: ' + error.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// DATABASE SETUP
// ============================================================
function getSpreadsheetId() {
  return SpreadsheetApp.getActiveSpreadsheet().getId();
}

function setupDatabase() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheetsToCreate = [
      { name: SHEET_SERVICES,   headers: ['id_layanan', 'kode_prefix', 'nama_layanan', 'status'] },
      { name: SHEET_DOCTORS,    headers: ['id_dokter', 'nama_dokter', 'id_layanan', 'status'] },
      { name: SHEET_QUEUES,     headers: ['id_antrean', 'no_antrean', 'tanggal', 'nama_pasien', 'nik', 'no_hp', 'id_layanan', 'id_dokter', 'status', 'waktu_daftar', 'waktu_panggil', 'catatan'] },
      { name: SHEET_BACKUP_LOG, headers: ['timestamp', 'action', 'payload', 'user_email'] }
    ];

    sheetsToCreate.forEach(item => {
      let sheet = ss.getSheetByName(item.name);
      if (!sheet) {
        sheet = ss.insertSheet(item.name);
        sheet.appendRow(item.headers);
        sheet.getRange(1, 1, 1, item.headers.length)
          .setFontWeight('bold')
          .setBackground('#0061A4')
          .setFontColor('#FFFFFF');
      }
    });

    const serviceSheet = ss.getSheetByName(SHEET_SERVICES);
    if (serviceSheet.getLastRow() <= 1) {
      serviceSheet.appendRow(['SERV-01', 'A', 'Poli Umum', 'Aktif']);
      serviceSheet.appendRow(['SERV-02', 'B', 'Poli Gigi', 'Aktif']);
      serviceSheet.appendRow(['SERV-03', 'C', 'Poli KIA & Anak', 'Aktif']);
      serviceSheet.appendRow(['SERV-04', 'D', 'Spesialis Penyakit Dalam', 'Aktif']);
    }

    const doctorSheet = ss.getSheetByName(SHEET_DOCTORS);
    if (doctorSheet.getLastRow() <= 1) {
      doctorSheet.appendRow(['DOC-01', 'dr. Ahmad Naseha, Sp.PD', 'SERV-04', 'Aktif']);
      doctorSheet.appendRow(['DOC-02', 'dr. Siti Rahmah', 'SERV-01', 'Aktif']);
      doctorSheet.appendRow(['DOC-03', 'drg. Budi Santoso', 'SERV-02', 'Aktif']);
      doctorSheet.appendRow(['DOC-04', 'dr. Nurul Hidayah, Sp.A', 'SERV-03', 'Aktif']);
    }

    logBackup('setupDatabase', {});
    return { success: true, message: 'Setup Database Google Sheets Berhasil!' };
  } catch (error) {
    Logger.log('setupDatabase error: ' + error.message);
    return { success: false, message: 'Gagal Setup Database: ' + error.message };
  }
}

// ============================================================
// READ DATA
// ============================================================
function getInitialData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return {
      success: true,
      services: readServices(ss),
      doctors:  readDoctors(ss),
      queues:   readTodayQueues(ss)
    };
  } catch (error) {
    Logger.log('getInitialData error: ' + error.message);
    return { success: false, message: error.message };
  }
}

function readServices(ss) {
  const sheet = ss.getSheetByName(SHEET_SERVICES);
  const services = [];
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    data.forEach(row => {
      if (row[0]) services.push({
        id: String(row[0]), prefix: String(row[1]),
        name: String(row[2]), status: String(row[3])
      });
    });
  }
  return services;
}

function readDoctors(ss) {
  const sheet = ss.getSheetByName(SHEET_DOCTORS);
  const doctors = [];
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    data.forEach(row => {
      if (row[0]) doctors.push({
        id: String(row[0]), name: String(row[1]),
        serviceId: String(row[2]), status: String(row[3])
      });
    });
  }
  return doctors;
}

function readTodayQueues(ss) {
  const sheet = ss.getSheetByName(SHEET_QUEUES);
  const queues = [];
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
    data.forEach(row => {
      const rowDate = row[2] instanceof Date
        ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(row[2]);

      if (rowDate === today || rowDate === '') {
        queues.push({
          id: String(row[0]),
          no: String(row[1]),
          date: rowDate,
          name: String(row[3]),
          nik: String(row[4]),
          phone: String(row[5]),
          serviceId: String(row[6]),
          doctorId: String(row[7]),
          status: String(row[8]),
          waktuDaftar: String(row[9]),
          waktuPanggil: String(row[10]),
          catatan: String(row[11])
        });
      }
    });
  }
  return queues;
}

// ============================================================
// QUEUE CRUD
// ============================================================
function saveQueueServer(queueData) {
  try {
    if (!queueData) return { success: false, message: 'Data antrean kosong' };

    const validation = validateQueueData(queueData);
    if (!validation.valid) return { success: false, message: validation.message };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_QUEUES);
    if (!sheet) return { success: false, message: 'Sheet QUEUES tidak ditemukan. Jalankan setupDatabase().' };

    const dupCheck = checkDuplicateQueue(ss, queueData);
    if (dupCheck.duplicate) {
      return {
        success: false,
        duplicate: true,
        existingId: dupCheck.existingId,
        message: dupCheck.message
      };
    }

    const newId = String(queueData.id || ('Q-' + Date.now()));
    sheet.appendRow([
      newId,
      String(queueData.no),
      queueData.date,
      String(queueData.name),
      String(queueData.nik || ''),
      String(queueData.phone || ''),
      String(queueData.serviceId),
      String(queueData.doctorId),
      String(queueData.status || 'Menunggu'),
      String(queueData.waktuDaftar || ''),
      String(queueData.waktuPanggil || ''),
      String(queueData.catatan || '')
    ]);

    logBackup('saveQueue', queueData);
    return { success: true, data: queueData };
  } catch (error) {
    Logger.log('saveQueueServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

function validateQueueData(q) {
  if (!q.name || String(q.name).trim().length === 0) return { valid: false, message: 'Nama pasien wajib diisi' };
  if (!q.serviceId) return { valid: false, message: 'Layanan poli wajib dipilih' };
  if (!q.doctorId)  return { valid: false, message: 'Dokter wajib dipilih' };
  if (!q.no)        return { valid: false, message: 'Nomor antrean wajib diisi' };
  return { valid: true };
}

function checkDuplicateQueue(ss, q) {
  const sheet = ss.getSheetByName(SHEET_QUEUES);
  if (!sheet || sheet.getLastRow() <= 1) return { duplicate: false };

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[2] instanceof Date
      ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(row[2]);
    if (rowDate !== today) continue;

    const rowStatus = String(row[8]);
    if (ACTIVE_STATUSES.indexOf(rowStatus) === -1) continue;

    const sameNik   = q.nik   && String(row[4]) === String(q.nik);
    const samePhone = q.phone && String(row[5]) === String(q.phone) && String(row[6]) === String(q.serviceId);

    if (sameNik || samePhone) {
      return {
        duplicate: true,
        existingId: String(row[0]),
        message: `Pasien sudah memiliki antrean aktif hari ini (${row[1]} - ${rowStatus}).`
      };
    }
  }
  return { duplicate: false };
}

function updateQueueStatusServer(queueId, status, waktuPanggil, catatan) {
  try {
    if (!queueId) return { success: false, message: 'ID antrean wajib diisi' };
    if (!status)  return { success: false, message: 'Status wajib diisi' };
    if (VALID_STATUSES.indexOf(status) === -1) {
      return { success: false, message: 'Status tidak valid: ' + status };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_QUEUES);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, message: 'Sheet kosong' };

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(queueId)) {
        const rowIndex = i + 2;
        const oldStatus = String(data[i][8]);

        sheet.getRange(rowIndex, 9).setValue(status);
        if (waktuPanggil) sheet.getRange(rowIndex, 11).setValue(waktuPanggil);
        if (catatan !== undefined && catatan !== null) sheet.getRange(rowIndex, 12).setValue(catatan);

        logBackup('updateStatus', { queueId, oldStatus, newStatus: status, waktuPanggil, catatan });
        return { success: true, id: queueId, status: status };
      }
    }
    return { success: false, message: 'ID Antrean tidak ditemukan: ' + queueId };
  } catch (error) {
    Logger.log('updateQueueStatusServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================
// SERVICES CRUD
// ============================================================
function addServiceServer(serviceData) {
  try {
    if (!serviceData) return { success: false, message: 'Data layanan kosong' };
    if (!serviceData.name || String(serviceData.name).trim() === '') return { success: false, message: 'Nama layanan wajib diisi' };
    if (!serviceData.prefix || String(serviceData.prefix).trim() === '') return { success: false, message: 'Prefix wajib diisi' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SERVICES);
    if (!sheet) return { success: false, message: 'Sheet SERVICES tidak ditemukan' };

    if (sheet.getLastRow() > 1) {
      const existing = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
      if (existing.map(String).indexOf(String(serviceData.prefix).toUpperCase()) !== -1) {
        return { success: false, message: 'Prefix "' + serviceData.prefix + '" sudah dipakai.' };
      }
    }

    const id = serviceData.id || ('SERV-' + Date.now());
    sheet.appendRow([id, String(serviceData.prefix).toUpperCase(), String(serviceData.name), serviceData.status || 'Aktif']);
    logBackup('addService', serviceData);
    return {
      success: true,
      data: { id, prefix: String(serviceData.prefix).toUpperCase(), name: serviceData.name, status: serviceData.status || 'Aktif' }
    };
  } catch (error) {
    Logger.log('addServiceServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

function deleteServiceServer(serviceId) {
  try {
    if (!serviceId) return { success: false, message: 'ID layanan wajib diisi' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SERVICES);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, message: 'Sheet kosong' };

    const doctorSheet = ss.getSheetByName(SHEET_DOCTORS);
    if (doctorSheet && doctorSheet.getLastRow() > 1) {
      const docs = doctorSheet.getRange(2, 3, doctorSheet.getLastRow() - 1, 1).getValues().flat();
      const referencing = docs.filter(d => String(d) === String(serviceId)).length;
      if (referencing > 0) {
        return { success: false, message: 'Tidak bisa hapus: ' + referencing + ' dokter masih menggunakan layanan ini.' };
      }
    }

    const queueSheet = ss.getSheetByName(SHEET_QUEUES);
    if (queueSheet && queueSheet.getLastRow() > 1) {
      const queues = queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 9).getValues();
      const activeRefs = queues.filter(q =>
        String(q[6]) === String(serviceId) && ACTIVE_STATUSES.indexOf(String(q[8])) !== -1
      );
      if (activeRefs.length > 0) {
        return { success: false, message: 'Tidak bisa hapus: ada ' + activeRefs.length + ' antrean aktif di layanan ini.' };
      }
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(serviceId)) {
        sheet.deleteRow(i + 2);
        logBackup('deleteService', { serviceId });
        return { success: true, id: serviceId };
      }
    }
    return { success: false, message: 'Layanan tidak ditemukan: ' + serviceId };
  } catch (error) {
    Logger.log('deleteServiceServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================
// DOCTORS CRUD
// ============================================================
function addDoctorServer(doctorData) {
  try {
    if (!doctorData) return { success: false, message: 'Data dokter kosong' };
    if (!doctorData.name || String(doctorData.name).trim() === '') return { success: false, message: 'Nama dokter wajib diisi' };
    if (!doctorData.serviceId) return { success: false, message: 'Layanan poli wajib dipilih' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_DOCTORS);
    if (!sheet) return { success: false, message: 'Sheet DOCTORS tidak ditemukan' };

    const id = doctorData.id || ('DOC-' + Date.now());
    sheet.appendRow([id, String(doctorData.name), String(doctorData.serviceId), doctorData.status || 'Aktif']);
    logBackup('addDoctor', doctorData);
    return {
      success: true,
      data: { id, name: doctorData.name, serviceId: doctorData.serviceId, status: doctorData.status || 'Aktif' }
    };
  } catch (error) {
    Logger.log('addDoctorServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

function deleteDoctorServer(doctorId) {
  try {
    if (!doctorId) return { success: false, message: 'ID dokter wajib diisi' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_DOCTORS);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, message: 'Sheet kosong' };

    const queueSheet = ss.getSheetByName(SHEET_QUEUES);
    if (queueSheet && queueSheet.getLastRow() > 1) {
      const queues = queueSheet.getRange(2, 1, queueSheet.getLastRow() - 1, 9).getValues();
      const activeRefs = queues.filter(q =>
        String(q[7]) === String(doctorId) && ACTIVE_STATUSES.indexOf(String(q[8])) !== -1
      );
      if (activeRefs.length > 0) {
        return { success: false, message: 'Tidak bisa hapus: ada ' + activeRefs.length + ' antrean aktif untuk dokter ini.' };
      }
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(doctorId)) {
        sheet.deleteRow(i + 2);
        logBackup('deleteDoctor', { doctorId });
        return { success: true, id: doctorId };
      }
    }
    return { success: false, message: 'Dokter tidak ditemukan: ' + doctorId };
  } catch (error) {
    Logger.log('deleteDoctorServer error: ' + error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================
// BACKUP LOGGING
// ============================================================
function logBackup(action, payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_BACKUP_LOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_BACKUP_LOG);
      sheet.appendRow(['timestamp', 'action', 'payload', 'user_email']);
    }
    let email = 'anonymous';
    try { email = Session.getActiveUser().getEmail() || 'anonymous'; } catch (e) {}
    sheet.appendRow([new Date().toISOString(), action, JSON.stringify(payload || {}), email]);
  } catch (e) {
    Logger.log('logBackup failed: ' + e.message);
  }
}