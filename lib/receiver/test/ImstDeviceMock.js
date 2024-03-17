'use strict';

const DeviceMock = require('./DeviceMock');
const HciMessage = require('../HciMessage');

class ImstDeviceMock extends DeviceMock {
    constructor(options) {
        super(options);
    }

    getResponse(data) {
        const m = new HciMessage();
        const parseResult = m.parse(data);
        if (parseResult !== true) {
            console.log(parseResult);
        }
        return m.setupResponse().build();
    }

    sendTelegram(dataString, rssi, frameType, ts) {
        this.sendData(new HciMessage()
            .setRssi(rssi)
            .setTimestamp(ts)
            .setCrc(true)
            .setPayload(2, 3, Buffer.from(dataString.substring(2), 'hex'))
            .build());
    }
}

exports.SerialPort = ImstDeviceMock;