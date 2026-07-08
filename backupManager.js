const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// =============================================
// INTERVAL PRESETS (ms)
// =============================================
const INTERVAL_PRESETS = {
    '1h':  1 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d':  7 * 24 * 60 * 60 * 1000
};

const INTERVAL_LABELS = {
    '1h':  '1 Jam',
    '24h': '24 Jam',
    '7d':  '7 Hari'
};

class BackupManager {
  /**
   * @param {Object} bot          - TelegramBot instance
   * @param {string} adminId      - Owner Telegram ID
   * @param {number} intervalMs   - Interval (deprecated, gunakan setInterval())
   * @param {string} backupFile   - File simpan timestamp last backup
   * @param {string} channelId    - Channel/chat tujuan backup
   * @param {string} intervalKey  - '1h' | '24h' | '7d' (default '24h')
   */
  constructor(bot, adminId, intervalMs, backupFile, channelId = null, intervalKey = '24h') {
    this.bot = bot;
    this.adminId = adminId;
    this.backupFile = backupFile;
    this.channelId = channelId || adminId;
    this.isBackupRunning = false;
    this.backupCount = 0;
    this.totalBackupSize = 0;
    this.failedBackups = 0;
    this._intervalTimer = null;

    // Tentukan interval dari key, fallback ke intervalMs lama jika key tidak valid
    if (intervalKey && INTERVAL_PRESETS[intervalKey]) {
        this.intervalMs = INTERVAL_PRESETS[intervalKey];
        this.intervalKey = intervalKey;
        this.intervalLabel = INTERVAL_LABELS[intervalKey];
    } else {
        // Backward compat: coba deteksi dari intervalMs
        this.intervalMs = intervalMs || INTERVAL_PRESETS['24h'];
        const found = Object.entries(INTERVAL_PRESETS).find(([, v]) => v === this.intervalMs);
        this.intervalKey = found ? found[0] : '24h';
        this.intervalLabel = INTERVAL_LABELS[this.intervalKey] || `${Math.round(this.intervalMs / 60000)} menit`;
    }

    if (!adminId) {
      throw new Error("❌ Invalid adminId");
    }

    this.loadStats();
    console.log(`✅ BackupManager initialized — Auto backup setiap ${this.intervalLabel}`);
  }

  // =============================================
  // GANTI INTERVAL TANPA RESTART
  // =============================================
  setIntervalKey(key) {
    if (!INTERVAL_PRESETS[key]) return false;
    this.intervalMs = INTERVAL_PRESETS[key];
    this.intervalKey = key;
    this.intervalLabel = INTERVAL_LABELS[key];

    // Restart timer
    if (this._intervalTimer) {
        clearInterval(this._intervalTimer);
        this._intervalTimer = null;
    }
    this._intervalTimer = setInterval(() => {
        console.log(`\n🎯 Running scheduled backup (${this.intervalLabel})...`);
        this.kirimBackupOtomatis();
    }, this.intervalMs);

    this.saveStats();
    console.log(`🔄 Interval backup diubah ke: ${this.intervalLabel}`);
    return true;
  }

  static getPresets() {
    return INTERVAL_PRESETS;
  }

  static getLabels() {
    return INTERVAL_LABELS;
  }

  // =============================================
  // STATS
  // =============================================
  loadStats() {
    try {
      const statsFile = 'backupStats.json';
      if (fs.existsSync(statsFile)) {
        const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        this.backupCount = data.backupCount || 0;
        this.totalBackupSize = data.totalBackupSize || 0;
        this.failedBackups = data.failedBackups || 0;
        // Restore interval key jika tersimpan
        if (data.intervalKey && INTERVAL_PRESETS[data.intervalKey]) {
            this.intervalMs = INTERVAL_PRESETS[data.intervalKey];
            this.intervalKey = data.intervalKey;
            this.intervalLabel = INTERVAL_LABELS[data.intervalKey];
        }
      }
    } catch (err) {
      console.error("⚠️ Load stats error:", err.message);
    }
  }

