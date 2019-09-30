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
        this.logFunc = (typeof logger === 'function' ? logger : console.log);

        this.CMD_END = '\r\n';
        this.CMD_DATA_REPORTING_WITH_RSSI = 'X21';
        this.CMD_SET_MODE = 'br';

        this.port = null;

        this.parserBuffer = Buffer.alloc(0);
        this.parserLength = -1;

        this.readCallbacks = [];
        this.readTimeouts = [];

        this.rssiEnabled = false;
        this.channel = 0;
        this.frame_type = null;
    }

    logger(msg) {
        this.logFunc("CUL: " + msg);
    }

    buildPayloadPackage(cmd, payload) {
        let s = cmd + (payload ? payload : '') + this.CMD_END;
        return Buffer.from(s);
    }

    readPayloadPackage(callback) {
        let that = this;

        that.readCallbacks.push(function(data) {
            if (!Buffer.isBuffer(data)) {
                callback && callback({ payload: Buffer.alloc(0), msg_ok: false });
            } else {
                callback && callback({ payload: data, msg_ok: true });
            }
        });

        that.readTimeouts.push(setTimeout(function() {
            that.logger("Message response timeout");
            that.readCallbacks.shift();
            that.readTimeouts.shift();
            callback && callback({ payload: Buffer.alloc(0), msg_ok: false });
        }, 3000));
    }
    
    sendWithoutReply(cmd, payload, callback) {
        let that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = '';
        }

        let pkg = that.buildPayloadPackage(cmd, payload);

        that.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }
            
            callback && callback();
        });
    }

    sendPackage(cmd, payload, callback) {
        let that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = '';
        }

        let pkg = that.buildPayloadPackage(cmd, payload);

        that.port.write(pkg, function(error) {
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
        let that = this;
        that.parserBuffer = Buffer.concat([that.parserBuffer, data]);
        that.logger(that.parserBuffer.toString('hex'));
        let len = that.parserBuffer.length;
        if (that.parserBuffer.toString('ascii', len-2) == that.CMD_END) {
            let emitBuffer;
            if (that.parserBuffer[0] == 0x62) { // starts with 'b' ?
                emitBuffer = Buffer.from(that.parserBuffer.toString('ascii', 1, len - that.CMD_END.length), 'hex'); // remove leading 'b' and trailing \r\n
            } else {
                emitBuffer = Buffer.slice(0, len - that.CMD_END.length);
            }

            that.parserBuffer = Buffer.alloc(0);

            //this.logger(emitBuffer);
            if (that.readCallbacks.length) {
                clearTimeout(that.readTimeouts.shift());
                that.readCallbacks.shift()(emitBuffer);
            } else {
                that.defaultCallback(emitBuffer);
            }
        }
    }

    defaultCallback(data) {
        let that = this;

        if (typeof that.incomingData === 'function') { // telegram received
            let rssi = data[data.length - 1];
            rssi = (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);
            let payload = data.slice(0, data.length - 1);
            that.incomingData({frame_type: that.frame_type, contains_crc: true, raw_data: payload, rssi: rssi, ts: new Date().getTime()});
        } else {
            this.logger("Data but no callback!");
            this.logFunc(data.toString('hex'));
        }
    }

    setMode(mode, callback) {
        mode = mode.toLowerCase();
        if ((mode != 's') || (mode != 't')) { // || (mode != 'c')) {
            callback && callback(undefined, { message: "Unknown mode!" });
            return;
        }
        this.sendPackage(this.CMD_SET_MODE, mode, callback);
    }

    /*getFrameType(callback) {
        this.sendPackage(this.CMD_GET_REQ, [0x2C, 0x01], function (res, err) {
            if (err || (res.payload[2] == 0x00)) {
                callback && callback(undefined);
                return;
            }
            callback && callback(res.payload[0] == 0x02 ? 'B' : 'A');
        });
    }*/

    init(dev, opts, mode) {
        let that = this;
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));
        this.sendWithoutReply(this.CMD_DATA_REPORTING_WITH_RSSI, function(res, err) {
            if (err) {
                that.logger("Error setting wMBus data reporting: " + (err ? err.message : ''));
                this.port.close();
                return;
            }
            that.logger("Receiver set data reporting with RSSI");
            let txt = "T-Mode";
            switch (mode) {
                //case 'C': txt = "C-Mode"; break;
                case 'S': txt = "S-Mode"; break;
                case 'T':
                default: mode = 'T'; txt = "T-Mode"; break;
            }
            this.setMode(mode, function(res, err) {
                if (err || (res.payload.toString('ascii') != mode.toUpperCase() + "MODE")) {
                    that.logger("Error setting wMBus mode: " + (err ? err.message : "response was " + res.payload.toString('ascii')));
                    this.port.close();
                    return;
                }
                that.logger("Receiver channel set to " + txt);
                that.frame_type = 'A'; // what about type B ?
            });
        });
    }
}

module.exports = CUL_WMBUS;
