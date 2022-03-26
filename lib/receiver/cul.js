/*
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * This work is part of the ioBroker wmbus adapter
 * and is licensed under the terms of the GPL2 license.
 *
 * Copyright (c) 2019 ISFH
 *
 * Implementation of the CUL fw UART Interface as described here:
 * http://culfw.de/commandref.html
 *
 */

const SerialPort = require('serialport');

class CUL_WMBUS {
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

        this.CMD_END = '\r\n';
        this.CMD_DATA_REPORTING_WITH_RSSI = 'X21';
        this.CMD_SET_MODE = 'br';

        this.port = null;

        this.parserBuffer = Buffer.alloc(0);

        this.readCallbacks = [];
        this.readTimeouts = [];

        this.frame_type = 'A';
    }

    logDebug(msg) {
        this.logFunc.debug('CUL: ' + msg);
    }

    logError(msg) {
        this.logFunc.error('CUL: ' + msg);
    }

    buildPayloadPackage(cmd, payload) {
        const s = cmd + (payload ? payload : '') + this.CMD_END;
        return Buffer.from(s);
    }

    readPayloadPackage(callback) {
        const that = this;

        that.readCallbacks.push(function(data) {
            if (!Buffer.isBuffer(data)) {
                callback && callback({ payload: Buffer.alloc(0), msg_ok: false });
            } else {
                callback && callback({ payload: data, msg_ok: true });
            }
        });

        that.readTimeouts.push(setTimeout(function() {
            that.logError('Message response timeout');
            that.readCallbacks.shift();
            that.readTimeouts.shift();
            callback && callback(undefined, { message: 'Timeout waiting for response' });
        }, 3000));
    }

    sendWithoutReply(cmd, payload, callback) {
        if (typeof payload === 'function') {
            callback = payload;
            payload = '';
        }

        const pkg = this.buildPayloadPackage(cmd, payload);

        this.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }

            callback && callback();
        });
    }

    sendPackage(cmd, payload, callback) {
        const that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = '';
        }

        const pkg = that.buildPayloadPackage(cmd, payload);

        this.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }

            that.readPayloadPackage(function(res, err) {
                if (err) {
                    callback && callback(undefined, err);
                    return;
                }

                if (res.msg_ok) {
                    callback && callback({ payload: res.payload, pkg: pkg, msg_ok: res.msg_ok});
                    return;
                }
            });
        });
    }

    onData(data) {
        this.parserBuffer = Buffer.concat([this.parserBuffer, data]);
        const len = this.parserBuffer.length;
        if (this.parserBuffer.toString('ascii', len-2) == this.CMD_END) {
            let emitBuffer;
            if (this.parserBuffer[0] == 0x62) { // starts with 'b' ?
                emitBuffer = Buffer.from(this.parserBuffer.toString('ascii', 1, len - this.CMD_END.length), 'hex'); // remove leading 'b' and trailing \r\n
            } else {
                emitBuffer = this.parserBuffer.slice(0, len - 2);
            }

            this.parserBuffer = Buffer.alloc(0);

            if (this.readCallbacks.length) {
                clearTimeout(this.readTimeouts.shift());
                this.readCallbacks.shift()(emitBuffer);
            } else {
                this.defaultCallback(emitBuffer);
            }
        }
    }

    defaultCallback(data) {
        if (typeof this.incomingData === 'function') { // telegram received
            let rssi = data[data.length - 1];
            rssi = (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);
            const payload = data.slice(0, data.length - 1);
            this.incomingData({frame_type: this.frame_type, contains_crc: true, raw_data: payload, rssi: rssi, ts: new Date().getTime()});
        } else {
            this.logError('Data but no callback!');
            this.logError(data.toString('hex'));
        }
    }

    setDataReportingAndMode(mode, callback) {
        mode = mode.toLowerCase();
        if ((mode != 's') && (mode != 't')) { // || (mode != 'c')) {
            callback && callback(undefined, { message: 'Unknown mode!' });
            return;
        }
        this.sendPackage(this.CMD_DATA_REPORTING_WITH_RSSI + this.CMD_END + this.CMD_SET_MODE, mode, callback);
    }

    init(dev, opts, mode) {
        const that = this;
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));

        this.setDataReportingAndMode(mode, function(res, err) {
            if (err || !res.payload.toString('ascii').endsWith(`${mode.toUpperCase()}MODE`)) {
                that.logError('Error setting wMBus mode: ' + (err ? err.message : 'response was ' + res.payload.toString('ascii')));
                that.port.close();
                return;
            }
            that.logDebug(`Receiver set to ${mode.toUpperCase()}-MODE and data reporting with RSSI`);
        });
    }
}

module.exports = CUL_WMBUS;