  saveStats() {
    try {
      const statsFile = 'backupStats.json';
      const data = {
        backupCount: this.backupCount,
        totalBackupSize: this.totalBackupSize,
        failedBackups: this.failedBackups,
        intervalKey: this.intervalKey,
        lastUpdate: Date.now()
      };
      fs.writeFileSync(statsFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error("⚠️ Save stats error:", err.message);
    }
  }

  getLastBackupTime() {
    try {
      if (!fs.existsSync(this.backupFile)) return null;
      const raw = fs.readFileSync(this.backupFile, "utf8");
      if (!raw || raw.trim() === '') return null;
      const json = JSON.parse(raw);
      return json.lastBackup || null;
    } catch (err) {
      return null;
    }
  }

  saveLastBackupTime(ts) {
    try {
      fs.writeFileSync(this.backupFile, JSON.stringify({ lastBackup: ts }, null, 2), 'utf8');
    } catch (err) {
      console.error("⚠️ Gagal save last backup:", err.message);
    }
  }

  // =============================================
  // UTILS
  // =============================================
  formatWaktuJakarta(date) {
    try {
      return date.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (err) {
      return date.toISOString().replace('T', ' ').substring(0, 19);
    }
  }

  isZipAvailable() {
    try {
      execSync('zip -v', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  escapePath(filePath) {
    if (process.platform === 'win32') {
      return `"${filePath}"`;
    }
    return filePath.replace(/(["\s'$`\\])/g, '\\$1');
  }

  async createZipBackup(zipName, itemsToBackup) {
    const zipFullPath = path.join(process.cwd(), zipName);
    
    if (!this.isZipAvailable()) {
      throw new Error("❌ Command 'zip' tidak tersedia di server");
    }

    try {
      const escapedItems = itemsToBackup.map(item => this.escapePath(item)).join(' ');
      const escapedZip = this.escapePath(zipName);
      const shellCmd = `cd "${process.cwd()}" && zip -rq ${escapedZip} ${escapedItems}`;
      
      execSync(shellCmd, {
        stdio: 'pipe',
        shell: true,
        timeout: 300000
      });

      if (!fs.existsSync(zipFullPath)) {
        throw new Error("ZIP file tidak ditemukan setelah pembuatan");
      }

      return zipFullPath;
    } catch (err) {
      if (fs.existsSync(zipFullPath)) {
        try { fs.unlinkSync(zipFullPath); } catch {}
      }
      throw err;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  getServerInfo() {
    try {
      const platform = os.platform();
      const arch = os.arch();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(1);
      const cpuCount = os.cpus().length;
      const systemUptime = os.uptime();
      const processUptime = process.uptime();
      const processMemory = process.memoryUsage();
      const processMemMB = (processMemory.heapUsed / 1024 / 1024).toFixed(2);
      
      let diskInfo = 'N/A';
      try {
        if (platform === 'linux' || platform === 'darwin') {
          const dfOutput = execSync('df -h / | tail -1', { encoding: 'utf8', timeout: 3000 });
          const parts = dfOutput.trim().split(/\s+/);
          diskInfo = `${parts[2] || 'N/A'}/${parts[1] || 'N/A'} (${parts[4] || 'N/A'})`;
        }
      } catch (err) {
        diskInfo = 'Error';
      }

      let serverType = 'Unknown';
      if (platform === 'linux') {
        serverType = 'Linux VPS';
        try {
          const releaseInfo = execSync('cat /etc/os-release | grep PRETTY_NAME', { encoding: 'utf8', timeout: 2000 });
          const match = releaseInfo.match(/PRETTY_NAME="(.+)"/);
          if (match) serverType = match[1];
        } catch {}
      } else if (platform === 'win32') {
        serverType = 'Windows Server';
      } else if (platform === 'darwin') {
        serverType = 'macOS';
      }

      return {
        serverType, platform, arch, cpuCount,
        totalMemGB: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        usedMemGB: (usedMem / 1024 / 1024 / 1024).toFixed(2),
        memUsagePercent,
        systemUptime: this.formatUptime(systemUptime),
        processUptime: this.formatUptime(processUptime),
        processMemMB, diskInfo,
        nodeVersion: process.version
      };
    } catch (err) {
      return { serverType: 'Unknown', platform: os.platform(), error: true };
    }
  }

  // =============================================
  // CORE: KIRIM BACKUP
  // =============================================
  async kirimBackupOtomatis() {
    if (this.isBackupRunning) {
      console.log("⚠️ Backup sedang berjalan, skip...");
      return;
    }

    this.isBackupRunning = true;
    const { bot, adminId, channelId } = this;
    const targetChatId = channelId;
    let zipFullPath = null;
    const startTime = Date.now();

    try {
      const now = Date.now();
      const nowDate = new Date(now);
      console.log(`\n🕒 Auto backup dimulai: ${this.formatWaktuJakarta(nowDate)}`);

      const allFiles = [
        "index.js",
        "settings.js",
        "backupManager.js",
        "package.json",
        "backupStats.json",
        "lastBackup.json",
        "./database/db.json"
      ];

      const foundFiles = allFiles.filter(f => fs.existsSync(f));

      if (foundFiles.length === 0) {
        throw new Error("🚫 Tidak ada file untuk di-backup");
      }

      console.log(`📂 File ditemukan: ${foundFiles.length}/${allFiles.length}`);

      const jakartaString = this.formatWaktuJakarta(nowDate);
      const safeTime = jakartaString
        .replace(/[/:]/g, "-")
        .replace(/,/g, "")
        .replace(/\s+/g, "-");

      const zipName = `BACKUP-${safeTime}.zip`;
      
      console.log(`⚙️ Creating ZIP: ${zipName}`);
      zipFullPath = await this.createZipBackup(zipName, foundFiles);

      const stats = fs.statSync(zipFullPath);
      const sizeFormatted = this.formatBytes(stats.size);
      console.log(`✅ ZIP created: ${sizeFormatted}`);

      const serverInfo = this.getServerInfo();
      const botInfo = await bot.getMe();
      const waktuIndo = this.formatWaktuJakarta(nowDate);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.backupCount++;
      this.totalBackupSize += stats.size;

      const avgBackupSize = this.backupCount > 0 ? this.totalBackupSize / this.backupCount : 0;
      const successRate = this.backupCount > 0 
        ? (((this.backupCount - this.failedBackups) / this.backupCount) * 100).toFixed(1)
        : 100;

      const nextTime = new Date(now + this.intervalMs);
      const nextStr = this.formatWaktuJakarta(nextTime);

      const captionText = 
`📦 *AUTO BACKUP #${this.backupCount}*

⏰ ${waktuIndo}
📁 ${zipName}
📏 ${sizeFormatted} | ⚡ ${duration}s

🖥️ *SERVER*
${serverInfo.serverType}
CPU: ${serverInfo.cpuCount} cores | RAM: ${serverInfo.usedMemGB}/${serverInfo.totalMemGB}GB (${serverInfo.memUsagePercent}%)
Disk: ${serverInfo.diskInfo}
Uptime: ${serverInfo.systemUptime} | Bot: ${serverInfo.processUptime}

📊 *STATS*
Total: ${this.backupCount} | Failed: ${this.failedBackups} | Rate: ${successRate}%
Size: ${this.formatBytes(this.totalBackupSize)} | Avg: ${this.formatBytes(avgBackupSize)}

⏱ Interval: ${this.intervalLabel}
📅 Backup berikutnya: ${nextStr}
Owner: ${adminId} | Bot: @${botInfo.username || 'unknown'}`;

      console.log(`📤 Sending to channel: ${targetChatId}...`);
      
      await bot.sendDocument(targetChatId, fs.createReadStream(zipFullPath), {
        caption: captionText,
        parse_mode: "Markdown"
      });

      console.log("✅ Backup sent successfully!");

      if (fs.existsSync(zipFullPath)) {
        fs.unlinkSync(zipFullPath);
        console.log("🧹 Local ZIP deleted");
      }

      this.saveLastBackupTime(now);
      this.saveStats();

      console.log(`⏭️ Next backup: ${nextStr}`);
      console.log("=".repeat(60) + "\n");

    } catch (err) {
      console.error("\n❌ BACKUP ERROR:", err.message);
      this.failedBackups++;
      this.saveStats();

      const serverInfo = this.getServerInfo();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      const errorMsg = 
`⚠️ *BACKUP FAILED*

❌ ${err.message}
⏰ ${this.formatWaktuJakarta(new Date())}
⚡ ${duration}s

🖥️ ${serverInfo.serverType}
RAM: ${serverInfo.usedMemGB}/${serverInfo.totalMemGB}GB
Disk: ${serverInfo.diskInfo}

📊 Total: ${this.backupCount} | Failed: ${this.failedBackups}
⏱ Interval saat ini: ${this.intervalLabel}

Troubleshoot:
• Pastikan command \`zip\` tersedia di server
• Cek permission file
• Cek kapasitas disk`;

      try {
        await bot.sendMessage(adminId, errorMsg, { parse_mode: "Markdown" });
      } catch (sendErr) {
        console.error("⚠️ Gagal kirim notifikasi error:", sendErr.message);
      }

    } finally {
      this.isBackupRunning = false;

      if (zipFullPath && fs.existsSync(zipFullPath)) {
        try { fs.unlinkSync(zipFullPath); console.log("🧹 ZIP cleanup"); } catch {}
      }
    }
  }

  // =============================================
  // START
  // =============================================
  startAutoBackup() {
    const { intervalMs } = this;
    const now = Date.now();
    const lastBackup = this.getLastBackupTime();

    let firstDelay;

    if (!lastBackup) {
      firstDelay = 60 * 1000;
      console.log("📋 First backup in 1 minute");
    } else {
      const elapsed = now - lastBackup;
      if (elapsed >= intervalMs) {
        firstDelay = 60 * 1000;
        console.log("⏰ Overdue backup, running in 1 minute");
      } else {
        firstDelay = intervalMs - elapsed;
        const waitMin = Math.floor(firstDelay / 60000);
        const waitH   = Math.floor(firstDelay / 3600000);
        const waitD   = Math.floor(firstDelay / 86400000);
        let waitLabel = `${waitMin} menit`;
        if (waitD > 0) waitLabel = `${waitD} hari ${waitH % 24} jam`;
        else if (waitH > 0) waitLabel = `${waitH} jam ${waitMin % 60} menit`;
        console.log(`⏳ Next backup in ${waitLabel}`);
      }
    }

    const next = new Date(now + firstDelay);
    const nextStr = this.formatWaktuJakarta(next);
    const serverInfo = this.getServerInfo();

    console.log(`\n╔═══════════════════════════════════════╗`);
    console.log(`║   🔄 AUTO BACKUP SYSTEM ACTIVATED    ║`);
    console.log(`╚═══════════════════════════════════════╝`);
    console.log(`📅 Jadwal Pertama : ${nextStr}`);
    console.log(`⏱️ Interval       : ${this.intervalLabel}`);
    console.log(`🖥️ Server         : ${serverInfo.serverType}`);
    console.log(`💾 RAM            : ${serverInfo.usedMemGB}GB / ${serverInfo.totalMemGB}GB`);
    console.log(`═══════════════════════════════════════\n`);

    setTimeout(() => {
      console.log("🎯 Running first backup...");
      this.kirimBackupOtomatis();
      
      this._intervalTimer = setInterval(() => {
        console.log(`\n🎯 Running scheduled backup (${this.intervalLabel})...`);
        this.kirimBackupOtomatis();
      }, this.intervalMs);

    }, firstDelay);
  }
}

module.exports = BackupManager;
module.exports.INTERVAL_PRESETS = INTERVAL_PRESETS;
module.exports.INTERVAL_LABELS = INTERVAL_LABELS;
