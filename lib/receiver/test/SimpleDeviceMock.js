'use strict';

const DeviceMock = require('./DeviceMock');

class SimpleDeviceMock extends DeviceMock {
    constructor(options) {
        super(options);
    }

    sendTelegram(dataString, rssi, frameType, ts, withCrc) {
        const payload = Buffer.from(dataString + '\n');
        if (withCrc) {
            this.sendData(Buffer.concat([Buffer.from([0x5A]), payload]));
        } else {
            this.sendData(payload);
        }
    }
}

exports.SerialPort = SimpleDeviceMock;