'use strict';

const HciMessageV2 = require('./HciMessageV2');
const SerialDevice = require('./SerialDevice');

/* eslint-disable no-unused-vars */

//DestinationId
const SAP_DEVMGMT = 0x01;
const SAP_WMBUS = 0x09;

const DEVMGMT_OFFSET = 0x100;

//messageId
const PING_REQ = 0x01 + DEVMGMT_OFFSET;
const PING_RSP = 0x02 + DEVMGMT_OFFSET;
const FW_INFO_REQ = 0x05 + DEVMGMT_OFFSET;
const FW_INFO_RSP = 0x06 + DEVMGMT_OFFSET;

const GET_ACTIVE_CONFIG_REQ = 0x01;
const GET_ACTIVE_CONFIG_RSP = 0x02;
const SET_ACTIVE_CONFIG_REQ = 0x03;
const SET_ACTIVE_CONFIG_RSP = 0x04;

const RX_MESSAGE_IND = 0x20;

//Link modes
const LINK_MODE_S = 0x01;
const LINK_MODE_T = 0x02;
const LINK_MODE_CT = 0x03;
const LINK_MODE_C = 0x05;
const LINK_MODE_TX = 0x06;

/* eslint-enable no-unused-vars */

class ImstV2Receiver extends SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        super(options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('IMSTv2');
    }

    buildPayloadPackage(command, payload) {
        const sapId = command >= DEVMGMT_OFFSET ? SAP_DEVMGMT : SAP_WMBUS;
        const messageId = command - DEVMGMT_OFFSET;

        return new HciMessageV2()
            .setDestinationId(sapId)
            .setMessageId(messageId)
            .setPayload(payload)
            .build();
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;
        const expectedLength = HciMessageV2.tryToGetLength(this.parserBuffer);

        if ((expectedLength !== -1) && (length >= expectedLength)) {
            const messageBuffer = this.parserBuffer.subarray(0, expectedLength);
            this.parserBuffer = this.parserBuffer.subarray(expectedLength);
            return messageBuffer;
        } else {
            return null;
        }
    }

    validateResponse(pkg, response) {
        const mPkg = new HciMessageV2();
        mPkg.parse(pkg);

        const mResponse = new HciMessageV2();
        mResponse.parse(response);

        if (mPkg.setupResponse().messageId != mResponse.messageId) {
            throw new Error('MessageId mismatch!');
        }
    }

    parseRawMessage(messageBuffer) {
        const hciMessage = new HciMessageV2();
        const parseResult = hciMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.info(parseResult);
        }

        if (hciMessage.messageId !== RX_MESSAGE_IND) {
            this.log.info(`Unhandled message received: 0x${hciMessage.messageId.toString(16)}`);
            this.log.info(hciMessage.payload.toString('hex'));
        }

        const timestamp = hciMessage.payload.readInt32LE(0);
        // hciMessage.payload[4] === decryptionStatus
        // hciMessage.payload[5] === encryptionMode
        const frameType = hciMessage.payload[6] >=20 ? 'B' : 'A';
        const rssi = hciMessage.payload.readInt8(7);

        return {
            frameType: frameType,
            containsCrc: false,
            rawData: hciMessage.payload.subarray(8),
            rssi: rssi,
            ts: timestamp,
        };
    }

    getMode() {
        switch (this.mode) {
            case 'S': return LINK_MODE_S;
            case 'T': return LINK_MODE_T;
            case 'CT': return LINK_MODE_CT;
            case 'C': return LINK_MODE_C;
            case 'Tx': return LINK_MODE_TX;
            default: return LINK_MODE_CT;
        }
    }

    getModeDescription() {
        switch (this.mode) {
            case 'S': return 'S-Mode';
            case 'T': return 'T-Mode';
            case 'CT': return 'combined C/T-Mode';
            case 'C': return 'C-Mode (100 kbps)';
            case 'Tx': return 'enhanced T-Mode';
            default: return 'combined C/T-Mode';
        }
    }

    logStatus(status) {
        if (status === 0x00) {
            this.log.info('Device status: OK');
        } else {
            this.log.info(`Device status not OK (0x${status.toString(16)})`);
        }
    }

    async ping() {
        const response = await this.sendPackage(PING_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        this.logStatus(m.payload[0]);
    }

    async getFwInfo() {
        const response = await this.sendPackage(FW_INFO_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        this.logStatus(m.payload[0]);

        const version = `${m.payload[2]}.${m.payload[1]}`;
        const buildCount = m.payload.readUint16LE(3);
        const date = m.payload.toString('utf-8', 5, 15);
        const fwName = m.payload.toString('utf-8', 15);

        this.log.info(`Firmware v${version} --- build count ${buildCount} on ${date} --- ${fwName}`);
    }

    async setModeAndAndEnableReceiveNotification() {
        const response = await this.sendPackage(GET_ACTIVE_CONFIG_REQ, Buffer.alloc(0));
        const m = new HciMessageV2();
        m.parse(response);

        const config = m.payload.subarray(1);
        config[0] = this.getMode();
        config[1] &= 0xFE; // disable address filter
        config[1] |= 0x02; // enable receive notification

        await this.sendPackage(SET_ACTIVE_CONFIG_REQ, config);
        this.log.info(`Receiver set to ${this.getModeDescription()}`);
    }

    async initDevice() {
        await this.ping();
        await this.getFwInfo();
        await this.setModeAndAndEnableReceiveNotification();
    }
}

module.exports = ImstV2Receiver;
