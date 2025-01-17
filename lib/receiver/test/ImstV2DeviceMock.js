'use strict';

const DeviceMock = require('./DeviceMock');
const HciMessageV2 = require('../HciMessageV2');

class ImstV2DeviceMock extends DeviceMock {
    constructor(options) {
        super(options);
    }

    getResponse(data) {
        const m = new HciMessageV2();
        const parseResult = m.parse(data);
        if (parseResult !== true) {
            console.log(parseResult);
        }

        if (m.destinationId == 0x01 && m.messageId === 0x01) {
            return m
                .setupResponse()
                .setPayload(Buffer.alloc(1))
                .build();
        } else if (m.destinationId == 0x01 && m.messageId === 0x05) {
            return m
                .setupResponse()
                .setPayload(this.buildGetFwResponsePayload())
                .build();
        } else if(m.destinationId == 0x09 && m.messageId === 0x01) {
            return m
                .setupResponse()
                .setPayload(this.buildGetActiveConfigurationResponsePayload())
                .build();
        }

        return m.setupResponse().build();
    }

    sendTelegram(dataString, rssi, frameType, ts) {
        this.sendData(new HciMessageV2()
            .setDestinationId(0x09)
            .setMessageId(0x20)
            .setPayload(this.buildTelegramPayload(dataString, rssi, frameType, ts))
            .build());
    }

    buildTelegramPayload(dataString, rssi, frameType, ts) {
        const payload = Buffer.alloc(dataString.length / 2 + 8);
        payload.writeUInt32LE(ts !== undefined ? ts : new Date().getTime() / 1000);
        payload[6] = frameType === 'B' ? 20 : 2;
        payload.writeInt8(rssi, 7);
        Buffer.from(dataString, 'hex').copy(payload, 8);
        return payload;
    }

    buildGetFwResponsePayload() {
        const payload = Buffer.alloc(25);
        payload[0] = 0; // status
        payload[1] = 9; // minor versio
        payload[2] = 0; // major version
        payload.writeInt16LE(1234, 3); // build count
        payload.write('17.01.2025', 5, 'ascii');
        payload.write('MockDevice', 15, 'ascii');
        return payload;
    }

    buildGetActiveConfigurationResponsePayload() {
        const payload = Buffer.alloc(11);
        payload[0] = 0; // link mode off
        payload[1] = 1; // packet filter enabled
        // everything else is ignored
        payload[5] = 0x0c; // test slip encoder
        return payload;
    }
}

exports.SerialPort = ImstV2DeviceMock;