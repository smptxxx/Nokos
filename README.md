<div align="center">

```
 ███████╗███████╗██████╗  ██████╗ ███╗   ██╗ ██████╗ ██╗  ██╗ ██████╗ ███████╗
 ╚══███╔╝██╔════╝██╔══██╗██╔═══██╗████╗  ██║██╔═══██╗██║ ██╔╝██╔═══██╗██╔════╝
   ███╔╝ █████╗  ██████╔╝██║   ██║██╔██╗ ██║██║   ██║█████╔╝ ██║   ██║███████╗
  ███╔╝  ██╔══╝  ██╔══██╗██║   ██║██║╚██╗██║██║   ██║██╔═██╗ ██║   ██║╚════██║
 ███████╗███████╗██║  ██║╚██████╔╝██║ ╚████║╚██████╔╝██║  ██╗╚██████╔╝███████║
 ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

**Bot Telegram OTP & Sesi — Sistem Lengkap dengan Pembayaran QRIS Otomatis**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-blue?style=flat-square&logo=telegram)](https://core.telegram.org/bots)
[![Pakasir](https://img.shields.io/badge/Payment-Pakasir_QRIS-orange?style=flat-square)](https://pakasir.com)
[![PM2](https://img.shields.io/badge/Process-PM2-red?style=flat-square)](https://pm2.keymetrics.io)
[![Developer](https://img.shields.io/badge/Dev-NEXUSDEV-purple?style=flat-square)](#)

</div>

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Persyaratan](#-persyaratan)
- [Install Otomatis (VPS)](#-install-otomatis-vps)
- [Install Manual](#-install-manual)
- [Konfigurasi](#️-konfigurasi)
- [Menjalankan Bot](#-menjalankan-bot)
- [Perintah PM2](#-perintah-pm2)
- [Fitur Admin](#️-fitur-admin)
- [Backup Otomatis](#-backup-otomatis)
- [Struktur Proyek](#-struktur-proyek)

---

## ✨ Fitur

### 🛒 Layanan User
| Fitur | Keterangan |
|---|---|
| 📱 Beli OTP | Layanan OTP multi-aplikasi & multi-negara via RumahOTP |
| 📦 Beli Sesi Telegram | Akun sesi Telegram (String Session) siap pakai |
| 💳 Deposit QRIS | Pembayaran QRIS otomatis via **Pakasir** — gambar QR muncul langsung di chat |
| 🎁 Sistem Referral | Bonus Rp 150 per referral yang deposit pertama kali |
| 🏆 Top Deposit | Ranking top depositor dengan diskon otomatis |
| 📋 Riwayat Transaksi | Riwayat order & deposit 5 terakhir |
| ⏱ Live Stock | Update stok OTP realtime setiap 2 detik |

### 🛡️ Sistem Keamanan
| Fitur | Keterangan |
|---|---|
| 🔒 Anti-Tuyul | Deteksi & koreksi anomali saldo otomatis setiap 5 menit |
| 🚫 Anti Double-Refund | Proteksi atomik mencegah refund ganda |
| 🔍 Fraud Scan | Admin bisa scan seluruh saldo pengguna secara manual |
| 📛 Blokir User | Blokir/unblokir user langsung dari panel admin |

### ⚙️ Sistem
| Fitur | Keterangan |
|---|---|
| 💾 Backup Otomatis | ZIP backup dikirim ke Telegram — pilih interval **1 Jam / 24 Jam / 7 Hari** |
| 🔧 Maintenance Mode | Auto maintenance 23:00–00:10 WIB harian |
| 📢 Broadcast | Kirim pesan ke semua user dengan entitas teks |
| 📊 Dual Bot | Bot User + Bot Admin berjalan bersamaan |
| 🔄 Sync Layanan | Auto-sync daftar layanan OTP setiap 30 menit |

---

## 📦 Persyaratan

- **VPS/Server** Linux (Ubuntu 20.04+ / Debian 10+)
- **Node.js** v18 atau lebih baru
- **npm** v8+
- **PM2** (process manager)
- **zip** (utilitas kompresi — untuk backup)
- Akun **Telegram Bot** (2 bot: User & Admin) dari [@BotFather](https://t.me/BotFather)
- API Key **RumahOTP** dari [rumahotp.io](https://www.rumahotp.io)
- Akun **Pakasir** dari [pakasir.com](https://pakasir.com) (untuk QRIS)

---

## 🚀 Install Otomatis (VPS)

Jalankan satu perintah berikut di terminal VPS sebagai **root**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/smptxxx/Nokos/main/install.sh)
```

> Script akan otomatis: update sistem, install Node.js, install PM2, clone repo, install dependencies, dan menjalankan bot.

Setelah install, edit konfigurasi:
```bash
nano /root/ZeroNokos/settings.js
```

Kemudian restart bot:
```bash
pm2 restart ZeroNokos
```

---

## 🔧 Install Manual

### 1. Clone Repo
```bash
git clone https://github.com/smptxxx/Nokos.git
cd ZeroNokos
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Konfigurasi
```bash
cp settings.example.js settings.js
nano settings.js
```

### 4. Jalankan Bot
```bash
# Dengan PM2 (recommended)
pm2 start index.js --name ZeroNokos
pm2 save

