'use strict';

const CMD_START = 0xFF;
const CMD_CONFIRM_BIT = 0x80;

class AmberMessage {
    constructor() {
        this.commandId = 0;
        this.payload = Buffer.alloc(0);
    }

    calcMessageSize() {
        return 4 + this.payload.length;
    }

    calcChecksum(data) {
        let csum = data[0];
        for (let i = 1; i < data.length - 1; i++) {
            csum ^= data[i];
        }
        return csum;
    }

    setPayload(commandId, data) {
        this.commandId = commandId;
        this.payload = data === null ? Buffer.alloc(0) : data;
        return this;
    }

    setupResponse() {
        this.commandId |= CMD_CONFIRM_BIT;
        return this;
    }

    build() {
        const message = Buffer.alloc(this.calcMessageSize());
        message[0] = CMD_START;
        message[1] = this.commandId;
        message[2] = this.payload.length;
        this.payload.copy(message, 3);
        message[message.length - 1] = this.calcChecksum(message);

        return message;
    }

    parse(data) {
        if (data[0] != CMD_START) {
            return `Expected message to start with ${CMD_START} but found ${data[0]}`;
        }

        this.commandId = data[1];
        this.payload = Buffer.alloc(data[2]);
        data.copy(this.payload, 0, 3, data.length - 1);

        if (this.calcChecksum(data) != data[data.length - 1]) {
            return `CRC check failed: got ${data[data.length - 1]} expected ${this.calcChecksum(data)}`;
        }
        return true;
    }

    static tryToGetLength(message) {
        if (message.length < 3) {
            return -1;
        } else {
            return message[2] + 4;
        }
    }
}

module.exports = AmberMessage;