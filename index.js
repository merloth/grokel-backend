const WebSocket = require('ws');
const admin = require('firebase-admin');

// Coolify'da ayarlayacağımız "Environment Variable"dan anahtarı alıyoruz.
// Bu sayede şifreli dosyanı koda gömmemiş oluyoruz (Güvenlik!).
// Base64 decode ediyoruz çünkü Coolify environment variable'da JSON escape sorunları yaşanıyor
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
);

// Firebase'i Başlat
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Proje ID'sini otomatik algılayıp URL'yi oluşturuyoruz
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.europe-west1.firebasedatabase.app`
});

const db = admin.database();
const wss = new WebSocket.Server({ port: 8080 });

// Bağlı olan cihazları hafızada tutacağız (RAM)
// Format: { "DEVICE_ID": WebSocket_Bağlantısı }
const devices = new Map();

console.log('🚀 Grokel Monolith (WebSocket Bridge) is starting on port 8080...');

// --- 1. ESP32 BAĞLANDIĞINDA ---
wss.on('connection', (ws, req) => {
    // URL'den Device ID'yi çekiyoruz
    // Örnek Bağlantı: ws://sunucu_ip:8080/?id=D46CF0
    const parameters = new URLSearchParams(req.url.replace('/?', ''));
    const deviceId = parameters.get('id');

    if (!deviceId) {
        console.log('❌ Rejected: No Device ID provided.');
        ws.close();
        return;
    }

    // Cihazı haritaya kaydet (Artık ona ulaşabiliriz)
    devices.set(deviceId, ws);
    ws.isAlive = true;
    ws.deviceId = deviceId;

    console.log(`✅ Device Connected: ${deviceId}`);

    // Bağlantı koparsa listeden sil
    ws.on('close', () => {
        console.log(`⚠️ Device Disconnected: ${deviceId}`);
        devices.delete(deviceId);
    });

    // Heartbeat (Kalp Atışı) - Bağlantının canlı olduğunu teyit et
    ws.on('pong', () => { ws.isAlive = true; });

    // --- İLK SENKRONİZASYON (SYNC) ---
    // Cihaz ilk açıldığında en son hangi renkte kaldıysa onu gönder.
    // Böylece elektrik gidip gelince lamba eski rengine döner.
    db.ref(`devices/${deviceId}/desiredState/color`).once('value', (snapshot) => {
        if (snapshot.exists()) {
            const color = snapshot.val();
            console.log(`🔄 Syncing initial state to ${deviceId}:`, color);

            // ESP32'ye gönder (JSON formatında)
            ws.send(JSON.stringify({
                type: 'color',
                data: color
            }));
        }
    });
});

// --- 2. FIREBASE'İ DİNLE (Anlık Tepki) ---
// 'devices' altındaki herhangi bir değişiklikte burası tetiklenir.
// Mobil uygulamadan renk değiştirdiğin AN burası çalışır.
db.ref('devices').on('child_changed', (snapshot) => {
    const deviceId = snapshot.key; // Hangi cihaz değişti?
    const data = snapshot.val();   // Yeni veri ne?

    // Eğer renk verisi varsa ve bu cihaz şu an bize bağlıysa...
    if (data && data.desiredState && data.desiredState.color) {
        const clientWs = devices.get(deviceId);

        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            console.log(`🎨 Color Update for ${deviceId} -> Pushing to ESP32 ⚡`);

            // ESP32'ye veriyi İT (PUSH)
            // Bu işlem milisaniyeler sürer. HTTP Polling gibi bekleme yoktur.
            const payload = JSON.stringify({
                type: 'color',
                data: data.desiredState.color
            });

            clientWs.send(payload);
        } else {
            console.log(`💤 Color changed for ${deviceId}, but device is OFFLINE.`);
        }
    }
});

// --- 3. KEEP-ALIVE (Bağlantı Sağlığı) ---
// Her 30 saniyede bir tüm cihazları dürt: "Orada mısın?"
// Cevap vermeyen ölü bağlantıları temizle.
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);