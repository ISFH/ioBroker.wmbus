'use strict';

const SerialDevice = require('./SerialDevice');
const EbiMessage = require('./EbiMessage');

/* eslint-disable no-unused-vars */

const DEVICE_INFORMATION_PROTOCOL = {
    0x00: 'Unknown',
    0x01: 'Proprietary',
    0x10: '802.15.4',
    0x20: 'ZigBee',
    0x21: 'ZigBee 2004 (1.0)',
    0x22: 'ZigBee 2006',
    0x23: 'ZigBee 2007',
    0x24: 'ZigBee 2007-Pro',
    0x40: 'Wireless M-Bus'
};

const DEVICE_INFORMATION_MODULE = {
    0x00: 'Unknown',
    0x10: 'Reserved',
    0x20: 'EMB-ZRF2xx',
    0x24: 'EMB-ZRF231xx',
    0x26: 'EMB-ZRF231PA',
    0x28: 'EMB-ZRF212xx',
    0x29: 'EMB-ZRF212B',
    0x30: 'EMB-Z253x',
    0x34: 'EMB-Z2530x',
    0x36: 'EMB-Z2530PA',
    0x38: 'EMB-Z2531x',
    0x3A: 'EMB-Z2531PA-USB',
    0x3C: 'EMB-Z2538x',
    0x3D: 'EMB-Z2538PA',
    0x40: 'EMB-WMBx',
    0x44: 'EMB-WMB169x',
    0x45: 'EMB-WMB169T',
    0x46: 'EMB-WMB169PA',
    0x48: 'EMB-WMB868x',
    0x49: 'EMB-WMB868'
};

const JOINING_NETWORK_PREFERENCE = {
    'JOINING_NETWORK_NOT_PERMITTED': 0x00,
    'JOINING_NETWORK_PERMITTED': 0x01
};

const SCAN_MODE = {
    'SCAN_MODE_ENERGY': 0x00,
    'SCAN_MODE_PASSIVE': 0x01,
    'SCAN_MODE_ACTIVE': 0x02
};

const EXECUTION_STATUS_BYTE_VALUE = {
    0x00: 'Success',
    0x01: 'Generic error',
    0x02: 'Parameters not accepted',
    0x03: 'Operation timeout',
    0x04: 'No memory',
    0x05: 'Unsupported',
    0x06: 'Busy',
    0x07: 'Duty Cycle'
};

const CHANNELS_WMB = {
    1: 0x01,  // 169.40625[MHz] @4.8[kbps]
    2: 0x02,  // 169,41875[MHz] @4.8[kbps]
    3: 0x03,  // 169,43125[MHz] @2.4[kbps]
    4: 0x04,  // 169,44375[MHz] @2.4[kbps]
    5: 0x05,  // 169,45625[MHz] @4.8[kbps]
    6: 0x06,  // 169,46875[MHz] @4.8[kbps]
    7: 0x07,  // 169,43750[MHz] @19.2[kbps]
    13: 0x0D,  // 868.030[MHz] @4.8[kbps]
    14: 0x0E,  // 868,090[MHz] @4.8[kbps]
    15: 0x0F,  // 868,150[MHz] @4.8[kbps]
    16: 0x10,  // 868.210[MHz] @4.8[kbps]
    17: 0x11,  // 868.270[MHz] @4.8[kbps]
    18: 0x12,  // 868.330[MHz] @4.8[kbps]
    19: 0x13,  // 868.390[MHz] @4.8[kbps]
    20: 0x14,  // 868.450[MHz] @4.8[kbps]
    21: 0x15,  // 868.510[MHz] @4.8[kbps]
    22: 0x16,  // 868.570[MHz] @4.8[kbps]
    23: 0x17,  // 868,300[MHz] @16,384[kbps]
    24: 0x18,  // 868,300[MHz] @16,384[kbps]
    25: 0x19,  // 868,950[MHz] @66.666[kbps]
    26: 0x1A,  // 868.300[MHz] @16.384[kbps]
    27: 0x1B,  // 868.030[MHz] @2.4[kbps]
    28: 0x1C,  // 868.090[MHz] @2.4[kbps]
    29: 0x1D,  // 868.150[MHz] @2.4[kbps]
    30: 0x1E,  // 868.210[MHz] @2.4[kbps]
    31: 0x1F,  // 868.270[MHz] @2.4[kbps]
    32: 0x20,  // 868.330[MHz] @2.4[kbps]
    33: 0x21,  // 868.390[MHz] @2.4[kbps]
    34: 0x22,  // 868.450[MHz] @2.4[kbps]
    35: 0x23,  // 868.510[MHz] @2.4[kbps]
    36: 0x24,  // 868.570[MHz] @2.4[kbps]
    37: 0x25,  // 868.950[MHz] @100[kbps]
    38: 0x26  // 869,525[MHz] @50[kbps]
};

