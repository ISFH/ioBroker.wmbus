'use strict';

const DeviceMock = require('./DeviceMock');

class CulDeviceMock extends DeviceMock {
    constructor(options) {
        super(options);
    }

    getResponse(data) {
        const str = data.toString();

        if (str === 'X21\r\nbrt\r\n') {
            return Buffer.from('TMODE\r\n');
        } else if (str === 'X21\r\nbrs\r\n') {
            return Buffer.from('SMODE\r\n');
        } else if (str === 'X21\r\nbrc\r\n') {
            return Buffer.from('CMODE\r\n');
        } else if (str === 'V\r\n') {
            return Buffer.from('V 1.30 CUL868\r\n');
        } else {
            console.log(str);
            return Buffer.from('NOT IMPLEMENTED\r\n');
        }
    }

    sendTelegram(dataString, rssi, frameType) {
        frameType = typeof frameType !== 'undefined' ? frameType.toUpperCase() : 'A';
        const prefix = 'b' + (frameType === 'B' ? 'Y' : '');
        const hexString = prefix +  dataString + (rssi != null ? rssi.toString(16).padStart(2, '0') : '00') + '\r\n';
        this.sendData(Buffer.from(hexString));
    }
}

exports.SerialPort = CulDeviceMock;