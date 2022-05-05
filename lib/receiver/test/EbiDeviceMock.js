'use strict';

const DeviceMock = require('./DeviceMock');
const EbiMessage = require('../EbiMessage');

class EbiDeviceMock extends DeviceMock {
    constructor(path, options) {
        super(path, options);

        this.deviceState = 0x10;

        this.setDeviceProperties('./EbiReceiver.config.json');
    }

    getResponse(data) {
        const m = new EbiMessage();
        const parseResult = m.parse(data);
        if (parseResult !== true) {
            console.log(parseResult);
        }

        switch (m.messageId) {
            case 0x01: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x40, 0x49])).build();
            case 0x05: setTimeout(this.sendDeviceState.bind(this), 200); return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x08: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x10: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x11: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x13: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x16: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x24: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            case 0x31: return m.setupResponse().setPayload(m.messageId, Buffer.from([0x00])).build();
            default: throw new Error(`Unimplemented commandId! ${m.messageId.toString(16)}`);
        }
    }

    sendDeviceState() {
        const m = new EbiMessage();
        m.setPayload(0x84, Buffer.from([this.deviceState]));
        this.sendData(m.build());
    }

    sendTelegram(dataString, rssi, frameType, ts) {
        let data = Buffer.from(dataString, 'hex');

        let options = 7;
        const dataSize = 2 + data.length + (typeof rssi !== 'undefined' ? 1 : 0) + (typeof ts !== 'undefined' ? 4 : 0);

        const tmpBuf = data;
        data = Buffer.alloc(dataSize);
        let pos = 2;

        if (typeof rssi !== 'undefined') {
            options |= 0x8000;
            data[pos++] = rssi;
        }

        if (typeof frameType !== 'undefined') {
            options |= 0x0010;
        }

        if (typeof ts !== 'undefined') {
            options |= 0x0008;
            data.writeUInt32BE(ts, pos);
            pos += 4;
        }

        data.writeUInt16BE(options);

        tmpBuf.copy(data, pos);

        const telegram = new EbiMessage()
            .setPayload(0xE0, data)
            .build();

        this.sendData(telegram);
    }
}

module.exports = EbiDeviceMock;