'use strict';

const DeviceMock = require('./DeviceMock');
const AmberMessage = require('../AmberMessage');

class AmberDeviceMock extends DeviceMock {
    constructor(path, options) {
        super(path, options);

        this.cmdOutEnabled = true;
        this.rssiEnabled = true;
        this.autoSleep = 0;

        this.setDeviceProperties('./AmberReceiver.config.json');
    }

    getResponse(data) {
        const m = new AmberMessage();
        const parseResult = m.parse(data);
        if (parseResult !== true) {
            console.log(parseResult);
        }

        switch (m.commandId) {
            case 0x04: return m.setupResponse().setPayload(m.commandId, Buffer.alloc(1)).build();
            case 0x05: return m.setupResponse().setPayload(m.commandId, Buffer.alloc(1)).build();
            case 0x09: return m.setupResponse().setPayload(m.commandId, this.getSetReqResponse(m)).build();
            case 0x0A: return m.setupResponse().setPayload(m.commandId, this.getGetReqResponse(m)).build();
            case 0x0C: return m.setupResponse().setPayload(m.commandId, Buffer.from([0x01, 0x02, 0x03])).build();
            default: throw new Error(`Unimplemented commandId! ${m.commandId.toString(16)}`);
        }
    }

    getGetReqResponse(m) {
        const address = m.payload[0];
        const count = m.payload[1];
        if (count != 1) {
            throw new Error('only single byte implemented!');
        }

        const buf = Buffer.alloc(3);
        buf[0] = address;
        buf[1] = count;

        switch (address) {
            case 0x05: buf[2] = this.cmdOutEnabled ? 0x01 : 0x00; break;
            case 0x45: buf[2] = this.rssiEnabled ? 0x01 : 0x00; break;
            case 0x3F: buf[2] = this.autoSleep; break;
            default: throw new Error(`GET_REQ for address ${address} is unimplemented!`);
        }
        return buf;
    }

    getSetReqResponse(m) {
        const address = m.payload[0];
        const count = m.payload[1];
        const value = m.payload[2];
        if (count != 1) {
            throw new Error('only single byte implemented!');
        }

        const buf = Buffer.alloc(1);
        buf[0] = 0x00;

        switch (address) {
            case 0x05:
                if (value === 0) {
                    this.cmdOutEnabled = false;
                } else if (value === 1) {
                    this.cmdOutEnabled = true;
                } else {
                    buf[0] = 0x02;
                }
                break;
            default:
                throw new Error(`SET_REQ for address ${address} is unimplemented!`);
        }

        return buf;
    }

    sendTelegram(dataString, rssi) {
        let data = Buffer.from(dataString.substring(2), 'hex');

        if (this.rssiEnabled) {
            const tmpBuf = data;
            data = Buffer.alloc(tmpBuf.length + 1);
            tmpBuf.copy(data);
            data[data.length - 1] = rssi;
        }

        const telegram = new AmberMessage()
            .setPayload(3, data)
            .build();

        this.sendData(telegram);
    }
}

module.exports = AmberDeviceMock;