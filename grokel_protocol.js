/**
 * ============================================================================
 * GROKEL BINARY PROTOCOL - Node.js Encoder
 * ============================================================================
 *
 * V6.0 Thin Client Binary Protocol - Server-side implementation
 *
 * Philosophy:
 * - Binary over WebSocket for maximum efficiency (87% size reduction)
 * - Big Endian byte order for network compatibility
 * - Cross-platform compatibility with ESP32 firmware (grokel_protocol.h)
 *
 * Packet Structure (8 bytes, packed):
 * - Byte 0: Command opcode
 * - Byte 1-2: Hue (0-360°, Big Endian uint16)
 * - Byte 3: Saturation (0-255)
 * - Byte 4: Value/Brightness (0-255)
 * - Byte 5: Auxiliary (White channel or animation speed)
 * - Byte 6-7: Duration in milliseconds (Big Endian uint16)
 *
 * ============================================================================
 */

// Command opcodes (must match grokel_protocol.h)
const GROKEL_CMD_SET_COLOR = 0x01;
const GROKEL_CMD_OFFLINE = 0x02;
const GROKEL_CMD_HEARTBEAT = 0x03;

const GROKEL_PACKET_SIZE = 8;

/**
 * RGB to HSV conversion
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{h: number, s: number, v: number}} HSV values (h: 0-360, s: 0-255, v: 0-255)
 */
function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    let s = max === 0 ? 0 : delta / max;
    let v = max;

    if (delta !== 0) {
        if (max === r) {
            h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
            h = ((b - r) / delta + 2) / 6;
        } else {
            h = ((r - g) / delta + 4) / 6;
        }
    }

    return {
        h: Math.round(h * 360),  // 0-360 degrees
        s: Math.round(s * 255),  // 0-255
        v: Math.round(v * 255)   // 0-255
    };
}

/**
 * Create a binary packet for SET_COLOR command
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @param {number} duration - Fade duration in milliseconds (0-65535)
 * @returns {Buffer} 8-byte binary packet
 */
function createSetColorPacket(r, g, b, duration = 0) {
    // Validate inputs
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
        throw new Error(`Invalid RGB values: R=${r} G=${g} B=${b} (must be 0-255)`);
    }
    if (duration < 0 || duration > 65535) {
        throw new Error(`Invalid duration: ${duration} (must be 0-65535)`);
    }

    // Convert RGB to HSV
    const hsv = rgbToHsv(r, g, b);

    // Create 8-byte buffer
    const packet = Buffer.alloc(GROKEL_PACKET_SIZE);

    // Byte 0: Command opcode
    packet.writeUInt8(GROKEL_CMD_SET_COLOR, 0);

    // Byte 1-2: Hue (Big Endian)
    packet.writeUInt16BE(hsv.h, 1);

    // Byte 3: Saturation
    packet.writeUInt8(hsv.s, 3);

    // Byte 4: Value/Brightness
    packet.writeUInt8(hsv.v, 4);

    // Byte 5: Auxiliary (reserved for future use - RGBW or animation speed)
    packet.writeUInt8(0, 5);

    // Byte 6-7: Duration (Big Endian)
    packet.writeUInt16BE(duration, 6);

    return packet;
}

/**
 * Create a binary packet for OFFLINE command
 * @returns {Buffer} 8-byte binary packet
 */
function createOfflinePacket() {
    const packet = Buffer.alloc(GROKEL_PACKET_SIZE);
    packet.writeUInt8(GROKEL_CMD_OFFLINE, 0);
    // All other bytes are zero-filled
    return packet;
}

/**
 * Create a binary packet for HEARTBEAT command
 * @returns {Buffer} 8-byte binary packet
 */
function createHeartbeatPacket() {
    const packet = Buffer.alloc(GROKEL_PACKET_SIZE);
    packet.writeUInt8(GROKEL_CMD_HEARTBEAT, 0);
    // All other bytes are zero-filled
    return packet;
}

/**
 * Validate packet structure
 * @param {Buffer} packet - Binary packet buffer
 * @returns {boolean} True if valid
 */
function validatePacket(packet) {
    if (!Buffer.isBuffer(packet)) {
        return false;
    }
    if (packet.length !== GROKEL_PACKET_SIZE) {
        return false;
    }

    const cmd = packet.readUInt8(0);
    if (cmd !== GROKEL_CMD_SET_COLOR &&
        cmd !== GROKEL_CMD_OFFLINE &&
        cmd !== GROKEL_CMD_HEARTBEAT) {
        return false;
    }

    // For SET_COLOR, validate HSV ranges
    if (cmd === GROKEL_CMD_SET_COLOR) {
        const hue = packet.readUInt16BE(1);
        const sat = packet.readUInt8(3);
        const val = packet.readUInt8(4);

        if (hue > 360 || sat > 255 || val > 255) {
            return false;
        }
    }

    return true;
}

/**
 * Log packet for debugging
 * @param {Buffer} packet - Binary packet buffer
 * @returns {string} Human-readable packet description
 */
function logPacket(packet) {
    if (!validatePacket(packet)) {
        return '❌ Invalid packet';
    }

    const cmd = packet.readUInt8(0);
    const cmdName = cmd === GROKEL_CMD_SET_COLOR ? 'SET_COLOR' :
                    cmd === GROKEL_CMD_OFFLINE ? 'OFFLINE' :
                    cmd === GROKEL_CMD_HEARTBEAT ? 'HEARTBEAT' : 'UNKNOWN';

    if (cmd === GROKEL_CMD_SET_COLOR) {
        const hue = packet.readUInt16BE(1);
        const sat = packet.readUInt8(3);
        const val = packet.readUInt8(4);
        const aux = packet.readUInt8(5);
        const duration = packet.readUInt16BE(6);

        return `📦 ${cmdName} | HSV(${hue}°, ${sat}, ${val}) | aux:${aux} | dur:${duration}ms`;
    }

    return `📦 ${cmdName}`;
}

module.exports = {
    // Command opcodes
    GROKEL_CMD_SET_COLOR,
    GROKEL_CMD_OFFLINE,
    GROKEL_CMD_HEARTBEAT,
    GROKEL_PACKET_SIZE,

    // Packet creation functions
    createSetColorPacket,
    createOfflinePacket,
    createHeartbeatPacket,

    // Utility functions
    rgbToHsv,
    validatePacket,
    logPacket
};
