const WebSocket = require('ws');
const admin = require('firebase-admin');
const http = require('http');

// Firebase Admin SDK - Environment Variable'dan Base64 decode
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
);

// Firebase Başlat
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.europe-west1.firebasedatabase.app`
});

const db = admin.database();

// Bağlı cihazlar ve Firebase listener'ları
const devices = new Map();           // deviceId -> WebSocket
const deviceListeners = new Map();   // deviceId -> Firebase listener reference

// HTTP server (healthcheck için)
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            connections: devices.size,
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

console.log('🚀 Grokel WebSocket Bridge starting on port 8080...');

// ESP32 Bağlandığında
wss.on('connection', (ws, req) => {
    const deviceId = new URLSearchParams(req.url.replace('/?', '')).get('id');

    if (!deviceId) {
        console.log('❌ Rejected: No Device ID');
        ws.close();
        return;
    }

    devices.set(deviceId, ws);
    ws.isAlive = true;
    console.log('Device connected:', deviceId);

    // Per-device Firebase listeners - Listen to both desiredState AND preview
    const stateRef = db.ref(`devices/${deviceId}/desiredState`);
    const previewRef = db.ref(`devices/${deviceId}/preview`);

    // İlk state'i gönder
    stateRef.once('value', (snapshot) => {
        if (snapshot.exists()) {
            const state = snapshot.val();
            if (state.color) {
                ws.send(JSON.stringify({ type: 'color', data: state.color }));
                console.log('Initial color sent to', deviceId, ':', JSON.stringify(state.color));
            }
        }
    });

    // Real-time desiredState değişikliklerini dinle
    const onStateChange = (snapshot) => {
        if (ws.readyState === WebSocket.OPEN && snapshot.exists()) {
            const state = snapshot.val();
            if (state.color) {
                ws.send(JSON.stringify({ type: 'color', data: state.color }));
                console.log('✅ desiredState color for', deviceId, ':', JSON.stringify(state.color));
            }
        }
    };

    // Real-time preview değişikliklerini dinle (Flutter Preview Mode)
    const onPreviewChange = (snapshot) => {
        if (ws.readyState === WebSocket.OPEN && snapshot.exists()) {
            const preview = snapshot.val();
            // Preview has direct RGB structure
            if (preview.r !== undefined && preview.g !== undefined && preview.b !== undefined) {
                const color = { r: preview.r, g: preview.g, b: preview.b };
                ws.send(JSON.stringify({ type: 'color', data: color }));
                console.log('🎨 preview color for', deviceId, ':', JSON.stringify(color));
            }
        }
    };

    stateRef.on('value', onStateChange);
    previewRef.on('value', onPreviewChange);

    // Store both listeners for cleanup
    deviceListeners.set(deviceId, {
        state: { ref: stateRef, callback: onStateChange },
        preview: { ref: previewRef, callback: onPreviewChange }
    });

    // Bağlantı koptuğunda cleanup (MEMORY LEAK ÖNLEMİ)
    ws.on('close', () => {
        const listeners = deviceListeners.get(deviceId);
        if (listeners) {
            // Clean up both desiredState and preview listeners
            listeners.state.ref.off('value', listeners.state.callback);
            listeners.preview.ref.off('value', listeners.preview.callback);
            deviceListeners.delete(deviceId);
        }
        devices.delete(deviceId);
        console.log('Device disconnected:', deviceId);
    });

    // Heartbeat
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Keep-Alive (30 saniyede bir ping)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

console.log('✅ Grokel WebSocket Bridge ready on port 8080');
server.listen(8080);