// Protocol and general device parameters
const CMD_DEVICE_INFORMATION = 0x01;
const CMD_DEVICE_STATE = 0x04;
const CMD_RESET = 0x05;
const CMD_FIRMWARE_VERSION = 0x06;
const CMD_RESTORE_SETTINGS = 0x07;
const CMD_SAVE_SETTINGS = 0x08;
const CMD_UART_CONFIG = 0x09;

const CMD_OUTPUT_POWER = 0x10;
const CMD_OPERATING_CHANNEL = 0x11;
const CMD_ENERGY_SAVE = 0x13;

const CMD_NETWORK_AUTOMATED_SETTINGS = 0x24;

const CMD_NETWORK_START = 0x31;

// Bootloader commands
const CMD_BOOTLOADER_ENTER = 0x70;
const CMD_BOOTLOADER_SETOPTIONS = 0x71;
const CMD_BOOTLOADER_ERASEMEMORY = 0x78;
const CMD_BOOTLOADER_WRITE = 0x7A;
const CMD_BOOTLOADER_READ = 0x7B;
const CMD_BOOTLOADER_COMMIT = 0x7F;

const RX_POLICY_ALLWAYS_ON_WMB = 0x00;
const RX_POLICY_ALLWAYS_OFF_WMB = 0x01;
// Receive window after transmission (whose duration is defined by WMBUS
// standard [3]); a notification (received data notification 0xE0) is
// generated if a packet is received during this receive window.
const RX_POLICY_RECEIVED_WINDOW_WMB = 0x02;
// Receive window after transmission (whose duration is defined by WMBUS
// standard [3]); a notification will be generated if a packet is received
// (just like mode 0x02); however, even if no packet is received, a
// notification (device state notification, 0x84, with code 0x51) is
// generated to indicate the end of the receiving window.
const RX_POLICY_RECEIVED_WITH_END_WINDOW_WMB = 0X03;

const MCU_POLICY_ALLWAYS_ON_WMB = 0x00;
const MCU_POLICY_ALLWAYS_OFF_WMB = 0x01;

const NETWORK_ROLE_WMB = {
    'NETWORK_ROLE_METER': 0x00,
    'NETWORK_ROLE_OTHER_DEVICE': 0x01
};

/* eslint-enable no-unused-vars */

class EbiReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('EBI');
    }

    buildPayloadPackage(command, payload) {
        return new EbiMessage()
            .setPayload(command, payload)
            .build();
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;
        const expectedLength = EbiMessage.tryToGetLength(this.parserBuffer);

        if ((expectedLength !== -1) && (length >= expectedLength)) {
            const messageBuffer = this.parserBuffer.subarray(0, expectedLength);
            this.parserBuffer = this.parserBuffer.subarray(expectedLength);
            return messageBuffer;
        } else {
            return null;
        }
    }

    validateResponse(pkg, response) {
        const mPkg = new EbiMessage();
        mPkg.parse(pkg);

        const mResponse = new EbiMessage();
        mResponse.parse(response);

        if (mPkg.payload.length) {
            if (mResponse.payload[0] != 0x00) {
                throw new Error(`Package validation failed! Execution status: ${EXECUTION_STATUS_BYTE_VALUE[mResponse.payload[0]]}`);
            }
        }

        if (mPkg.setupResponse().messageId != mResponse.messageId) {
            throw new Error('MessageId mismatch!');
        }
    }

    parseRawMessage(messageBuffer) {
        const ebiMessage = new EbiMessage();
        const parseResult = ebiMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.info(parseResult);
        }

        const options = ebiMessage.payload.readUInt16BE(0);
        const frameType = this.getFrameType(options);
        const rssi = this.getRssi(options, ebiMessage.payload);
        const ts = this.getTimestamp(options, ebiMessage.payload);
        const rawData = this.stripHeader(options, ebiMessage.payload);

        return {
            frameType: frameType,
            containsCrc: false,
            rawData: rawData,
            rssi: rssi,
            ts: ts
        };
    }

    getRssi(options, payload) {
        if (options & 0x8000) {
            return payload.readInt8(2);
        } else {
            return -1;
        }
    }

    getFrameType(options) {
        if (options & 0x0010) {
            return 'B';
        } else {
            return 'A';
        }
    }

    getTimestamp(options, payload) {
        if (options & 0x0008) { // timestamp since power on
            const pos = 2 + (options & 0x8000 ? 1 : 0);
            return payload.readUInt32BE(pos) / 32768;
        } else {
            return new Date().getTime();
        }
    }

    stripHeader(options, payload) {
        const start = 2 + (options & 0x8000 ? 1 : 0) + (options & 0x0008 ? 4 : 0);
        return payload.subarray(start);
    }

    async reset() {
        await this.sendPackage(CMD_RESET, Buffer.alloc(0));
        const response = await this.readResponse();
        const m = new EbiMessage();
        m.parse(response);

        if (m.payload[0] != 0x10) {
            this.log.error(`Device not ready! ${m.payload.toString('hex')}`);
            return false;
        } else {
            this.log.info('Device ready');
            return true;
        }
    }

    async getDeviceInformation() {
        const response = await this.sendPackage(CMD_DEVICE_INFORMATION, Buffer.alloc(0));
        const m = new EbiMessage();
        m.parse(response);

        this.log.info(`Found ${DEVICE_INFORMATION_PROTOCOL[m.payload[0]]} protocol and module ${DEVICE_INFORMATION_MODULE[m.payload[1]]}`);
        return m.payload;
    }

    async setOutputPower(power) {
        let payload;
        if (power >= 0) {
            payload = Buffer.from([power & 0xFF]);
        } else {
            payload = Buffer.from([(-power) & 0x80]);
        }

        await this.sendPackage(CMD_OUTPUT_POWER, payload);
    }

    async setOperatingChannel(channel) {
        await this.sendPackage(CMD_OPERATING_CHANNEL, Buffer.from([CHANNELS_WMB[channel]]));
    }

    async setEnergySave(rxPolicy, mcuPolicy) {
        await this.sendPackage(CMD_ENERGY_SAVE, Buffer.from([rxPolicy, mcuPolicy]));
    }

    async setNetworkAutomatedSettings() {
        await this.sendPackage(CMD_NETWORK_AUTOMATED_SETTINGS, Buffer.from([0x80, 0x00]));
    }

    async saveSettings() {
        await this.sendPackage(CMD_SAVE_SETTINGS, Buffer.alloc(0));
    }

    async networkStart() {
        await this.sendPackage(CMD_NETWORK_START, Buffer.alloc(0));
    }

    getMode() {
        switch (this.mode) {
            case 'T': return 0x19;
            case 'S': return 0x18;
            case 'C': return 0x25;
            default: return 0x19;
        }
    }

    getModeDescription() {
        switch (this.mode) {
            case 'T': return 'T-Mode 868.950[MHz] @66.666[kbps]';
            case 'S': return 'S-Mode 868.300[MHz] @16.384[kbps]';
            case 'C': return 'C-Mode 868.950[MHz] @100[kbps]';
            default: return 'T-Mode 868.950[MHz] @66.666[kbps]';
        }
    }

    async initDevice() {
        const deviceInfo = await this.getDeviceInformation();
        if (!(deviceInfo[0] & 0x40)) {
            throw new Error('This is not an Embit Wireless M-Bus device!');
        }

        // do a reset for a cleaner state
        const deviceReady = await this.reset();

        // set channel, power, energy saving
        await this.setOutputPower(0x0F);
        this.log.info('Power set to max');

        await this.setOperatingChannel(this.getMode());
        this.log.info(`Channel set to ${this.getModeDescription()}`);

        await this.setEnergySave(RX_POLICY_ALLWAYS_ON_WMB, MCU_POLICY_ALLWAYS_ON_WMB);
        this.log.info('Energy saving disabled');

        if (deviceReady) {
            await this.setNetworkAutomatedSettings();
            this.log.info('Automatically start network');
            await this.saveSettings();
            this.log.info('Settings saved');
        }

        await this.networkStart();
        this.log.info('Network start okay!');
    }
}

module.exports = EbiReceiver;
