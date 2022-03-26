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

class SIMPLE_WMBUS {
    constructor(logger) {
        this.logFunc = {};
        if (typeof logger === 'undefined') {
            this.logFunc.debug = console.log;
            this.logFunc.error = console.log;
        } else if (typeof logger === 'function') {
            this.logFunc.debug = logger;
            this.logFunc.error = logger;
        } else {
            this.logFunc.debug = (typeof logger.debug === 'function' ? logger.debug : function() {});
            this.logFunc.error = (typeof logger.error === 'function' ? logger.error : function() {});
        }

        this.CMD_END = '\n';
        this.CMD_END_LENGTH = 1;

        this.port = null;

        this.parserBuffer = Buffer.alloc(0);

        this.frame_type = 'A';
    }

    logDebug(msg) {
        this.logFunc.debug('SIMPLE_WBUS: ' + msg);
    }

    logError(msg) {
        this.logFunc.error('SIMPLE_WBUS: ' + msg);
    }

    onData(data) {
        const that = this;
        that.parserBuffer = Buffer.concat([that.parserBuffer, data]);
        const len = that.parserBuffer.length;
        if (that.parserBuffer.toString('ascii', len - that.CMD_END_LENGTH) == that.CMD_END) {
            const withCrc = that.parserBuffer[0] == 0x5A;
            const emitBuffer = Buffer.from(that.parserBuffer.toString('ascii', (withCrc ? 1 : 0), len - that.CMD_END.length), 'hex');
            that.parserBuffer = Buffer.alloc(0);
            that.defaultCallback(emitBuffer, withCrc);
        }
    }

    defaultCallback(data, withCrc) {
        const that = this;

        if (typeof that.incomingData === 'function') { // telegram received
            that.incomingData({frame_type: that.frame_type, contains_crc: withCrc, raw_data: data, rssi: -1, ts: new Date().getTime()});
        } else {
            this.logError('Data but no callback!');
            this.logError(data.toString('hex'));
        }
    }

    init(dev, opts, mode) {
        this.port = new SerialPort(dev, opts);
        if (mode == 'B') {
            this.frame_type = 'B';
        }
        this.port.on('data', this.onData.bind(this));
    }
}

module.exports = SIMPLE_WMBUS;
