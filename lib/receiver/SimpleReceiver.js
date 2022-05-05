'use strict';

const SerialDevice = require('./SerialDevice');

const CMD_END = '\n';

class SimpleReceiver extends SerialDevice {
    constructor(path, options, mode, onMessage, onError, loggerFunction) {
        super(path, options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('SIMPLE');
        this.frameType = 'A';
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;

        if (this.parserBuffer.toString('ascii', length - 1) === CMD_END) {
            const buf = this.parserBuffer;
            this.parserBuffer = Buffer.alloc(0);
            return buf;
        } else {
            return null;
        }
    }

    parseRawMessage(messageBuffer) {
        const withCrc = messageBuffer[0] == 0x5A;
        const payload = Buffer.from(messageBuffer.toString('ascii', (withCrc ? 1 : 0), messageBuffer.length - 1), 'hex');

        return {
            frameType: this.frameType,
            containsCrc: withCrc,
            rawData: payload,
            rssi: -1,
            ts: new Date().getTime()
        };
    }

    async initDevice() {
        if (this.mode == 'B') {
            this.frame_type = 'B';
        }
    }
}

module.exports = SimpleReceiver;
