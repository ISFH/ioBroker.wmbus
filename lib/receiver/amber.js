const SerialPort = require('serialport');

class AMBER_WMBUS {
    constructor(logger) {
        this.logFunc = (typeof logger === 'function' ? logger : console.log);

        this.CMD_DATA_REQ = 0x00; //Transmission of wM-Bus data
        this.CMD_DATARETRY_REQ = 0x02; //Resend data previously sent by the module
        this.CMD_DATA_IND = 0x03; //Output of received Data
        this.CMD_SET_MODE_REQ = 0x04; //Temporary change of the wM-Bus mode of operation (in volatile memory)
        this.CMD_RESET_REQ = 0x05; //Software reset
        this.CMD_SET_CHANNEL_REQ = 0x06; //Select channel
        this.CMD_SET_REQ = 0x09; //Write parameters of the non-volatile memory
        this.CMD_GET_REQ = 0x0A; //Read parameters from the non-volatile memory
        this.CMD_SERIALNO_REQ = 0x0B; //Read serial number
        this.CMD_FWV_REQ = 0x0C; //Read firmware version
        this.CMD_RSSI_REQ = 0x0D; //Read current RSSI value
        //Reserved 0x0E
        this.CMD_SETUARTSPEED_REQ = 0x10; //Select transfer speed of the user interface
        this.CMD_FACTORYRESET_REQ = 0x11; //Reset module to factory settings
        //Reserved 0x20
        //Reserved 0x21
        this.CMD_DATA_PRELOAD_REQ = 0x30; //Load telegram for bi-directional operation
        this.CMD_DATA_CLR_PRELOAD_REQ = 0x31; //Delete preloaded telegram
        this.CMD_SET_AES_KEY_REQ = 0x50; //AES-Key registration

        this.CMD_START = 0xFF;
        this.CMD_CONFIRM_BIT = 0x80;

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
        this.logFunc("AMBER: " + msg);
    }

    calcChecksum(data) {
        let csum = data[0];
        for (let i = 1; i < data.length-1; ++i) {
            csum ^= data[i];
        }
        return csum;
    }

    buildPayloadPackage(cmd_id, payload) {
        let that = this;
        if (!Buffer.isBuffer(payload)) {
            if (typeof payload === 'undefined') {
                payload = Buffer.alloc(0);
            } else {
                payload = Buffer.from(payload);
            }
        }

        let res = Buffer.alloc(3 + payload.length + 1);
        res[0] = this.CMD_START;
        res[1] = cmd_id;
        res[2] = payload.length
        payload.copy(res, 3);
        res[res.length - 1] = that.calcChecksum(res);
        return res;
    }

    readPayloadPackage(cmd_id, callback) {
        let that = this;
        let cmd_id_read = cmd_id | this.CMD_CONFIRM_BIT;

        that.readCallbacks.push(function(data) {
            if (!Buffer.isBuffer(data) || (data[0] != that.CMD_START)) {
                callback && callback({cmd_id: 0, payload: Buffer.alloc(0), crc_ok: false});
            } else {
                let payload = data.slice(3, data.length - 1);
                if (that.calcChecksum(data) != data[data.length - 1]) {
                    callback && callback(undefined, { message: 'Incorrect checksum' });
                    return;
                }

                let return_id = data[1];
                if (cmd_id_read == return_id) {
                    callback && callback({cmd_id: return_id, payload: payload, crc_ok: true});
                } else {
                    callback && callback(undefined, { message: 'The data received has a different confirmation ID than expected' });

                }
            }
        });

        that.readTimeouts.push(setTimeout(function() {
            that.logger("Message response timeout");
            that.readCallbacks.shift();
            that.readTimeouts.shift();
            callback && callback({cmd_id: 0, payload: Buffer.alloc(0), crc_ok: false});
        }, 3000));
    }

    sendPackage(cmd_id, payload, callback) {
        let that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = Buffer.alloc(0);
        }

        let pkg = that.buildPayloadPackage(cmd_id, payload);

