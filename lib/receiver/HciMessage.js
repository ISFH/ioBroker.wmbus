'use strict';

const SOF = 0xA5;
const CRC_FLAG = 0x80;
const RSSI_FLAG = 0x40;
const TIMESTAMP_FLAG = 0x20;

const HEADER_SIZE = 4;
const RSSI_SIZE = 1;
const CRC_SIZE = 2;
const TIMESTAMP_SIZE = 4;

const HIGH_MASK = 0xF0;
const LOW_MASK = 0x0F;

const CRC_INITIAL_VALUE = 0xFFFF;
const CRC_GOOD_VALUE = 0x0F47;
const CRC_TABLE = [
    0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf,
    0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
    0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e,
    0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
    0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd,
    0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
    0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c,
    0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
    0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb,
    0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
    0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a,
    0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
    0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9,
    0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
    0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738,
    0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
    0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7,
    0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cff,
    0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036,
    0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
    0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5,
    0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
    0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134,
    0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
    0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3,
    0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
    0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232,
    0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
    0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1,
    0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
    0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330,
    0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78
];

class HciMessage {
    constructor() {
        this.messageId = 0;
        this.endpointId = 0;

        this.hasTimestamp = false;
        this.hasRssi = false;
        this.hasCrc = false;

        this.crc = null;
        this.rawRssi = null;
        this.rssi = null;
        this.timestamp = null;

        this.payload = Buffer.alloc(0);
    }

    calcCrc(message, includeCrc) {
        let crc = CRC_INITIAL_VALUE;
        const end = includeCrc ? message.length : message.length - 2;
        for (let i = 1; i < end; i++) {
            crc = (crc >> 8) ^ CRC_TABLE[(crc ^ message[i]) & 0x00FF];
        }
        return (~crc & 0xFFFF);
    }

    checkCrc(message) {
        return this.calcCrc(message, true) == CRC_GOOD_VALUE;
    }

    calcMessageSize() {
        return 4 + this.payload.length + (this.hasTimestamp ? TIMESTAMP_SIZE : 0)
            + (this.hasRssi ? RSSI_SIZE : 0) + (this.hasCrc ? CRC_SIZE : 0);
    }

    setPayload(endpointId, messageId, data) {
        this.endpointId = endpointId;
        this.messageId = messageId;
        this.payload = data === null ? Buffer.alloc(0) : data;
        return this;
    }

    setRssi(rssi) {
        if (rssi === null) {
            this.hasRssi = false;
            this.rssi = null;
        } else {
            this.hasRssi = true;
            this.rssi = rssi;
        }
        return this;
    }

    setTimestamp(timestamp) {
        if (timestamp == null) {
            this.hasTimestamp = false;
            this.timestamp = null;
        } else {
            this.hasTimestamp = true;
            this.timestamp = timestamp;
        }
        return this;
    }

    setCrc(update) {
        if (update === true) {
            this.hasCrc = true;
        } else {
            this.hasCrc = false;
        }
        return this;
    }

    setupResponse() {
        this.setTimestamp(null);
        this.setRssi(null);
        this.setCrc(true);
        this.messageId++;
        this.payload = Buffer.alloc(0);
        return this;
    }

    buildHeader() {
        const header = Buffer.alloc(HEADER_SIZE);
        const controlField = (this.hasCrc ? CRC_FLAG : 0x00) | (this.hasRssi ? RSSI_FLAG : 0x00)
            | (this.hasTimestamp ? TIMESTAMP_FLAG : 0x00) | this.endpointId;

        header[0] = SOF;
        header[1] = controlField;
        header[2] = this.messageId;
        header[3] = this.payload.length;

        return header;
    }

    build() {
        const message = Buffer.alloc(this.calcMessageSize());
        let messagePos = 0;

        const header = this.buildHeader();
        header.copy(message, 0);
        messagePos += HEADER_SIZE;

        this.payload.copy(message, messagePos);
        messagePos += this.payload.length;

        if (this.hasTimestamp) {
            message.writeUInt32LE(this.timestamp, messagePos);
            messagePos += TIMESTAMP_SIZE;
        }

        if (this.hasRssi) {
            const rawRssi = ((this.rssi + 380.0 / 3.0) * 15.0 / 8.0) & 0xFF;
            message[messagePos] = rawRssi;
            messagePos += RSSI_SIZE;
        }

        if (this.hasCrc) {
            message.writeUInt16LE(this.calcCrc(message, false), messagePos);
            messagePos += CRC_SIZE;
        }

        return message;
    }

    parse(data) {
        if (data[0] != SOF) {
            throw new Error(`SOF byte is incorrect! Was ${data[0]} expected ${SOF}`);
        }

        const controlField = data[1] & HIGH_MASK;
        this.hasCrc = controlField & CRC_FLAG ? true : false;
        this.hasRssi = controlField & RSSI_FLAG ? true : false;
        this.hasTimestamp = controlField & TIMESTAMP_FLAG ? true : false;

        this.endpointId = data[1] & LOW_MASK;
        this.messageId = data[2];

        const payloadLength = data[3];
        let messagePos = HEADER_SIZE;
        this.payload = data.subarray(HEADER_SIZE, payloadLength + HEADER_SIZE);
        messagePos += payloadLength;

        if (this.hasTimestamp) {
            this.timestamp = data.readUInt32LE(messagePos);
            messagePos += TIMESTAMP_SIZE;
        } else {
            this.timestamp = null;
        }

        if (this.hasRssi) {
            const rawRssi = data[messagePos++];
            this.rssi = (8.0 / 15.0 * rawRssi) - 380.0 / 3.0;
        } else {
            this.rawRssi = null;
            this.rssi = null;
        }

        if (this.hasCrc) {
            this.crc = data.readUInt16LE(messagePos);
            messagePos += CRC_SIZE;
            if (!this.checkCrc(data)) {
                return `CRC check failed: got ${this.crc} expected ${this.calcCrc(data, false)}`;
            }
        } else {
            this.crc = null;
        }
        return true;
    }

    static tryToGetLength(message) {
        if (message.length < 4) {
            return -1;
        }

        const controlField = message[1] & HIGH_MASK;
        return message[3] + 4
            + (controlField & TIMESTAMP_FLAG ? TIMESTAMP_SIZE : 0)
            + (controlField & RSSI_FLAG ? RSSI_SIZE : 0)
            + (controlField & CRC_FLAG ? CRC_SIZE : 0);
    }
}

module.exports = HciMessage;