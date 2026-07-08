module.exports = {
    // --- 1. TOKEN BOT TELEGRAM ---
    tokenUser: 'ISI_TOKEN_BOT_USER',        // Token Bot User dari @BotFather
    tokenAdmin: 'ISI_TOKEN_BOT_ADMIN',       // Token Bot Admin dari @BotFather
    ownerId: 'ISI_TELEGRAM_ID_OWNER',        // Telegram ID Owner (angka saja)

    // --- 2. API KEY RUMAHOTP (untuk layanan OTP) ---
    rumahOtpApiKey: 'ISI_API_KEY_RUMAHOTP',  // API Key dari rumahotp.io

    // --- 3. PEMBAYARAN PAKASIR (QRIS) ---
    pakasirProject: 'slug-proyek-pakasir',   // Slug proyek dari app.pakasir.com
    pakasirApiKey:  'api-key-pakasir',        // API Key dari app.pakasir.com

    // --- 4. INFO BOT & LINK ---
    botUsername: '@username_bot_user',        // Username bot user (dengan @)
    botUrl: 'https://t.me/username_bot_user', // URL bot user
    linkAdmin: 'https://t.me/username_admin', // Link kontak admin

    // --- 5. GAMBAR/THUMBNAIL MENU ---
    // Isi dengan link gambar direct (JPG/PNG)
    images: {
        menuUtama:   'https://link-gambar-menu-utama.jpg',
        menuAdmin:   'https://link-gambar-menu-admin.jpg',
        menuDeposit: 'https://link-gambar-menu-deposit.jpg'
    }
};
