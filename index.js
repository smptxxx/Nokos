const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const https = require('https'); 
const settings = require('./settings');
const readline = require('readline');
const { flag } = require('country-emoji');
const BackupManager = require('./backupManager');

// --- GLOBAL ERROR HANDLER (MENCEGAH BOT CRASH) ---
process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    // Abaikan error Telegram yang umum & tidak kritis
    if (msg.includes('ETELEGRAM') || msg.includes('query is too old') || msg.includes('message is not modified') || msg.includes('message to edit not found') || msg.includes('bot was blocked')) {
        console.warn('⚠️ [Telegram Warning - Diabaikan]:', msg);
        return;
    }
    console.error('❌ Unhandled Rejection:', msg);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
});

// --- GRAMJS UNTUK MANAJEMEN SESI TELEGRAM ---
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const authClients = {};

// --- FUNGSI SECURITY CONSOLE ---
startSystem();

// --- PEMBUNGKUS UTAMA (WRAPPER) ---
async function startSystem() {
    const fse = require('fs-extra');
    const DB_DIR = './database';
    const DB_FILE = './database/db.json';

    await fse.ensureDir(DB_DIR);
    console.log("📁 Database lokal siap!");

    if (!settings.tokenUser || !settings.tokenAdmin) {
        console.error("❌ ERROR: Harap isi KEDUA Token Bot di settings.js!");
        process.exit(1);
    }

    settings.rumahOtpApiKey = settings.rumahOtpApiKey || 'KOSONG';

    console.log('🔄 Menghubungkan Dual Bot System...');
    const botUser = new TelegramBot(settings.tokenUser, { polling: true });
    const botAdmin = new TelegramBot(settings.tokenAdmin, { polling: true });

    const startTime = Date.now();
    if (!fs.existsSync('./scripts')) fs.mkdirSync('./scripts');

    console.log('✅ Bot User: ONLINE');
    console.log('✅ Bot Admin: ONLINE');

// --- STRUKTUR DATABASE DEFAULT ---
    const defaultDB = {
        users: [],
        telegramSessions: [],
        orderSessions: [],
        orders: [], 
        deposits: [],
        pendingOtps: [], 
        blockedUsers: [],   // { userId, username, reason, blockedAt }
        fraudLog: [],       // { userId, username, detectedAt, saldoBefore, saldoAfter, expectedSaldo, note }
        logImages: {
            deposit: null, maintenance: null, trx_otp: null
        },
        stats: { totalTrx: 0, totalIncome: 0 },
        priceHistory: {}, 
        settings: { 
            maintenance: false, mtReason: 'Perbaikan Sistem', otpMargin: 0, forceSubChannels: [],
            sessionPrice: 4000,
            backupChannelId: null,
            promoButton: {
                text: null,
                imageUrl: null,
                btnText: null,
                btnUrl: null
            },
            topSystem: { maxTop: 3, minDepoRank1: 40000, minDepoRank2: 30000, minDepoRank3: 20000, resetDays: 0, nextResetTime: 0, discountRank1: 5, discountRank2: 3, discountRank3: 1 },
            autoPodcast: { active: false, serviceCode: null, intervalMinutes: 5, nextRun: 0 },
            autoBroadcastMsg: { active: false, intervalMinutes: 60, nextRun: 0, text: null, entities: null },
            channels: { logTrxDepo: null, logStock: null },
            activeMenus: { otp: true, sesi: true }
        }
    };
    let db = { ...defaultDB };
    let isDbLoaded = false;
    // --- FUNGSI USERS.JSON ---
const USERS_JSON_FILE = './database/users.json';

function readUsersJson() {
    try {
        if (!fs.existsSync(USERS_JSON_FILE)) return [];
        const raw = fs.readFileSync(USERS_JSON_FILE, 'utf-8');
        return JSON.parse(raw) || [];
    } catch (e) {
        return [];
    }
}

function saveUsersJson(ids) {
    try {
        fs.writeFileSync(USERS_JSON_FILE, JSON.stringify(ids, null, 2));
    } catch (e) {
        console.error('Gagal simpan users.json:', e.message);
    }
}

    async function loadDB() {
    console.log("📂 Memuat Database dari file lokal...");
    try {
        const exists = await fse.pathExists(DB_FILE);
        if (exists) {
            const data = await fse.readJson(DB_FILE);
            db.users = data.users || [];
            db.orders = data.orders || [];
            db.deposits = data.deposits || [];
            db.pendingOtps = data.pendingOtps || [];
            db.telegramSessions = data.telegramSessions || [];
            db.orderSessions = data.orderSessions || [];
            db.priceHistory = data.priceHistory || {};
            db.blockedUsers = data.blockedUsers || [];
            db.fraudLog = data.fraudLog || [];

            if (data.logImages) db.logImages = data.logImages;
            if (data.settings) db.settings = { ...db.settings, ...data.settings };
            if (data.stats) db.stats = data.stats;

            if (!db.settings.autoPodcast) db.settings.autoPodcast = defaultDB.settings.autoPodcast;
            if (!db.settings.autoBroadcastMsg) db.settings.autoBroadcastMsg = defaultDB.settings.autoBroadcastMsg;
            if (!db.settings.channels) db.settings.channels = defaultDB.settings.channels;
            if (!db.settings.topSystem) db.settings.topSystem = defaultDB.settings.topSystem;
            if (!db.settings.forceSubChannels) db.settings.forceSubChannels = [];
            if (!db.settings.activeMenus) db.settings.activeMenus = defaultDB.settings.activeMenus;
            if (db.settings.backupChannelId === undefined) db.settings.backupChannelId = null;
            if (!db.settings.promoButton) db.settings.promoButton = defaultDB.settings.promoButton;

            console.log("✅ Database Berhasil Dimuat dari file lokal!");
        } else {
            console.log("⚠️ Database belum ada, membuat default...");
            await saveDB();
        }
        // Sinkronisasi users.json dari db.users yang sudah ada
        const existingIds = readUsersJson();
        let changed = false;
        db.users.forEach(u => {
            if (u && u.id && !existingIds.includes(u.id)) {
                existingIds.push(u.id);
                changed = true;
            }
        });
        if (changed) saveUsersJson(existingIds);
        console.log(`✅ users.json tersinkron: ${existingIds.length} user`);

        isDbLoaded = true;
        resumeDeposits();
        resumeOtps();
    } catch (error) {
        console.error("❌ Gagal memuat Database:", error.message);
        isDbLoaded = true;
    }
}

let isSaving = false;
async function saveDB() {
    if (!isDbLoaded) return;
    if (isSaving) return;
    isSaving = true;
    try {
        const dataToSave = {
            users: db.users || [],
            deposits: db.deposits || [],
            telegramSessions: db.telegramSessions || [],
            orderSessions: db.orderSessions || [],
            pendingOtps: db.pendingOtps || [],
            orders: db.orders || [],
            blockedUsers: db.blockedUsers || [],
            fraudLog: (db.fraudLog || []).slice(-200),
            logImages: db.logImages,
            settings: db.settings,
            stats: db.stats,
            priceHistory: db.priceHistory
        };
        // Tulis ke file temp dulu, lalu rename (atomic write)
        const tempFile = DB_FILE + '.tmp';
        await fse.writeJson(tempFile, dataToSave, { spaces: 2 });
        await fse.move(tempFile, DB_FILE, { overwrite: true });
    } catch (e) {
        console.error("⚠️ Gagal menyimpan database:", e.message);
    } finally {
        isSaving = false;
    }
}

    function resumeDeposits() {
        if (!db.deposits) return;
        const pendingDeposits = db.deposits.filter(d => d.status === 'pending');
        pendingDeposits.forEach(d => {
            startDepositChecker(d.userId, d.refId, null);
        });
    }

    function resumeOtps() {
        if (!db.pendingOtps) return;
        const pending = db.pendingOtps || [];
        pending.forEach(p => {
            startOtpChecker(p.userId, p.orderId, p.price, p.itemName, p.countryName, p.startTime);
        });
    }

    loadDB();

// ← TAMBAH MULAI SINI
let backupManager = null;

function initBackupManager() {
    const channelId = db.settings.backupChannelId || settings.ownerId;
    const intervalKey = db.settings.backupIntervalKey || '24h';
    if (backupManager) return; // Sudah aktif
    try {
        backupManager = new BackupManager(
            botAdmin,
            settings.ownerId,
            null,
            'lastBackup.json',
            channelId,
            intervalKey
        );
        backupManager.startAutoBackup();
        console.log(`✅ BackupManager aktif → Channel: ${channelId} | Interval: ${intervalKey}`);
    } catch (e) {
        console.error('❌ BackupManager gagal init:', e.message);
    }
}

// Jalankan setelah DB loaded (delay 5 detik)
setTimeout(() => {
    initBackupManager();
}, 5000);
// ← TAMBAH SAMPAI SINI
    
    function checkTopReset() {
        if (!db.settings.topSystem || !db.settings.topSystem.nextResetTime) return;
        if (Date.now() >= db.settings.topSystem.nextResetTime) {
            db.users.forEach(u => u.topDeposit = 0);
            const days = db.settings.topSystem.resetDays || 7;
            db.settings.topSystem.nextResetTime = Date.now() + (days * 24 * 60 * 60 * 1000);
            saveDB();
        }
    }
    setInterval(checkTopReset, 60000); 
    
    // ==============================================
    // SISTEM PINTAR: DETEKSI ANOMALI SALDO (ANTI TUYUL)
    // ==============================================
    
    function detectBalanceAnomaly(userId) {
        const user = db.users.find(u => u.id == userId);
        if (!user) return null;

        const totalDepo = (db.deposits || [])
            .filter(d => d.userId == userId && d.status === 'success')
            .reduce((acc, d) => acc + (d.amount || 0), 0);

        const totalSpent = (db.orders || [])
            .filter(o => o.userId == userId && o.status === 'success')
            .reduce((acc, o) => acc + (o.price || 0), 0);

        const referralBonus = user.referralBonus || 0;

        // Saldo yang ditambah manual oleh admin ikut diperhitungkan
        const adminAddedBalance = user.adminAddedBalance || 0;

        const expectedMaxSaldo = totalDepo - totalSpent + referralBonus + adminAddedBalance;

        return {
            userId: user.id,
            username: user.username || 'Unknown',
            currentSaldo: user.saldo || 0,
            totalDepo,
            totalSpent,
            referralBonus,
            adminAddedBalance,
            expectedMaxSaldo,
            selisih: (user.saldo || 0) - expectedMaxSaldo,
            isAnomaly: (user.saldo || 0) > expectedMaxSaldo + 500
        };
    }

    function autoAuditAllUsers() {
        let fixedCount = 0;
        const usersToCheck = Array.isArray(db.users) ? db.users : Object.values(db.users || {});
        for (const user of usersToCheck) {
            if (!user || !user.id) continue;
            const result = detectBalanceAnomaly(user.id);
            if (!result || !result.isAnomaly) continue;

            const saldoBefore = user.saldo;
            const correctSaldo = Math.max(0, result.expectedMaxSaldo);
            
            // Simpan log penipuan
            if (!db.fraudLog) db.fraudLog = [];
            db.fraudLog.push({
                userId: user.id,
                username: user.username,
                detectedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                saldoBefore: saldoBefore,
                saldoAfter: correctSaldo,
                expectedMaxSaldo: result.expectedMaxSaldo,
                totalDepo: result.totalDepo,
                totalSpent: result.totalSpent,
                selisih: result.selisih,
                note: 'Auto-detect: Saldo melebihi total deposit - pembelian'
            });

            // Reset saldo ke nilai yang benar
            const uIdx = db.users.findIndex(u => u.id == user.id);
            if (uIdx !== -1) db.users[uIdx].saldo = correctSaldo;

            fixedCount++;

            // Kirim notifikasi ke user
            botUser.sendMessage(user.id, `⚠️ <b>PERINGATAN SISTEM OTOMATIS</b>

Sistem kami mendeteksi <b>ketidaksesuaian saldo</b> pada akun Anda.

<blockquote><b>📊 DETAIL AUDIT</b>
💰 Saldo Sebelumnya: <b>${formatRupiah(saldoBefore)}</b>
✅ Total Deposit Anda: <b>${formatRupiah(result.totalDepo)}</b>
🛒 Total Pembelian: <b>${formatRupiah(result.totalSpent)}</b>
💵 Saldo Disesuaikan: <b>${formatRupiah(correctSaldo)}</b></blockquote>

🔧 <i>Saldo Anda telah disesuaikan secara otomatis sesuai riwayat transaksi. Jika Anda merasa ini adalah kesalahan, silakan hubungi admin.</i>`, { parse_mode: 'HTML' }).catch(() => {});

            console.warn(`[ANTI-FRAUD AUTO] User ${user.id} (@${user.username}): Saldo ${formatRupiah(saldoBefore)} → ${formatRupiah(correctSaldo)} (selisih: ${formatRupiah(result.selisih)})`);
        }
        if (fixedCount > 0) saveDB();
        return fixedCount;
    }

    // Jalankan audit otomatis setiap 5 menit
    setInterval(() => {
        try { autoAuditAllUsers(); } catch(e) { console.error('[AUDIT ERR]', e.message); }
    }, 5 * 60 * 1000);
    
    setInterval(() => {
        const timeNow = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
        const dateObj = new Date(timeNow);
        const currentHour = dateObj.getHours(); 
        const currentMinute = dateObj.getMinutes();
        const isMaintenanceTime = (currentHour === 23) || (currentHour === 0 && currentMinute < 10);

        if (isMaintenanceTime && !db.settings.maintenance) {
            db.settings.maintenance = true;
            db.settings.mtReason = "Jam operasional telah berakhir. Buka kembali pukul 00:10 WIB.";
            saveDB();
            broadcastMaintenance(true, true);
            console.log(`[SYSTEM] Auto Maintenance ON | Jam Jakarta: ${currentHour}:${currentMinute}`);
        } 
        else if (!isMaintenanceTime && db.settings.maintenance && db.settings.mtReason.includes("00:10")) {
            db.settings.maintenance = false;
            saveDB();
            broadcastMaintenance(false, true);
            console.log(`[SYSTEM] Auto Maintenance OFF | Jam Jakarta: ${currentHour}:${currentMinute}`);
        }
    }, 60000);

    // --- AUTO BROADCAST PESAN TEKS INTERVAL ---
    setInterval(() => {
        if (!db.settings.autoBroadcastMsg || !db.settings.autoBroadcastMsg.active || !db.settings.autoBroadcastMsg.text) return;
        const now = Date.now();
        if (now >= db.settings.autoBroadcastMsg.nextRun) {
            db.settings.autoBroadcastMsg.nextRun = now + (db.settings.autoBroadcastMsg.intervalMinutes * 60 * 1000);
            saveDB();
            db.users.forEach(async user => {
                try {
                    await botUser.sendMessage(user.id, db.settings.autoBroadcastMsg.text, { entities: db.settings.autoBroadcastMsg.entities });
                } catch(e) {}
            });
        }
    }, 60000);

    const formatRupiah = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
    const getDate = () => moment().format('DD/MM/YYYY');
    const getTime = () => moment().format('HH:mm:ss');
    
    // --- UTIL PROGRESS BAR ---
    function makeProgressBar(percent, length=10) {
        let filled = Math.round((percent / 100) * length);
        if (filled < 0) filled = 0; if (filled > length) filled = length;
        return '█'.repeat(filled) + '▒'.repeat(length - filled);
    }

    const getUser = (id) => {
        if (!Array.isArray(db.users)) db.users = Object.values(db.users || {});
        return db.users.find(u => u && u.id === id);
    };

    function syncUsername(fromObj) {
        if(!fromObj || !fromObj.id) return;
        if (!Array.isArray(db.users)) db.users = Object.values(db.users || {});
        
        const uIdx = db.users.findIndex(u => u && u.id === fromObj.id);
        if(uIdx !== -1) {
            const newUname = fromObj.username || fromObj.first_name || 'User'; 
            if (db.users[uIdx] && db.users[uIdx].username !== newUname) {
                db.users[uIdx].username = newUname;
                saveDB();
            }
        }
    }


    function getRuntime() {
        const diff = Date.now() - startTime;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return `${days} Hari, ${hours} Jam, ${minutes} Menit`;
    }

    const adminState = {};
    const tempScriptData = {}; 
    const adminBcSession = {}; 
    const activeAdminMonitors = {}; // Untuk live monitor interval

    // ====================================================================
    // 🚀 ADVANCED NETWORK SYSTEM & CACHING
    // ====================================================================

    const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 10, timeout: 60000 });
    const USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ];

    function getRandomHeaders() {
        return {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Accept': 'application/json, text/plain, */*',
            'Connection': 'keep-alive'
        };
    }

    const requestQueue = [];
    let activeRequests = 0;
    const MAX_CONCURRENCY = 2; 
    
    function processQueue() {
        if (requestQueue.length === 0 || activeRequests >= MAX_CONCURRENCY) return;
        const task = requestQueue.shift();
        activeRequests++;
        runAxiosTask(task).finally(() => {
            activeRequests--;
            processQueue(); 
        });
    }

    async function runAxiosTask(task) {
        const { options, retries, resolve, reject, attempt } = task;
        options.httpAgent = httpsAgent;
        options.httpsAgent = httpsAgent;
        options.headers = { ...getRandomHeaders(), ...options.headers };
        options.timeout = 30000;
        try {
            const response = await axios(options);
            resolve(response);
        } catch (error) {
            if (attempt <= retries) {
                const delay = 2000 * Math.pow(2, attempt - 1); 
                setTimeout(() => {
                    requestQueue.push({ options, retries, resolve, reject, attempt: attempt + 1 });
                    processQueue(); 
                }, delay);
            } else {
                reject(error);
            }
        }
    }

    function fetchWithRetry(options, retries = 3) {
        return new Promise((resolve, reject) => {
            requestQueue.push({ options, retries, resolve, reject, attempt: 1 });
            processQueue(); 
        });
    }

    // ==============================================
    // LOGIKA BOT & INTEGRASI RUMAH OTP & CACHING FAST RESPOND
    // ==============================================

    const activeOtps = {}; 
    const activeDeposits = {};
    const activeStockUpdaters = {}; // Realtime stock updater per chatId

    let cachedOtpServices = [];
    const countryCache = {};

    async function syncServices() {
        console.log("🔄 Melakukan Auto-Sync ID Layanan...");
        try {
            const options = {
                method: 'GET',
                url: 'https://www.rumahotp.io/api/v2/services',
                headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' }
            };
            const res = await fetchWithRetry(options);
            if (res.data && res.data.success && Array.isArray(res.data.data)) {
                cachedOtpServices = res.data.data;
                console.log(`✅ Auto-Sync Berhasil: Memperbarui ${cachedOtpServices.length} ID Layanan.`);
                return { success: true, count: cachedOtpServices.length };
            }
        } catch (e) { console.log("❌ Auto-Sync Gagal:", e.message); }
        return { success: false, count: 0 };
    }

    setTimeout(syncServices, 5000);
    setInterval(syncServices, 1800000);

    async function getCountriesCached(serviceId) {
        const now = Date.now();
        if (countryCache[serviceId] && (now - countryCache[serviceId].timestamp < 60000)) {
            return { success: true, data: countryCache[serviceId].data };
        }
        try {
            const res = await reqOtp(`/api/v2/countries?service_id=${serviceId}`);
            if (res.success && res.data) {
                countryCache[serviceId] = { timestamp: now, data: res.data };
                return res;
            }
            return res;
        } catch (e) {
            return { success: false, message: e.message };
        }
    }

    // Fetch fresh data langsung tanpa cache (untuk realtime updater)
    async function getCountriesFresh(serviceId) {
        try {
            const options = {
                method: 'GET',
                url: `https://www.rumahotp.io/api/v2/countries?service_id=${serviceId}`,
                headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' },
                timeout: 10000
            };
            const res = await axios(options);
            if (res.data && res.data.success && res.data.data) {
                // Update cache sekaligus
                countryCache[serviceId] = { timestamp: Date.now(), data: res.data.data };
                return { success: true, data: res.data.data };
            }
            return { success: false, message: 'Data tidak valid' };
        } catch (e) {
            // Fallback ke cache jika ada
            if (countryCache[serviceId]) return { success: true, data: countryCache[serviceId].data };
            return { success: false, message: e.message };
        }
    }

    async function checkRumahOtpApi() {
        console.log('🔄 Memeriksa Koneksi API Rumah OTP...');
        try {
            const options = {
                method: 'GET',
                url: 'https://www.rumahotp.io/api/v2/services',
                headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' }
            };
            const res = await fetchWithRetry(options);
            if (res.data && res.data.success) {
                console.log('✅ Rumah OTP API: TERHUBUNG & ASLI (Connected)');
            } else {
                console.log('❌ Rumah OTP API: GAGAL (Response tidak valid, cek API Key)');
            }
        } catch (e) {
            console.log('❌ Rumah OTP API: GAGAL (' + e.message + ')');
        }
    }
    checkRumahOtpApi();

    async function reqOtp(endpoint) {
        try {
            const options = {
                method: 'GET',
                url: `https://www.rumahotp.io${endpoint}`,
                headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' }
            };
            const res = await fetchWithRetry(options);
            return res.data;
        } catch (e) {
            return { success: false, message: e.message, data: e.response ? e.response.data : null };
        }
    }

    function paginateArray(array, pageSize, pageNumber) {
        return array.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    }

    // ==============================================
    // AUTO PODCAST (STOK & HARGA)
    // ==============================================
    
    function getFlag(countryName) {
        let emoji = flag(countryName);
        if (!emoji) {
            const aliases = {
                'viet nam': '🇻🇳', 'syrian arab republic': '🇸🇾', 'macau': '🇲🇴',
                'cote d\'ivoire': '🇨🇮', 'democratic republic of the congo': '🇨🇩'
            };
            emoji = aliases[countryName.toLowerCase()] || '🌎'; 
        }
        return emoji;
    }

    async function processAutoPodcast() {
    if (!db.settings.autoPodcast || !db.settings.autoPodcast.serviceCode) return;

    // Default interval 30 menit jika belum diset
    if (!db.settings.autoPodcast.intervalMinutes) db.settings.autoPodcast.intervalMinutes = 30;
    // Default aktif jika belum diset
    if (db.settings.autoPodcast.active === undefined) db.settings.autoPodcast.active = true;
    if (!db.settings.autoPodcast.active) return;

    const now = Date.now();
    if (now < (db.settings.autoPodcast.nextRun || 0)) return;

    db.settings.autoPodcast.nextRun = now + (db.settings.autoPodcast.intervalMinutes * 60 * 1000);
    saveDB();

    const svcCode = db.settings.autoPodcast.serviceCode;

    // Ambil data fresh langsung dari API endpoint
    let res;
    try {
        const options = {
            method: 'GET',
            url: `https://www.rumahotp.io/api/v2/countries?service_id=${svcCode}`,
            headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' },
            timeout: 15000
        };
        const apiRes = await axios(options);
        if (!apiRes.data || !apiRes.data.success || !apiRes.data.data) {
            console.warn('[AUTO PODCAST] API tidak mengembalikan data valid.');
            return;
        }
        res = { success: true, data: apiRes.data.data };
        // Update cache sekaligus
        countryCache[svcCode] = { timestamp: Date.now(), data: apiRes.data.data };
    } catch (e) {
        console.error('[AUTO PODCAST] Gagal fetch API:', e.message);
        return;
    }

    if (!res.success || !res.data) return;

    if (!db.priceHistory[svcCode]) db.priceHistory[svcCode] = {};

    let changes = [];
    let otherCountries = [];
    let totalStok = 0;

    res.data.forEach(country => {
        totalStok += parseInt(country.stock_total || 0);
        if (country.pricelist && country.pricelist.length > 0) {
            let sortedPrices = [...country.pricelist].sort((a, b) => parseInt(a.price) - parseInt(b.price));
            let currentLowest = parseInt(sortedPrices[0].price);
            let currentStock = parseInt(sortedPrices[0].stock);
            let oldPriceData = db.priceHistory[svcCode][country.number_id];
            let isDropped = false;
            let diff = 0, perc = 0, oldLowest = currentLowest;

            if (oldPriceData) {
                oldLowest = parseInt(oldPriceData.price);
                if (currentLowest < oldLowest) {
                    diff = oldLowest - currentLowest;
                    perc = ((diff / oldLowest) * 100).toFixed(1);
                    isDropped = true;
                }
            }

            let obj = {
                countryName: country.name,
                oldPrice: oldLowest,
                newPrice: currentLowest,
                diff: diff,
                perc: perc,
                stock: currentStock
            };

            if (isDropped) changes.push(obj);
            else otherCountries.push(obj);

            db.priceHistory[svcCode][country.number_id] = { price: currentLowest, stock: currentStock };
        }
    });

    saveDB();

    // Susun top 10: utamakan yang turun harga, sisanya filler termurah
    changes.sort((a, b) => a.newPrice - b.newPrice);
    otherCountries.sort((a, b) => a.newPrice - b.newPrice);

    let topList = [...changes];
    if (topList.length < 10) {
        topList = topList.concat(otherCountries.slice(0, 10 - topList.length));
    } else {
        topList = topList.slice(0, 10);
    }
    topList.sort((a, b) => a.newPrice - b.newPrice);

    // Ambil nama layanan dari cache
    let svcName = String(svcCode).toUpperCase();
    if (cachedOtpServices && cachedOtpServices.length > 0) {
        let foundSvc = cachedOtpServices.find(s => String(s.service_code) === String(svcCode));
        if (foundSvc && foundSvc.service_name) svcName = foundSvc.service_name.toUpperCase();
    }

    // Susun baris negara
    let listCountries = '';
    topList.forEach(c => {
        let finalOld = c.oldPrice + (db.settings.otpMargin || 0);
        let finalNew = c.newPrice + (db.settings.otpMargin || 0);
        let flagEmoji = getFlag(c.countryName);

        if (c.diff > 0) {
            listCountries += `${flagEmoji} <b>${c.countryName}</b>\n`;
            listCountries += `↳ 💸 <s>${formatRupiah(finalOld)}</s> ➔ <b>${formatRupiah(finalNew)}</b> (Turun ${c.perc}% 📉)\n`;
            listCountries += `↳ 🚀 Rate: Tinggi | 📦 Stok: ${c.stock}\n\n`;
        } else {
            listCountries += `${flagEmoji} <b>${c.countryName}</b>\n`;
            listCountries += `↳ 💰 Harga: <b>${formatRupiah(finalNew)}</b>\n`;
            listCountries += `↳ 🚀 Rate: Tinggi | 📦 Stok: ${c.stock}\n\n`;
        }
    });

    const msgText = `🔥 <b>UPDATE HARGA &amp; STOK: ${svcName}</b> 🔥
<i>Pusat Suplai OTP Tercepat &amp; Terpercaya</i>

<blockquote><b>📊 INFORMASI SERVER</b>
⏱ <b>Waktu:</b> ${getDate()} | ${getTime()} WIB
🌍 <b>Cakupan:</b> Semua Negara
📦 <b>Total Stok Aktif:</b> ${totalStok.toLocaleString('id-ID')}
⚡ <b>Jaringan:</b> Lancar / Optimal 🟢</blockquote>

🌟 <b>KILASAN HARGA TERBAIK HARI INI:</b>

${listCountries.trim()}

💡 <i>Pesan sekarang sebelum kehabisan!</i>
🛡 <b>Garansi 100% Saldo Kembali jika OTP gagal masuk.</b>`;

    const bcMarkup = {
        inline_keyboard: [[{
            text: '🛒 ORDER SEKARANG',
            url: settings.botUrl || `https://t.me/${settings.botUsername}`
        }]]
    };

    // Kirim hanya ke channel stok — tidak broadcast ke semua user
    const stockChannel = db.settings.channels.logStock || settings.channelLogId;
    if (stockChannel) {
        botUser.sendMessage(stockChannel, msgText, { parse_mode: 'HTML', reply_markup: bcMarkup })
            .then(() => console.log(`[AUTO PODCAST] ✅ Terkirim ke channel ${stockChannel} — ${getDate()} ${getTime()}`))
            .catch(e => console.error('[AUTO PODCAST] ❌ Gagal kirim ke channel:', e.message));
    } else {
        console.warn('[AUTO PODCAST] ⚠️ Channel stok belum diset. Atur di Admin → Sistem → Setup Channel Logs → Ch Info Stok');
    }
}
    setInterval(processAutoPodcast, 60000); 

    // ==============================================
    // 1. INTEGRASI LOG 
    // ==============================================

    async function sendLog(type, data) {
        let logChannel = db.settings.channels.logTrxDepo || settings.channelLogId;

        if (!logChannel) return;

        let text = '';
        let imageUrl = null;

        if (type === 'deposit_success') imageUrl = db.logImages.deposit;
        else if (type === 'trx_otp') imageUrl = db.logImages.trx_otp; 

        const btnOrder = { inline_keyboard: [[{ text: '🛒 Order Sekarang', url: settings.botUrl || `https://t.me/${settings.botUsername}` }]] };

        if (type === 'deposit_success') {
    const sisaSaldo = data.saldo !== undefined ? formatRupiah(data.saldo) : 'Rp 0';
    text = `<blockquote><b>✅ NOTIFIKASI DEPOSIT BERHASIL</b>
Pengisian saldo Anda telah berhasil divalidasi oleh sistem dan dana sudah ditambahkan ke akun Anda.

<b>🧾 Rincian Sistem</b>
├ ID Transaksi: <code>${data.refId}</code> 
├ Tanggal & Waktu: ${getDate()} | ${getTime()} WIB
└ Status: Sukses 🟢

<b>💰 Rincian Dana</b>
├ Metode: QRIS / E-Wallet
├ Nominal Deposit: ${formatRupiah(data.amount)}
├ Biaya Admin: Rp 0
└ Total Masuk: ${formatRupiah(data.amount)}

<b>👤 Informasi Akun</b>
├ Username: @${data.username}
├ ID Pengguna: <code>${data.userId}</code>
└ Sisa Saldo: ${sisaSaldo}

<i>Simpan ID Transaksi ini sebagai bukti pembayaran yang sah. Terima kasih telah menggunakan layanan Official OTP @Jeeyhosting</i></blockquote>`;
} 

        else if (type === 'trx_otp') {
            const sisaSaldo = data.saldo !== undefined ? formatRupiah(data.saldo) : 'Rp 0';
            text = `<blockquote><b>📱 NOTIFIKASI PESANAN OTP BERHASIL</b>
Permintaan layanan OTP telah berhasil diproses oleh sistem dan nomor telah dialokasikan untuk Anda.

<b>🧾 Rincian Sistem</b>
├ ID Transaksi: <code>${data.trxId}</code> (tap untuk salin)
├ Tanggal & Waktu: ${getDate()} | ${getTime()} WIB
└ Status: Sukses (Nomor Terpesan) 🟢

<b>📦 Detail Layanan</b>
├ Aplikasi: ${data.item}
├ Negara: ${data.country}
└ Harga Layanan: ${formatRupiah(data.price)}

<b>👤 Informasi Akun</b>
├ Username: @${data.username}
└ Sisa Saldo: ${sisaSaldo}</blockquote>`;
        }

        try {
            if (imageUrl && imageUrl.startsWith('http')) {
                await botUser.sendPhoto(logChannel, imageUrl, { caption: text, parse_mode: 'HTML', reply_markup: btnOrder });
            } else {
                await botUser.sendMessage(logChannel, text, { parse_mode: 'HTML', reply_markup: btnOrder });
            }
        } catch (e) { 
            botUser.sendMessage(logChannel, text, { parse_mode: 'HTML', reply_markup: btnOrder }).catch(()=>{});
        }
    }

    async function broadcastMaintenance(isMaintenance, isDaily = false) {
    let mtChannel = db.settings.channels.logTrxDepo || settings.channelLogId;
    if (!mtChannel) return;
    let imageUrl = db.logImages.maintenance;
    let text = '';

    if (isMaintenance) {
        text = `⛔ <b>MAINTENANCE SISTEM</b>
━━━━━━━━━━━━━━━━━━━━

Bot sedang dalam mode pemeliharaan rutin harian.
Semua fitur dinonaktifkan sementara.

<blockquote><b>🔧 YANG SEDANG DILAKUKAN:</b>
🗄 Memelihara &amp; optimasi database
📈 Meningkatkan kualitas layanan
📦 Menambahkan stok nomor baru
🎁 Menyiapkan promo terbaru</blockquote>

⏳ <b>Jadwal Maintenance Harian:</b>
Mulai: 23:00 WIB
Selesai: 00:10 WIB

Mohon tunggu hingga proses selesai.
Kami akan segera kembali! 🙏

#MaintenanceMode`;
    } else {
        text = `✅ <b>MAINTENANCE SELESAI</b>
━━━━━━━━━━━━━━━━━━━━

Bot sudah aktif kembali dan siap digunakan!

<blockquote><b>✨ YANG SUDAH DIPERBARUI:</b>
🗄 Database telah dioptimasi
📈 Kualitas layanan ditingkatkan
📦 Stok nomor baru telah ditambahkan
🎁 Promo terbaru sudah tersedia</blockquote>

🚀 Semua fitur sudah tersedia kembali.
💰 Silakan lakukan transaksi seperti biasa.

Terima kasih atas kesabaran Anda! 🙏

#MaintenanceSelesai`;
    }

    try {
        if (imageUrl && imageUrl.startsWith('http')) {
            await botUser.sendPhoto(mtChannel, imageUrl, { caption: text, parse_mode: 'HTML' });
        } else {
            await botUser.sendMessage(mtChannel, text, { parse_mode: 'HTML' });
        }
    } catch (e) {
        botUser.sendMessage(mtChannel, text, { parse_mode: 'HTML' }).catch(() => {});
    }

    // Broadcast juga ke semua user yang terdaftar
    if (isDaily) {
        const userMsg = isMaintenance
            ? `⛔ <b>MAINTENANCE SISTEM</b>
━━━━━━━━━━━━━━━━━━━━

Halo! Bot sedang dalam pemeliharaan rutin harian.

<blockquote><b>🔧 YANG SEDANG DILAKUKAN:</b>
🗄 Memelihara &amp; optimasi database
📈 Meningkatkan kualitas layanan
📦 Menambahkan stok nomor baru
🎁 Menyiapkan promo terbaru</blockquote>

⏳ <b>Jadwal:</b> 23:00 — 00:10 WIB
Kami akan segera kembali. Mohon ditunggu! 🙏`
            : `✅ <b>MAINTENANCE SELESAI!</b>
━━━━━━━━━━━━━━━━━━━━

Bot sudah aktif kembali! 🎉

<blockquote><b>✨ YANG SUDAH DIPERBARUI:</b>
🗄 Database telah dioptimasi
📈 Kualitas layanan ditingkatkan
📦 Stok nomor baru telah ditambahkan
🎁 Promo terbaru sudah tersedia</blockquote>

🚀 Semua fitur sudah tersedia.
💰 Silakan bertransaksi kembali!`;

        const allUids_mt = [...new Set([...db.users.map(u => u.id), ...readUsersJson()])];
        allUids_mt.forEach(async uid => {
            try {
                await botUser.sendMessage(uid, userMsg, { parse_mode: 'HTML' });
            } catch (e) {}
        });
        // ──────────────────────
    }
}

    // ==============================================
    // 2. INTEGRASI DEPOSIT PAKASIR (QRIS)
    // ==============================================
    
    async function createRumahOtpDepositTransaction(amount, userId) {
        try {
            const pendingCount = db.deposits.filter(d => d.userId === userId && d.status === 'pending').length;
            if (pendingCount >= 3) {
                return { success: false, message: 'Anda memiliki 3 deposit pending. Harap selesaikan atau batalkan terlebih dahulu.' };
            }

            const orderId = `DEP-${userId}-${Date.now()}`;
            const options = {
                method: 'POST',
                url: `https://app.pakasir.com/api/transactioncreate/qris`,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                data: {
                    project: settings.pakasirProject,
                    order_id: orderId,
                    amount: amount,
                    api_key: settings.pakasirApiKey
                }
            };
            const response = await fetchWithRetry(options);
            const d = response.data;
            if (d && d.payment) {
                const p = d.payment;
                return {
                    success: true,
                    data: {
                        id: p.order_id,
                        qr_string: p.payment_number,
                        currency: {
                            total: p.total_payment || amount,
                            diterima: p.amount || amount
                        },
                        expired_at_ts: p.expired_at ? new Date(p.expired_at).getTime() : (Date.now() + 20 * 60 * 1000),
                        method: 'qris'
                    }
                };
            }
            return { success: false, message: d && d.message ? d.message : 'Gagal membuat transaksi Pakasir.' };
        } catch (e) {
            console.error('Pakasir Deposit Error:', e.message);
            if (e.response && e.response.data) return { success: false, message: JSON.stringify(e.response.data) };
            return { success: false, message: 'Gagal menghubungi server pembayaran.' };
        }
    }

    async function checkRumahOtpDepositStatus(trxId) {
        try {
            // trxId di sini adalah order_id Pakasir dan amount tersimpan di db.deposits
            const depo = db.deposits.find(d => d.refId === trxId);
            if (!depo) return 'pending';
            const amount = depo.amount || depo.total || 0;

            const options = {
                method: 'GET',
                url: `https://app.pakasir.com/api/transactiondetail`,
                params: {
                    project: settings.pakasirProject,
                    amount: amount,
                    order_id: trxId,
                    api_key: settings.pakasirApiKey
                },
                headers: { 'Accept': 'application/json' }
            };
            const res = await fetchWithRetry(options);
            if (res.data && res.data.transaction) {
                const status = res.data.transaction.status;
                if (status === 'completed') return 'success';
                if (status === 'canceled' || status === 'cancel') return 'canceled';
                return 'pending';
            }
            return 'pending'; 
        } catch (e) {
            return 'pending'; 
        }
    }

    async function cancelPakasirTransaction(orderId, amount) {
        try {
            await axios.post('https://app.pakasir.com/api/transactioncancel', {
                project: settings.pakasirProject,
                order_id: orderId,
                amount: amount,
                api_key: settings.pakasirApiKey
            }, { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            // abaikan error cancel
        }
    }

    // ==============================================
    // 3. LOGIKA BOT ADMIN
    // ==============================================

    function getAdminStats() {
        const today = getDate(); // DD/MM/YYYY
        const thisMonth = today.split('/')[1] + '/' + today.split('/')[2];
        
        const totalUsers = db.users.length;
        
        // Orders this month
        const ordersThisMonth = db.orders.filter(o => o.status === 'success' && o.date && o.date.includes(thisMonth)).length;
        
        // Deposit this month
        const depoThisMonth = db.deposits.filter(d => d.status === 'success' && d.date && d.date.includes(thisMonth))
            .reduce((acc, curr) => acc + curr.amount, 0);

        // Total Trx (All Time)
        const totalTrx = db.stats.totalTrx;
        
        // Total Income (All Time)
        const totalIncome = db.stats.totalIncome;

        const margin = db.settings.otpMargin || 0;
        const mtStatus = db.settings.maintenance ? '🔴 ON' : '🟢 OFF';
        
        return `🏢 <b>RUMAH OTP | ADMIN SYSTEM</b>
━━━━━━━━━━━━━━━━━━━━
⚙️ <b>SYSTEM STATUS</b>
⏱ Uptime : <code>${getRuntime()}</code>
🛡 Mode Maintenance : ${mtStatus}

📊 <b>STATISTIK BOT</b>
👥 Total Member : <code>${totalUsers} Users</code>
🛒 Orderan Berhasil Bulan Ini : <code>${ordersThisMonth} Trx</code>
💵 Deposit Bulan Ini : <code>${formatRupiah(depoThisMonth)}</code>
📦 Total Keseluruhan Trx : <code>${totalTrx} Trx</code>
💰 Total Pendapatan Keseluruhan : <code>${formatRupiah(totalIncome)}</code>

🏷 Margin Nokos Umum : <code>${formatRupiah(margin)}</code>
━━━━━━━━━━━━━━━━━━━━
🔄 <i>Last synced: ${getTime()} WIB</i>`;
    }

    botAdmin.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (chatId.toString() !== settings.ownerId) return botAdmin.sendMessage(chatId, "❌ Anda bukan admin.");
        sendAdminDashboard(chatId);
    });

    async function sendAdminDashboard(chatId, msgId = null) {
        const caption = getAdminStats(); 
        const kb = {
            inline_keyboard: [
                [ { text: '👥 Manajemen User', callback_data: 'adm_cat_users' }, { text: '💰 Keuangan', callback_data: 'adm_cat_finance' } ],
                [ { text: '🛒 Produk & Transaksi', callback_data: 'adm_cat_products' }, { text: '⚙️ Sistem & Tampilan', callback_data: 'adm_cat_system' } ],
                [ { text: '🔄 Refresh Data', callback_data: 'adm_refresh' } ]
            ]
        };

        if (msgId) {
            try {
                 await botAdmin.editMessageMedia({ type: 'photo', media: settings.images.menuAdmin, caption: caption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: kb });
            } catch (e) {
                 botAdmin.sendMessage(chatId, "Dashboard refreshed.");
                 botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: caption, parse_mode: 'HTML', reply_markup: kb });
            }
        } else {
            botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: caption, parse_mode: 'HTML', reply_markup: kb });
        }
    }

    botAdmin.on('callback_query', async (query) => {
        try {
        const chatId = query.message.chat.id;
        const data = query.data;
        const msgId = query.message.message_id;

        if (chatId.toString() !== settings.ownerId) return;

        // Clear Live Monitor Interval if admin navigates away
        if (activeAdminMonitors[chatId] && !data.startsWith('adm_live_')) {
            clearInterval(activeAdminMonitors[chatId]);
            delete activeAdminMonitors[chatId];
        }

        if (data === 'adm_refresh') {
            sendAdminDashboard(chatId, msgId);
        }
        else if (data === 'adm_set_session_price') {
            adminState[chatId] = 'set_session_price';
            botAdmin.sendMessage(chatId, `💰 <b>ATUR HARGA SESI TELEGRAM</b>

Harga per akun saat ini: <b>${formatRupiah(db.settings.sessionPrice)}</b>

➡️ Masukkan Harga Baru (Ketik angka saja, contoh: 4500):`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_cat_users') {
            const kb = {
                inline_keyboard: [
                    [{ text: '👥 Kelola Pengguna', callback_data: 'adm_users_1' }, { text: '🏆 Atur Top User', callback_data: 'adm_top_menu' }],
                    [{ text: '🔍 Cek Bug Saldo', callback_data: 'adm_fraud_scan' }, { text: '🚫 Blokir / Unblokir User', callback_data: 'adm_block_menu' }],
                    [{ text: '📋 Log Fraud', callback_data: 'adm_fraud_log' }],
                    [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'adm_refresh' }]
                ]
            };
            botAdmin.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: msgId }).catch(()=>{});
        }
        else if (data === 'adm_cat_finance') {
            const kb = {
                inline_keyboard: [
                    [{ text: '➕ Tambah Saldo User', callback_data: 'adm_add_bal' }, { text: '⚙️ Atur Margin Umum', callback_data: 'adm_set_margin' }],
                    [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'adm_refresh' }]
                ]
            };
            botAdmin.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: msgId }).catch(()=>{});
        }
        else if (data === 'adm_cat_products') {
            const kb = {
                inline_keyboard: [
                    [{ text: '➕ Tambah Akun Sesi', callback_data: 'adm_add_session' }, { text: '💰 Atur Harga Sesi', callback_data: 'adm_set_session_price' }],
                    [{ text: '📋 Cek Stok Sesi', callback_data: 'adm_cek_stok_sesi' }, { text: '📜 Lihat Riwayat Trx', callback_data: 'adm_history' }],
                    [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'adm_refresh' }]
                ]
            };
            botAdmin.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: msgId }).catch(()=>{});
        }
        else if (data === 'adm_add_session') {
            adminState[chatId] = 'await_session_phone';
            botAdmin.sendMessage(chatId, `➕ <b>TAMBAH AKUN SESI (TELEGRAM)</b>

Masukkan Nomor Telepon (Gunakan kode negara, misal: +628...):`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_cek_stok_sesi') {
            const stokTersedia = db.telegramSessions ? db.telegramSessions.filter(s => s.status === 'tersedia').length : 0;
            const stokTerjual = db.telegramSessions ? db.telegramSessions.filter(s => s.status === 'terjual').length : 0;
            botAdmin.editMessageCaption(`📋 <b>INFO STOK SESI TELEGRAM</b>

📦 <b>Tersedia:</b> ${stokTersedia} Akun
🛒 <b>Terjual:</b> ${stokTerjual} Akun
💰 <b>Harga Per Akun:</b> ${formatRupiah(db.settings.sessionPrice || 4000)}`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'adm_cat_products' }]] } }).catch(()=>{});
        }
        else if (data === 'adm_cat_system') {
    const kb = {
        inline_keyboard: [
            [{ text: '📢 Broadcast', callback_data: 'adm_broadcast_menu' }, { text: '⚙️ Sync Service', callback_data: 'adm_sync_svc' }],
            [{ text: '🖼️ Info Banner', callback_data: 'adm_image_info' }, { text: '🔧 Maintenance', callback_data: 'adm_mt' }],
            [{ text: '🔗 Settings Join', callback_data: 'adm_set_join' }, { text: '🎛 Atur Menu Layanan', callback_data: 'adm_menu_toggle' }],
            [{ text: '📢 Setup Channel Logs', callback_data: 'adm_channel_menu' }],
            [{ text: '💾 Kelola Backup', callback_data: 'adm_backup_menu' }],  // ← TAMBAH INI
            [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'adm_refresh' }]
        ]
    };
    botAdmin.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: msgId }).catch(()=>{});
}
        else if (data === 'adm_channel_menu') {
            const ch = db.settings.channels || {};
            const kb = {
                inline_keyboard: [
                    [{ text: `📝 Ch Trx & Depo: ${ch.logTrxDepo ? 'Terisi' : 'Kosong'}`, callback_data: 'adm_set_ch_trxdepo' }],
                    [{ text: `📈 Ch Info Stok: ${ch.logStock ? 'Terisi' : 'Kosong'}`, callback_data: 'adm_set_ch_stock' }],
                    [{ text: '🔙 Kembali', callback_data: 'adm_cat_system' }]
                ]
            };
            botAdmin.editMessageCaption(`📢 <b>PENGATURAN CHANNEL LOG & INFO</b>\n\nAtur channel ID (contoh: -100123456) untuk memisahkan log:\n\n1. <b>Trx & Deposit</b>: Notif gabungan saat user berhasil order layanan / deposit masuk.\n2. <b>Info Stok</b>: Target channel untuk auto-podcast harga/stok promo.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
        }
        else if (data === 'adm_set_ch_trxdepo') {
            adminState[chatId] = 'set_ch_trxdepo';
            botAdmin.sendMessage(chatId, `Masukkan ID Channel untuk Log Transaksi & Deposit:`, {reply_markup: {force_reply: true}});
        }
        else if (data === 'adm_set_ch_stock') {
            adminState[chatId] = 'set_ch_stock';
            botAdmin.sendMessage(chatId, `Masukkan ID Channel untuk Update Stok / Promo Broadcast:`, {reply_markup: {force_reply: true}});
        }
        else if (data === 'adm_menu_toggle') {
            if (!db.settings.activeMenus) db.settings.activeMenus = { otp: true, sesi: true };
            const am = db.settings.activeMenus;
            const kb = {
                inline_keyboard: [
                    [{ text: `📱 Layanan OTP: ${am.otp ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'tgl_menu_otp' }, { text: `📦 Beli Sesi: ${am.sesi ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'tgl_menu_sesi' }],
                    [{ text: '🔙 Kembali', callback_data: 'adm_cat_system' }]
                ]
            };
            botAdmin.editMessageCaption(`🎛 <b>PENGATURAN MENU LAYANAN USER</b>\n\nKlik tombol di bawah ini untuk menghidupkan/mematikan menu pada Bot User.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
        }
        else if (data.startsWith('tgl_menu_')) {
            const menu = data.replace('tgl_menu_', '');
            if (!db.settings.activeMenus) db.settings.activeMenus = { otp: true, sesi: true };
            db.settings.activeMenus[menu] = !db.settings.activeMenus[menu];
            saveDB();
            botAdmin.emit('callback_query', { id: query.id, data: 'adm_menu_toggle', message: query.message });
        }
        // ============================================================
        // ADMIN: CEK BUG SALDO (SISTEM PINTAR DETEKSI ANOMALI)
        // ============================================================
        else if (data === 'adm_fraud_scan') {
            botAdmin.answerCallbackQuery(query.id, { text: '🔍 Sedang memindai seluruh saldo pengguna...' });
            const anomalies = [];
            const allUsers = Array.isArray(db.users) ? db.users : Object.values(db.users || {});
            for (const u of allUsers) {
                if (!u || !u.id) continue;
                const r = detectBalanceAnomaly(u.id);
                if (r && r.isAnomaly) anomalies.push(r);
            }

            if (anomalies.length === 0) {
                return botAdmin.editMessageCaption(`✅ <b>SCAN SELESAI — TIDAK ADA ANOMALI</b>

Semua saldo pengguna sesuai dengan riwayat deposit dan pembelian.

<i>Tidak ada indikasi penyalahgunaan sistem ditemukan.</i>`, {
                    chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'adm_cat_users' }]] }
                }).catch(()=>{});
            }

            let txt = `⚠️ <b>SCAN SELESAI — ${anomalies.length} ANOMALI DITEMUKAN</b>\n\n`;
            const kb = [];
            for (const a of anomalies.slice(0, 8)) {
                txt += `👤 @${a.username} (<code>${a.userId}</code>)\n`;
                txt += `├ Saldo: <b>${formatRupiah(a.currentSaldo)}</b>\n`;
                txt += `├ Total Depo: ${formatRupiah(a.totalDepo)}\n`;
                txt += `├ Total Belanja: ${formatRupiah(a.totalSpent)}\n`;
                txt += `└ Maks Normal: ${formatRupiah(a.expectedMaxSaldo)} | <b>Selisih: +${formatRupiah(a.selisih)}</b>\n\n`;
                kb.push([{ text: `🔧 Reset @${a.username || a.userId}`, callback_data: `adm_fraud_reset_${a.userId}` }]);
            }
            if (anomalies.length > 8) txt += `<i>...dan ${anomalies.length - 8} lainnya</i>\n`;
            kb.push([{ text: '🔧 Reset SEMUA Anomali Sekarang', callback_data: 'adm_fraud_reset_all' }]);
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_cat_users' }]);

            botAdmin.editMessageCaption(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data.startsWith('adm_fraud_reset_') && data !== 'adm_fraud_reset_all') {
            const targetId = data.replace('adm_fraud_reset_', '');
            const result = detectBalanceAnomaly(targetId);
            if (!result) return botAdmin.answerCallbackQuery(query.id, { text: '❌ User tidak ditemukan.', show_alert: true });

            const correctSaldo = Math.max(0, result.expectedMaxSaldo);
            const uIdx = db.users.findIndex(u => u.id == targetId);
            if (uIdx !== -1) {
                const before = db.users[uIdx].saldo;
                db.users[uIdx].saldo = correctSaldo;
                if (!db.fraudLog) db.fraudLog = [];
                db.fraudLog.push({ userId: result.userId, username: result.username, detectedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }), saldoBefore: before, saldoAfter: correctSaldo, expectedMaxSaldo: result.expectedMaxSaldo, totalDepo: result.totalDepo, totalSpent: result.totalSpent, selisih: result.selisih, note: 'Manual reset oleh admin' });
                saveDB();
                botAdmin.answerCallbackQuery(query.id, { text: `✅ Saldo @${result.username} di-reset ke ${formatRupiah(correctSaldo)}` });
                botUser.sendMessage(result.userId, `⚠️ <b>NOTIFIKASI DARI ADMIN</b>\n\nSaldo Anda telah disesuaikan ke <b>${formatRupiah(correctSaldo)}</b> berdasarkan audit riwayat transaksi.\n\nJika ada pertanyaan, silakan hubungi admin.`, { parse_mode: 'HTML' }).catch(() => {});
            }
        }
        else if (data === 'adm_fraud_reset_all') {
            const fixed = autoAuditAllUsers();
            botAdmin.answerCallbackQuery(query.id, { text: `✅ ${fixed} akun berhasil direset ke saldo normal.` });
            sendAdminDashboard(chatId, msgId);
        }
        else if (data === 'adm_fraud_log') {
            const logs = (db.fraudLog || []).slice(-10).reverse();
            if (logs.length === 0) return botAdmin.editMessageCaption(`📋 <b>LOG FRAUD</b>\n\nBelum ada catatan anomali saldo.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'adm_cat_users' }]] } }).catch(()=>{});
            let txt = `📋 <b>LOG FRAUD (10 Terbaru)</b>\n\n`;
            for (const l of logs) {
                txt += `👤 @${l.username} | ${l.detectedAt}\n`;
                txt += `└ ${formatRupiah(l.saldoBefore)} → ${formatRupiah(l.saldoAfter)} (selisih: ${formatRupiah(l.selisih)})\n\n`;
            }
            botAdmin.editMessageCaption(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'adm_cat_users' }]] } }).catch(()=>{});
        }

        // ============================================================
        // ADMIN: BLOKIR / UNBLOKIR USER
        // ============================================================
        else if (data === 'adm_block_menu') {
            const blockedList = db.blockedUsers || [];
            let txt = `🚫 <b>MANAJEMEN BLOKIR USER</b>\n\nTotal Diblokir: <b>${blockedList.length} User</b>\n\n`;
            if (blockedList.length > 0) {
                txt += `<b>Daftar Diblokir:</b>\n`;
                blockedList.slice(-5).forEach(b => {
                    txt += `• @${b.username || b.userId} — <i>${b.reason}</i>\n`;
                });
            }
            const kb = [
                [{ text: '🚫 Blokir User Baru', callback_data: 'adm_block_ask_id' }],
                [{ text: '✅ Unblokir User', callback_data: 'adm_unblock_ask_id' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_cat_users' }]
            ];
            botAdmin.editMessageCaption(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data === 'adm_block_ask_id') {
            adminState[chatId] = 'await_block_user_id';
            botAdmin.sendMessage(chatId, `🚫 <b>BLOKIR USER</b>\n\nMasukkan ID atau Username pengguna yang ingin diblokir:`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_unblock_ask_id') {
            adminState[chatId] = 'await_unblock_user_id';
            botAdmin.sendMessage(chatId, `✅ <b>UNBLOKIR USER</b>\n\nMasukkan ID atau Username pengguna yang ingin di-unblokir:`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data.startsWith('adm_block_reason_')) {
            // Format: adm_block_reason_USERID_REASONINDEX
            const parts = data.split('_');
            const targetBlockId = parts[3];
            const reasonIdx = parseInt(parts[4]);
            const reasons = [
                'Memanfaatkan bug sistem untuk mendapatkan saldo gratis',
                'Melakukan penipuan/tuyul pada sistem bot',
                'Penyalahgunaan fitur refund/cancel OTP secara berulang',
                'Percobaan manipulasi saldo akun',
                'Melanggar syarat & ketentuan layanan'
            ];
            const chosenReason = reasons[reasonIdx] || 'Pelanggaran kebijakan layanan';
            const targetUser = db.users.find(u => u.id == targetBlockId);
            if (!targetUser) return botAdmin.answerCallbackQuery(query.id, { text: '❌ User tidak ditemukan.', show_alert: true });

            if (!db.blockedUsers) db.blockedUsers = [];
            const alreadyBlocked = db.blockedUsers.find(b => b.userId == targetBlockId);
            if (alreadyBlocked) return botAdmin.answerCallbackQuery(query.id, { text: '⚠️ User sudah dalam daftar blokir.', show_alert: true });

            db.blockedUsers.push({ userId: targetUser.id, username: targetUser.username, reason: chosenReason, blockedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) });
            saveDB();
            botAdmin.answerCallbackQuery(query.id, { text: `✅ @${targetUser.username || targetBlockId} berhasil diblokir.` });
            botUser.sendMessage(targetUser.id, `🚫 <b>AKUN ANDA TELAH DIBLOKIR</b>\n\n<b>Alasan:</b> ${chosenReason}\n\nHubungi admin jika Anda keberatan.`, { parse_mode: 'HTML' }).catch(() => {});
            sendAdminDashboard(chatId, msgId);
        }

        else if (data === 'adm_set_join') {
            adminState[chatId] = 'set_join_count';
            botAdmin.sendMessage(chatId, `⚙️ <b>SETTINGS JOIN CHANNEL</b>
            
Berapa banyak channel Wajib Join yang ingin diset?
Ketik angka (contoh: 2, atau ketik 0 untuk mematikan fitur ini):`, {parse_mode: 'HTML', reply_markup: {force_reply: true}});
        }
        else if (data.startsWith('adm_users_') || data === 'adm_search_user_reset') {
            let page = 1;
            if (!adminBcSession[chatId]) adminBcSession[chatId] = {}; 
            let searchQuery = adminBcSession[chatId].userSearch || "";

            if (data.startsWith('adm_users_')) {
                page = parseInt(data.split('_')[2]) || 1;
            } else if (data === 'adm_search_user_reset') {
                adminBcSession[chatId].userSearch = "";
                searchQuery = "";
                page = 1;
            }

            let rawUsers = Array.isArray(db.users) ? db.users : Object.values(db.users || {});
            let usersList = rawUsers.filter(u => u && u.id); 

            if (searchQuery) {
                usersList = usersList.filter(u => 
                    u.id.toString().includes(searchQuery) || 
                    (u.username && u.username.toLowerCase().includes(searchQuery.toLowerCase()))
                );
            }

            const totalPage = Math.ceil(usersList.length / 6);
            if (page > totalPage && totalPage > 0) page = 1;

            const paginated = paginateArray(usersList, 6, page);
            let kb = [];
            for (let i = 0; i < paginated.length; i += 2) {
                let row = [{ text: `👤 ${paginated[i].username || paginated[i].id}`, callback_data: `adm_udetail_${paginated[i].id}` }];
                if (paginated[i+1]) row.push({ text: `👤 ${paginated[i+1].username || paginated[i+1].id}`, callback_data: `adm_udetail_${paginated[i+1].id}` });
                kb.push(row);
            }

            let nav = [];
            if (page > 1) nav.push({ text: '⬅️', callback_data: `adm_users_${page - 1}` });
            nav.push({ text: searchQuery ? '❌ Hapus Cari' : '🔍 Cari Pengguna', callback_data: searchQuery ? 'adm_search_user_reset' : 'adm_search_user' });
            if (page < totalPage) nav.push({ text: '➡️', callback_data: `adm_users_${page + 1}` });
            if(nav.length > 0) kb.push(nav);
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_refresh' }]);

            botAdmin.editMessageCaption(`👥 <b>KELOLA PENGGUNA</b>
Total Pengguna: ${usersList.length}
Halaman: ${page}/${totalPage}
Pencarian: ${searchQuery || 'Tidak ada'}`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data === 'adm_search_user') {
            adminState[chatId] = 'await_search_user';
            botAdmin.sendMessage(chatId, `🔍 Masukkan Username atau ID Pengguna yang dicari:`, { reply_markup: { force_reply: true } });
        }
        else if (data.startsWith('adm_udetail_')) {
            const targetId = data.split('_')[2];
            const targetUser = db.users.find(u => u.id == targetId);
            if(!targetUser) return botAdmin.answerCallbackQuery(query.id, { text: '❌ User tidak ditemukan!', show_alert: true });

            const totalDepoCount = db.deposits.filter(d => d.userId == targetId && d.status === 'success').length;
            const totalDepoAmount = db.deposits.filter(d => d.userId == targetId && d.status === 'success').reduce((acc, curr) => acc + curr.amount, 0);
            const totalTrxCount = db.orders.filter(o => o.userId == targetId && o.status === 'success').length;

            let marginStatus = "Mengikuti Margin Umum";
            let marginValue = db.settings.otpMargin || 0;
            
            if (targetUser.useSpecialMargin) {
                marginStatus = "✅ Margin Khusus (Permanen)";
                marginValue = targetUser.specialMarginValue || 0;
            }

            const caption = `👤 <b>DETAIL PENGGUNA</b>

🆔 <b>ID:</b> <code>${targetUser.id}</code>
🗣 <b>Username:</b> @${targetUser.username || 'Tidak ada'}
💰 <b>Saldo:</b> ${formatRupiah(targetUser.saldo)}
📅 <b>Bergabung:</b> ${targetUser.joined || 'Tidak diketahui'}

🏷 <b>Status Margin:</b> ${marginStatus}
💵 <b>Nilai Margin Saat Ini:</b> ${formatRupiah(marginValue)}

📊 <b>STATISTIK TRANSAKSI</b>
💵 Total Deposit: ${formatRupiah(totalDepoAmount)} (${totalDepoCount}x)
🛍 Total Order: ${totalTrxCount}x`;

            const isBlocked = db.blockedUsers && db.blockedUsers.find(b => b.userId == targetId);
            const kb = [
                [{ text: 'Ubah Saldo', callback_data: `adm_edit_saldo_${targetUser.id}` }, { text: 'Atur Margin Nokos', callback_data: `adm_margin_menu_${targetUser.id}` }],
                [{ text: isBlocked ? '✅ Unblokir User' : '🚫 Blokir User', callback_data: isBlocked ? `adm_udetail_unblock_${targetUser.id}` : `adm_udetail_block_${targetUser.id}` }],
                [{ text: '🔍 Cek Anomali Saldo', callback_data: `adm_udetail_audit_${targetUser.id}` }],
                [{ text: '🔙 Kembali ke List', callback_data: 'adm_users_1' }]
            ];
            botAdmin.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data.startsWith('adm_udetail_block_')) {
            const tId = data.replace('adm_udetail_block_', '');
            const tUser = db.users.find(u => u.id == tId);
            if (!tUser) return botAdmin.answerCallbackQuery(query.id, { text: '❌ User tidak ditemukan.', show_alert: true });
            const rList = [
                'Memanfaatkan bug sistem untuk mendapatkan saldo gratis',
                'Melakukan penipuan/tuyul pada sistem bot',
                'Penyalahgunaan fitur refund/cancel OTP secara berulang',
                'Percobaan manipulasi saldo akun',
                'Melanggar syarat & ketentuan layanan'
            ];
            const rKb = rList.map((r, i) => [{ text: r, callback_data: `adm_block_reason_${tUser.id}_${i}` }]);
            rKb.push([{ text: '🔙 Kembali', callback_data: `adm_udetail_${tId}` }]);
            botAdmin.sendMessage(chatId, `🚫 <b>Pilih alasan blokir untuk @${tUser.username || tId}:</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rKb } });
        }
        else if (data.startsWith('adm_udetail_unblock_')) {
            const tId = data.replace('adm_udetail_unblock_', '');
            const bIdx2 = (db.blockedUsers || []).findIndex(b => b.userId == tId);
            if (bIdx2 === -1) return botAdmin.answerCallbackQuery(query.id, { text: '⚠️ User tidak ada di daftar blokir.', show_alert: true });
            const ub = db.blockedUsers[bIdx2];
            db.blockedUsers.splice(bIdx2, 1);
            saveDB();
            botAdmin.answerCallbackQuery(query.id, { text: `✅ @${ub.username || ub.userId} berhasil di-unblokir.` });
            botUser.sendMessage(ub.userId, `✅ <b>AKUN ANDA TELAH DIBUKA KEMBALI</b>\n\nAkun Anda telah di-unblokir oleh admin.`, { parse_mode: 'HTML' }).catch(() => {});
            botAdmin.emit('callback_query', { id: query.id, data: `adm_udetail_${tId}`, message: query.message });
        }
        else if (data.startsWith('adm_udetail_audit_')) {
            const tId = data.replace('adm_udetail_audit_', '');
            const auditRes = detectBalanceAnomaly(tId);
            if (!auditRes) return botAdmin.answerCallbackQuery(query.id, { text: '❌ User tidak ditemukan.', show_alert: true });
            const statusTxt = auditRes.isAnomaly ? `⚠️ ANOMALI TERDETEKSI!\nSaldo lebih dari yang seharusnya sebesar ${formatRupiah(auditRes.selisih)}` : '✅ NORMAL — Saldo sesuai riwayat transaksi';
            const auditTxt = `🔍 <b>AUDIT SALDO: @${auditRes.username}</b>

<blockquote>📊 <b>Rincian Audit</b>
💰 Saldo Aktif: <b>${formatRupiah(auditRes.currentSaldo)}</b>
✅ Total Deposit: ${formatRupiah(auditRes.totalDepo)}
🛒 Total Belanja: ${formatRupiah(auditRes.totalSpent)}
🎁 Bonus Referral: ${formatRupiah(auditRes.referralBonus)}
📐 Maks Saldo Normal: <b>${formatRupiah(auditRes.expectedMaxSaldo)}</b></blockquote>

${statusTxt}`;
            const auditKb = auditRes.isAnomaly
                ? [[{ text: `🔧 Reset ke ${formatRupiah(Math.max(0, auditRes.expectedMaxSaldo))}`, callback_data: `adm_fraud_reset_${tId}` }], [{ text: '🔙 Kembali', callback_data: `adm_udetail_${tId}` }]]
                : [[{ text: '🔙 Kembali', callback_data: `adm_udetail_${tId}` }]];
            botAdmin.editMessageCaption(auditTxt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: auditKb } }).catch(()=>{});
        }
        else if (data.startsWith('adm_margin_menu_')) {
            const targetId = data.replace('adm_margin_menu_', '');
            const targetUser = db.users.find(u => u.id == targetId);
            if(!targetUser) return botAdmin.answerCallbackQuery(query.id, { text: 'User hilang', show_alert: true });

            const isSpecial = targetUser.useSpecialMargin || false;
            const currentVal = isSpecial ? targetUser.specialMarginValue : (db.settings.otpMargin || 0);

            const txt = `🏷 <b>PENGATURAN MARGIN KHUSUS</b>

User: <b>${targetUser.username || targetId}</b>
Status Saat Ini: <b>${isSpecial ? '✅ AKTIF (Permanen)' : '❌ NON-AKTIF (Ikut Umum)'}</b>
Nominal Margin: <b>${formatRupiah(currentVal)}</b>

<i>Jika dihidupkan, user ini akan memiliki harga sendiri dan TIDAK TERPENGARUH perubahan margin global.</i>`;
            const kb = [
                [ { text: '🔴 Matikan Margin', callback_data: `adm_margin_off_${targetId}` }, { text: '🟢 Hidupkan Margin', callback_data: `adm_margin_on_ask_${targetId}` } ],
                [{ text: '🔙 Kembali', callback_data: `adm_udetail_${targetId}` }]
            ];
            botAdmin.editMessageCaption(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data.startsWith('adm_margin_off_')) {
            const targetId = data.replace('adm_margin_off_', '');
            const uIdx = db.users.findIndex(u => u.id == targetId);
            if (uIdx !== -1) {
                db.users[uIdx].useSpecialMargin = false;
                saveDB();
                botAdmin.answerCallbackQuery(query.id, { text: '✅ Margin Khusus Dimatikan. User kembali mengikuti margin umum.' });
                botAdmin.emit('callback_query', { id: query.id, data: `adm_margin_menu_${targetId}`, message: query.message }); 
            }
        }
        else if (data.startsWith('adm_margin_on_ask_')) {
            const targetId = data.replace('adm_margin_on_ask_', '');
            adminState[chatId] = `await_set_special_margin_${targetId}`;
            botAdmin.sendMessage(chatId, `🟢 <b>HIDUPKAN MARGIN KHUSUS</b>

Masukkan nominal margin (keuntungan) permanen untuk user <code>${targetId}</code>:
(Contoh: 2000)`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data.startsWith('adm_edit_saldo_')) {
            const targetId = data.replace('adm_edit_saldo_', '');
            adminState[chatId] = `await_edit_saldo_${targetId}`;
            botAdmin.sendMessage(chatId, `💰 <b>UBAH SALDO</b>

Masukkan nominal Saldo BARU untuk User <code>${targetId}</code>:
(Ketik nominal angka saja)`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_top_menu') {
            const topSys = db.settings.topSystem || { maxTop: 3, minDepoRank1: 40000, minDepoRank2: 30000, minDepoRank3: 20000, resetDays: 0, nextResetTime: 0, discountRank1: 5, discountRank2: 3, discountRank3: 1 };
            let userDepoList = db.users.filter(u => (u.topDeposit || 0) > 0).map(u => ({ ...u, topDepo: u.topDeposit || 0 }));
            userDepoList.sort((a, b) => b.topDepo - a.topDepo);
            let eligibleUsers = userDepoList.filter(u => u.topDepo >= (topSys.minDepoRank3 || 0));

            let top1 = eligibleUsers.length > 0 && eligibleUsers[0].topDepo >= topSys.minDepoRank1 ? eligibleUsers[0] : null;
            let top2 = eligibleUsers.length > 1 && eligibleUsers[1].topDepo >= topSys.minDepoRank2 ? eligibleUsers[1] : null;
            let top3 = eligibleUsers.length > 2 && eligibleUsers[2].topDepo >= topSys.minDepoRank3 ? eligibleUsers[2] : null;

            const getUname = (u) => u ? (u.username ? `@${u.username}` : `User ${u.id}`) : "Belum ada";
            const getDepo = (u) => u ? formatRupiah(u.topDepo) : "Rp 0";

            const caption = `🏆 𝗔𝗧𝗨𝗥 𝗛𝗔𝗗𝗜𝗔 𝗧𝗢𝗣 🏆

𝗟𝗶𝘀𝘁 𝗽𝗲𝗻𝗴𝘂𝗻𝗮 𝘆𝗮𝗻𝗴 𝗺𝗮𝘀𝘂𝗸 𝘁𝗼𝗽 & 𝘁𝗼𝘁𝗮𝗹 𝗱𝗲𝗽𝗼𝘀𝗶𝘁 𝗻𝘆𝗮 𝗱𝗮𝗻 𝘁𝗼𝘁𝗮𝗹 𝗱𝗶𝘀𝗸𝗼𝗻 𝘆𝗮𝗻𝗴 𝗮𝗸𝗮𝗻 𝗱𝗶 𝗱𝗮𝗽𝗮𝘁❗

🥇 𝗧𝗢𝗣 𝟭 (𝗦𝘂𝗹𝘁𝗮𝗻)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank1)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank1}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top1)}
└ 📋 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top1)}

🥈 𝗧𝗢𝗣 𝟮 (𝗝𝘂𝗿𝗮𝗴𝗮𝗻)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank2)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank2}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top2)}
└ 📋 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top2)}

🥉 𝗧𝗢𝗣 𝟯 (𝗝𝗮𝘄𝗮𝗿𝗮)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank3)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank3}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top3)}
└ ?? 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top3)}`;
            const kb = [
                [{ text: '🎁 Atur Diskon Top', callback_data: 'adm_top_set_disc_menu' }, { text: '⏳ Atur Reset Leaderboard', callback_data: 'adm_top_set_reset' }],
                [{ text: '📈 Atur Syarat Masuk Top', callback_data: 'adm_top_set_min_menu' }, { text: '🔙 Kembali', callback_data: 'adm_refresh' }]
            ];
            botAdmin.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data === 'adm_top_set_disc_menu') {
            const kb = [
                [{ text: '🥇 Diskon Top 1', callback_data: 'adm_top_set_disc1' }],
                [{ text: '🥈 Diskon Top 2', callback_data: 'adm_top_set_disc2' }],
                [{ text: '🥉 Diskon Top 3', callback_data: 'adm_top_set_disc3' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_top_menu' }]
            ];
            botAdmin.editMessageCaption('🎁 Pilih diskon rank mana yang ingin diatur (Maks 10%):', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data === 'adm_top_set_min_menu') {
            const kb = [
                [{ text: '🥇 Syarat Top 1', callback_data: 'adm_top_set_min1' }],
                [{ text: '🥈 Syarat Top 2', callback_data: 'adm_top_set_min2' }],
                [{ text: '🥉 Syarat Top 3', callback_data: 'adm_top_set_min3' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_top_menu' }]
            ];
            botAdmin.editMessageCaption('📈 Pilih syarat masuk top rank mana yang ingin diatur:', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
        }
        else if (data === 'adm_top_set_disc1') { adminState[chatId] = 'set_top_disc1'; botAdmin.sendMessage(chatId, '🥇 Masukkan Persentase Diskon untuk Top 1 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_disc2') { adminState[chatId] = 'set_top_disc2'; botAdmin.sendMessage(chatId, '🥈 Masukkan Persentase Diskon untuk Top 2 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_disc3') { adminState[chatId] = 'set_top_disc3'; botAdmin.sendMessage(chatId, '🥉 Masukkan Persentase Diskon untuk Top 3 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_min1') { adminState[chatId] = 'set_top_min1'; botAdmin.sendMessage(chatId, '🥇 Masukkan syarat TOTAL DEPOSIT untuk Rank 1 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_min2') { adminState[chatId] = 'set_top_min2'; botAdmin.sendMessage(chatId, '🥈 Masukkan syarat TOTAL DEPOSIT untuk Rank 2 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_min3') { adminState[chatId] = 'set_top_min3'; botAdmin.sendMessage(chatId, '🥉 Masukkan syarat TOTAL DEPOSIT untuk Rank 3 (Angka):', { reply_markup: { force_reply: true } }); }
        else if (data === 'adm_top_set_reset') { adminState[chatId] = 'set_top_reset'; botAdmin.sendMessage(chatId, '⏳ Masukkan waktu reset Top Users (Hari):', { reply_markup: { force_reply: true } }); }
        
        else if (data === 'adm_sync_svc') {
            botAdmin.answerCallbackQuery(query.id, { text: '⏳ Sedang Sinkronisasi ID Layanan...' });
            const syncResult = await syncServices();
            if (syncResult.success) {
                botAdmin.sendMessage(chatId, `✅ <b>SINKRONISASI BERHASIL!</b>

Berhasil memperbarui <b>${syncResult.count}</b> ID Layanan dari Provider (RumahOTP). Semua ID Layanan kini terupdate otomatis.`, { parse_mode: 'HTML' });
            } else {
                botAdmin.sendMessage(chatId, `❌ <b>SINKRONISASI GAGAL!</b>

Koneksi ke API Provider terputus. Silakan coba lagi nanti.`, { parse_mode: 'HTML' });
            }
        }
        else if (data === 'adm_broadcast_menu') {
            const kb = [
                [{ text: '📝 Podcast Teks Manual', callback_data: 'adm_bc_msg' }, { text: '🔄 Auto Kirim Pesan Teks', callback_data: 'adm_abm_menu' }],
                [{ text: '💰 Podcast Harga (Otomatis)', callback_data: 'adm_bc_price_svc_1' }, { text: '🔥 Podcast Promo Top 10', callback_data: 'adm_bc_promo_top10_1' }],
                [{ text: '⏱️ Auto Update Stok', callback_data: 'adm_auto_podcast_menu' }, { text: '🔙 Kembali', callback_data: 'adm_refresh' }]
            ];
            botAdmin.editMessageCaption(`📢 <b>MENU POSCAST / BROADCAST</b>

Silahkan pilih metode broadcast:`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data === 'adm_abm_menu') {
            const abm = db.settings.autoBroadcastMsg || { active: false, intervalMinutes: 60, text: null };
            const statusStr = abm.active ? '🟢 AKTIF' : '🔴 NONAKTIF';
            const kb = [
                [{ text: abm.active ? '🔴 Matikan Auto Pesan' : '🟢 Hidupkan Auto Pesan', callback_data: 'adm_abm_toggle' }],
                [{ text: `⏱ Atur Interval (${abm.intervalMinutes} Menit)`, callback_data: 'adm_abm_int' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_broadcast_menu' }]
            ];
            const caption = `🔄 <b>AUTO KIRIM PESAN KE PENGGUNA</b>

Status: <b>${statusStr}</b>
Interval: <b>${abm.intervalMinutes} Menit</b>
Pesan Diset: <b>${abm.text ? '✅ Ya' : '❌ Belum'}</b>

ℹ️ <i>Fitur ini mengirimkan pesan teks murni (beserta format font seperti bold/italic) ke seluruh pengguna.</i>
Untuk mengatur isi pesan, silakan reply pesan Anda (hanya teks, tidak termasuk gambar/tombol) lalu ketik:
<code>.setpesan</code>`;
            botAdmin.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data === 'adm_abm_toggle') {
            if (!db.settings.autoBroadcastMsg) db.settings.autoBroadcastMsg = { active: false, intervalMinutes: 60, text: null, entities: null };
            db.settings.autoBroadcastMsg.active = !db.settings.autoBroadcastMsg.active;
            saveDB();
            botAdmin.emit('callback_query', { id: query.id, data: 'adm_abm_menu', message: query.message });
        }
        else if (data === 'adm_abm_int') {
            adminState[chatId] = 'await_abm_int';
            botAdmin.sendMessage(chatId, `⏱ Masukkan interval untuk auto-pesan (menit):`, { reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_bc_msg') {
            botAdmin.sendMessage(chatId, `📢 <b>BROADCAST PESAN TEKS MANUAL</b>

Silakan ketik pesan menggunakan format langsung dari Telegram (Bold, Italic, Link, dll), lalu balas pesan (Reply) tersebut dengan mengetik <b>Share</b>. 

Pesan tersebut akan dikirimkan ke seluruh pengguna (Hanya format TEKS, jika ada gambar tidak akan dikirim gambarnya).`, { parse_mode: 'HTML' });
        }
        else if (data === 'adm_auto_podcast_menu') {
            const ap = db.settings.autoPodcast;
            const statusStr = ap.active ? '🟢 AKTIF' : '🔴 NONAKTIF';
            const kb = [
                [{ text: ap.active ? '🔴 Matikan Auto Podcast' : '🟢 Hidupkan Auto Podcast', callback_data: 'adm_ap_toggle' }],
                [{ text: '📱 Pilih Layanan', callback_data: 'adm_ap_sel_svc_1' }, { text: `⏱ Interval (${ap.intervalMinutes} Menit)`, callback_data: 'adm_ap_set_int' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_broadcast_menu' }]
            ];
            const caption = `⏱️ <b>PENGATURAN AUTO UPDATE STOK</b>

Status: <b>${statusStr}</b>
Layanan Terpilih: <b>${ap.serviceCode ? ap.serviceCode.toUpperCase() : 'Belum Dipilih'}</b>
Interval: <b>${ap.intervalMinutes} Menit</b>

<i>Sistem otomatis mengirim pesan perbandingan stok & harga turun. Target channel dapat diatur di Pengaturan Channel Log.</i>`;
            botAdmin.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data === 'adm_ap_toggle') {
            db.settings.autoPodcast.active = !db.settings.autoPodcast.active;
            saveDB();
            botAdmin.emit('callback_query', { id: query.id, data: 'adm_auto_podcast_menu', message: query.message });
        }
        else if (data === 'adm_ap_set_int') {
            adminState[chatId] = 'await_ap_int';
            botAdmin.sendMessage(chatId, `⏱ Masukkan interval (menit):`, { reply_markup: { force_reply: true } });
        }
        else if (data.startsWith('adm_ap_sel_svc_')) {
            const page = parseInt(data.split('_')[4]) || 1;
            botAdmin.answerCallbackQuery(query.id, { text: '⏳ Mengambil data layanan...' });
            if (cachedOtpServices.length === 0) await syncServices();
            if (cachedOtpServices.length === 0) return botAdmin.sendMessage(chatId, '❌ Gagal koneksi ke API.');

            const services = [...cachedOtpServices];
            const totalPage = Math.ceil(services.length / 10);
            const paginated = paginateArray(services, 10, page);

            let kb = [];
            for (let i = 0; i < paginated.length; i += 2) {
                let row = [{ text: `${paginated[i].service_name}`, callback_data: `adm_ap_sv_set_${paginated[i].service_code}` }];
                if (paginated[i+1]) row.push({ text: `${paginated[i+1].service_name}`, callback_data: `adm_ap_sv_set_${paginated[i+1].service_code}` });
                kb.push(row);
            }
            let nav = [];
            if (page > 1) nav.push({ text: '⬅️', callback_data: `adm_ap_sel_svc_${page - 1}` });
            if (page < totalPage) nav.push({ text: '➡️', callback_data: `adm_ap_sel_svc_${page + 1}` });
            if(nav.length > 0) kb.push(nav);
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_auto_podcast_menu' }]);

            botAdmin.editMessageCaption(`📱 <b>PILIH LAYANAN UNTUK AUTO PODCAST</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data.startsWith('adm_ap_sv_set_')) {
            const svcCode = data.replace('adm_ap_sv_set_', '');
            db.settings.autoPodcast.serviceCode = svcCode;
            saveDB();
            botAdmin.answerCallbackQuery(query.id, { text: '✅ Layanan Disimpan!' });
            botAdmin.emit('callback_query', { id: query.id, data: 'adm_auto_podcast_menu', message: query.message });
        }
        else if (data.startsWith('adm_bc_promo_top10_')) {
            const page = parseInt(data.split('_')[4]) || 1;
            botAdmin.answerCallbackQuery(query.id, { text: '⏳ Mengambil data layanan...' });
            if (cachedOtpServices.length === 0) await syncServices();
            if (cachedOtpServices.length === 0) return botAdmin.sendMessage(chatId, '❌ Gagal koneksi API.');

            const services = [...cachedOtpServices];
            const totalPage = Math.ceil(services.length / 10);
            const paginated = paginateArray(services, 10, page);

            let kb = [];
            for (let i = 0; i < paginated.length; i += 2) {
                let row = [{ text: `${paginated[i].service_name}`, callback_data: `adm_bc_promo_exec_${paginated[i].service_code}_${paginated[i].service_name}` }];
                if (paginated[i+1]) row.push({ text: `${paginated[i+1].service_name}`, callback_data: `adm_bc_promo_exec_${paginated[i+1].service_code}_${paginated[i+1].service_name}` });
                kb.push(row);
            }
            let nav = [];
            if (page > 1) nav.push({ text: '⬅️', callback_data: `adm_bc_promo_top10_${page - 1}` });
            if (page < totalPage) nav.push({ text: '➡️', callback_data: `adm_bc_promo_top10_${page + 1}` });
            if(nav.length > 0) kb.push(nav);
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_broadcast_menu' }]);

            botAdmin.editMessageCaption(`🔥 <b>PODCAST PROMO TOP 10</b>

Pilih <b>LAYANAN</b>:`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data.startsWith('adm_bc_promo_exec_')) {
            const parts = data.split('_');
            const svcCode = parts[4];
            const svcName = parts[5];
            botAdmin.sendMessage(chatId, `⏳ <b>Sedang menyusun Promo Top 10...</b>`, { parse_mode: 'HTML' });

            const res = await reqOtp(`/api/v2/countries?service_id=${svcCode}`);
            if (!res.success || !res.data) return botAdmin.sendMessage(chatId, '❌ Gagal ambil data.');

            let countryPrices = [];
            res.data.forEach(c => {
                if (c.pricelist && c.pricelist.length > 0) {
                    let sortedPrices = [...c.pricelist].sort((a,b) => parseInt(a.price) - parseInt(b.price));
                    countryPrices.push({ name: c.name, price: parseInt(sortedPrices[0].price) });
                }
            });

            countryPrices.sort((a,b) => a.price - b.price);
            let top10 = countryPrices.slice(0, 10);
            const margin = db.settings.otpMargin || 0;
                     let listText = '';
            top10.forEach((c, i) => {
                let flagEmoji = getFlag(c.name);
                listText += `${i+1}. ${flagEmoji} <b>${c.name}</b> - ${formatRupiah(c.price + margin)}
`;
            });

            const broadcastCaption = `🔥 <b>PROMO VIRTUAL NUMBER: ${svcName.toUpperCase()}</b> 🔥
<i>Cari nomor OTP untuk nuyul atau akun bisnis? Pesan instan 24 Jam!</i>

<blockquote><b>🌟 TOP 10 NEGARA TERMURAH SAAT INI</b>
${listText.trim()}</blockquote>

👇 <b>ORDER SEKARANG VIA BOT RESMI:</b>
${settings.botUrl || `https://t.me/${settings.botUsername}`}`;

            const bcMarkup = { inline_keyboard: [[{ text: '🛒 ORDER SEKARANG', url: settings.botUrl || `https://t.me/${settings.botUsername}` }]] };
            
            let stockChannel = db.settings.channels.logStock || settings.channelLogId;
            if (stockChannel) botUser.sendMessage(stockChannel, broadcastCaption, { parse_mode: 'HTML', reply_markup: bcMarkup }).catch(()=>{});
           
            let success = 0;
            const allUserIds_promo = [...new Set([...db.users.map(u => u.id), ...readUsersJson()])];
            for (let uid of allUserIds_promo) {
                try {
                    await botUser.sendMessage(uid, broadcastCaption, { parse_mode: 'HTML', reply_markup: bcMarkup });
                    success++;
                } catch (e) {}
            }
            botAdmin.sendMessage(chatId, `✅ <b>BROADCAST PROMO SELESAI!</b>\nTerikirim ke: ${success} User`, { parse_mode: 'HTML' });
            sendAdminDashboard(chatId);
        }
        
        else if (data.startsWith('adm_bc_price_svc_')) {
            const page = parseInt(data.split('_')[4]) || 1;
            if (!adminBcSession[chatId]) adminBcSession[chatId] = {};
            botAdmin.answerCallbackQuery(query.id, { text: '⏳ Mengambil data layanan...' });
            if (cachedOtpServices.length === 0) await syncServices();
            if (cachedOtpServices.length === 0) return botAdmin.sendMessage(chatId, '❌ Gagal koneksi API.');

            const services = [...cachedOtpServices];
            const totalPage = Math.ceil(services.length / 10);
            const paginated = paginateArray(services, 10, page);

            let kb = [];
            for (let i = 0; i < paginated.length; i += 2) {
                let row = [{ text: `${paginated[i].service_name}`, callback_data: `adm_bc_sel_svc_${paginated[i].service_code}` }];
                if (paginated[i+1]) row.push({ text: `${paginated[i+1].service_name}`, callback_data: `adm_bc_sel_svc_${paginated[i+1].service_code}` });
                kb.push(row);
            }
            let nav = [];
            if (page > 1) nav.push({ text: '⬅️', callback_data: `adm_bc_price_svc_${page - 1}` });
            if (page < totalPage) nav.push({ text: '➡️', callback_data: `adm_bc_price_svc_${page + 1}` });
            if(nav.length > 0) kb.push(nav);
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_broadcast_menu' }]);

            botAdmin.editMessageCaption(`💰 <b>POSCAST HARGA - LANGKAH 1/2</b>
Pilih <b>LAYANAN</b>:`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data.startsWith('adm_bc_sel_svc_')) {
            const svcCode = data.replace('adm_bc_sel_svc_', '');
            adminBcSession[chatId].serviceCode = svcCode;
            const res = await reqOtp(`/api/v2/countries?service_id=${svcCode}`);
            if (!res.success) return botAdmin.sendMessage(chatId, '❌ Gagal ambil negara.');

            const countries = res.data;
            const paginated = paginateArray(countries, 8, 1);
            const kb = [];
            for (let i = 0; i < paginated.length; i += 2) {
                 let row = [{ text: `${paginated[i].name}`, callback_data: `adm_bc_exec_${paginated[i].number_id}_${paginated[i].name}` }];
                 if (paginated[i+1]) row.push({ text: `${paginated[i+1].name}`, callback_data: `adm_bc_exec_${paginated[i+1].number_id}_${paginated[i+1].name}` });
                 kb.push(row);
            }
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_bc_price_svc_1' }]);

            botAdmin.editMessageCaption(`💰 <b>POSCAST HARGA - LANGKAH 2/2</b>
Layanan Code: ${svcCode}
Pilih <b>NEGARA</b> tujuan:`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data.startsWith('adm_bc_exec_')) {
            const parts = data.split('_');
            const countryId = parts[3];
            const countryName = parts[4];
            const svcCode = adminBcSession[chatId].serviceCode;
            botAdmin.sendMessage(chatId, `⏳ <b>Sedang menyusun dan mengirim Broadcast...</b>`, { parse_mode: 'HTML' });

            const res = await reqOtp(`/api/v2/countries?service_id=${svcCode}`);
            const targetCountry = res.data.find(c => c.number_id == countryId);
            if (!targetCountry || !targetCountry.pricelist) return botAdmin.sendMessage(chatId, '❌ Data harga kosong.');

            const priceList = targetCountry.pricelist.slice(0, 8); 
            const margin = db.settings.otpMargin || 0;
            let listText = '';
            priceList.forEach(p => {
                let provName = p.operator_name || p.provider_name || `Server ${p.server_id}`;
                listText += `🔹 ${provName} : <b>${formatRupiah(parseInt(p.price) + margin)}</b> (Stok: ${p.stock})
`;
            });

            let flagEmoji = getFlag(countryName);
            const broadcastCaption = `📢 <b>UPDATE STOK & HARGA TERBARU</b>
<i>Info ketersediaan nomor virtual saat ini.</i>

<blockquote><b>📊 DETAIL LAYANAN</b>
📱 <b>Layanan:</b> ${svcCode.toUpperCase()}
${flagEmoji} <b>Negara:</b> ${countryName}</blockquote>

<b>💰 DAFTAR HARGA SPESIAL:</b>
${listText.trim()}

⚡ <i>Koneksi Cepat & OTP Valid!</i>
👇 <b>ORDER SEKARANG MELALUI BOT:</b>
${settings.botUrl || `https://t.me/${settings.botUsername}`}`;

            const bcMarkup = { inline_keyboard: [[{ text: '🛒 ORDER SEKARANG', url: settings.botUrl || `https://t.me/${settings.botUsername}` }]] };
            
            let stockChannel = db.settings.channels.logStock || settings.channelLogId;
            if (stockChannel) botUser.sendMessage(stockChannel, broadcastCaption, { parse_mode: 'HTML', reply_markup: bcMarkup }).catch(()=>{});
            
           let success = 0;
            const allUserIds_harga = [...new Set([...db.users.map(u => u.id), ...readUsersJson()])];
            for (let uid of allUserIds_harga) {
                try {
                    await botUser.sendMessage(uid, broadcastCaption, { parse_mode: 'HTML', reply_markup: bcMarkup });
                    success++;
                } catch (e) {}
            }
            botAdmin.sendMessage(chatId, `✅ <b>BROADCAST HARGA SELESAI!</b>
Terikirim ke: ${success} User`, { parse_mode: 'HTML' });
            sendAdminDashboard(chatId);
        }
        else if (data === 'adm_set_margin') {
            adminState[chatId] = 'set_otp_margin';
            botAdmin.sendMessage(chatId, `💸 <b>PENGATURAN MARGIN NOKOS (UMUM)</b>

Margin saat ini: ${formatRupiah(db.settings.otpMargin || 0)}

➡️ Masukkan Nominal Margin Tambahan:`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_image_info') {
            const kb = {
                inline_keyboard: [
                    [{ text: '📥 Image Deposit', callback_data: 'set_img_deposit' }, { text: '📥 Image Trx OTP', callback_data: 'set_img_trx_otp' }],
                    [{ text: '📥 Image Maintenance', callback_data: 'set_img_maintenance' }, { text: '🔙 Kembali', callback_data: 'adm_refresh' }]
                ]
            };
            botAdmin.editMessageCaption(`🖼 <b>PENGATURAN GAMBAR INFORMASI</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb });
        }
        else if (data.startsWith('set_img_')) {
            const type = data.replace('set_img_', '');
            adminState[chatId] = `upload_img_${type}`;
            botAdmin.sendMessage(chatId, `➡️ Silahkan kirim  <b>LINK (URL)</b> untuk kategori: <b>${type.toUpperCase()}</b>`, { parse_mode: 'HTML', reply_markup: { force_reply: true } });
        }
        else if (data === 'adm_promo_menu') {
    const pb = db.settings.promoButton || {};
    const kb = {
        inline_keyboard: [
            [{ text: '📝 Set Teks Pesan', callback_data: 'adm_promo_set_text' }],
            [{ text: '🖼 Set Gambar (URL)', callback_data: 'adm_promo_set_img' }],
            [{ text: '🔘 Set Label Tombol', callback_data: 'adm_promo_set_btntext' }],
            [{ text: '🔗 Set URL Tombol', callback_data: 'adm_promo_set_btnurl' }],
            [{ text: '📢 Kirim Promo ke Semua User', callback_data: 'adm_promo_broadcast' }],
            [{ text: '👁 Preview Promo', callback_data: 'adm_promo_preview' }],
            [{ text: '🔙 Kembali', callback_data: 'adm_cat_system' }]
        ]
    };
    const caption = `🎯 <b>KELOLA PROMO BUTTON</b>

<b>Status Setting:</b>
📝 Teks: ${pb.text ? '✅ Terisi' : '❌ Kosong'}
🖼 Gambar: ${pb.imageUrl ? '✅ Terisi' : '❌ Kosong (kirim teks saja)'}
🔘 Label Tombol: ${pb.btnText ? `✅ "${pb.btnText}"` : '❌ Kosong'}
🔗 URL Tombol: ${pb.btnUrl ? '✅ Terisi' : '❌ Kosong'}

<i>Isi semua field lalu klik Preview sebelum broadcast.</i>`;

    botAdmin.editMessageCaption(caption, {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'HTML', reply_markup: kb
    }).catch(() => {});
}
else if (data === 'adm_promo_set_text') {
    adminState[chatId] = 'await_promo_text';
    botAdmin.sendMessage(chatId, `📝 <b>SET TEKS PROMO</b>\n\nKetik isi pesan promo (support format bold/italic Telegram):`, {
        parse_mode: 'HTML', reply_markup: { force_reply: true }
    });
}
else if (data === 'adm_promo_set_img') {
    adminState[chatId] = 'await_promo_img';
    botAdmin.sendMessage(chatId, `🖼 <b>SET GAMBAR PROMO</b>\n\nMasukkan URL gambar (https://...), atau ketik <code>hapus</code> untuk kirim teks saja:`, {
        parse_mode: 'HTML', reply_markup: { force_reply: true }
    });
}
else if (data === 'adm_promo_set_btntext') {
    adminState[chatId] = 'await_promo_btntext';
    botAdmin.sendMessage(chatId, `🔘 <b>SET LABEL TOMBOL</b>\n\nContoh: <code>🛒 Order Sekarang</code>`, {
        parse_mode: 'HTML', reply_markup: { force_reply: true }
    });
}
else if (data === 'adm_promo_set_btnurl') {
    adminState[chatId] = 'await_promo_btnurl';
    botAdmin.sendMessage(chatId, `🔗 <b>SET URL TOMBOL</b>\n\nContoh: <code>https://t.me/username</code>`, {
        parse_mode: 'HTML', reply_markup: { force_reply: true }
    });
}
else if (data === 'adm_promo_preview') {
    const pb = db.settings.promoButton || {};
    if (!pb.text) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Teks pesan belum diset!', show_alert: true });
    if (!pb.btnText || !pb.btnUrl) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Label/URL tombol belum diset!', show_alert: true });

    const previewKb = { inline_keyboard: [[{ text: pb.btnText, url: pb.btnUrl }]] };
    botAdmin.sendMessage(chatId, `👁 <b>PREVIEW PROMO:</b>`, { parse_mode: 'HTML' });

    if (pb.imageUrl && pb.imageUrl.startsWith('http')) {
        botAdmin.sendPhoto(chatId, pb.imageUrl, {
            caption: pb.text,
            parse_mode: 'HTML',
            reply_markup: previewKb
        }).catch(() => botAdmin.sendMessage(chatId, pb.text, { parse_mode: 'HTML', reply_markup: previewKb }));
    } else {
        botAdmin.sendMessage(chatId, pb.text, { parse_mode: 'HTML', reply_markup: previewKb });
    }
}
else if (data === 'adm_promo_broadcast') {
    const pb = db.settings.promoButton || {};
    if (!pb.text) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Teks pesan belum diset!', show_alert: true });
    if (!pb.btnText || !pb.btnUrl) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Label/URL tombol belum diset!', show_alert: true });

    botAdmin.answerCallbackQuery(query.id, { text: '⏳ Mengirim promo...' });
    botAdmin.sendMessage(chatId, `⏳ <b>Sedang mengirim promo ke semua user...</b>`, { parse_mode: 'HTML' });

    const promoKb = { inline_keyboard: [[{ text: pb.btnText, url: pb.btnUrl }]] };
    let success = 0;

    const allUserIds_promoBtn = [...new Set([...db.users.map(u => u.id), ...readUsersJson()])];
    for (const uid of allUserIds_promoBtn) {
        try {
            if (pb.imageUrl && pb.imageUrl.startsWith('http')) {
                await botUser.sendPhoto(uid, pb.imageUrl, {
                    caption: pb.text,
                    parse_mode: 'HTML',
                    reply_markup: promoKb
                });
            } else {
                await botUser.sendMessage(uid, pb.text, {
                    parse_mode: 'HTML',
                    reply_markup: promoKb
                });
            }
            success++;
        } catch (e) {}
    }
   

    botAdmin.sendMessage(chatId, `✅ <b>PROMO TERKIRIM!</b>\nBerhasil ke: <b>${success} user</b>`, { parse_mode: 'HTML' });
}
     else if (data === 'adm_backup_menu') {
    const bChId = db.settings.backupChannelId;
    const bm = backupManager;
    const curKey = bm ? bm.intervalKey : (db.settings.backupIntervalKey || '24h');
    const { INTERVAL_LABELS } = require('./backupManager');
    const curLabel = INTERVAL_LABELS[curKey] || curKey;

    const statusText = bm ? '🟢 Aktif' : '🔴 Belum Aktif';
    const channelText = bChId ? `<code>${bChId}</code>` : '⚠️ Belum diset (kirim ke Owner ID)';
    const statsText = bm
        ? `✅ Total: ${bm.backupCount} | ❌ Gagal: ${bm.failedBackups}`
        : 'Belum ada data';

    const btn1h  = curKey === '1h'  ? '✅ 1 Jam'   : '1 Jam';
    const btn24h = curKey === '24h' ? '✅ 24 Jam'  : '24 Jam';
    const btn7d  = curKey === '7d'  ? '✅ 7 Hari'  : '7 Hari';

    const kb = {
        inline_keyboard: [
            [{ text: '⏱ Interval Backup:',     callback_data: 'null' }],
            [
                { text: btn1h,  callback_data: 'adm_backup_interval_1h'  },
                { text: btn24h, callback_data: 'adm_backup_interval_24h' },
                { text: btn7d,  callback_data: 'adm_backup_interval_7d'  }
            ],
            [{ text: '📡 Set Channel Backup',       callback_data: 'adm_backup_set_channel' }],
            [{ text: '🔄 Jalankan Backup Sekarang', callback_data: 'adm_backup_now' }],
            [{ text: '🔙 Kembali',                  callback_data: 'adm_cat_system' }]
        ]
    };

    botAdmin.editMessageCaption(
        `💾 <b>KELOLA BACKUP OTOMATIS</b>

<b>Status:</b> ${statusText}
<b>Channel Target:</b> ${channelText}
<b>Interval Aktif:</b> Setiap <b>${curLabel}</b>
<b>Statistik:</b> ${statsText}

<i>Pilih interval, set channel, lalu backup dikirim otomatis sebagai file ZIP.</i>`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }
    ).catch(() => {});
}
else if (data.startsWith('adm_backup_interval_')) {
    const key = data.replace('adm_backup_interval_', '');
    const { INTERVAL_LABELS } = require('./backupManager');
    if (!INTERVAL_LABELS[key]) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Interval tidak valid.' });
    if (!db.settings) db.settings = {};
    db.settings.backupIntervalKey = key;
    saveDB();
    if (backupManager) {
        backupManager.setIntervalKey(key);
    } else {
        initBackupManager();
    }
    botAdmin.answerCallbackQuery(query.id, { text: `✅ Interval backup diubah ke: ${INTERVAL_LABELS[key]}` });
    // Redirect kembali ke menu backup agar tombol terupdate
    botAdmin.emit('callback_query', { id: query.id, data: 'adm_backup_menu', message: query.message });
}
else if (data === 'adm_backup_set_channel') {
    adminState[chatId] = 'await_backup_channel';
    botAdmin.sendMessage(chatId,
        `📡 <b>SET CHANNEL BACKUP</b>

Masukkan ID Channel tujuan backup:
(Contoh: <code>-1001234567890</code>)

⚠️ Pastikan bot sudah dijadikan <b>Admin</b> di channel tersebut.`,
        { parse_mode: 'HTML', reply_markup: { force_reply: true } }
    );
}
else if (data === 'adm_backup_now') {
    if (!backupManager) {
        return botAdmin.answerCallbackQuery(query.id, { text: '❌ BackupManager belum aktif.', show_alert: true });
    }
    botAdmin.answerCallbackQuery(query.id, { text: '⏳ Menjalankan backup manual...' });
    botAdmin.sendMessage(chatId, `⏳ <b>Menjalankan backup manual...</b>`, { parse_mode: 'HTML' });
    backupManager.kirimBackupOtomatis().then(() => {
        botAdmin.sendMessage(chatId, `✅ <b>Backup manual selesai!</b>`, { parse_mode: 'HTML' });
    }).catch(e => {
        botAdmin.sendMessage(chatId, `❌ <b>Backup gagal:</b> ${e.message}`, { parse_mode: 'HTML' });
    });
}
        else if (data === 'adm_mt') {
            const status = db.settings.maintenance;
            const kb = {
                inline_keyboard: [
                    [{ text: status ? '🟢 Matikan Maintenance' : '🔴 Hidupkan Maintenance', callback_data: `adm_set_mt_${!status}` }],
                    [{ text: '🔙 Kembali', callback_data: 'adm_refresh' }]
                ]
            };
            botAdmin.editMessageCaption(`🛠 <b>PENGATURAN MAINTENANCE</b>

Status saat ini: <b>${status ? 'ON' : 'OFF'}</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb });
        }
        else if (data.startsWith('adm_set_mt_')) {
            const newVal = data.split('_')[3] === 'true';
            db.settings.maintenance = newVal;
            saveDB();
            broadcastMaintenance(newVal);
            botAdmin.answerCallbackQuery(query.id, { text: `Maintenance: ${newVal ? 'ON' : 'OFF'}` });
            sendAdminDashboard(chatId, msgId);
        }
        else if (data === 'adm_history') {
             const kb = [
                [{ text: '🛍 Riwayat Pembelian', callback_data: 'adm_hist_order' }, { text: '💰 Riwayat Deposit', callback_data: 'adm_hist_depo' }],
                [{ text: '📡 LIVE MONITOR OTP', callback_data: 'adm_live_otp' }, { text: '📡 LIVE MONITOR DEPO', callback_data: 'adm_live_depo' }],
                [{ text: '🔙 Kembali', callback_data: 'adm_refresh' }]
            ];
            botAdmin.editMessageCaption(`📜 <b>PEMANTAUAN & RIWAYAT TRANSAKSI</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
                  // --- LIVE MONITOR HANDLERS ---
        else if (data === 'adm_live_otp') {
            if (activeAdminMonitors[chatId]) clearInterval(activeAdminMonitors[chatId]);
            botAdmin.answerCallbackQuery(query.id, { text: '📡 Memulai Live Monitor OTP...' });
            
            const limit = 15 * 60 * 1000;
            const generateText = () => {
                if (!db.pendingOtps || db.pendingOtps.length === 0) return `📡 <b>LIVE MONITOR: PENDING OTP</b>
<i>Sistem melacak pesanan yang sedang berjalan.</i>

<blockquote>✅ <i>Tidak ada orderan OTP yang menunggu saat ini.</i></blockquote>`;
                
                let txt = `📡 <b>LIVE MONITOR: PENDING OTP</b>
<i>Sistem melacak pesanan yang sedang berjalan.</i>

<blockquote>`;
                const now = Date.now();
                let listArray = [];
                db.pendingOtps.forEach((p, i) => {
                    const elapsed = now - p.startTime;
                    let remaining = limit - elapsed;
                    if(remaining < 0) remaining = 0;
                    const mins = Math.floor(remaining / 60000);
                    const secs = Math.floor((remaining % 60000) / 1000);
                    const percent = ((limit - remaining) / limit) * 100;
                    const bar = makeProgressBar(percent, 10);
                    
                    listArray.push(`<b>${i+1}. ${p.itemName} (${p.countryName})</b>
├ 🆔 <b>ID:</b> <code>${p.orderId}</code>
└ ⏳ <b>Timer:</b> [${bar}] ${mins}m ${secs}s`);
                });
                
                txt += listArray.join(`

`);
                
                txt += `</blockquote>

🔄 <i>Auto-update tiap 3 detik...</i>`;
                return txt;
            };

            const kb = { inline_keyboard: [[{ text: '🔙 Berhenti & Kembali', callback_data: 'adm_history' }]] };
            botAdmin.editMessageCaption(generateText(), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
            
            activeAdminMonitors[chatId] = setInterval(() => {
                botAdmin.editMessageCaption(generateText(), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
            }, 3000);
        }

        else if (data === 'adm_live_depo') {
            if (activeAdminMonitors[chatId]) clearInterval(activeAdminMonitors[chatId]);
            botAdmin.answerCallbackQuery(query.id, { text: '📡 Memulai Live Monitor Deposit...' });
            
            const limit = 20 * 60 * 1000;
            const generateText = () => {
                const pendingDepo = db.deposits ? db.deposits.filter(d => d.status === 'pending') : [];
                if (pendingDepo.length === 0) return `📡 <b>LIVE MONITOR PENDING DEPOSIT</b>

<i>Tidak ada tagihan deposit yang menunggu pembayaran.</i>`;
                let txt = `📡 <b>LIVE MONITOR PENDING DEPOSIT</b>

`;
                const now = Date.now();
                pendingDepo.forEach((d, i) => {
                    // Gunakan createdAt jika tidak ada
                    const startT = d.createdAt || (Date.now() - limit/2); 
                    const elapsed = now - startT;
                    let remaining = limit - elapsed;
                    if(remaining < 0) remaining = 0;
                    const mins = Math.floor(remaining / 60000);
                    const secs = Math.floor((remaining % 60000) / 1000);
                    const percent = ((limit - remaining) / limit) * 100;
                    const bar = makeProgressBar(percent, 12);
                    txt += `<b>${i+1}. ${formatRupiah(d.amount)} (${d.method})</b>
`;
                    txt += `└ ID: <code>${d.refId}</code>
`;
                    txt += `└ ⏳ [${bar}] ${mins}m ${secs}s left

`;
                });
                txt += `🔄 <i>Auto-update tiap 3 detik...</i>`;
                return txt;
            };

            const kb = { inline_keyboard: [[{ text: '🔙 Berhenti & Kembali', callback_data: 'adm_history' }]] };
            botAdmin.editMessageCaption(generateText(), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
            
            activeAdminMonitors[chatId] = setInterval(() => {
                botAdmin.editMessageCaption(generateText(), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
            }, 3000);
        }
        else if (data === 'adm_hist_order') {
            const orderList = Array.isArray(db.orders) ? db.orders : [];
            const lastOrders = orderList.slice(-10).reverse();
            let kb = [];
            if (lastOrders.length === 0) { kb.push([{ text: 'Kosong', callback_data: 'adm_history' }]); } 
            else {
                lastOrders.forEach((o, i) => {
                    let statusIcon = o.status === 'success' ? '✅' : (o.status === 'pending' ? '⏳' : '❌');
                    kb.push([{ text: `${i+1}. ${statusIcon} ${o.trxId} - ${formatRupiah(o.price)}`, callback_data: `adm_detail_trx_${o.trxId}` }]);
                });
            }
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_history' }]);
            botAdmin.editMessageCaption(`📜 <b>10 PEMBELIAN TERAKHIR</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data === 'adm_hist_depo') {
            const depoList = Array.isArray(db.deposits) ? db.deposits : [];
            const lastDeposits = depoList.slice(-10).reverse();
            let kb = [];
            if (lastDeposits.length === 0) { kb.push([{ text: 'Kosong', callback_data: 'adm_history' }]); } 
            else {
                lastDeposits.forEach((d, i) => {
                    let statusIcon = d.status === 'success' ? '✅' : (d.status === 'pending' ? '⏳' : '❌');
                    kb.push([{ text: `${i+1}. ${statusIcon} ${d.refId} - ${formatRupiah(d.amount)}`, callback_data: `adm_detail_trx_${d.refId}` }]);
                });
            }
            kb.push([{ text: '🔙 Kembali', callback_data: 'adm_history' }]);
            botAdmin.editMessageCaption(`💰 <b>10 DEPOSIT TERAKHIR</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (data.startsWith('adm_detail_trx_')) {
            const trxId = data.replace('adm_detail_trx_', '');
            let trx = db.orders.find(o => o.trxId === trxId);
            let isDepo = false;
            
            if (!trx) { trx = db.deposits.find(d => d.refId === trxId); isDepo = true; }
            if (!trx) return botAdmin.answerCallbackQuery(query.id, { text: '❌ Detail transaksi tidak ditemukan.', show_alert: true });

            const itemName = isDepo ? 'Deposit Saldo' : trx.item;
            const price = isDepo ? trx.amount : trx.price;
            const statusStr = trx.status === 'success' ? '✅ Berhasil' : (trx.status === 'pending' ? '⏳ Menunggu Pembayaran' : '❌ Gagal / Batal');
            const trxType = isDepo ? 'DEPOSIT' : (trx.type ? trx.type.toUpperCase() : 'LAYANAN');
            const dateStr = trx.date || 'Tidak diketahui';

            const caption = `🧾 <b>DETAIL TRANSAKSI (ADMIN)</b>

🆔 <b>ID Trx:</b> <code>${isDepo ? trx.refId : trx.trxId}</code>
👤 <b>User ID:</b> <code>${trx.userId}</code>
📅 <b>Tanggal:</b> <code>${dateStr}</code>
🏷 <b>Tipe:</b> <code>${trxType}</code>
🎁 <b>Item:</b> <b>${itemName}</b>
💰 <b>Nominal:</b> <b>${formatRupiah(price)}</b>
📊 <b>Status:</b> <b>${statusStr}</b>`;
            botAdmin.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'adm_history' }]] } }).catch(()=>{});
        }
        else if (data === 'adm_add_bal') {
            adminState[chatId] = 'await_id_saldo';
            botAdmin.sendMessage(chatId, `➕ <b>TAMBAH SALDO MANUAL</b>
Input User ID:`, { reply_markup: { force_reply: true } });
        }
        } catch (err) {
            const errMsg = err?.message || String(err);
            console.warn('⚠️ [Admin Callback Error - Diabaikan]:', errMsg);
            try { await botAdmin.answerCallbackQuery(query.id, { text: '❌ Terjadi kesalahan.' }); } catch (_) {}
        }
    });

    botAdmin.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (chatId.toString() !== settings.ownerId) return;

        // FUNGSI SET PESAN AUTO BROADCAST (HANYA MENGAMBIL TEXT DAN ENTITIES TANPA BUTTON/GAMBAR)
        if (text.toLowerCase() === '.setpesan' && msg.reply_to_message) {
            let fwdMsg = msg.reply_to_message;
            let msgText = fwdMsg.text || fwdMsg.caption;
            let msgEntities = fwdMsg.entities || fwdMsg.caption_entities;
            
            if (!msgText) return botAdmin.sendMessage(chatId, "❌ Pesan yang di-reply tidak memiliki teks/caption.");
            
            if (!db.settings.autoBroadcastMsg) db.settings.autoBroadcastMsg = {};
            db.settings.autoBroadcastMsg.text = msgText;
            db.settings.autoBroadcastMsg.entities = msgEntities;
            saveDB();
            return botAdmin.sendMessage(chatId, "✅ Teks & Format Pesan Auto-Kirim berhasil diset!");
        }

        // FUNGSI PODCAST MANUAL BALAS "SHARE" (AUTO COPY MESSAGE - HANYA TEXT & FORMAT KUTIPAN/BOLD)
        if (msg.reply_to_message && text.toLowerCase() === 'share') {
            botAdmin.sendMessage(chatId, "⏳ Mengirim Broadcast teks ke seluruh pengguna...");
            let count = 0;
            let usersList = Array.isArray(db.users) ? db.users : Object.values(db.users || {});
            let fwdMsg = msg.reply_to_message;
            let msgText = fwdMsg.text || fwdMsg.caption;
            let msgEntities = fwdMsg.entities || fwdMsg.caption_entities;

            if(!msgText) return botAdmin.sendMessage(chatId, "❌ Pesan yang dibalas tidak memiliki teks/caption. Podcast dibatalkan.");
            
            for (let u of usersList) {
                if (u && u.id) {
                    try {
                        await botUser.sendMessage(u.id, msgText, { entities: msgEntities });
                        count++;
                    } catch (e) {}
                }
            }
            return botAdmin.sendMessage(chatId, `✅ Broadcast Teks Berhasil! Terkirim langsung ke ${count} pengguna.`);
        }

        if (!adminState[chatId]) return;

        // SET CHANNEL LOGS
        if (adminState[chatId] === 'await_block_user_id') {
            const query2 = text.replace('@', '').trim();
            const targetUser = db.users.find(u => u.id == query2 || (u.username && u.username.toLowerCase() === query2.toLowerCase()));
            if (!targetUser) { adminState[chatId] = null; return botAdmin.sendMessage(chatId, `❌ User tidak ditemukan: <code>${query2}</code>`, { parse_mode: 'HTML' }); }

            adminState[chatId] = null;
            // Tampilkan pilihan alasan blokir
            const reasons = [
                'Memanfaatkan bug sistem untuk mendapatkan saldo gratis',
                'Melakukan penipuan/tuyul pada sistem bot',
                'Penyalahgunaan fitur refund/cancel OTP secara berulang',
                'Percobaan manipulasi saldo akun',
                'Melanggar syarat & ketentuan layanan'
            ];
            const kb = reasons.map((r, i) => [{ text: r, callback_data: `adm_block_reason_${targetUser.id}_${i}` }]);
            kb.push([{ text: '🔙 Batal', callback_data: 'adm_block_menu' }]);
            return botAdmin.sendMessage(chatId, `🚫 <b>Pilih Alasan Blokir untuk @${targetUser.username || targetUser.id}:</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        else if (adminState[chatId] === 'await_unblock_user_id') {
            const query3 = text.replace('@', '').trim();
            const bIdx = (db.blockedUsers || []).findIndex(b => b.userId == query3 || (b.username && b.username.toLowerCase() === query3.toLowerCase()));
            if (bIdx === -1) { adminState[chatId] = null; return botAdmin.sendMessage(chatId, `❌ User tidak ditemukan dalam daftar blokir: <code>${query3}</code>`, { parse_mode: 'HTML' }); }
            const unblocked = db.blockedUsers[bIdx];
            db.blockedUsers.splice(bIdx, 1);
            saveDB();
            adminState[chatId] = null;
            botAdmin.sendMessage(chatId, `✅ User @${unblocked.username || unblocked.userId} berhasil di-unblokir.`);
            botUser.sendMessage(unblocked.userId, `✅ <b>AKUN ANDA TELAH DIBUKA KEMBALI</b>\n\nAkun Anda telah di-unblokir oleh admin. Anda dapat menggunakan bot kembali.`, { parse_mode: 'HTML' }).catch(() => {});
            return sendAdminDashboard(chatId);
        }
        if (adminState[chatId] === 'await_promo_text') {
    if (!db.settings.promoButton) db.settings.promoButton = {};
    db.settings.promoButton.text = text;
    saveDB();
    adminState[chatId] = null;
    return botAdmin.sendMessage(chatId, `✅ Teks promo disimpan!`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Promo', callback_data: 'adm_promo_menu' }]] }
    });
}
else if (adminState[chatId] === 'await_promo_img') {
    if (!db.settings.promoButton) db.settings.promoButton = {};
    db.settings.promoButton.imageUrl = text.toLowerCase() === 'hapus' ? null : text;
    saveDB();
    adminState[chatId] = null;
    return botAdmin.sendMessage(chatId, `✅ Gambar promo ${text.toLowerCase() === 'hapus' ? 'dihapus' : 'disimpan'}!`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Promo', callback_data: 'adm_promo_menu' }]] }
    });
}
else if (adminState[chatId] === 'await_promo_btntext') {
    if (!db.settings.promoButton) db.settings.promoButton = {};
    db.settings.promoButton.btnText = text;
    saveDB();
    adminState[chatId] = null;
    return botAdmin.sendMessage(chatId, `✅ Label tombol disimpan: "${text}"`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Promo', callback_data: 'adm_promo_menu' }]] }
    });
}
else if (adminState[chatId] === 'await_promo_btnurl') {
    if (!text.startsWith('http')) return botAdmin.sendMessage(chatId, `❌ URL harus diawali https://`);
    if (!db.settings.promoButton) db.settings.promoButton = {};
    db.settings.promoButton.btnUrl = text;
    saveDB();
    adminState[chatId] = null;
    return botAdmin.sendMessage(chatId, `✅ URL tombol disimpan!`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Promo', callback_data: 'adm_promo_menu' }]] }
    });
}      
       if (adminState[chatId] === 'await_backup_channel') {
    const newChannel = text.trim();
    if (!newChannel.startsWith('-100') && isNaN(newChannel)) {
        return botAdmin.sendMessage(chatId, `❌ Format ID Channel tidak valid. Harus diawali <code>-100...</code>`, { parse_mode: 'HTML' });
    }
    db.settings.backupChannelId = newChannel;
    saveDB();
    adminState[chatId] = null;

    // Restart BackupManager dengan channel baru
    backupManager = null;
    setTimeout(() => {
        initBackupManager();
        botAdmin.sendMessage(chatId,
            `✅ <b>Channel backup diperbarui!</b>

📡 Channel baru: <code>${newChannel}</code>
🔄 BackupManager direstart dengan channel baru.`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Backup', callback_data: 'adm_backup_menu' }]] } }
        );
    }, 1000);
    return;
}
        if (adminState[chatId] === 'set_ch_trxdepo') {
            if (!db.settings.channels) db.settings.channels = {};
            db.settings.channels.logTrxDepo = text;
            saveDB(); adminState[chatId] = null;
            return botAdmin.sendMessage(chatId, `✅ Channel Log Transaksi & Deposit berhasil diatur ke: ${text}`);
        }
        else if (adminState[chatId] === 'set_ch_stock') {
            if (!db.settings.channels) db.settings.channels = {};
            db.settings.channels.logStock = text;
            saveDB(); adminState[chatId] = null;
            return botAdmin.sendMessage(chatId, `✅ Channel Log Update Stok/Promo berhasil diatur ke: ${text}`);
        }

        // SETTINGS JOIN
        if (adminState[chatId] === 'set_join_count') {
            const count = parseInt(text);
            if (isNaN(count) || count < 0) return botAdmin.sendMessage(chatId, "❌ Masukkan angka yang valid.");
            if (count === 0) {
                db.settings.forceSubChannels = [];
                saveDB();
                adminState[chatId] = null;
                return botAdmin.sendMessage(chatId, "✅ Fitur Wajib Join dimatikan.");
            }
            tempScriptData[chatId] = { joinCount: count, currentStep: 1, channels: [] };
            adminState[chatId] = 'set_join_id';
            botAdmin.sendMessage(chatId, `Masukkan Username/ID Channel ke-1 (contoh: @mychannel atau -100123456):`, {reply_markup: {force_reply: true}});
            return;
        }
        else if (adminState[chatId] === 'set_join_id') {
            tempScriptData[chatId].tempId = text;
            adminState[chatId] = 'set_join_link';
            botAdmin.sendMessage(chatId, `Masukkan Link Channel ke-${tempScriptData[chatId].currentStep} (contoh: https://t.me/mychannel):`, {reply_markup: {force_reply: true}});
            return;
        }
        else if (adminState[chatId] === 'set_join_link') {
            tempScriptData[chatId].channels.push({
                id: tempScriptData[chatId].tempId,
                link: text
            });
            if (tempScriptData[chatId].currentStep < tempScriptData[chatId].joinCount) {
                tempScriptData[chatId].currentStep++;
                adminState[chatId] = 'set_join_id';
                botAdmin.sendMessage(chatId, `Masukkan Username/ID Channel ke-${tempScriptData[chatId].currentStep}:`, {reply_markup: {force_reply: true}});
            } else {
                db.settings.forceSubChannels = tempScriptData[chatId].channels;
                saveDB();
                adminState[chatId] = null;
                botAdmin.sendMessage(chatId, `✅ Berhasil mengatur ${tempScriptData[chatId].joinCount} Channel Wajib Join.`);
            }
            return;
        }
        
        // FUNGSI GRAMJS ADMIN ADD SESSION
        if (adminState[chatId] === 'await_session_phone') {
            tempScriptData[chatId] = { phone: text };
            adminState[chatId] = 'await_session_apiid';
            botAdmin.sendMessage(chatId, `Masukkan <b>API ID</b>:`, { parse_mode: 'HTML', reply_markup: { force_reply: true }});
            return;
        }
        else if (adminState[chatId] === 'await_session_apiid') {
            tempScriptData[chatId].apiId = parseInt(text);
            adminState[chatId] = 'await_session_apihash';
            botAdmin.sendMessage(chatId, `Masukkan <b>API HASH</b>:`, { parse_mode: 'HTML', reply_markup: { force_reply: true }});
            return;
        }
        else if (adminState[chatId] === 'await_session_apihash') {
            tempScriptData[chatId].apiHash = text;
            const data = tempScriptData[chatId];
            botAdmin.sendMessage(chatId, `⏳ Meminta kode OTP dari Telegram untuk nomor ${data.phone}...`);
            
            const client = new TelegramClient(new StringSession(""), data.apiId, data.apiHash, { connectionRetries: 1 });
            authClients[chatId] = client;
            
            client.start({
                phoneNumber: async () => data.phone,
                password: async () => {
                    return new Promise(resolve => {
                        tempScriptData[chatId].resolvePassword = resolve;
                        adminState[chatId] = 'await_session_password';
                        botAdmin.sendMessage(chatId, `🔐 Akun ini memiliki 2FA Password. Masukkan Password:`, { reply_markup: { force_reply: true } });
                    });
                },
                phoneCode: async () => {
                    return new Promise(resolve => {
                        tempScriptData[chatId].resolveCode = resolve;
                        adminState[chatId] = 'await_session_code';
                        botAdmin.sendMessage(chatId, `📩 Kode OTP telah dikirim ke Telegram/SMS nomor ${data.phone}. Masukkan Kode OTP:`, { reply_markup: { force_reply: true } });
                    });
                },
                onError: (err) => { throw err; }
            }).then(() => {
                const sessionString = client.session.save();
                if (!db.telegramSessions) db.telegramSessions = [];
                db.telegramSessions.push({ nomor: data.phone, apiId: data.apiId, apiHash: data.apiHash, sessionString: sessionString, status: 'tersedia' });
                saveDB();
                botAdmin.sendMessage(chatId, `✅ Akun sesi <b>${data.phone}</b> berhasil terhubung dan ditambahkan ke stok!`, { parse_mode: 'HTML' });
                adminState[chatId] = null;
                delete tempScriptData[chatId];
                client.disconnect();
            }).catch(err => {
                botAdmin.sendMessage(chatId, `❌ <b>Gagal login:</b> ${err.message}
Silakan coba tambah sesi lagi.`, { parse_mode: 'HTML' });
                adminState[chatId] = null;
                delete tempScriptData[chatId];
                client.disconnect().catch(()=>{}); 
            });
            return;
        }
        else if (adminState[chatId] === 'await_session_code') { if (tempScriptData[chatId] && tempScriptData[chatId].resolveCode) tempScriptData[chatId].resolveCode(text); return; }
        else if (adminState[chatId] === 'await_session_password') { if (tempScriptData[chatId] && tempScriptData[chatId].resolvePassword) tempScriptData[chatId].resolvePassword(text); return; }

        if (adminState[chatId] === 'await_ap_int') {
            const val = parseInt(text);
            if (!isNaN(val) && val > 0) {
                db.settings.autoPodcast.intervalMinutes = val;
                saveDB();
                botAdmin.sendMessage(chatId, `✅ Interval update stok diatur: ${val} menit.`);
            } else { botAdmin.sendMessage(chatId, `❌ Input tidak valid.`); }
            adminState[chatId] = null;
            return;
        }

        if (adminState[chatId] === 'await_abm_int') {
            const val = parseInt(text);
            if (!isNaN(val) && val > 0) {
                if(!db.settings.autoBroadcastMsg) db.settings.autoBroadcastMsg = {};
                db.settings.autoBroadcastMsg.intervalMinutes = val;
                saveDB();
                botAdmin.sendMessage(chatId, `✅ Interval Auto Pesan diatur: ${val} menit.`);
            } else { botAdmin.sendMessage(chatId, `❌ Input tidak valid.`); }
            adminState[chatId] = null;
            return;
        }

        if (adminState[chatId] && adminState[chatId].startsWith('await_set_special_margin_')) {
            const targetId = adminState[chatId].split('_')[4];
            const nominal = parseInt(text);
            if (isNaN(nominal)) return botAdmin.sendMessage(chatId, '❌ Harap masukkan angka saja.');
            const uIdx = db.users.findIndex(u => u.id == targetId);
            if (uIdx !== -1) {
                db.users[uIdx].useSpecialMargin = true;
                db.users[uIdx].specialMarginValue = nominal;
                saveDB();
                botAdmin.sendMessage(chatId, `✅ <b>BERHASIL!</b>
User <code>${targetId}</code> menggunakan Margin Khusus: <b>${formatRupiah(nominal)}</b>.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Menu User', callback_data: `adm_udetail_${targetId}` }]] } });
            } else { botAdmin.sendMessage(chatId, '❌ User tidak ditemukan.'); }
            adminState[chatId] = null;
            return;
        }

        if (adminState[chatId] === 'await_search_user') {
            if(!adminBcSession[chatId]) adminBcSession[chatId] = {}; 
            adminBcSession[chatId].userSearch = text;
            adminState[chatId] = null;
            botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Pencarian untuk <b>"${text}"</b> disimpan.`, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Lihat Hasil', callback_data: 'adm_users_1' }]] } });
            return;
        }

        if (adminState[chatId] && adminState[chatId].startsWith('await_edit_saldo_')) {
            const targetId = adminState[chatId].split('_')[3];
            const newSaldo = parseInt(text);
            if (isNaN(newSaldo) || newSaldo < 0) return botAdmin.sendMessage(chatId, `❌ Nominal tidak valid!`);
            const uIdx = db.users.findIndex(u => u.id == targetId);
            if (uIdx !== -1) {
                const oldSaldo = db.users[uIdx].saldo || 0;
                const selisih = newSaldo - oldSaldo;

                db.users[uIdx].saldo = newSaldo;

                // Jika saldo dinaikkan admin, catat agar tidak dianggap anomali
                if (selisih > 0) {
                    db.users[uIdx].adminAddedBalance = (db.users[uIdx].adminAddedBalance || 0) + selisih;
                }

                saveDB();
                botAdmin.sendMessage(chatId, `✅ Saldo User <code>${targetId}</code> berhasil diubah menjadi <b>${formatRupiah(newSaldo)}</b>.\n\n📝 Total saldo manual tercatat: <b>${formatRupiah(db.users[uIdx].adminAddedBalance || 0)}</b>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Kembali', callback_data: `adm_udetail_${targetId}` }]] } });
            } else {
                botAdmin.sendMessage(chatId, `❌ User tidak ditemukan.`);
            }
            adminState[chatId] = null;
            return;
        }

        // --- HANDLER ATUR TOP USER (ADMIN) ---
        if (adminState[chatId] === 'set_top_disc1') { const disc = parseInt(text); if(!isNaN(disc) && disc >= 0 && disc <= 10) { db.settings.topSystem.discountRank1 = disc; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Diskon Top 1 diubah menjadi ${disc}%`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }
        if (adminState[chatId] === 'set_top_disc2') { const disc = parseInt(text); if(!isNaN(disc) && disc >= 0 && disc <= 10) { db.settings.topSystem.discountRank2 = disc; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Diskon Top 2 diubah menjadi ${disc}%`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }
        if (adminState[chatId] === 'set_top_disc3') { const disc = parseInt(text); if(!isNaN(disc) && disc >= 0 && disc <= 10) { db.settings.topSystem.discountRank3 = disc; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Diskon Top 3 diubah menjadi ${disc}%`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }
        if (adminState[chatId] === 'set_top_min1') { const min = parseInt(text); if(!isNaN(min) && min >= 0) { db.settings.topSystem.minDepoRank1 = min; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Syarat Rank 1 diubah menjadi ${formatRupiah(min)}`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }
        if (adminState[chatId] === 'set_top_min2') { const min = parseInt(text); if(!isNaN(min) && min >= 0) { db.settings.topSystem.minDepoRank2 = min; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Syarat Rank 2 diubah menjadi ${formatRupiah(min)}`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }
        if (adminState[chatId] === 'set_top_min3') { const min = parseInt(text); if(!isNaN(min) && min >= 0) { db.settings.topSystem.minDepoRank3 = min; saveDB(); botAdmin.sendPhoto(chatId, settings.images.menuAdmin, { caption: `✅ Syarat Rank 3 diubah menjadi ${formatRupiah(min)}`, parse_mode: 'HTML', reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } }); } adminState[chatId] = null; return; }

        if (adminState[chatId] === 'set_top_reset') {
            const days = parseInt(text);
            if(!isNaN(days) && days > 0) {
                db.settings.topSystem.resetDays = days;
                db.settings.topSystem.nextResetTime = Date.now() + (days * 24 * 60 * 60 * 1000);
                saveDB();
                botAdmin.sendMessage(chatId, `✅ Timer Top diatur untuk reset setiap ${days} hari!`, { reply_markup: { inline_keyboard:[[{text:'Kembali', callback_data:'adm_top_menu'}]] } });
            }
            adminState[chatId] = null;
            return;
        }

        if (adminState[chatId] === 'set_otp_margin') {
            const margin = parseInt(text);
            if (isNaN(margin)) return botAdmin.sendMessage(chatId, `❌ Harap masukkan angka saja.`, { parse_mode: 'HTML' });
            if (!db.settings) db.settings = {};
            db.settings.otpMargin = margin;
            saveDB();
            botAdmin.sendMessage(chatId, `✅ <b>BERHASIL DISIMPAN!</b>
Margin Umum Nokos diubah menjadi: <b>+ ${formatRupiah(margin)}</b> per nomor.`, { parse_mode: 'HTML' });
            adminState[chatId] = null;
            sendAdminDashboard(chatId);
            return; 
        }

        if (adminState[chatId].startsWith('upload_img_')) {
            const type = adminState[chatId].replace('upload_img_', '');
            if (!text.startsWith('http')) return botAdmin.sendMessage(chatId, `❌ Input harus berupa Link Gambar (URL).`);
            db.logImages[type] = text;
            saveDB();
            botAdmin.sendMessage(chatId, `✅ Link gambar untuk <b>${type.toUpperCase()}</b> disimpan.
🔗 ${text}`, { parse_mode: 'HTML' });
            adminState[chatId] = null;
            return;
        }

        if (adminState[chatId] === 'await_id_saldo') {
            adminState[chatId] = `await_amount_saldo_${text}`;
            botAdmin.sendMessage(chatId, `User ID: ${text}
➡️ Masukkan Nominal:`);
        }
        else if (adminState[chatId] && adminState[chatId].startsWith('await_amount_saldo_')) {
            const targetId = adminState[chatId].split('_')[3];
            const amount = parseInt(text);
            if (!isNaN(amount)) {
                const uIdx = db.users.findIndex(u => u.id == targetId);
                if (uIdx !== -1) {
                    db.users[uIdx].saldo += amount;
                    // Catat ke adminAddedBalance agar tidak dianggap anomali oleh anti-fraud
                    db.users[uIdx].adminAddedBalance = (db.users[uIdx].adminAddedBalance || 0) + amount;
                    saveDB();
                    botAdmin.sendMessage(chatId, `✅ Saldo <code>${targetId}</code> berhasil ditambah <b>${formatRupiah(amount)}</b>.\n\n📝 Total saldo manual tercatat: <b>${formatRupiah(db.users[uIdx].adminAddedBalance)}</b>`, { parse_mode: 'HTML' });
                    botUser.sendMessage(targetId, `🎁 <b>SALDO DITAMBAHKAN</b>\n\nAdmin menambahkan saldo sebesar <b>${formatRupiah(amount)}</b> ke akun Anda.`, { parse_mode: 'HTML' }).catch(() => {});
                } else {
                    botAdmin.sendMessage(chatId, `❌ User tidak ditemukan.`);
                }
            }
            adminState[chatId] = null;
            sendAdminDashboard(chatId);
        }
    });

    // ==============================================
    // 5. AUTO CHECKER STATUS DEPOSIT & OTP
    // ==============================================
    
    function startDepositChecker(chatId, refId, msgIdToEdit) {
        if (activeDeposits[refId]) return;
        
        // Ambil data deposit dari database
        const depoData = db.deposits.find(d => d.refId === refId);
        if (!depoData) return;

        const limit = 20 * 60 * 1000;
        // Gunakan expiredAt dari DB, jangan gunakan Date.now() agar tidak keriset saat bot restart
        const stopTime = depoData.expiredAt || (depoData.createdAt + limit); 
        
        let isChecking = false;

        activeDeposits[refId] = setInterval(async () => {
            if (isChecking) return;
            isChecking = true;

            const now = Date.now();
            if (now > stopTime) {
                clearInterval(activeDeposits[refId]);
                delete activeDeposits[refId];
                const dIdx = db.deposits.findIndex(d => d.refId === refId);
                if (dIdx !== -1) { db.deposits[dIdx].status = 'expired'; saveDB(); }
                if (msgIdToEdit) botUser.editMessageCaption(`❌ <b>TAGIHAN KADALUARSA</b>`, { chat_id: chatId, message_id: msgIdToEdit, parse_mode: 'HTML' }).catch(()=>{});
                isChecking = false;
                return;
            }

            const status = await checkRumahOtpDepositStatus(refId);
            if (status === 'success') {
                clearInterval(activeDeposits[refId]);
                delete activeDeposits[refId];
                const dIdx = db.deposits.findIndex(d => d.refId === refId);
                
                if (dIdx !== -1 && db.deposits[dIdx].status === 'pending') {
                    const depositData = db.deposits[dIdx];
                    db.deposits[dIdx].status = 'success';
                    const uIdx = db.users.findIndex(u => u.id === chatId);
                    
                    if (uIdx !== -1) {
                        db.users[uIdx].saldo += depositData.amount;
                        db.users[uIdx].topDeposit = (db.users[uIdx].topDeposit || 0) + depositData.amount;
                        
                        // ANTI-TUYUL: Referral cair HANYA pada deposit pertama kali
                        if (db.users[uIdx].referredBy && (db.users[uIdx].topDeposit - depositData.amount === 0)) {
                            let referrerId = db.users[uIdx].referredBy;
                            let rIdx = db.users.findIndex(u => u.id === referrerId);
                            
                            if (rIdx !== -1) {
                                db.users[rIdx].saldo += 150; 
                                if (!db.users[rIdx].referralCount) db.users[rIdx].referralCount = 0;
                                if (!db.users[rIdx].referralBonus) db.users[rIdx].referralBonus = 0;
                                db.users[rIdx].referralCount += 1;
                                db.users[rIdx].referralBonus += 150;
                                botUser.sendMessage(referrerId, `🎁 <b>BONUS REFERRAL CAIR!</b>
Teman yang Anda undang telah berhasil melakukan deposit pertama. Bonus <b>Rp 150</b> telah ditambahkan ke saldo Anda!`, { parse_mode: 'HTML' }).catch(()=>{});
                            }
                            db.users[uIdx].referredBy = null; 
                        }

                        saveDB(); 
                        const successMsg = `✅ <b>DEPOSIT BERHASIL!</b>
💰 <b>Nominal:</b> ${formatRupiah(depositData.amount)}
🆔 <b>ID Trx:</b> <code>${refId}</code>
Saldo telah ditambahkan ke akun Anda. Terima kasih!`;
                        if (msgIdToEdit) botUser.deleteMessage(chatId, msgIdToEdit).catch(()=>{});
                        botUser.sendMessage(chatId, successMsg, { parse_mode: 'HTML' }).catch(()=>{});
                        try { await sendLog('deposit_success', { userId: chatId, username: db.users[uIdx].username, amount: depositData.amount, refId: refId, saldo: db.users[uIdx].saldo }); } catch (errLog) {}
                    }
                }
            } else if (status === 'canceled') {
                clearInterval(activeDeposits[refId]);
                delete activeDeposits[refId];
                const dIdx = db.deposits.findIndex(d => d.refId === refId);
                if (dIdx !== -1) { db.deposits[dIdx].status = 'canceled'; saveDB(); }
                if (msgIdToEdit) botUser.editMessageCaption(`❌ <b>TAGIHAN DIBATALKAN</b>`, { chat_id: chatId, message_id: msgIdToEdit, parse_mode: 'HTML' }).catch(()=>{});
            }
            isChecking = false;
        }, 5000); 
    }

    function startOtpChecker(chatId, orderId, originalPrice, itemName, countryName, savedStartTime = null) {
        if (activeOtps[orderId]) return;
        let isChecking = false; 
        const startTime = savedStartTime || Date.now();
        const timeoutLimit = 15 * 60 * 1000; 

        activeOtps[orderId] = setInterval(async () => {
            if (isChecking) return; 
            isChecking = true;
            const now = Date.now();

            if (now - startTime > timeoutLimit) {
                clearInterval(activeOtps[orderId]);
                delete activeOtps[orderId];

                // ===== ANTI DOUBLE-REFUND: Cek status pesanan dulu =====
                const oCheckTimeout = db.orders.find(o => o.trxId === orderId);
                if (!oCheckTimeout || oCheckTimeout.status !== 'pending') {
                    // Sudah diproses (refund/cancel/success) sebelumnya — jangan refund lagi!
                    console.warn(`[ANTI-FRAUD] Skip double-refund timeout untuk order ${orderId}`);
                    isChecking = false;
                    return;
                }
                // Tandai sebagai 'canceled' DULU sebelum refund (operasi atomik)
                const oIdxTimeout = db.orders.findIndex(o => o.trxId === orderId);
                if (oIdxTimeout !== -1) db.orders[oIdxTimeout].status = 'canceled';
                const pIdxTimeout = db.pendingOtps ? db.pendingOtps.findIndex(p => p.orderId === orderId) : -1;
                if (pIdxTimeout !== -1) db.pendingOtps.splice(pIdxTimeout, 1);
                // ========================================================

                const user = getUser(chatId);
                if(user) {
                    user.saldo += originalPrice;
                    saveDB();
                    const refundMsg = `⚠️ <b>WAKTU HABIS (AUTO REFUND)</b>
<i>Mohon maaf, pesan OTP tidak kunjung masuk.</i>

<blockquote><b>🧾 DETAIL PEMBATALAN</b>
🆔 <b>Order ID:</b> <code>${orderId}</code>
⏱ <b>Batas Waktu:</b> 15 Menit
💰 <b>Saldo Dikembalikan:</b> ${formatRupiah(originalPrice)}</blockquote>

✅ <i>Saldo Anda telah otomatis dikembalikan secara utuh. Silakan coba order menggunakan nomor atau operator lain.</i>`;
                    botUser.sendMessage(chatId, refundMsg, { parse_mode: 'HTML' });
                    try { await reqOtp(`/api/v1/orders/set_status?order_id=${orderId}&status=cancel`); } catch (e) {}
                }
                isChecking = false;
                return;
            }

            try {
                const res = await reqOtp(`/api/v1/orders/get_status?order_id=${orderId}`);
                if (res.success && res.data) {
                    const status = res.data.status ? res.data.status.toLowerCase() : '';
                    const otpCode = res.data.otp_code;
                    const isOtpValid = otpCode && otpCode.toString().trim() !== '' && otpCode.toString().trim() !== '-';

                    if (status === 'completed' || status === 'received' || isOtpValid) {
                        clearInterval(activeOtps[orderId]);
                        delete activeOtps[orderId];
                        db.stats.totalTrx++;
                        db.stats.totalIncome += originalPrice;

                        if (db.pendingOtps) {
                            const pIdx = db.pendingOtps.findIndex(p => p.orderId === orderId);
                            if (pIdx !== -1) db.pendingOtps.splice(pIdx, 1);
                        }
                        const oIdx = db.orders.findIndex(o => o.trxId === orderId);
                        if (oIdx !== -1) db.orders[oIdx].status = 'success';
                        
                        saveDB();
                        
                        const finalOtp = isOtpValid ? otpCode : "Cek Log Web OTP"; 
                       botUser.sendMessage(chatId, `🎉 <b>KODE OTP DITERIMA!</b>

🆔 <b>Order ID:</b> <code>${orderId}</code>
📞 <b>Nomor:</b> <code>${res.data.phone_number}</code>
💬 <b>KODE OTP:</b> <code>${finalOtp}</code>

<blockquote>
<b>⚠️ Panduan Penggunaan Nokos</b>

- Aktifkan notifikasi keamanan pada akun
- Aktifkan verifikasi 2 langkah (2FA)
- Tambahkan email, jika tidak mau logout
- Gunakan DNS 1.1.1.1 untuk keamanan tambahan
- Jangan memasukkan nomor ke dalam grup
- Hindari penggunaan chat selama 2 hari pertama

<b>📝 Note Penting:</b>
Nokos = nomor virtual (tanpa SIM fisik)
OTP hanya tersedia 1x pemakaian
</blockquote>

<i>Terima kasih telah menggunakan layanan kami.</i>`, { parse_mode: 'HTML' });
                        
                        const user = getUser(chatId);
                        sendLog('trx_otp', { trxId: orderId, item: itemName || 'Layanan OTP', country: countryName || 'Random', username: user ? user.username : 'Unknown', userId: chatId, price: originalPrice, saldo: user ? user.saldo : 0 });
                    } 
                    else if (status === 'canceled' || status === 'cancel' || status === 'refunded') {
                        clearInterval(activeOtps[orderId]);
                        delete activeOtps[orderId];

                        // ===== ANTI DOUBLE-REFUND =====
                        const oCheckProvCancel = db.orders.find(o => o.trxId === orderId);
                        if (!oCheckProvCancel || oCheckProvCancel.status !== 'pending') {
                            console.warn(`[ANTI-FRAUD] Skip double-refund provider-cancel untuk order ${orderId}`);
                            isChecking = false;
                            return;
                        }
                        // Tandai dulu sebelum refund
                        const oIdxPc = db.orders.findIndex(o => o.trxId === orderId);
                        if (oIdxPc !== -1) db.orders[oIdxPc].status = 'canceled';
                        const pIdxPc = db.pendingOtps ? db.pendingOtps.findIndex(p => p.orderId === orderId) : -1;
                        if (pIdxPc !== -1) db.pendingOtps.splice(pIdxPc, 1);
                        // ==============================

                        const user = getUser(chatId);
                        if(user) {
                            user.saldo += originalPrice;
                            saveDB();
                            botUser.sendMessage(chatId, `❌ <b>PESANAN DIBATALKAN!</b>

🆔 <b>Order ID:</b> <code>${orderId}</code>
Nomor dibatalkan/kadaluarsa. Saldo ${formatRupiah(originalPrice)} telah <b>dikembalikan</b>.`, { parse_mode: 'HTML' });
                        }
                    }
                }
            } catch (e) { } finally { isChecking = false; }
        }, 5000); 
    }

    // ==============================================
    // 4. LOGIKA BOT USER 
    // ==============================================
    const otpSession = {}; 
    const userState = {};

    function setupUserBot() {
        // ============================================================
        // REALTIME STOCK UPDATER - Update stok & harga setiap 3 detik
        // ============================================================
        function stopStockUpdater(chatId) {
            if (activeStockUpdaters[chatId]) {
                clearInterval(activeStockUpdaters[chatId].timer);
                delete activeStockUpdaters[chatId];
            }
        }

        function startRealtimeStockUpdater(chatId, msgId, session, margin) {
            stopStockUpdater(chatId); // Hentikan updater lama jika ada
            const AUTO_STOP_MS = 10 * 60 * 1000; // Otomatis berhenti setelah 10 menit
            const stopAt = Date.now() + AUTO_STOP_MS;
            let isUpdating = false;
            let lastKbStr = ''; // Untuk deteksi perubahan sebelum edit

            const timer = setInterval(async () => {
                if (isUpdating) return;
                if (Date.now() > stopAt) { stopStockUpdater(chatId); return; }
                if (!activeStockUpdaters[chatId]) return;

                isUpdating = true;
                try {
                    const freshRes = await getCountriesFresh(session.serviceId);
                    if (!freshRes.success || !freshRes.data) { isUpdating = false; return; }

                    const countryData = freshRes.data.find(c => c.number_id == session.countryId);
                    if (!countryData) { isUpdating = false; return; }

                    let stocks = countryData.pricelist || [];
                    stocks.sort((a, b) => parseInt(b.stock) - parseInt(a.stock));

                    const page = session.pageStk || 1;
                    const totalPage = Math.ceil(stocks.length / 10);
                    const paginated = paginateArray(stocks, 10, page);

                    let kb = [];
                    for (let i = 0; i < paginated.length; i += 2) {
                        let finalPrice1 = parseInt(paginated[i].price) + margin;
                        let stok1 = parseInt(paginated[i].stock);
                        let row = [{
                            text: `💰 ${formatRupiah(finalPrice1)} | Stok: ${stok1 > 0 ? stok1 : '❌ Habis'}`,
                            callback_data: stok1 > 0 ? `os_stk_${paginated[i].provider_id}_${paginated[i].server_id}_${finalPrice1}` : `stok_habis_notif`
                        }];
                        if (paginated[i + 1]) {
                            let finalPrice2 = parseInt(paginated[i + 1].price) + margin;
                            let stok2 = parseInt(paginated[i + 1].stock);
                            row.push({
                                text: `💰 ${formatRupiah(finalPrice2)} | Stok: ${stok2 > 0 ? stok2 : '❌ Habis'}`,
                                callback_data: stok2 > 0 ? `os_stk_${paginated[i + 1].provider_id}_${paginated[i + 1].server_id}_${finalPrice2}` : `stok_habis_notif`
                            });
                        }
                        kb.push(row);
                    }

                    let nav = [];
                    if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `otp_pg_stk_${page - 1}` });
                    if (page < totalPage) nav.push({ text: 'Next ➡️', callback_data: `otp_pg_stk_${page + 1}` });
                    if (nav.length > 0) kb.push(nav);
                    kb.push([{ text: '🔙 Kembali', callback_data: 'otp_pg_cty_1' }]);

                    // Hanya edit jika ada perubahan stok (hindari rate limit Telegram)
                    const newKbStr = JSON.stringify(kb);
                    if (newKbStr === lastKbStr) { isUpdating = false; return; }
                    lastKbStr = newKbStr;

                    const desc = `📦 <b>KATALOG STOK TERSEDIA</b>
<i>Pilih harga dan stok yang ingin Anda pesan.</i>
<blockquote><b>📊 INFORMASI STOK</b>
🌎 <b>Negara:</b> ${session.countryName}
✅ <b>Stok Tersedia:</b> ${countryData.stock_total} Nomor
📄 <b>Halaman:</b> ${page}/${totalPage}</blockquote>

🔄 <i>Live update: ${getTime()} WIB (Tiap 2 dtk)</i>
👇 <b>Silakan pilih stok di bawah ini:</b>`;

                    await botUser.editMessageCaption(desc, {
                        chat_id: chatId,
                        message_id: msgId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: kb }
                    }).catch(() => {});
                } catch (e) { /* abaikan error agar tidak crash */ }
                isUpdating = false;
            }, 2000);

            activeStockUpdaters[chatId] = { timer, msgId };
        }

        // ============================================================
        // REALTIME STOCK MONITOR - Update stok di halaman konfirmasi pesanan
        // ============================================================
        function startConfirmStockMonitor(chatId, msgId, session) {
            stopStockUpdater(chatId); // Hentikan updater lama jika ada
            const AUTO_STOP_MS = 10 * 60 * 1000; // Otomatis berhenti setelah 10 menit
            const stopAt = Date.now() + AUTO_STOP_MS;
            let isUpdating = false;
            let lastStockAvailable = null; // null = belum diketahui
            let lastStockCount = -1;

            const timer = setInterval(async () => {
                if (isUpdating) return;
                if (Date.now() > stopAt) { stopStockUpdater(chatId); return; }
                if (!activeStockUpdaters[chatId]) return;

                isUpdating = true;
                try {
                    const freshRes = await getCountriesFresh(session.serviceId);
                    if (!freshRes.success || !freshRes.data) { isUpdating = false; return; }

                    const cData = freshRes.data.find(c => c.number_id == session.countryId);
                    let currentStock = 0;
                    if (cData && cData.pricelist) {
                        const stkData = cData.pricelist.find(p => p.provider_id == session.providerId && p.server_id == session.serverId);
                        if (stkData) currentStock = parseInt(stkData.stock) || 0;
                    }

                    const stockAvailable = currentStock > 0;

                    // Update selalu jika status berubah ATAU jumlah stok berubah
                    if (stockAvailable === lastStockAvailable && currentStock === lastStockCount) {
                        isUpdating = false;
                        return;
                    }
                    lastStockAvailable = stockAvailable;
                    lastStockCount = currentStock;

                    let kb, desc;
                    if (stockAvailable) {
                        kb = [
                            [{ text: `💵 Bayar Sekarang dengan Saldo`, callback_data: `otp_pay_now` }],
                            [{ text: `🔄 Pilih Operator Lain`, callback_data: `otp_pg_stk_1` }],
                            [{ text: `🏠 Menu Utama`, callback_data: `main_menu` }]
                        ];
                        const flagConfirm = getFlag(session.countryName);
                        desc = `🛒 <b>KONFIRMASI PESANAN NOMOR</b>
<i>Silakan periksa kembali detail pesanan Anda.</i>

<blockquote><b>🧾 DETAIL PESANAN</b>
${flagConfirm} <b>Negara:</b> ${session.countryName}
📶 <b>Operator:</b> ${session.operatorId}
💰 <b>Total Harga:</b> ${formatRupiah(session.price)}</blockquote>

✅ <i>Stok tersedia: ${currentStock} nomor (Live ${getTime()} WIB)</i>
⚠️ <i>Saldo Anda akan otomatis terpotong setelah menekan tombol Bayar.</i>`;
                    } else {
                        kb = [
                            [{ text: `🔄 Pilih Operator Lain`, callback_data: `otp_pg_stk_1` }],
                            [{ text: `🏠 Menu Utama`, callback_data: `main_menu` }]
                        ];
                        const flagEmpty = getFlag(session.countryName);
                        desc = `🛒 <b>KONFIRMASI PESANAN NOMOR</b>
<i>Silakan periksa kembali detail pesanan Anda.</i>

<blockquote><b>🧾 DETAIL PESANAN</b>
${flagEmpty} <b>Negara:</b> ${session.countryName}
📶 <b>Operator:</b> ${session.operatorId}
💰 <b>Total Harga:</b> ${formatRupiah(session.price)}</blockquote>

❌ <b>STOK HABIS!</b>
<i>Stok untuk pilihan ini baru saja habis.</i>

👇 <b>Silakan pilih salah satu opsi di bawah:</b>
- Klik <b>Pilih Operator Lain</b> untuk kembali ke daftar stok
- Klik <b>Menu Utama</b> untuk kembali ke menu awal`;
                    }

                    await botUser.editMessageCaption(desc, {
                        chat_id: chatId,
                        message_id: msgId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: kb }
                    }).catch(() => {});
                } catch (e) { /* abaikan error agar tidak crash */ }
                isUpdating = false;
            }, 2000); // Cek setiap 2 detik

            activeStockUpdaters[chatId] = { timer, msgId };
        }
        // ============================================================
        async function checkMembership(userId) {
            // Gunakan settings multi-channel dari Database (Di set melalui Admin panel)
            if (!db.settings.forceSubChannels || db.settings.forceSubChannels.length === 0) return true; 
            
            for (let ch of db.settings.forceSubChannels) {
                try {
                    const member = await botUser.getChatMember(ch.id, userId);
                    if (!['creator', 'administrator', 'member'].includes(member.status)) {
                        return false;
                    }
                } catch (e) {
                    return false; // Anggap belum join jika error/bot bukan admin
                }
            }
            return true;
        }

        async function sendJoinMenu(chatId, msgId = null) {
            const user = getUser(chatId);
            const caption = `🔒 <b>AKSES DITOLAK</b>

Halo <b>${user ? user.username : 'User'}</b>,
Untuk menggunakan bot ini, Anda wajib bergabung ke seluruh channel/grup di bawah ini terlebih dahulu.

👇 <i>Silakan klik tombol join lalu tekan Refresh:</i>`;

            let kbButtons = [];
            if (db.settings.forceSubChannels) {
                db.settings.forceSubChannels.forEach((ch, idx) => {
                    kbButtons.push([{ text: `📢 Join Channel ${idx + 1}`, url: ch.link }]);
                });
            }
            kbButtons.push([{ text: '🔄 Refresh / Saya Sudah Join', callback_data: 'check_join_status' }]);

            const kb = { inline_keyboard: kbButtons };

            try {
                const photo = settings.images.menuUtama; 
                if (msgId) {
                    await botUser.editMessageMedia({ type: 'photo', media: photo, caption: caption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: kb });
                } else {
                    await botUser.sendPhoto(chatId, photo, { caption: caption, parse_mode: 'HTML', reply_markup: kb });
                }
            } catch (e) {
                console.log('Error sendJoinMenu:', e.message);
            }
        }

        botUser.onText(/\/start(?: (.*))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            
            if (db.settings.maintenance && chatId.toString() !== settings.ownerId) {
    return botUser.sendMessage(chatId, `⛔ <b>MAINTENANCE SISTEM</b>
━━━━━━━━━━━━━━━━━━━━

Bot sedang dalam pemeliharaan rutin harian.

<blockquote><b>🔧 YANG SEDANG DILAKUKAN:</b>
🗄 Memelihara &amp; optimasi database
📈 Meningkatkan kualitas layanan
📦 Menambahkan stok nomor baru
🎁 Menyiapkan promo terbaru</blockquote>

⏳ <b>Jadwal Maintenance Harian:</b>
Mulai: 23:00 WIB
Selesai: 00:10 WIB

Mohon tunggu hingga proses selesai.
Kami akan segera kembali! 🙏`, { parse_mode: 'HTML' });
}

            // Cek blokir
            const blockStart = db.blockedUsers ? db.blockedUsers.find(b => b.userId == chatId) : null;
            if (blockStart) {
                return botUser.sendMessage(chatId, `🚫 <b>AKUN ANDA DIBLOKIR</b>

<b>Alasan:</b> ${blockStart.reason}
<b>Diblokir pada:</b> ${blockStart.blockedAt || '-'}

Hubungi admin jika Anda merasa ini adalah kesalahan.`, { parse_mode: 'HTML' });
            }

            const payload = match[1];

            let user = getUser(chatId);
            if (!user) {
                user = { id: chatId, username: msg.from.username || msg.from.first_name || 'User', saldo: 0, joined: getDate(), status: 'active', topDeposit: 0, referralCount: 0, referralBonus: 0 };
                if (payload) {
                    let referrer = getUser(Number(payload));
                    if (referrer && referrer.id !== chatId) user.referredBy = Number(payload);
                }
                db.users.push(user);
                saveDB();
            } else { syncUsername(msg.from); }
            
            const isMember = await checkMembership(chatId);
            if (!isMember) return sendJoinMenu(chatId);
            sendMainMenu(chatId);
        });

        async function sendMainMenu(chatId, msgId = null) {
                  const user = getUser(chatId);

        // Menentukan Rank User berdasarkan total deposit
        const topSys = db.settings.topSystem || { minDepoRank1: 40000, minDepoRank2: 30000, minDepoRank3: 20000 };
        let rank = 'Member 👤';
        if (user && user.topDeposit >= topSys.minDepoRank1) rank = 'VIP Sultan 👑';
        else if (user && user.topDeposit >= topSys.minDepoRank2) rank = 'Juragan 🥇';
        else if (user && user.topDeposit >= topSys.minDepoRank3) rank = 'Jawara 🥈';

        const joinedDate = user && user.joined ? user.joined : getDate();

        const caption = `
Selamat datang di <b>RUMAH OTP OFFICIAL</b>
<i>Pusat Layanan Virtual Number & Sesi Telegram</i>
 <blockquote><b>👤 INFORMASI AKUN</b></blockquote>
├ <b>ID User:</b> <code>${user ? user.id : chatId}</code>
├ <b>Pangkat:</b> ${rank}
├ <b>Join Date:</b> ${joinedDate}
└ <b>Sisa Saldo:</b> <b>${user ? formatRupiah(user.saldo) : 'Rp 0'}</b>
 <blockquote><b>🌐 SISTEM SERVER</b></blockquote>
├ <b>Waktu:</b> ${getDate()} | ${getTime()}
├ <b>Uptime:</b> <code>${getRuntime()}</code>
├ <b>Sistem:</b> V-2.0.1 (Stable)
└ <b>Koneksi:</b> 🟢 Sangat Baik
<blockquote><b>🔰 MENGAPA MEMILIH KAMI?</b></blockquote>
<b>• Saldo kembali otomatis jika OTP gagal.</b>
<b>• Proses OTP masuk dalam hitungan detik.</b>
<b>• Deposit QRIS diproses otomatis 24 Jam.</b>
<b>• Stok nomor fresh dan berkualitas.</b>

👇 <b>Silakan pilih menu transaksi di bawah ini:</b>`;

            // -- LOGIKA MENYESUAIKAN MENU BERDASARKAN SETTING ADMIN --
            if (!db.settings.activeMenus) db.settings.activeMenus = { otp: true, sesi: true };
            let activeTopButtons = [];
            if (db.settings.activeMenus.otp) activeTopButtons.push({ text: '📱 Layanan OTP', callback_data: 'menu_otp', style: 'primary' });
            if (db.settings.activeMenus.sesi) activeTopButtons.push({ text: '📱 Beli Sesi Telegram', callback_data: 'menu_beli_sesi', style: 'primary' });

            const kb = { inline_keyboard: [] };

            let tempRow = [];
            for (let i = 0; i < activeTopButtons.length; i++) {
                tempRow.push(activeTopButtons[i]);
                if (tempRow.length === 2) {
                    kb.inline_keyboard.push(tempRow);
                    tempRow = [];
                }
            }
            if (tempRow.length > 0) kb.inline_keyboard.push(tempRow);

            kb.inline_keyboard.push([{ text: '💳 Isi Saldo', callback_data: 'menu_deposit', style: 'success' }, { text: '🎁 Referral', callback_data: 'menu_referral', style: 'success' }]);
            kb.inline_keyboard.push([{ text: '📋 Riwayat Trx', callback_data: 'menu_hist_order', style: 'primary' }, { text: '💰 Riwayat Depo', callback_data: 'menu_hist_depo', style: 'primary' }]);
            kb.inline_keyboard.push([{ text: '🏆 Top Pengguna', callback_data: 'menu_top_users', style: 'success' }]);

            let safeAdminLink = 'https://t.me/telegram';
            if (settings.linkAdmin && typeof settings.linkAdmin === 'string' && settings.linkAdmin.startsWith('http')) {
                safeAdminLink = settings.linkAdmin;
            }

            kb.inline_keyboard.push([{ text: '📞 Hubungi Admin', url: safeAdminLink, style: 'danger' }]);

            if (msgId) {
                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: caption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: kb }).catch(()=>{});
            } else {
                botUser.sendPhoto(chatId, settings.images.menuUtama, { caption: caption, parse_mode: 'HTML', reply_markup: kb }).catch(()=>{});
            }
        }

        async function handleDepositRumahOtp(chatId, amount, msgIdToEdit) {
            botUser.deleteMessage(chatId, msgIdToEdit).catch(()=>{});
            const loadingMsg = await botUser.sendMessage(chatId, `🔄 <b>Membuat Tagihan QRIS...</b>`, { parse_mode: 'HTML' });
            const res = await createRumahOtpDepositTransaction(amount, chatId);
            
            if (res && res.success && res.data) {
                const data = res.data;
                const refId = data.id; 
                const totalBayar = data.currency ? data.currency.total : amount;
                const amountReceived = data.currency ? data.currency.diterima : amount; 
                const expiredTimestamp = data.expired_at_ts ? data.expired_at_ts : (Date.now() + 20 * 60 * 1000);
                const expiredDate = moment(expiredTimestamp).format('DD/MM/YYYY HH:mm:ss');

                if (!Array.isArray(db.deposits)) db.deposits = [];
                db.deposits.push({ refId: refId, userId: chatId, amount: amountReceived, total: totalBayar, status: 'pending', method: 'QRIS', date: getDate(), createdAt: Date.now(), expiredAt: expiredTimestamp });
                saveDB();

                // Generate QR image dari qr_string menggunakan library qrcode
                let qrMedia;
                const qrStr = data.qr_string;
                if (!qrStr) {
                    botUser.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                    return botUser.sendMessage(chatId, `❌ <b>Gagal Membuat Tagihan.</b>\nProvider tidak mengeluarkan QR string.`, { parse_mode: 'HTML' });
                }
                try {
                    const QRCode = require('qrcode');
                    const qrBuffer = await QRCode.toBuffer(qrStr, { type: 'png', width: 512, margin: 2 });
                    qrMedia = qrBuffer;
                } catch (qrErr) {
                    console.error('Error generate QR:', qrErr.message);
                    botUser.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                    return botUser.sendMessage(chatId, `❌ <b>Gagal Generate Gambar QR.</b>\n${qrErr.message}`, { parse_mode: 'HTML' });
                }

                const caption = `<b>✅ Tagihan Deposit Berhasil Dibuat</b>

🆔 <b>ID Transaksi:</b> <code>${refId}</code>
📅 <b>Tanggal:</b> ${getDate()}
💰 <b>TOTAL BAYAR:</b> <code>${formatRupiah(totalBayar)}</code>

📥 <b>Saldo Masuk:</b> ${formatRupiah(amountReceived)}
⏳ <b>Expired:</b> ${expiredDate}

<i>Silahkan bayar sesuai scan QR di atas.</i>`;
                const kb = { inline_keyboard: [[{ text: '❌ Batalkan Deposit', callback_data: `depo_cancel_${refId}`, style: 'danger' }]] };
                botUser.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                const qrisMsg = await botUser.sendPhoto(chatId, qrMedia, { caption: caption, parse_mode: 'HTML', reply_markup: kb });
                startDepositChecker(chatId, refId, qrisMsg.message_id);
            } else {
                 botUser.deleteMessage(chatId, loadingMsg.message_id).catch(()=>{});
                 botUser.sendMessage(chatId, `❌ <b>Gagal Membuat Tagihan.</b>
${res && res.message ? res.message : 'Terjadi kesalahan pada provider.'}`, { parse_mode: 'HTML' });
            }
        }

        botUser.on('callback_query', async (query) => {
            try {
            const chatId = query.message.chat.id;
            
            // CEK GLOBAL MAINTENANCE UNTUK CALLBACK USER (KECUALI OWNER)
            if (db.settings.maintenance && chatId.toString() !== settings.ownerId) {
    return botUser.answerCallbackQuery(query.id, {
        text: `⛔ MAINTENANCE HARIAN\n\nBot sedang memelihara database,\nmeningkatkan kualitas & menambah stok.\n\n⏳ Jadwal: 23:00 — 00:10 WIB\nMohon ditunggu! 🙏`,
        show_alert: true
    });
}

            const data = query.data;
            const msgId = query.message.message_id;
            if(query.from) syncUsername(query.from);
            const user = getUser(chatId);

            // ===== CEK USER DIBLOKIR =====
            const blockInfo = db.blockedUsers ? db.blockedUsers.find(b => b.userId == chatId) : null;
            if (blockInfo && data !== 'check_join_status') {
                return botUser.answerCallbackQuery(query.id, {
                    text: `🚫 AKUN DIBLOKIR\nAlasan: ${blockInfo.reason}\nHubungi admin untuk banding.`,
                    show_alert: true
                });
            }
            // =============================

            // Hentikan realtime updater saat user klik tombol apapun
            // kecuali navigasi halaman stok (akan di-restart oleh handler-nya)
            if (!data.startsWith('otp_pg_stk_') && !data.startsWith('otp_sel_cty_')) {
                stopStockUpdater(chatId);
            }

            // Notifikasi jika stok habis (tombol dari realtime updater)
            if (data === 'stok_habis_notif') {
                return botUser.answerCallbackQuery(query.id, { text: '❌ Stok habis! Tunggu update berikutnya.', show_alert: true });
            }
            
            if (data === 'check_join_status') {
                const isMember = await checkMembership(chatId);
                if (isMember) { await botUser.answerCallbackQuery(query.id, { text: '✅ Terimakasih! Akses dibuka.' }); return sendMainMenu(chatId, msgId); }
                else { return botUser.answerCallbackQuery(query.id, { text: '❌ Anda belum bergabung!', show_alert: true }); }
            }

            if (data === 'main_menu') sendMainMenu(chatId, msgId);
            
            else if (data === 'menu_beli_sesi') {
                const kb = [
                    [{ text: '📦 1 Akun', callback_data: 'buy_sesi_1' }, { text: '📦 2 Akun', callback_data: 'buy_sesi_2' }],
                    [{ text: '📦 3 Akun', callback_data: 'buy_sesi_3' }, { text: '📦 4 Akun', callback_data: 'buy_sesi_4' }],
                    [{ text: '✏️ Custom Sesi', callback_data: 'buy_sesi_custom' }],
                    [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                ];
                const stokTersedia = db.telegramSessions ? db.telegramSessions.filter(s => s.status === 'tersedia').length : 0;
                
                const captionSesi = `📱 <b>KATALOG SESI TELEGRAM</b>
<i>Beli akun sesi Telegram (Format String) siap pakai.</i>
<blockquote><b>📊 INFORMASI STOK & HARGA</b>
📦 <b>Stok Tersedia:</b> ${stokTersedia} Akun
💰 <b>Harga per Akun:</b> ${formatRupiah(db.settings.sessionPrice || 4000)}
⚡ <b>Kualitas:</b> Private & Fresh</blockquote>

👇 <b>Silakan pilih jumlah akun di bawah ini:</b>`;

                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: captionSesi, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data === 'buy_sesi_custom') {
                userState[chatId] = 'await_buy_sesi_custom';
                botUser.sendMessage(chatId, '<b>✏️ Masukkan jumlah akun yang ingin dibeli:</b>', { parse_mode: 'HTML', reply_markup: { force_reply: true } });
            }
            else if (data.startsWith('buy_sesi_')) {
                const jumlah = parseInt(data.split('_')[2]);
                const hargaTotal = (db.settings.sessionPrice || 4000) * jumlah;
                const kb = [[{ text: '✅ Konfirmasi Order', callback_data: `confirm_buy_sesi_${jumlah}` }], [{ text: '❌ Batal', callback_data: 'menu_beli_sesi' }]];
                botUser.editMessageCaption(`<b>🛒 KONFIRMASI PESANAN</b>
<b>🔢 Jumlah:</b> ${jumlah} Akun
<b>💰 Total Harga:</b> ${formatRupiah(hargaTotal)}`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data.startsWith('confirm_buy_sesi_')) {
                if (userState[chatId] === 'processing_buy_sesi') return botUser.answerCallbackQuery(query.id, { text: '⏳ Sedang memproses!', show_alert: true });
                userState[chatId] = 'processing_buy_sesi';
                const jumlah = parseInt(data.replace('confirm_buy_sesi_', ''));
                const hargaTotal = (db.settings.sessionPrice || 4000) * jumlah;

                if (user.saldo < hargaTotal) { userState[chatId] = null; return botUser.answerCallbackQuery(query.id, { text: '❌ Saldo tidak mencukupi!', show_alert: true }); }

                let akunTersedia = db.telegramSessions ? db.telegramSessions.filter(s => s.status === 'tersedia') : [];
                if (akunTersedia.length < jumlah) { userState[chatId] = null; return botUser.answerCallbackQuery(query.id, { text: `❌ Stok tidak cukup.`, show_alert: true }); }

                user.saldo -= hargaTotal;
                let akunTerbeli = akunTersedia.slice(0, jumlah);
                
                akunTerbeli.forEach(akun => {
                    let idx = db.telegramSessions.findIndex(s => s.sessionString === akun.sessionString); 
                    if (idx !== -1) { db.telegramSessions[idx].status = 'terjual'; db.telegramSessions[idx].pembeli = chatId; }
                });

                const orderId = 'TRX-SESI-' + Date.now();
                if (!db.orderSessions) db.orderSessions = [];
                db.orderSessions.push({ orderId: orderId, userId: chatId, akunList: akunTerbeli.map(a => ({ nomor: a.nomor, sessionString: a.sessionString, statusLogout: false, statusOtp: false })), date: getDate() });
                saveDB();

                const caption = `<b>✅ ORDER SESI TELEGRAM BERHASIL</b>
<b>ID Pesanan:</b> <code>${orderId}</code>

<b>DETAIL NOMOR:</b>
${akunTerbeli.map((a, i) => `${i+1}. <b><code>${a.nomor}</code></b>`).join(`
`)}`;
                let kb = [];
                akunTerbeli.forEach((a, i) => {
                    kb.push([{ text: `📩 Check OTP (${a.nomor})`, callback_data: `check_otp_${orderId}_${i}` }]);
                    kb.push([{ text: `🗑 Logout Auto (${a.nomor})`, callback_data: `do_logout_${orderId}_${i}` }]);
                });

                botUser.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
                userState[chatId] = null;
            }
            else if (data.startsWith('check_otp_')) {
                const parts = data.split('_');
                const orderId = parts[2]; const akunIndex = parseInt(parts[3]);
                const orderData = db.orderSessions.find(o => o.orderId === orderId);
                if (!orderData) return botUser.answerCallbackQuery(query.id, { text: '❌ Pesanan tidak ditemukan!', show_alert: true });
                const akunTarget = orderData.akunList[akunIndex];
                if (akunTarget.statusLogout) return botUser.answerCallbackQuery(query.id, { text: '⚠️ Sesi sudah dilogout!', show_alert: true });

                botUser.answerCallbackQuery(query.id, { text: `⏳ Memeriksa OTP...` });
                try {
                    const dbSession = db.telegramSessions.find(s => s.nomor === akunTarget.nomor);
                    if (!dbSession) throw new Error("Sesi API tidak ditemukan");
                    const client = new TelegramClient(new StringSession(akunTarget.sessionString), dbSession.apiId, dbSession.apiHash, { connectionRetries: 1 });
                    await client.connect();
                    const messages = await client.getMessages(777000, { limit: 2 });
                    let otpFound = false, otpText = "";
                    for (let m of messages) { if (m.message && (m.message.includes('code') || m.message.includes('kode'))) { otpFound = true; otpText = m.message; break; } }
                    await client.disconnect();
                    if (otpFound) { akunTarget.statusOtp = true; saveDB(); botUser.sendMessage(chatId, `<b>🔔 KODE OTP TELEGRAM (${akunTarget.nomor})</b>

<b>${otpText}</b>`, { parse_mode: 'HTML' }); } 
                    else { botUser.sendMessage(chatId, `<b>⏳ Kode OTP untuk ${akunTarget.nomor} belum masuk.</b>`, { parse_mode: 'HTML' }); }
                } catch (err) { botUser.sendMessage(chatId, `<b>❌ Error mengecek OTP: ${err.message}</b>`, { parse_mode: 'HTML' }); }
            }
            else if (data.startsWith('do_logout_')) {
                const parts = data.split('_'); const orderId = parts[2]; const akunIndex = parseInt(parts[3]);
                const orderData = db.orderSessions.find(o => o.orderId === orderId);
                if (!orderData) return botUser.answerCallbackQuery(query.id, { text: '❌ Pesanan tidak ditemukan!', show_alert: true });
                const akunTarget = orderData.akunList[akunIndex];
                if (akunTarget.statusLogout === true) return botUser.answerCallbackQuery(query.id, { text: '⚠️ Sesi ini sudah di-logout!', show_alert: true });

                botUser.answerCallbackQuery(query.id, { text: `⏳ Memproses logout...` });
                try {
                    const dbSession = db.telegramSessions.find(s => s.nomor === akunTarget.nomor);
                    if (dbSession) {
                        const client = new TelegramClient(new StringSession(akunTarget.sessionString), dbSession.apiId, dbSession.apiHash, { connectionRetries: 1 });
                        await client.connect();
                        await client.invoke(new Api.auth.LogOut());
                        await client.disconnect();
                    }
                    akunTarget.statusLogout = true; saveDB();
                    botUser.sendMessage(chatId, `<b>✅ LOGOUT BERHASIL!</b>

<b>Sesi untuk nomor <code>${akunTarget.nomor}</code> dihapus bersih dari server.</b>`, { parse_mode: 'HTML' });

                    let kb = [];
                    orderData.akunList.forEach((a, i) => {
                        if (a.statusLogout) kb.push([{ text: `✅ Sudah login (${a.nomor})`, callback_data: `null` }]);
                        else {
                            kb.push([{ text: `📩 Check OTP (${a.nomor})`, callback_data: `check_otp_${orderId}_${i}` }]);
                            kb.push([{ text: `🗑 Logout Auto (${a.nomor})`, callback_data: `do_logout_${orderId}_${i}` }]);
                        }
                    });
                    botUser.editMessageReplyMarkup({ inline_keyboard: kb }, { chat_id: chatId, message_id: msgId }).catch(()=>{});
                } catch (err) { botUser.sendMessage(chatId, `<b>❌ Error saat logout: ${err.message}</b>`, { parse_mode: 'HTML' }); }
            }
            else if (data === 'menu_referral') {
                const refCount = user.referralCount || 0;
                const refBonus = user.referralBonus || 0;
                let botUsername = 'BOT_USERNAME';
                try { let botInfo = await botUser.getMe(); botUsername = botInfo.username; } catch(e) {}
                const refLink = `https://t.me/${botUsername}?start=${chatId}`;
                const refText = `🎁 <b>SISTEM REFERRAL (UNDANG TEMAN)</b>
<i>Ajak teman & dapatkan bonus saldo otomatis!</i>

<blockquote><b>📊 STATISTIK PERFORMA ANDA</b>
👥 <b>Teman Diajak:</b> ${refCount} Orang
💸 <b>Total Bonus:</b> ${formatRupiah(refBonus)}</blockquote>

<b>💡 Cara Kerja:</b>
Bagikan link di bawah ini. Anda akan langsung mendapat bonus <b>Rp 150</b> setiap kali teman yang diundang berhasil melakukan <b>Deposit Pertama</b>.

🔗 <b>LINK REFERRAL ANDA (Tap untuk salin):</b>
<code>${refLink}</code>`;
                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: refText, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'main_menu' }]] } }).catch(()=>{});
            }
            else if (data === 'menu_top_users') {
                const topSys = db.settings.topSystem || { maxTop: 3, minDepoRank1: 40000, minDepoRank2: 30000, minDepoRank3: 20000, resetDays: 0, nextResetTime: 0, discountRank1: 5, discountRank2: 3, discountRank3: 1 };
                let userDepoList = db.users.filter(u => (u.topDeposit || 0) > 0).map(u => ({ ...u, topDepo: u.topDeposit || 0 }));
                userDepoList.sort((a, b) => b.topDepo - a.topDepo);
                let eligibleUsers = userDepoList.filter(u => u.topDepo >= (topSys.minDepoRank3 || 0));

                let top1 = eligibleUsers.length > 0 && eligibleUsers[0].topDepo >= topSys.minDepoRank1 ? eligibleUsers[0] : null;
                let top2 = eligibleUsers.length > 1 && eligibleUsers[1].topDepo >= topSys.minDepoRank2 ? eligibleUsers[1] : null;
                let top3 = eligibleUsers.length > 2 && eligibleUsers[2].topDepo >= topSys.minDepoRank3 ? eligibleUsers[2] : null;

                const getUname = (u) => u ? (u.username ? `@${u.username}` : `User ${u.id}`) : "Belum ada";
                const getDepo = (u) => u ? formatRupiah(u.topDepo) : "Rp 0";
                let topText = `𝗗𝗮𝗽𝗮𝘁𝗸𝗮𝗻 𝗱𝗶𝘀𝗸𝗼𝗻 𝗼𝘁𝗼𝗺𝗮𝘁𝗶𝘀 𝘀𝗲𝘁𝗶𝗮𝗽 𝘁𝗿𝗮𝗻𝘀𝗮𝗸𝘀𝗶 𝗱𝗲𝗻𝗴𝗮𝗻 𝗺𝗲𝗻𝗷𝗮𝗱𝗶 𝗧𝗼𝗽 𝗗𝗲𝗽𝗼𝘀𝗶𝘁❗

🥇 𝗧𝗢𝗣 𝟭 (𝗦𝘂𝗹𝘁𝗮𝗻)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank1)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank1}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top1)}
└ 📋 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top1)}

🥈 𝗧𝗢𝗣 𝟮 (𝗝𝘂𝗿𝗮𝗴𝗮𝗻)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank2)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank2}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top2)}
└ 📋 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top2)}

🥉 𝗧𝗢𝗣 𝟯 (𝗝𝗮𝘄𝗮𝗿𝗮)
└ 💰 𝗠𝗶𝗻. 𝗗𝗲𝗽𝗼: ${formatRupiah(topSys.minDepoRank3)}
└ 🎁 𝗗𝗶𝘀𝗸𝗼𝗻: ${topSys.discountRank3}%
└ 💵 𝗧𝗼𝘁𝗮𝗹 𝗗𝗲𝗽𝗼: ${getDepo(top3)}
└ 📋 𝗨𝘀𝗲𝗿𝗻𝗮𝗺𝗲 : ${getUname(top3)}`;
                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: topText, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali', callback_data: 'main_menu' }]] } }).catch(()=>{});
            }
            else if (data.startsWith('depo_cancel_')) {
                const refId = data.replace('depo_cancel_', '');
                if (activeDeposits[refId]) { clearInterval(activeDeposits[refId]); delete activeDeposits[refId]; }
                const dIdx = db.deposits.findIndex(d => d.refId === refId);
                if (dIdx !== -1) { db.deposits[dIdx].status = 'canceled'; saveDB(); }
                botUser.deleteMessage(chatId, msgId).catch(()=>{});
                botUser.sendMessage(chatId, `❌ <b>DEPOSIT DIBATALKAN</b>`, { parse_mode: 'HTML' });
                // Cancel ke Pakasir
                const depoCancel = db.deposits.find(d => d.refId === refId);
                if (depoCancel) cancelPakasirTransaction(refId, depoCancel.amount || depoCancel.total || 0).catch(()=>{});
            }
                        else if (data === 'menu_hist_order') {
                const orderList = Array.isArray(db.orders) ? db.orders : [];
                let userOrders = orderList.filter(o => o.userId === chatId).reverse().slice(0, 5);
                let kb = [];
                if (userOrders.length === 0) {
                    kb.push([{ text: 'Kosong (Belum ada pembelian)', callback_data: 'main_menu' }]);
                } else {
                    userOrders.forEach((o, i) => {
                        let statusIcon = o.status === 'success' ? '✅' : (o.status === 'pending' ? '⏳' : '❌');
                        kb.push([{ text: `${i+1}. ${statusIcon} ${o.item} - ${formatRupiah(o.price)}`, callback_data: `detail_trx_${o.trxId}` }]);
                    });
                }
                kb.push([{ text: '🔙 Kembali', callback_data: 'main_menu' }]);
                
                const historyOrderCaption = `🛍 <b>RIWAYAT TRANSAKSI TERAKHIR</b>
<i>Pantau aktivitas pembelian layanan OTP Anda di sini.</i>

<blockquote><b>📊 INFORMASI RIWAYAT</b>
Sistem menampilkan 5 transaksi terakhir akun Anda.
Gunakan ID Transaksi untuk komplain jika ada kendala.

<b>Keterangan Status:</b>
✅ = Berhasil & Selesai
⏳ = Sedang Diproses / Menunggu OTP
❌ = Dibatalkan / Refund</blockquote>

👇 <b>Daftar Transaksi Anda:</b>`;

                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: historyOrderCaption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }

            else if (data === 'menu_hist_depo') {
                const depoList = Array.isArray(db.deposits) ? db.deposits : [];
                let userDeposits = depoList.filter(d => d.userId === chatId).reverse().slice(0, 5);
                let kb = [];
                if (userDeposits.length === 0) {
                    kb.push([{ text: 'Kosong (Belum ada deposit)', callback_data: 'main_menu' }]);
                } else {
                    userDeposits.forEach((d, i) => {
                        let statusIcon = d.status === 'success' ? '✅' : (d.status === 'pending' ? '⏳' : '❌');
                        kb.push([{ text: `${i+1}. ${statusIcon} Deposit ${formatRupiah(d.amount)}`, callback_data: `detail_trx_${d.refId}` }]);
                    });
                }
                kb.push([{ text: '🔙 Kembali', callback_data: 'main_menu' }]);
                
                const historyDepoCaption = `💰 <b>RIWAYAT PENGISIAN SALDO</b>
<i>Catatan aktivitas deposit ke akun RUMAH OTP Anda.</i>

<blockquote><b>📊 INFORMASI DEPOSIT</b>
Sistem menampilkan 5 riwayat deposit terakhir Anda.

<b>Keterangan Status:</b>
✅ = Saldo Berhasil Masuk
⏳ = Menunggu Pembayaran QRIS
❌ = Dibatalkan / Kadaluarsa</blockquote>

👇 <b>Daftar Deposit Anda:</b>`;

                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: historyDepoCaption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
                        else if (data.startsWith('detail_trx_')) {
                const trxId = data.replace('detail_trx_', '');
                let trx = db.orders.find(o => o.trxId === trxId);
                let isDepo = false;
                
                if (!trx) { trx = db.deposits.find(d => d.refId === trxId); isDepo = true; }
                if (!trx) return botUser.answerCallbackQuery(query.id, { text: '❌ Detail tidak ditemukan.', show_alert: true });

                let caption = '';

                if (isDepo) {
                    // --- TEMPLATE KHUSUS DETAIL DEPOSIT ---
                    const statusStr = trx.status === 'success' ? '✅ Berhasil Masuk' : (trx.status === 'pending' ? '⏳ Menunggu Pembayaran' : '❌ Dibatalkan / Kadaluarsa');
                    caption = `🧾 <b>BUKTI DEPOSIT DIGITAL</b>
<i>Rincian pengisian saldo akun RUMAH OTP Anda.</i>

<blockquote><b>📝 RINCIAN SISTEM</b>
🆔 <b>ID Deposit:</b> <code>${trx.refId}</code>
📅 <b>Tanggal:</b> ${trx.date || 'Tidak diketahui'}
🏷 <b>Metode:</b> ${trx.method || 'QRIS'}
📊 <b>Status:</b> ${statusStr}

<b>💰 RINCIAN DANA</b>
💵 <b>Nominal:</b> ${formatRupiah(trx.amount)}
💸 <b>Biaya Admin:</b> Rp 0
📥 <b>Total Diterima:</b> ${formatRupiah(trx.amount)}</blockquote>

💡 <i>Gunakan ID Deposit di atas jika butuh bantuan Admin.</i>`;

                } else {
                    // --- TEMPLATE KHUSUS DETAIL TRX/OTP ---
                    const statusStr = trx.status === 'success' ? '✅ Berhasil' : (trx.status === 'pending' ? '⏳ Menunggu OTP' : '❌ Gagal / Batal');
                    const trxType = trx.type ? trx.type.toUpperCase() : 'LAYANAN OTP';
                    caption = `🧾 <b>BUKTI TRANSAKSI DIGITAL</b>
<i>Rincian aktivitas pesanan Anda di RUMAH OTP.</i>

<blockquote><b>📝 RINCIAN SISTEM</b>
🆔 <b>ID Trx:</b> <code>${trx.trxId}</code>
📅 <b>Tanggal:</b> ${trx.date || 'Tidak diketahui'}
🏷 <b>Kategori:</b> ${trxType}
📊 <b>Status:</b> ${statusStr}

<b>🛒 RINCIAN ITEM</b>
🎁 <b>Layanan:</b> ${trx.item}
💰 <b>Total Bayar:</b> ${formatRupiah(trx.price)}</blockquote>

💡 <i>Simpan ID Transaksi ini jika Anda membutuhkan bantuan Admin.</i>`;
                }

                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: caption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Menu', callback_data: 'main_menu' }]] } }).catch(()=>{});
            }
        // OTP HANDLERS (ANTI NYANGKUT & FAST RESPON)
            else if (data === 'menu_otp' || data.startsWith('otp_pg_svc_')) {
                if(!otpSession[chatId]) otpSession[chatId] = {};
                let session = otpSession[chatId];
                session.isProcessing = false;

                let page = 1;
                if (data === 'menu_otp') { session.searchSvc = null; session.searchCty = null; page = 1; } 
                else page = parseInt(data.split('_')[3]);
                session.pageSvc = page;

                botUser.answerCallbackQuery(query.id, { text: '⏳ Memuat Aplikasi...' });
                if (cachedOtpServices.length === 0) await syncServices();
                if (cachedOtpServices.length === 0) return botUser.sendMessage(chatId, '❌ Gagal koneksi ke server provider.');
                
                let services = [...cachedOtpServices];
                if (session.searchSvc) services = services.filter(s => s.service_name.toLowerCase().includes(session.searchSvc.toLowerCase()));

                const totalPage = Math.ceil(services.length / 6);
                if (page > totalPage && totalPage > 0) page = 1;
                const paginated = paginateArray(services, 6, page);

                let kb = [];
                for (let i = 0; i < paginated.length; i += 2) {
                    let row = [{ text: `📱 ${paginated[i].service_name}`, callback_data: `otp_sel_svc_${paginated[i].service_code}` }];
                    if (paginated[i + 1]) row.push({ text: `📱 ${paginated[i + 1].service_name}`, callback_data: `otp_sel_svc_${paginated[i + 1].service_code}` });
                    kb.push(row);
                }

                let nav = [];
                if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `otp_pg_svc_${page - 1}` });
                nav.push({ text: session.searchSvc ? '❌ Hapus Cari' : '🔍 Cari Layanan', callback_data: session.searchSvc ? 'menu_otp' : 'otp_search_svc' });
                if (page < totalPage) nav.push({ text: 'Next ➡️', callback_data: `otp_pg_svc_${page + 1}` });
                if(nav.length > 0) kb.push(nav);
                kb.push([{ text: '🔙 Kembali ke Main Menu', callback_data: 'main_menu' }]);

                const desc = `📱 <b>KATALOG LAYANAN OTP</b>
<i>Pilih aplikasi tujuan untuk menerima kode OTP.</i>
<blockquote><b>📊 INFORMASI KATALOG</b>
🌟 <b>Total Layanan:</b> ${services.length} Aplikasi
📄 <b>Halaman:</b> ${page} dari ${totalPage}
🔍 <b>Pencarian:</b> ${session.searchSvc ? session.searchSvc : 'Tidak Ada'}</blockquote>

👇 <b>Silakan pilih aplikasi di bawah ini:</b>`;
                await botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: desc, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data === 'otp_search_svc') {
                userState[chatId] = 'search_otp_svc';
                botUser.sendMessage(chatId, '🔍 Masukkan nama Aplikasi/Layanan yang dicari:', { reply_markup: { force_reply: true } });
            }
            else if (data.startsWith('otp_sel_svc_') || data.startsWith('otp_pg_cty_')) {
                let session = otpSession[chatId];
                if(!session) { botUser.answerCallbackQuery(query.id, { text: 'Sesi habis, ulangi.', show_alert: true }); return sendMainMenu(chatId, msgId); }

                let page = 1;
                if (data.startsWith('otp_sel_svc_')) { session.serviceId = data.split('_')[3]; session.searchCty = ""; } 
                else page = parseInt(data.split('_')[3]);
                session.pageCty = page;

                botUser.answerCallbackQuery(query.id, { text: '⏳ Memuat Negara...' });
                const res = await getCountriesCached(session.serviceId);
                if (!res.success) return botUser.sendMessage(chatId, '❌ Gagal memuat negara.');

                let countries = res.data;
                if (session.searchCty) countries = countries.filter(c => c.name.toLowerCase().includes(session.searchCty.toLowerCase()));

                const totalPage = Math.ceil(countries.length / 8);
                const paginated = paginateArray(countries, 8, page);

                let kb = [];
                for (let i = 0; i < paginated.length; i += 2) {
                    let flagA = getFlag(paginated[i].name);
                    let row = [{ text: `${flagA} ${paginated[i].name} (${paginated[i].prefix})`, callback_data: `otp_sel_cty_${paginated[i].number_id}` }];
                    if (paginated[i + 1]) {
                        let flagB = getFlag(paginated[i + 1].name);
                        row.push({ text: `${flagB} ${paginated[i + 1].name} (${paginated[i + 1].prefix})`, callback_data: `otp_sel_cty_${paginated[i + 1].number_id}` });
                    }
                    kb.push(row);
                }

                let nav = [];
                if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `otp_pg_cty_${page - 1}` });
                nav.push({ text: '🔍 Cari Negara', callback_data: 'otp_search_cty' });
                if (page < totalPage) nav.push({ text: 'Next ➡️', callback_data: `otp_pg_cty_${page + 1}` });
                kb.push(nav);
                kb.push([{ text: '🔙 Kembali', callback_data: 'otp_pg_svc_1' }]);

                const desc = `🌎 <b>KATALOG NEGARA TERSEDIA</b>
<i>Pilih negara asal untuk layanan OTP Anda.</i>
<blockquote><b>📊 INFORMASI KATALOG</b>
📱 <b>Layanan ID:</b> ${session.serviceId}
🌟 <b>Total Negara:</b> ${countries.length} Negara
📄 <b>Halaman ke:</b> ${page} dari ${totalPage}
🔍 <b>Pencarian:</b> ${session.searchCty ? session.searchCty : 'Tidak Ada'}</blockquote>

👇 <b>Silakan pilih negara di bawah ini:</b>`;
                await botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: desc, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data === 'otp_search_cty') {
                userState[chatId] = 'search_otp_cty';
                botUser.sendMessage(chatId, '🔍 Masukkan nama Negara yang dicari:', { reply_markup: { force_reply: true } });
            }
            else if (data.startsWith('otp_sel_cty_') || data.startsWith('otp_pg_stk_')) {
                let session = otpSession[chatId];
                if(!session) { botUser.answerCallbackQuery(query.id, { text: 'Sesi habis, ulangi.', show_alert: true }); return sendMainMenu(chatId, msgId); }

                let page = 1;
                if (data.startsWith('otp_sel_cty_')) session.countryId = data.split('_')[3];
                else page = parseInt(data.split('_')[3]);
                session.pageStk = page;

                botUser.answerCallbackQuery(query.id, { text: '⏳ Memuat Stok...' });

                // Force fresh fetch untuk tampilan awal (bypass cache)
                const res = await getCountriesFresh(session.serviceId);
                if (!res.success) return botUser.sendMessage(chatId, '❌ Gagal memuat stok.');

                const countryData = res.data.find(c => c.number_id == session.countryId);
                if (!countryData) return botUser.answerCallbackQuery(query.id, { text: '❌ Negara tidak ditemukan.', show_alert: true });

                session.countryName = countryData.name;
                let stocks = countryData.pricelist || [];
                stocks.sort((a, b) => parseInt(b.stock) - parseInt(a.stock));

                const totalPage = Math.ceil(stocks.length / 10);
                const paginated = paginateArray(stocks, 10, page);
                
                let margin = user.useSpecialMargin ? (user.specialMarginValue || 0) : (db.settings.otpMargin || 0);

                const topSys = db.settings.topSystem || {};
                let userDepoList = db.users.filter(u => (u.topDeposit || 0) > 0).map(u => ({ ...u, topDepo: u.topDeposit || 0 }));
                userDepoList.sort((a, b) => b.topDepo - a.topDepo);
                let eligibleUsers = userDepoList.filter(u => u.topDepo >= (topSys.minDepoRank3 || 0));

                let discount = 0;
                if (eligibleUsers.length > 0 && eligibleUsers[0].id === chatId && eligibleUsers[0].topDepo >= (topSys.minDepoRank1 || 40000)) discount = topSys.discountRank1 !== undefined ? topSys.discountRank1 : 5;
                else if (eligibleUsers.length > 1 && eligibleUsers[1].id === chatId && eligibleUsers[1].topDepo >= (topSys.minDepoRank2 || 30000)) discount = topSys.discountRank2 !== undefined ? topSys.discountRank2 : 3;
                else if (eligibleUsers.length > 2 && eligibleUsers[2].id === chatId && eligibleUsers[2].topDepo >= (topSys.minDepoRank3 || 20000)) discount = topSys.discountRank3 !== undefined ? topSys.discountRank3 : 1;

                if (discount > 0) { let potongan = discount * 100; if (potongan > margin) potongan = margin; margin -= potongan; }

                let kb = [];
                for (let i = 0; i < paginated.length; i += 2) {
                    let finalPrice1 = parseInt(paginated[i].price) + margin;
                    let stok1 = parseInt(paginated[i].stock);
                    let row = [{
                        text: `💰 ${formatRupiah(finalPrice1)} | Stok: ${stok1 > 0 ? stok1 : '❌ Habis'}`,
                        callback_data: stok1 > 0 ? `os_stk_${paginated[i].provider_id}_${paginated[i].server_id}_${finalPrice1}` : `stok_habis_notif`
                    }];
                    if (paginated[i+1]) {
                        let finalPrice2 = parseInt(paginated[i+1].price) + margin;
                        let stok2 = parseInt(paginated[i+1].stock);
                        row.push({
                            text: `💰 ${formatRupiah(finalPrice2)} | Stok: ${stok2 > 0 ? stok2 : '❌ Habis'}`,
                            callback_data: stok2 > 0 ? `os_stk_${paginated[i+1].provider_id}_${paginated[i+1].server_id}_${finalPrice2}` : `stok_habis_notif`
                        });
                    }
                    kb.push(row);
                }

                let nav = [];
                if (page > 1) nav.push({ text: '⬅️ Prev', callback_data: `otp_pg_stk_${page - 1}` });
                if (page < totalPage) nav.push({ text: 'Next ➡️', callback_data: `otp_pg_stk_${page + 1}` });
                if(nav.length > 0) kb.push(nav);
                kb.push([{ text: '🔙 Kembali', callback_data: 'otp_pg_cty_1' }]);

                const desc = `📦 <b>KATALOG STOK TERSEDIA</b>
<i>Pilih harga dan stok yang ingin Anda pesan.</i>
<blockquote><b>📊 INFORMASI STOK</b>
🌎 <b>Negara:</b> ${session.countryName}
✅ <b>Stok Tersedia:</b> ${countryData.stock_total} Nomor
📄 <b>Halaman:</b> ${page}/${totalPage}</blockquote>

🔄 <i>Update otomatis: ${getTime()} WIB (Tiap 3 dtk)</i>
👇 <b>Silakan pilih stok di bawah ini:</b>`;
                await botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: desc, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});

                // Mulai realtime updater 3 detik sekali
                startRealtimeStockUpdater(chatId, msgId, session, margin);
            }
            else if (data.startsWith('os_stk_')) {
                stopStockUpdater(chatId); // Hentikan updater saat user pilih stok
                let session = otpSession[chatId];
                if(!session) { botUser.answerCallbackQuery(query.id, { text: 'Sesi habis, ulangi.', show_alert: true }); return sendMainMenu(chatId, msgId); }

                const parts = data.split('_');
                session.providerId = parts[2];
                session.serverId = parts[3];
                session.price = parseInt(parts[4]); 

                botUser.answerCallbackQuery(query.id, { text: '⏳ Memuat Operator...' });
                const safeCountryName = encodeURIComponent(session.countryName);
                const res = await reqOtp(`/api/v2/operators?country=${safeCountryName}&provider_id=${session.providerId}`);
                
                let kb = [];
                if (res.success && res.data && res.data.length > 0) {
                    for (let i = 0; i < res.data.length; i += 2) {
                        let row = [{ text: `📶 ${res.data[i].name}`, callback_data: `otp_sel_op_${res.data[i].id}` }];
                        if (res.data[i+1]) row.push({ text: `📶 ${res.data[i+1].name}`, callback_data: `otp_sel_op_${res.data[i+1].id}` });
                        kb.push(row);
                    }
                } else { kb.push([{ text: `📶 Random (Any)`, callback_data: `otp_sel_op_any` }]); }
                kb.push([{ text: '🔙 Kembali', callback_data: 'otp_pg_stk_1' }]);

                const desc = `📶 <b>KATALOG OPERATOR</b>
<i>Pilih jaringan operator untuk nomor OTP Anda.</i>
<blockquote><b>📊 INFORMASI OPERATOR</b>
🌎 <b>Negara:</b> ${session.countryName}
🏢 <b>Provider ID:</b> ${session.providerId}
💰 <b>Harga:</b> ${formatRupiah(session.price)}</blockquote>

👇 <b>Silakan pilih operator di bawah ini:</b>`;
                await botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: desc, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data.startsWith('otp_sel_op_')) {
                let session = otpSession[chatId];
                if(!session) { botUser.answerCallbackQuery(query.id, { text: 'Sesi habis, ulangi.', show_alert: true }); return sendMainMenu(chatId, msgId); }

                session.operatorId = data.replace('otp_sel_op_', '');
                botUser.answerCallbackQuery(query.id, { text: '⏳ Mengecek ketersediaan stok...' });

                // Satu kali fetch fresh, dipakai untuk cek stok sekaligus tampilkan jumlah
                let confirmStock = 0;
                try {
                    const resStock = await getCountriesFresh(session.serviceId);
                    if (resStock.success && resStock.data) {
                        const cData = resStock.data.find(c => c.number_id == session.countryId);
                        if (cData && cData.pricelist) {
                            const stkData = cData.pricelist.find(p => p.provider_id == session.providerId && p.server_id == session.serverId);
                            if (!stkData || parseInt(stkData.stock) <= 0) {
                                return botUser.answerCallbackQuery(query.id, { text: '❌ Stok habis! Silahkan pilih operator lain.', show_alert: true });
                            }
                            confirmStock = parseInt(stkData.stock) || 0;
                        }
                    }
                } catch (e) {}

                const kb = [
    [{ text: `💵 Bayar Sekarang dengan Saldo`, callback_data: `otp_pay_now`, style: 'success' }],
    [{ text: '🔙 Batal', callback_data: 'menu_otp', style: 'danger' }]
];

                const countryFlag = getFlag(session.countryName);
                const desc = `🛒 <b>KONFIRMASI PESANAN NOMOR</b>
<i>Silakan periksa kembali detail pesanan Anda.</i>
<blockquote><b>🧾 DETAIL PESANAN</b>
${countryFlag} <b>Negara:</b> ${session.countryName}
📶 <b>Operator:</b> ${session.operatorId}
💰 <b>Total Harga:</b> ${formatRupiah(session.price)}</blockquote>

📦 <i>Stok saat ini: ${confirmStock} nomor</i>
🔄 <i>Stok diperbarui otomatis setiap 3 detik</i>
⚠️ <i>Saldo Anda akan otomatis terpotong setelah menekan tombol Bayar.</i>`;
                await botUser.editMessageMedia({ type: 'photo', media: settings.images.menuUtama, caption: desc, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});

                // Mulai monitor stok realtime di halaman konfirmasi (setiap 15 detik)
                startConfirmStockMonitor(chatId, msgId, session);
            }
            else if (data === 'otp_pay_now') {
                stopStockUpdater(chatId);
                let session = otpSession[chatId];
                if(!session) { botUser.answerCallbackQuery(query.id, { text: 'Sesi habis, ulangi.', show_alert: true }); return sendMainMenu(chatId, msgId); }

                if (session.isProcessing) return botUser.answerCallbackQuery(query.id, { text: '⏳ Sedang diproses, mohon tunggu!', show_alert: true });
                if (user.saldo < session.price) return botUser.answerCallbackQuery(query.id, { text: '❌ Saldo tidak mencukupi!', show_alert: true });

                // Validasi stok realtime sebelum proses pembayaran (anti tuyul stok habis)
                try {
                    const resStockCheck = await getCountriesFresh(session.serviceId);
                    if (resStockCheck.success && resStockCheck.data) {
                        const cData = resStockCheck.data.find(c => c.number_id == session.countryId);
                        if (cData && cData.pricelist) {
                            const stkData = cData.pricelist.find(p => p.provider_id == session.providerId && p.server_id == session.serverId);
                            if (!stkData || parseInt(stkData.stock) <= 0) {
                                return botUser.answerCallbackQuery(query.id, { text: '❌ Stok habis saat ini! Silahkan pilih stok lain.', show_alert: true });
                            }
                        }
                    }
                } catch (e) { /* lanjut proses jika gagal cek */ }

                session.isProcessing = true;
                botUser.answerCallbackQuery(query.id, { text: '🔄 Memproses pesanan...' });
                botUser.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(()=>{});
                
                const opId = session.operatorId === 'any' ? '' : session.operatorId;
                let res;
                
                try {
                    const response = await fetchWithRetry({
                        method: 'GET',
                        url: `https://www.rumahotp.io/api/v2/orders?number_id=${session.countryId}&provider_id=${session.providerId}&operator_id=${opId}`,
                        headers: { 'x-apikey': settings.rumahOtpApiKey, 'Accept': 'application/json' }
                    });
                    res = response.data;
                } catch (error) {
                    res = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
                }

                if (res && res.success && res.data) {
                    user.saldo -= session.price;
                    const startTime = Date.now();
                    const orderData = res.data;
                    const orderId = orderData.order_id;
                    
                    if(!db.pendingOtps) db.pendingOtps = [];
                    db.pendingOtps.push({
                        orderId: orderId, userId: chatId, price: session.price, itemName: orderData.service, countryName: orderData.country, startTime: startTime
                    });

                    if(!Array.isArray(db.orders)) db.orders = [];
                    db.orders.push({ trxId: orderId, userId: chatId, type: 'otp', item: orderData.service, price: session.price, date: getDate(), status: 'pending' });
                    saveDB();

                                                            const desc = `✅ <b>PESANAN NOMOR BERHASIL!</b>
<i>Sistem sedang memproses nomor Anda...</i>

<blockquote><b>🧾 DETAIL PESANAN</b>
🆔 <b>Order ID:</b> <code>${orderId}</code>
📞 <b>Nomor:</b> <code>${orderData.phone_number}</code>
📱 <b>Layanan:</b> ${orderData.service}
💰 <b>Harga Dibayar:</b> ${formatRupiah(session.price)}</blockquote>
🔄 <i>Mohon tunggu, kode OTP akan masuk secara otomatis...</i>

💡 <b>PANDUAN & KENDALA OTP:</b>
<blockquote><b>⚠️ Info Nomor Virtual</b>
Ini adalah nomor kosong (bukan kartu pribadi), wajar jika sesekali ada kendala. Harap cek nomor sebelum mendaftar. Kamu mungkin perlu mencoba beberapa kali hingga berhasil.

<b>🚫 Nomor Telah Terdaftar?</b>
Cek nomor terlebih dahulu di aplikasi tujuan. Jika ternyata <b>Sudah Terdaftar</b>, harap <b>JANGAN</b> meminta OTP. Tunggu saja hingga 15 menit agar sistem membatalkan pesanan secara otomatis (Refund 100%).

<b>🛡️ Tips Keamanan</b>
Disarankan menggunakan VPN untuk aplikasi ketat seperti WhatsApp/Telegram. Jika tetap tidak berfungsi, silakan tunggu waktu habis atau batalkan transaksi. Saldo Anda aman dan akan dikembalikan otomatis tanpa potongan.</blockquote>`;

                    const cancelKb = { inline_keyboard: [[{ text: '❌ Batalkan Pesanan', callback_data: `cancel_otp_${orderId}`, style: 'danger' }]] };
                    await botUser.editMessageCaption(desc, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: cancelKb }).catch(()=>{});

                    startOtpChecker(chatId, orderId, session.price, orderData.service, orderData.country, startTime);
                    session.isProcessing = false;
                } else {
    const failKb = {
        inline_keyboard: [
            [{ text: '🔄 Pilih Stok Lain', callback_data: `otp_pg_stk_1` }],
            [{ text: '📱 Ganti Layanan', callback_data: 'menu_otp' }],
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
    };
    botUser.editMessageCaption(
        `❌ <b>GAGAL ORDER</b>\n\n<blockquote>${res.message || 'Stok habis atau koneksi ke provider terputus.'}\n\nSilakan pilih stok lain atau coba lagi.</blockquote>`,
        {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'HTML',
            reply_markup: failKb
        }
    ).catch(() => {
        botUser.sendMessage(chatId, `❌ <b>GAGAL ORDER</b>\n\n${res.message || 'Stok habis.'}`, {
            parse_mode: 'HTML',
            reply_markup: failKb
        });
    });
    session.isProcessing = false;
}
            }
            else if (data.startsWith('cancel_otp_')) {
                const orderId = data.replace('cancel_otp_', '');
                const pendingOtp = db.pendingOtps ? db.pendingOtps.find(p => p.orderId === orderId && p.userId === chatId) : null;

                if (!pendingOtp) {
                    return botUser.answerCallbackQuery(query.id, { text: '❌ Pesanan tidak ditemukan atau sudah selesai.', show_alert: true });
                }

                const CANCEL_WAIT_MS = 3 * 60 * 1000 + 20 * 1000; // 3 menit 20 detik = 200 detik
                const elapsed = Date.now() - pendingOtp.startTime;

                if (elapsed < CANCEL_WAIT_MS) {
                    const remaining = Math.ceil((CANCEL_WAIT_MS - elapsed) / 1000);
                    const mins = Math.floor(remaining / 60);
                    const secs = remaining % 60;
                    return botUser.answerCallbackQuery(query.id, { text: `⏳ Harap tunggu ${mins} menit ${secs} detik lagi sebelum dapat membatalkan pesanan.`, show_alert: true });
                }

                botUser.answerCallbackQuery(query.id, { text: '🔄 Membatalkan pesanan...' });

                try { await reqOtp(`/api/v1/orders/set_status?order_id=${orderId}&status=cancel`); } catch (e) {}

                const userCancel = getUser(chatId);
                if (userCancel) {
                    // ===== ANTI DOUBLE-REFUND: Hentikan interval DULU, lalu cek status =====
                    if (activeOtps[orderId]) {
                        clearInterval(activeOtps[orderId]);
                        delete activeOtps[orderId];
                    }

                    const oCheckManual = db.orders.find(o => o.trxId === orderId);
                    if (!oCheckManual || oCheckManual.status !== 'pending') {
                        // Sudah diproses (oleh interval/timeout), jangan refund lagi
                        console.warn(`[ANTI-FRAUD] Skip double-refund manual-cancel untuk order ${orderId}`);
                        return botUser.editMessageCaption(`✅ <b>Pesanan sudah otomatis dibatalkan sebelumnya.</b>\n\nSaldo Anda telah dikembalikan secara otomatis.`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]] } }).catch(()=>{});
                    }

                    // Tandai DULU sebelum refund (atomik)
                    const oIdxManual = db.orders.findIndex(o => o.trxId === orderId);
                    if (oIdxManual !== -1) db.orders[oIdxManual].status = 'canceled';
                    const pIdxManual = db.pendingOtps.findIndex(p => p.orderId === orderId);
                    if (pIdxManual !== -1) db.pendingOtps.splice(pIdxManual, 1);
                    // =========================================================================

                    userCancel.saldo += pendingOtp.price;
                    saveDB();

                    const cancelMsg = `❌ <b>PESANAN DIBATALKAN</b>
<i>Pesanan telah berhasil dibatalkan secara manual.</i>

<blockquote><b>🧾 DETAIL PEMBATALAN</b>
🆔 <b>Order ID:</b> <code>${orderId}</code>
💰 <b>Saldo Dikembalikan:</b> ${formatRupiah(pendingOtp.price)}</blockquote>

✅ <i>Saldo Anda telah dikembalikan secara penuh. Silakan coba order dengan nomor lain.</i>`;

                    botUser.editMessageCaption(cancelMsg, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]] } }).catch(()=>{});
                }
            }
            else if (data === 'menu_deposit') {
                const kb = [
    [{ text: '5k', callback_data: 'req_depo_5000', style: 'success' }, { text: '10k', callback_data: 'req_depo_10000', style: 'success' }],
    [{ text: '15k', callback_data: 'req_depo_15000', style: 'success' }, { text: '20K', callback_data: 'req_depo_20000', style: 'success' }],
    [{ text: '✏️ Masukan nominal', callback_data: 'req_depo_custom', style: 'primary' }],
    [{ text: '🔙 Kembali', callback_data: 'main_menu', style: 'danger' }]
];
                const depositCaption = `💳 <b>MENU DEPOSIT SALDO</b>
<i>Pilih nominal deposit untuk mengisi saldo akun Anda.</i>
<blockquote><b>ℹ️ INFORMASI DEPOSIT</b>
💰 <b>Metode:</b> QRIS (Otomatis)
💵 <b>Min. Deposit:</b> Rp 2.000
⏱ <b>Proses:</b> Instan 24/7</blockquote>

👇 <b>Pilih nominal atau ketik manual di bawah ini:</b>`;
                botUser.editMessageMedia({ type: 'photo', media: settings.images.menuDeposit, caption: depositCaption, parse_mode: 'HTML' }, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
            }
            else if (data === 'req_depo_custom') {
                userState[chatId] = 'await_depo';
                botUser.deleteMessage(chatId, msgId);
                botUser.sendMessage(chatId, '💰 Masukkan nominal deposit (Min 2000):', { reply_markup: { force_reply: true } });
            }
            else if (data.startsWith('req_depo_')) {
                const amt = parseInt(data.split('_')[2]);
                handleDepositRumahOtp(chatId, amt, msgId);
            }
            } catch (err) {
                const errMsg = err?.message || String(err);
                console.warn('⚠️ [User Callback Error - Diabaikan]:', errMsg);
                try { await botUser.answerCallbackQuery(query.id, { text: '❌ Terjadi kesalahan, coba lagi.' }); } catch (_) {}
            }
        });

        botUser.on('message', async (msg) => {
            const chatId = msg.chat.id;
            
            // CEK GLOBAL MAINTENANCE UNTUK MESSAGE USER (KECUALI OWNER)
            if (db.settings.maintenance && chatId.toString() !== settings.ownerId) {
                return; 
            }

            // Cek blokir
            const blockMsg = db.blockedUsers ? db.blockedUsers.find(b => b.userId == chatId) : null;
            if (blockMsg) return; // Abaikan pesan dari user yang diblokir

            const text = msg.text;
            if(msg.from) syncUsername(msg.from);
            if (!text || !userState[chatId]) return;
            if (text.startsWith('/')) { userState[chatId] = null; return; }

            if (userState[chatId] === 'await_buy_sesi_custom') {
                const user = getUser(chatId); 
                if (!user) { userState[chatId] = null; return botUser.sendMessage(chatId, '<b>❌ Data pengguna tidak ditemukan.</b>', { parse_mode: 'HTML' }); }
                
                const jumlah = parseInt(text);
                if (isNaN(jumlah) || jumlah <= 0) { userState[chatId] = null; return botUser.sendMessage(chatId, '<b>❌ Jumlah tidak valid!</b>', { parse_mode: 'HTML' }); }
                
                const hargaTotal = (db.settings.sessionPrice || 4000) * jumlah;
                if (user.saldo < hargaTotal) return botUser.sendMessage(chatId, '<b>❌ Saldo Anda tidak mencukupi!</b>', { parse_mode: 'HTML' });

                let akunTersedia = db.telegramSessions ? db.telegramSessions.filter(s => s.status === 'tersedia') : [];
                if (akunTersedia.length < jumlah) return botUser.sendMessage(chatId, `<b>❌ Stok tidak cukup. Sisa stok: ${akunTersedia.length}</b>`, { parse_mode: 'HTML' });

                user.saldo -= hargaTotal;
                let akunTerbeli = akunTersedia.slice(0, jumlah);
                akunTerbeli.forEach(akun => {
                    let idx = db.telegramSessions.findIndex(s => s.nomor === akun.nomor);
                    if (idx !== -1) { db.telegramSessions[idx].status = 'terjual'; db.telegramSessions[idx].pembeli = chatId; }
                });

                const orderId = 'TRX-SESI-' + Date.now();
                if (!db.orderSessions) db.orderSessions = [];
                db.orderSessions.push({ orderId: orderId, userId: chatId, akunList: akunTerbeli.map(a => ({ nomor: a.nomor, sessionString: a.sessionString, statusLogout: false, statusOtp: false })), date: getDate() });
                saveDB();

                const detailNomor = akunTerbeli.map((a, i) => `${i+1}. <b><code>${a.nomor}</code></b>`).join(`
`);
                const caption = `<b>✅ ORDER SESI TELEGRAM BERHASIL</b>

<b>ID Pesanan:</b> <code>${orderId}</code>
<b>Total Harga:</b> <b>${formatRupiah(hargaTotal)}</b>

<b>DETAIL NOMOR:</b>
${detailNomor}`;

                let kb = [];
                akunTerbeli.forEach((a, i) => {
                    kb.push([{ text: `📩 Check OTP (${a.nomor})`, callback_data: `check_otp_${orderId}_${i}` }]);
                    kb.push([{ text: `🗑 Logout Auto (${a.nomor})`, callback_data: `do_logout_${orderId}_${i}` }]);
                });

                botUser.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
                userState[chatId] = null;
                return;
            }

            if (userState[chatId] === 'search_otp_svc') {
                if(!otpSession[chatId]) otpSession[chatId] = {};
                otpSession[chatId].searchSvc = text;
                userState[chatId] = null;
                botUser.sendMessage(chatId, `✅ Pencarian disimpan: "${text}"`, { reply_markup: { inline_keyboard: [[{ text: 'Lanjutkan', callback_data: 'otp_pg_svc_1' }]] } });
            }
            else if (userState[chatId] === 'search_otp_cty') {
                if(!otpSession[chatId]) otpSession[chatId] = {};
                otpSession[chatId].searchCty = text;
                userState[chatId] = null;
                botUser.sendMessage(chatId, `✅ Pencarian disimpan: "${text}"`, { reply_markup: { inline_keyboard: [[{ text: 'Lanjutkan', callback_data: 'otp_pg_cty_1' }]] } });
            }
            else if (userState[chatId] === 'await_depo') {
                const amt = parseInt(text);
                if (isNaN(amt) || amt < 2000) return botUser.sendMessage(chatId, '❌ Minimal deposit Rp 2.000');
                userState[chatId] = null;
                handleDepositRumahOtp(chatId, amt, msg.message_id);
            }
        });
    }

    setupUserBot();
}
// ==============================================
// 6. CEK IP SERVER (AUTO RUN)
// ==============================================
axios.get('https://api.ipify.org?format=json')
    .then(response => {
        console.log(`
🌐 [SYSTEM INFO] IP Server/Host Bot ini adalah: ${response.data.ip}
`);
    })
    .catch(error => {
        console.error(`
❌ [SYSTEM INFO] Gagal mengecek IP:`, error.message);
    });
