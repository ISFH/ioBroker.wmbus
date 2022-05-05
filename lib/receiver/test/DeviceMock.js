'use strict';

const SerialPort = require('@serialport/stream');
const MockBinding = require('@serialport/binding-mock');
const fs = require('fs');

const EventEmitter = require('events');

class EmulatedMockBinding extends MockBinding {
    constructor(opt = {}) {
        super(opt);

        this.emitter = new EventEmitter();
    }

    async write(buffer) {
        console.log(`<<< ${buffer.toString('hex')}`);
        this.emitter.emit('write', buffer);
    }
}

SerialPort.Binding = EmulatedMockBinding;

class DeviceMock extends SerialPort {
    constructor(path, options) {
        EmulatedMockBinding.createPort(path, { echo: false, record: false, readyData: Buffer.alloc(0) });
        super(path, options);

        this.binding.emitter.on('write', this.onWrite.bind(this));
        this.communicationLog = [];
    }

    setDeviceProperties(filename) {
        if (fs.existsSync(filename)) {
            const options = JSON.parse(fs.readFileSync(filename, { encoding: 'utf-8' }));
            Object.keys(options).forEach(key => this[key] = options[key]);
        }
    }

    /* eslint-disable no-unused-vars */

    getResponse(request) {
        throw new Error('getResponse is unimplemented');
    }

    sendTelegram(dataString, rssi, frameType, ts, withCrc) {
        throw new Error('sendTelegram is unimplemented!');
    }

    /* eslint-enable no-unused-vars */

    onWrite(buffer) {
        this.communicationLog.push(`<<< ${buffer.toString('hex')}`);

        const response = this.getResponse(buffer);
        if (Buffer.isBuffer(response)) {
            this.sendData(response);
        }
    }

    sendData(data) {
        console.log(`>>> ${data.toString('hex')}`);
        this.communicationLog.push(`>>> ${data.toString('hex')}`);

        this.binding.emitData(data);
    }

    close() {
        super.close();
        MockBinding.reset();
    }
}

module.exports = DeviceMock;
