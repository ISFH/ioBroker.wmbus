'use strict';

const CMD_CONFIRM_BIT = 0x80;

class EbiMessage {
    constructor() {
        this.messageId = 0;
        this.payload = Buffer.alloc(0);
    }

    calcChecksum(data) {
        let chksum = 0;
        for (let i = 0; i < data.length - 1; i++) {
            chksum += data[i];
        }
        return chksum & 0xFF;
    }

    calcMessageSize() {
        return 4 + this.payload.length;
    }

    setPayload(messageId, data) {
        this.messageId = messageId;
        this.payload = data === null ? Buffer.alloc(0) : data;
        return this;
    }

    setupResponse() {
        this.messageId |= CMD_CONFIRM_BIT;
        return this;
    }

    build() {
        const message = Buffer.alloc(this.calcMessageSize());
        message.writeUInt16BE(this.calcMessageSize(), 0);
        message[2] = this.messageId;
        this.payload.copy(message, 3);
        message[message.length - 1] = this.calcChecksum(message);

        return message;
    }

    parse(data) {
        this.messageId = data[2];
        this.payload = Buffer.alloc(data.readUInt16BE(0) - 4);
        data.copy(this.payload, 0, 3, data.length - 1);

        if (this.calcChecksum(data) != data[data.length - 1]) {
            return `CRC check failed: got ${data[data.length - 1]} expected ${this.calcChecksum(data)}`;
        }
        return true;
    }

    static tryToGetLength(message) {
        if (message.length < 2) {
            return -1;
        } else {
            return message.readUInt16BE(0);
        }
    }
}

module.exports = EbiMessage;