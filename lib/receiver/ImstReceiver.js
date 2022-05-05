'use strict';

const HciMessage = require('./HciMessage');
const SerialDevice = require('./SerialDevice');

/* eslint-disable no-unused-vars */

//Endpoint Identifier
const DEVMGMT_ID = 0x01;
const RADIOLINK_ID = 0x02;
const RADIOLINKTEST_ID = 0x03;
const HWTEST_ID = 0x04;

//Device Management Message Identifier
const DEVMGMT_MSG_SET_CONFIG_REQ = 0x03;
const DEVMGMT_MSG_SET_CONFIG_RSP = 0x04;

//Link modes
const LINK_MODE_S1 = 0x00;
const LINK_MODE_S1m = 0x01;
const LINK_MODE_S2 = 0x02;
const LINK_MODE_T1 = 0x03;
const LINK_MODE_T2 = 0x04;
const LINK_MODE_R2 = 0x05;
const LINK_MODE_C1A = 0x06;
const LINK_MODE_C1B = 0x07;
const LINK_MODE_C2A = 0x08;
const LINK_MODE_C2B = 0x09;

/* eslint-enable no-unused-vars */

class ImstReceiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('IMST');

        this.frameType = 'A';
    }

    buildPayloadPackage(command, payload) {
        return new HciMessage()
            .setPayload(DEVMGMT_ID, command, payload)
            .setCrc(true)
            .build();
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;
        const expectedLength = HciMessage.tryToGetLength(this.parserBuffer);

        if ((expectedLength !== -1) && (length >= expectedLength)) {
            const messageBuffer = this.parserBuffer.subarray(0, expectedLength);
            this.parserBuffer = this.parserBuffer.subarray(expectedLength);
            return messageBuffer;
        } else {
            return null;
        }
    }

    validateResponse(pkg, response) {
        const mPkg = new HciMessage();
        mPkg.parse(pkg);

        const mResponse = new HciMessage();
        mResponse.parse(response);

        if (mPkg.setupResponse().messageId != mResponse.messageId) {
            throw new Error('MessageId mismatch!');
        }
    }

    parseRawMessage(messageBuffer) {
        const hciMessage = new HciMessage();
        const parseResult = hciMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.info(parseResult);
        }

        return {
            frameType: this.frameType,
            containsCrc: false,
            rawData: this.prefixPayloadWithLength(hciMessage.payload),
            rssi: hciMessage.rssi,
            ts: hciMessage.hasTimestamp ? hciMessage.timestamp : new Date().getTime()
        };
    }

    prefixPayloadWithLength(payload) {
        return Buffer.concat([Buffer.from([payload.length]), payload]);
    }

    getMode() {
        switch (this.mode) {
            case 'S': return LINK_MODE_S1;
            case 'CA': return LINK_MODE_C1A;
            case 'CB': return LINK_MODE_C1B;
            default: return LINK_MODE_T1;
        }
    }

    async setModeAndDisableSleepMode() {
        const mode = this.getMode();
        this.frameType = (mode == LINK_MODE_C1B ? 'B' : 'A');
        if (mode > 0x09) {
            throw new Error(`Invalid mode! ${mode}`);
        }
        await this.sendPackage(DEVMGMT_MSG_SET_CONFIG_REQ, Buffer.from([0x00, 0x03, 0x00, mode, 0x08, 0x00]));
        this.log.info(`Receiver set to ${this.mode}-MODE`);
    }

    async initDevice() {
        await this.setModeAndDisableSleepMode();
    }
}

module.exports = ImstReceiver;
