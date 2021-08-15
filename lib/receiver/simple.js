/*
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * This work is part of the ioBroker wmbus adapter
 * and is licensed under the terms of the GPL2 license.
 *
 * Copyright (c) 2021 Christian Landvogt
 *
 * This is a simple receiver for testing: It opens the serialport and waits
 * for \r terminated hexstrings
 *
 */

const SerialPort = require('serialport');

class SIMPLE_WBUS {
    constructor(logger) {
        this.logFunc = (typeof logger === 'function' ? logger : console.log);

        this.CMD_END = '\n';
        this.CMD_END_LENGTH = 1;

        this.port = null;

        this.parserBuffer = Buffer.alloc(0);
        this.parserLength = -1;

        this.readCallbacks = [];
        this.readTimeouts = [];

        this.frame_type = 'A';
    }

    logger(msg) {
        this.logFunc("SIMPLE_WBUS: " + msg);
    }

    onData(data) {
        let that = this;
        that.parserBuffer = Buffer.concat([that.parserBuffer, data]);
        let len = that.parserBuffer.length;
        if (that.parserBuffer.toString('ascii', len - that.CMD_END_LENGTH) == that.CMD_END) {
            let emitBuffer = Buffer.from(that.parserBuffer.toString('ascii', 0, len - that.CMD_END_LENGTH), 'hex');
            that.parserBuffer = Buffer.alloc(0);
            that.defaultCallback(emitBuffer);
        }
    }

    defaultCallback(data) {
        let that = this;

        if (typeof that.incomingData === 'function') { // telegram received
            that.incomingData({frame_type: that.frame_type, contains_crc: true, raw_data: data, rssi: -1, ts: new Date().getTime()});
        } else {
            this.logger("Data but no callback!");
            this.logFunc(data.toString('hex'));
        }
    }

    init(dev, opts, mode) {
        let that = this;
        this.port = new SerialPort(dev, opts);
        if (mode == "B") {
            this.frame_type = 'B';
        }
        this.port.on('data', this.onData.bind(this));
    }
}

module.exports = SIMPLE_WBUS;
