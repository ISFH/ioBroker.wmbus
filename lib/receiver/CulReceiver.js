'use strict';

const SerialDevice = require('./SerialDevice');

const CMD_END = '\r\n';
const CMD_SET_DATA_REPORTING_AND_MODE = 'X21\r\nbr';
const CMD_VERSION = 'V';

class CulReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('CUL');
    }

    buildPayloadPackage(command, payload) {
        const s = command + (payload ? payload : '') + CMD_END;
        return Buffer.from(s);
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;

        if (this.parserBuffer.toString('ascii', length - 2) === CMD_END) {
            const buf = this.parserBuffer;
            this.parserBuffer = Buffer.alloc(0);

            if (buf[0] === 0x62) { // starts with 'b' ?
                // remove leading 'b' and trailing \r\n
                return Buffer.from(buf.toString('ascii', 1, length - 2), 'hex');
            } else {
                return buf.subarray(0, buf.length - 2);
            }
        } else {
            return null;
        }
    }

    parseRawMessage(messageBuffer) {
        let rssi = messageBuffer[messageBuffer.length - 1];
        rssi = (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);

        const payload = messageBuffer.subarray(0, messageBuffer.length - 1);
        return {
            frameType: 'A',
            containsCrc: true,
            rawData: payload,
            rssi: rssi,
            ts: new Date().getTime()
        };
    }

    async setDataReportingAndMode() {
        const m = this.mode.toLowerCase();
        if ((m != 's') && (m != 't')) {
            throw new Error('Unknown mode!');
        }

        const response = await this.sendPackage(CMD_SET_DATA_REPORTING_AND_MODE, m);

        if (!response.toString('ascii').endsWith(`${m.toUpperCase()}MODE`)) {
            throw new Error(`Response was ${response.toString('ascii')}`);
        } else {
            this.log.info(`Receiver set to ${m.toUpperCase()}-MODE and data reporting with RSSI`);
        }
    }

    async checkVersion() {
        try {
            const version = await this.sendPackage(CMD_VERSION);
            this.log.info(`Version: ${version.toString('ascii')}`);
        } catch (error) {
            this.log.error(`Error getting CUL version: ${error}`);
        }
    }

    async initDevice() {
        await this.checkVersion();
        await this.setDataReportingAndMode();
    }
}

module.exports = CulReceiver;