        that.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }

            that.readPayloadPackage(cmd_id, function(res, err) {
                if (err) {
                    callback && callback(undefined, err);
                    return;
                }

                if (res.crc_ok) {
                    callback && callback({cmd_id: res.cmd_id, payload: res.payload, pkg: pkg, msg_ok: res.crc_ok}); 
                    return;
                }
            });
        });
    }

    onData(data) {
        let that = this;
        that.parserBuffer = Buffer.concat([that.parserBuffer, data]);

        if (that.parserLength == -1) {
            if (that.parserBuffer.length < 3) {
                return;
            }
            that.parserLength = that.parserBuffer[2] + 4;
            if (that.parserLength < 4) {
                that.parserLength = -1;
                that.parserBuffer = Buffer.alloc(0);
                this.logger("Error: Incorrect data length");
            }
        }

        if (that.parserBuffer.length >= that.parserLength) {
            let emitBuffer = that.parserBuffer.slice(0, that.parserLength);
            that.parserBuffer = that.parserBuffer.slice(that.parserLength);
            that.parserLength = -1;

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

        if ((typeof that.incomingData === 'function') && (data[0] == that.CMD_START) && (data[1] == that.CMD_DATA_IND)) { // telegram received
            if (that.calcChecksum(data) == data[data.length - 1]) {
                let rssi = -1;
                let payload;
                if (that.rssiEnabled) {
                    rssi = data[data.length - 2];
                    rssi = (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);
                    payload = data.slice(2, data.length - 2);
                    payload[0] = payload[0] - 1;
                } else {
                    payload = data.slice(2, data.length - 1);
                }
                if (!that.frame_type) {
                    that.getFrameType(function (type) {
                        that.frame_type = (type ? type : 'A');
                        that.incomingData({frame_type: that.frame_type, contains_crc: false, raw_data: payload, rssi: rssi, ts: new Date().getTime()});
                    });
                    return;
                }
                that.incomingData({frame_type: that.frame_type, contains_crc: false, raw_data: payload, rssi: rssi, ts: new Date().getTime()});
            } else {
                this.logger("CRC error");
                this.logFunc(data);
            }
        } else {
            this.logger("Data but no callback!");
            this.logFunc(data);
        }
    }

    getRSSI(callback) {
        this.sendPackage(this.CMD_RSSI_REQ, function(res, err) {
            if (err) {
                callback && callback(-1);
                return;
            }
            let rssi = res.payload[0];
            rssi = (rssi >= 0x80 ? (rssi - 0x100) / 2 - 74 : rssi / 2 - 74);
            callback && callback(rssi);
        });
    }

    setMode(mode, callback) {
        if (mode > 0x0F) {
            callback && callback(undefined, { message: "Unknown mode!" });
            return;
        }
        this.sendPackage(this.CMD_SET_MODE_REQ, [mode], callback);
    }

    reset(callback) {
        this.sendPackage(this.CMD_RESET_REQ, callback);
    }

    factoryReset(callback) {
        let that = this;
        this.sendPackage(this.CMD_FACTORYRESET_REQ, function(res, err) {
            if (err) {
                callback && callback(undefined, err);
                return;
            }
            if (res.payload[0] == 0x00) {
                that.reset(callback);
            }
        });
    }

    setChannel(channel, callback) {
        if (channel > 0x0F) {
            callback && callback(undefined, { message: "Unknown channel!" });
            return;
        }
        this.sendPackage(this.CMD_SET_CHANNEL_REQ, [channel], function(res, err) {
            if (err) {
                callback && callback(undefined, err);
                return;
            }
            callback && callback(res.payload[0]);
        });
    }

    getSerialNo(callback) {
        this.sendPackage(this.CMD_SERIALNO_REQ, function(res, err) {
            if (err) {
                callback && callback(undefined, err);
                return;
            }
            let serial = res.payload.readUInt32BE(0);
            callback && callback(serial);
        });
    }

    getFWVersion(callback) {
        this.sendPackage(this.CMD_FWV_REQ, function(res, err) {
            if (err) {
                callback && callback(undefined, err);
                return;
            }
            let fw = res.payload[0].toString() + "." + res.payload[1].toString() + "." + res.payload[2].toString();
            callback && callback(fw);
        });
    }

    setUARTSpeed(baudrate, callback) {
        if (baudrate > 0x07) {
            callback && callback(undefined, { message: "Undefined baud rate!" });
            return;
        }
        this.sendPackage(this.CMD_SETUARTSPEED_REQ, [baudrate], function(res, err) {
            if (err) {
                callback && callback(undefined, err);
                return;
            }
            if (res.payload[0] == 0x00) {
                callback && callback(true);
            } else {
                callback && callback(false, res.payload[0]);
            }
        });
    }

    isRSSIEnabled(callback) {
        this.sendPackage(this.CMD_GET_REQ, [0x45, 0x01], function(res, err) {
            if (err) {
                callback && callback(undefined);
                return;
            }
            callback && callback(res.payload[2]);
        });
    }

    isCMDOutEnabled(callback) {
        this.sendPackage(this.CMD_GET_REQ, [0x05, 0x01], function(res, err) {
            if (err) {
                callback && callback(undefined);
                return;
            }
            callback && callback(res.payload[2]);
        });
    }

    getFrameType(callback) {
        this.sendPackage(this.CMD_GET_REQ, [0x2C, 0x01], function (res, err) {
            if (err || (res.payload[2] == 0x00)) {
                callback && callback(undefined);
                return;
            }
            callback && callback(res.payload[0] == 0x02 ? 'B' : 'A');
        });
    }

    setCMDOutEnabled(flag, callback) {
        flag = (flag ? 0x01 : 0x00);
        let that = this;
        this.sendPackage(this.CMD_SET_REQ, [0x05, 0x01, flag], function(res, err) {
            if (err || (res.payload[0] != 0x00)) {
                callback && callback((res.payload[0] == 0x01 ? "Error: verification failed" : "Error: invalid memory position or invalid number of bytes"));
                return;
            }

            that.reset(callback);
            return;
        });
    }

    getAutosleep(callback) {
        this.sendPackage(this.CMD_GET_REQ, [0x3F, 0x01], function(res, err) {
            if (err) {
                callback && callback(undefined);
                return;
            }
            callback && callback(res.payload[2]);
        });
    }

    initSecondStage() {
        let that = this;
        // check if RSSI is enabled
        that.isRSSIEnabled(function (res) {
            if (typeof res !== 'undefined') {
                this.rssiEnabled = (res ? true : false);
                this.logger("RSSI is " + (res ? "enabled" : "disnabled"));

                //check if auto sleep is disabled
                this.getAutosleep(function (res) {
                    if (typeof res !== 'undefined') {
                        if (res != 0x00) {
                            this.logger("WARNING: Auto sleep is not disabled. Messages " + (res == 2 ? "will" : "might") + " get lost!");
                        } else {
                            this.logger("Autosleep is disabled");
                        }
                    }
                }.bind(this));
            }
        }.bind(that));
    }

    init(dev, opts, mode) {
        let that = this;
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));
        let ch = 0x08;
        let txt = "T-Mode";
        switch (mode) {
            case 'C': ch = 0x0E; txt = "C-Mode"; break;
            case 'S': ch = 0x03; txt = "S-Mode"; break;
            case 'CT': ch = 0x09; txt = "combined C/T-Mode"; break;
        }
        this.setMode(ch, function(res, err) {
            if (err || (res.payload[0] != 0x00)) {
                that.logger("Error setting wMBus mode: " + (err ? err.message : "response was " + res.payload[0]));
                this.port.close();
                return;
            }
            that.logger("Receiver channel set to " + txt);
            that.channel = ch;
            if ((ch != 0x09) && (ch != 0x0E)) {
                that.frame_type = 'A';
            }

            that.isCMDOutEnabled(function (res) {
                if (typeof res !== 'undefined') {
                    if (res == 0x00) {
                        this.logger("Enabling UART_CMD_Out...");
                        this.setCMDOutEnabled(true, function(res, err) {
                            if (err || (res.payload[0] != 0x00)) {
                                this.logger("Error enabling CMDOut: " + (err ? err.message : "response was " + res.payload[0]));
                                this.port.close();
                                return;
                            }
                            this.logger("Enabled UART_CMD_Out; wait for 500 msec");
                            setTimeout(this.initSecondStage.bind(this), 500);
                        }.bind(this));
                        return;
                    }
                    this.logger("UART_CMD_Out is enabled");
                    this.initSecondStage();
                }
            }.bind(that));
        });
    }
}

module.exports = AMBER_WMBUS;
