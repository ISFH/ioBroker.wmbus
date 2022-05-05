'use strict';

/* eslint-disable no-unused-vars */

const AmberMessage = require('./AmberMessage');
const SerialDevice = require('./SerialDevice');

const CMD_DATA_REQ = 0x00; //Transmission of wM-Bus data
const CMD_DATARETRY_REQ = 0x02; //Resend data previously sent by the module
const CMD_DATA_IND = 0x03; //Output of received Data
const CMD_SET_MODE_REQ = 0x04; //Temporary change of the wM-Bus mode of operation (in volatile memory)
const CMD_RESET_REQ = 0x05; //Software reset
const CMD_SET_CHANNEL_REQ = 0x06; //Select channel
const CMD_SET_REQ = 0x09; //Write parameters of the non-volatile memory
const CMD_GET_REQ = 0x0A; //Read parameters from the non-volatile memory
const CMD_SERIALNO_REQ = 0x0B; //Read serial number
const CMD_FWV_REQ = 0x0C; //Read firmware version
const CMD_RSSI_REQ = 0x0D; //Read current RSSI value
//Reserved 0x0E
const CMD_SETUARTSPEED_REQ = 0x10; //Select transfer speed of the user interface
const CMD_FACTORYRESET_REQ = 0x11; //Reset module to factory settings
//Reserved 0x20
//Reserved 0x21
const CMD_DATA_PRELOAD_REQ = 0x30; //Load telegram for bi-directional operation
const CMD_DATA_CLR_PRELOAD_REQ = 0x31; //Delete preloaded telegram
const CMD_SET_AES_KEY_REQ = 0x50; //AES-Key registration

/* eslint-enable no-unused-vars */

class AmberReceiver extends SerialDevice {
    constructor(path, options, mode, onMessage, onError, loggerFunction) {
        super(path, options, mode, onMessage, onError, loggerFunction);

        this.log.setPrefix('AMBER');

        this.rssiEnabled = false;
    }

    buildPayloadPackage(command, payload) {
        return new AmberMessage()
            .setPayload(command, payload)
            .build();
    }

    checkAndExtractMessage() {
        const length = this.parserBuffer.length;
        const expectedLength = AmberMessage.tryToGetLength(this.parserBuffer);

        if ((expectedLength !== -1) && (length >= expectedLength)) {
            const messageBuffer = this.parserBuffer.subarray(0, expectedLength);
            this.parserBuffer = this.parserBuffer.subarray(expectedLength);
            return messageBuffer;
        } else {
            return null;
        }
    }

    validateResponse(pkg, response) {
        const mPkg = new AmberMessage();
        mPkg.parse(pkg);

        const mResponse = new AmberMessage();
        mResponse.parse(response);

        if (mPkg.setupResponse().commandId != mResponse.commandId) {
            throw new Error('CommandId mismatch!');
        }
    }

    parseRawMessage(messageBuffer) {
        const amberMessage = new AmberMessage();
        const parseResult = amberMessage.parse(messageBuffer);
        if (parseResult !== true) {
            this.log.info(parseResult);
        }

        const rssi = this.getRssi(amberMessage.payload);

        return {
            frameType: 'A',
            containsCrc: false,
            rawData: this.fixPayload(amberMessage.payload),
            rssi: rssi,
            ts: new Date().getTime()
        };
    }

    getRssi(payload) {
        if (!this.rssiEnabled) {
            return -1;
        } else {
            const rssi = payload[payload.length - 1];
            return (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);
        }
    }

    fixPayload(payload) {
        const withoutRssi = this.removeRssiFromPayload(payload);
        return Buffer.concat([Buffer.from([withoutRssi.length]), withoutRssi]);
    }

    removeRssiFromPayload(payload) {
        if (!this.rssiEnabled) {
            return payload;
        } else {
            return payload.subarray(0, payload.length - 1);
        }
    }

    getMode() {
        switch (this.mode) {
            case 'C': return 0x0E;
            case 'S': return 0x03;
            case 'CT': return 0x09;
            default: return 0x08;
        }
    }

    getModeDescription() {
        switch (this.mode) {
            case 'C': return 'C-Mode';
            case 'S': return 'S-Mode';
            case 'CT': return 'combined C/T-Mode';
            default: return 'T-Mode';
        }
    }

    async getReq(address) {
        const response = await this.sendPackage(CMD_GET_REQ, Buffer.from([address, 0x01]));
        const m = new AmberMessage();
        m.parse(response);
        return m.payload[2];
    }

    async reset() {
        await this.sendPackage(CMD_RESET_REQ, Buffer.alloc(0));
    }

    async isCmdOutDisabled() {
        const response = await this.getReq(0x05);
        return response == 0x01 ? false : true;
    }

    async setCmdOutEnabled(state) {
        state = (state ? 0x01 : 0x00);
        this.log.info(`${state ? 'Enabling' : 'Disabling'} UART_CMD_Out...`);

        const response = await this.sendPackage(CMD_SET_REQ, Buffer.from([0x05, 0x01, state]));
        const m = new AmberMessage();
        m.parse(response);

        if (m.payload[0] === 0x01) {
            throw new Error('Verification failed!');
        } else if (m.payload[0] === 0x02) {
            throw new Error('Error: invalid memory position or invalid number of bytes');
        }

        await this.reset();
    }

    async getAutosleep() {
        return await this.getReq(0x3F);
    }

    async isRssiEnabled() {
        return await this.getReq(0x45);
    }

    async getFwVersion() {
        const response = await this.sendPackage(CMD_FWV_REQ, Buffer.alloc(0));
        const m = new AmberMessage();
        m.parse(response);
        this.log.info(`Firmware version ${m.payload[0]}.${m.payload[1]}.${m.payload[2]}`);
    }

    async setMode() {
        const mode = this.getMode();
        await this.sendPackage(CMD_SET_MODE_REQ, Buffer.from([mode]));
        this.log.info(`Receiver set to ${this.getModeDescription()}-MODE`);
    }

    async initDevice() {
        await this.getFwVersion();
        await this.setMode();
        if (await this.isCmdOutDisabled()) {
            await this.setCmdOutEnabled(true);
            this.log.info('Enabled UART_CMD_Out; wait for 500 msec');
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            this.log.info('UART_CMD_Out is enabled');
        }

        this.rssiEnabled = await this.isRssiEnabled() ? true : false;
        this.log.info(`RSSI is ${this.rssiEnabled ? 'enabled' : 'disabled'}`);

        const autosleepState = await this.getAutosleep();
        if (autosleepState != 0x00) {
            this.log.error(`Auto sleep is enabled! Messages ${autosleepState == 2 ? 'will' : 'might'} get lost!`);
        } else {
            this.log.info('Autosleep is disabled');
        }
    }

}

module.exports = AmberReceiver;
