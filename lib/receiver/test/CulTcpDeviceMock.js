'use strict';

const net = require('net');

const IS_DEBUG = process.env.DEBUG === 'true';

class CulTcpDeviceMock {
    constructor(options) {
        this.options = options;

        this.communicationLog = [];

        this.server = net.createServer();
        this.socket = null;
        this.server.on('connection', (socket) => {
            this.socket = socket;
            socket.on('data', (data) => this.onData(socket, data));
        });

        this.server.listen(Number(this.options.port), this.options.host);
    }

    onData(socket, data) {
        this.communicationLog.push(`<<< ${data.toString('hex')}`);
        const response = this.getResponse(data);
        if (IS_DEBUG) {
            console.log(`>>> ${response.toString('hex')}`);
        }
        socket.write(response);
        this.communicationLog.push(`>>> ${response.toString('hex')}`);
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
        const hexString = prefix + dataString + (rssi != null ? rssi.toString(16).padStart(2, '0') : '00') + '\r\n';
        if (this.socket) {
            this.socket.write(Buffer.from(hexString));
        }
    }
}

module.exports = CulTcpDeviceMock;