# Atau langsung
node index.js
```

---

## ⚙️ Konfigurasi

Edit file `settings.js`:

```js
module.exports = {
    // Token bot dari @BotFather
    tokenUser:  'TOKEN_BOT_USER',
    tokenAdmin: 'TOKEN_BOT_ADMIN',

    // Telegram ID owner (angka)
    ownerId: '123456789',

    // API Key RumahOTP dari rumahotp.io
    rumahOtpApiKey: 'your-rumahotp-api-key',

    // Pakasir — daftar di app.pakasir.com
    pakasirProject: 'slug-proyek-anda',
    pakasirApiKey:  'api-key-pakasir-anda',

    // Info bot
    botUsername: '@username_bot',
    botUrl:      'https://t.me/username_bot',
    linkAdmin:   'https://t.me/username_admin',

    // Gambar menu (link direct image)
    images: {
        menuUtama:   'https://link-gambar.jpg',
        menuAdmin:   'https://link-gambar.jpg',
        menuDeposit: 'https://link-gambar.jpg'
    }
};
```

### Cara Mendapatkan Konfigurasi

| Field | Cara Mendapatkan |
|---|---|
| `tokenUser` / `tokenAdmin` | Chat [@BotFather](https://t.me/BotFather) → `/newbot` |
| `ownerId` | Chat [@userinfobot](https://t.me/userinfobot) |
| `rumahOtpApiKey` | Login [rumahotp.io](https://www.rumahotp.io) → Dashboard → API Key |
| `pakasirProject` | Login [app.pakasir.com](https://app.pakasir.com) → Proyek → Slug |
| `pakasirApiKey` | Login [app.pakasir.com](https://app.pakasir.com) → Proyek → API Key |

---

## ▶️ Menjalankan Bot

```bash
# Start
pm2 start index.js --name ZeroNokos

# Atau pakai npm script
npm run pm2
```

---

## 🖥️ Perintah PM2

```bash
pm2 status                    # Lihat status semua proses
pm2 logs ZeroNokos            # Log realtime
pm2 restart ZeroNokos         # Restart bot
pm2 stop ZeroNokos            # Stop bot
pm2 delete ZeroNokos          # Hapus dari PM2
pm2 startup                   # Auto-start saat VPS reboot
```

---

## 🛠️ Fitur Admin

Kirim `/start` ke **Bot Admin** untuk membuka dashboard. Fitur yang tersedia:

```
📊 Dashboard         — Statistik bot, uptime, total transaksi
👥 Manajemen User    — Kelola user, cek saldo, scan fraud, blokir/unblokir
💰 Keuangan          — Tambah saldo manual, atur margin OTP
🛒 Produk & Trx      — Tambah stok sesi, atur harga, riwayat transaksi
⚙️ Sistem & Tampilan
 ├ 📢 Broadcast      — Kirim pesan ke semua user
 ├ 🖼️ Info Banner    — Atur gambar menu
 ├ 🔧 Maintenance    — ON/OFF mode maintenance
 ├ 🔗 Settings Join  — Wajib join channel
 ├ 🎛 Atur Menu      — Aktif/nonaktif menu OTP & Sesi
 ├ 📢 Channel Logs   — Set channel log transaksi & stok
 └ 💾 Kelola Backup  — Atur interval & channel backup
```

---

## 💾 Backup Otomatis

Backup dikirim sebagai file ZIP ke channel/chat Telegram yang ditentukan.

### Pilihan Interval

| Tombol | Interval | Cocok Untuk |
|---|---|---|
| ✅ 1 Jam | Setiap 1 jam | Server produksi aktif |
| ✅ 24 Jam | Setiap 24 jam | Penggunaan normal (default) |
| ✅ 7 Hari | Setiap 7 hari | Traffic rendah |

### Cara Setup Backup
1. Buka **Bot Admin** → `/start`
2. Pergi ke **⚙️ Sistem & Tampilan** → **💾 Kelola Backup**
3. Pilih interval (1 Jam / 24 Jam / 7 Hari)
4. Klik **📡 Set Channel Backup** → masukkan ID channel (contoh: `-1001234567890`)
5. Pastikan Bot Admin sudah dijadikan **Admin** di channel tersebut
6. Klik **🔄 Jalankan Backup Sekarang** untuk test

### Isi Backup
File ZIP berisi: `index.js`, `settings.js`, `backupManager.js`, `package.json`, `database/db.json`

---

## 📁 Struktur Proyek

```
ZeroNokos/
├── index.js              # File utama bot
├── backupManager.js      # Sistem backup otomatis
├── settings.js           # Konfigurasi (tidak di-commit ke Git)
├── settings.example.js   # Template konfigurasi
├── package.json          # Dependencies Node.js
├── install.sh            # Auto installer VPS
├── .gitignore
└── database/
    └── db.json           # Database lokal (auto-created)
```

---

## 🔄 Update Bot

```bash
cd /root/ZeroNokos
git pull origin main
npm install
pm2 restart ZeroNokos
```

> ⚠️ `settings.js` dan folder `database/` tidak akan tertimpa git pull karena sudah ada di `.gitignore`.

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---|---|
| Bot tidak merespons | `pm2 logs ZeroNokos` — cek error |
| QRIS tidak muncul | Pastikan `pakasirProject` & `pakasirApiKey` benar |
| Backup gagal | Pastikan `zip` terinstall: `apt install zip` |
| Error `Cannot find module` | Jalankan ulang `npm install` |
| PM2 tidak autostart | Jalankan `pm2 startup` lalu copy-paste perintahnya |

---

<div align="center">

**⚡ Developed by NEXUSDEV**

*ZeroNokos — Solusi Bot OTP & Sesi Telegram Terlengkap*

</div>
