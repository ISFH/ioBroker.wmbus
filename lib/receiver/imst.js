const SerialPort = require('serialport');

class CRC {
    constructor(polynom, initValue, finalXor) {
        this.polynom = (typeof polynom !== 'undefined' ? polynom : 0x1021);
        this.initValue = (typeof initValue !== 'undefined' ? initValue : 0xFFFF);
        this.finalXor = (typeof finalXor !== 'undefined' ? finalXor : 0xFFFF);
        this.table = [];
        for (var i = 0; i < 256; i++) {
            var r = i << 8;
            for (var j = 0; j < 8; j++) {
                if (r & (1 << 15)) {
                    r = (r << 1) ^ this.polynom;
                } else {
                    r = (r << 1);
                }
            }
            this.table[i] = r;
        }
    }

    calc(data) {
        if (!Buffer.isBuffer(data)) {
            data = Buffer.from(data);
        }
        let that = this;
        let chk = this.initValue;
        data.forEach(function(n) {
            let val = ((n & 0x80) >> 7) | ((n & 0x40) >> 5) | ((n & 0x20) >> 3) | ((n & 0x10) >> 1) | ((n & 0x08) << 1) | ((n & 0x04) << 3) | ((n & 0x02) << 5) | ((n & 0x01) << 7);
            chk = that.table[((chk >> 8) ^ val) & 0xFF] ^ (chk << 8);
        });
        chk ^= this.finalXor;
        chk &= 0xFFFF;
        let n = chk & 0xFF;
        let clow = ((n & 0x80) >> 7) | ((n & 0x40) >> 5) | ((n & 0x20) >> 3) | ((n & 0x10) >> 1) | ((n & 0x08) << 1) | ((n & 0x04) << 3) | ((n & 0x02) << 5) | ((n & 0x01) << 7);
        n = (chk >> 8) & 0xFF;
        let chigh = ((n & 0x80) >> 7) | ((n & 0x40) >> 5) | ((n & 0x20) >> 3) | ((n & 0x10) >> 1) | ((n & 0x08) << 1) | ((n & 0x04) << 3) | ((n & 0x02) << 5) | ((n & 0x01) << 7);
        return (chigh << 8) | clow;
    }
}

class IMST_WMBUS {
    constructor(logger) {
        this.logFunc = (typeof logger === 'function' ? logger : console.log);
        this.crc = new CRC();

        //Endpoint Identifier
        this.DEVMGMT_ID = 0x01;
        this.RADIOLINK_ID = 0x02;
        this.RADIOLINKTEST_ID = 0x03;
        this.HWTEST_ID = 0x04;

        //Device Management Message Identifier
        this.DEVMGMT_MSG_PING_REQ = 0x01;
        this.DEVMGMT_MSG_PING_RSP = 0x02;
        this.DEVMGMT_MSG_SET_CONFIG_REQ = 0x03;
        this.DEVMGMT_MSG_SET_CONFIG_RSP = 0x04;
        this.DEVMGMT_MSG_GET_CONFIG_REQ = 0x05;
        this.DEVMGMT_MSG_GET_CONFIG_RSP = 0x06;
        this.DEVMGMT_MSG_RESET_REQ = 0x07;
        this.DEVMGMT_MSG_RESET_RSP = 0x08;
        this.DEVMGMT_MSG_FACTORY_RESET_REQ = 0x09;
        this.DEVMGMT_MSG_FACTORY_RESET_RSP = 0x0A;
        this.DEVMGMT_MSG_GET_OPMODE_REQ = 0x0B;
        this.DEVMGMT_MSG_GET_OPMODE_RSP = 0x0C;
        this.DEVMGMT_MSG_SET_OPMODE_REQ = 0x0D;
        this.DEVMGMT_MSG_SET_OPMODE_RSP = 0x0E;
        this.DEVMGMT_MSG_GET_DEVICEINFO_REQ = 0x0F;
        this.DEVMGMT_MSG_GET_DEVICEINFO_RSP = 0x10;
        this.DEVMGMT_MSG_GET_SYSSTATUS_REQ = 0x11;
        this.DEVMGMT_MSG_GET_SYSSTATUS_RSP = 0x12;
        this.DEVMGMT_MSG_GET_FWINFO_REQ = 0x13;
        this.DEVMGMT_MSG_GET_FWINFO_RSP = 0x14;
        this.DEVMGMT_MSG_GET_RTC_REQ = 0x19;
        this.DEVMGMT_MSG_GET_RTC_RSP = 0x1A;
        this.DEVMGMT_MSG_SET_RTC_REQ = 0x1B;
        this.DEVMGMT_MSG_SET_RTC_RSP = 0x1C;
        this.DEVMGMT_MSG_ENTER_LPM_REQ = 0x1D;
        this.DEVMGMT_MSG_ENTER_LPM_RSP = 0x1E;
        this.DEVMGMT_MSG_SET_AES_ENCKEY_REQ = 0x21;
        this.DEVMGMT_MSG_SET_AES_ENCKEY_RSP = 0x22;
        this.DEVMGMT_MSG_ENABLE_AES_ENCKEY_REQ = 0x23;
        this.DEVMGMT_MSG_ENABLE_AES_ENCKEY_RSP = 0x24;
        this.DEVMGMT_MSG_SET_AES_DECKEY_RSP = 0x25;
        this.DEVMGMT_MSG_SET_AES_DECKEY_RSP = 0x26;
        this.DEVMGMT_MSG_AES_DEC_ERROR_IND = 0x27;

        //Radio Link Message Identifier
        this.RADIOLINK_MSG_WMBUSMSG_REQ = 0x01;
        this.RADIOLINK_MSG_WMBUSMSG_RSP = 0x02;
        this.RADIOLINK_MSG_WMBUSMSG_IND = 0x03;
        this.RADIOLINK_MSG_DATA_REQ = 0x04;
        this.RADIOLINK_MSG_DATA_RSP = 0x05;

        //Radio Link Test Message Identifier
        this.RADIOLINKTEST_MSG_START_REQ = 0x01;
        this.RADIOLINKTEST_MSG_START_RSP = 0x02;
        this.RADIOLINKTEST_MSG_STOP_REQ = 0x03;
        this.RADIOLINKTEST_MSG_STOP_RSP = 0x04;
        this.RADIOLINKTEST_MSG_STATUS_IND = 0x07;

        //Hardware Test Message Identifier
        this.HWTEST_MSG_RADIOTEST_REQ = 0x01;
        this.HWTEST_MSG_RADIOTEST_RSP = 0x02;

        //Link modes
        this.LINK_MODE_S1 = 0x00;
        this.LINK_MODE_S1m = 0x01;
        this.LINK_MODE_S2 = 0x02;
        this.LINK_MODE_T1 = 0x03;
        this.LINK_MODE_T2 = 0x04;
        this.LINK_MODE_R2 = 0x05;
        this.LINK_MODE_C1A = 0x06;
        this.LINK_MODE_C1B = 0x07;
        this.LINK_MODE_C2A = 0x08;
        this.LINK_MODE_C2B = 0x09;

        this.CMD_START = 0xA5;

        this.port = null;

        this.parserBuffer = Buffer.alloc(0);
        this.parserLength = -1;

        this.readCallbacks = [];
        this.readTimeouts = [];

        this.rssiEnabled = false;
        this.channel = 0;
        this.frame_type = 'A';
    }
    
    logger(msg) {
        this.logFunc("IMST: " + msg);
    }

    calcChecksum(data) {
        return this.crc.calc(data.slice(1, data.length - 2));
    }

    //SOF  ControlField EndPointID MsgIDField LengthField PayloadField TimeStampOpt RSSIOpt FCSOpt
    //8bit 4bit         4bit       8bit       8bit        L bytes      32bit        8bit    16bit    
    buildPayloadPackage(endpoint_id, msg_id, crc, payload) {
        let that = this;
        if (!Buffer.isBuffer(payload)) {
            if (typeof payload === 'undefined') {
                payload = Buffer.alloc(0);
            } else {
                payload = Buffer.from(payload);
            }
        }

        let res = Buffer.alloc(4 + payload.length + 2);
        res[0] = this.CMD_START;
        res[1] = (crc ? 0x80 : 0x00) | endpoint_id;
        res[2] = msg_id;
        res[3] = payload.length;
        payload.copy(res, 4);
        if (crc) {
            let csum = that.calcChecksum(res);
            res[res.length - 1] = csum & 0xFF;
            res[res.length - 2] = (csum >> 8) & 0xFF;
        }
        return res;
    }

    readPayloadPackage(msg_id, callback) {
        let that = this;
        let msg_id_read = msg_id + 1; //ok?

        that.readCallbacks.push(function(data) {
            if (!Buffer.isBuffer(data) || (data[0] != that.CMD_START)) {
                callback && callback({endpoint_id: 0, msg_id: 0, payload: Buffer.alloc(0), ts: 0, rssi: 0, crc_ok: false});
            } else {
                let control = data[1] >> 4;
                let end_id = data[1] & 0x0F;
                let tsField = (control & 0b0010 ? true : false);
                let rssiField = (control & 0b0100 ? true : false);
                let crcField = (control & 0b1000 ? true : false);
                let return_id = data[2];
                let payloadlength = data[3];
                let pos = payloadlength + 4;
                let ts = (tsField ? data.readUInt32LE(pos) : new Date().getTime());
                if (tsField) { pos += 4; }
                let rssi = (rssiField ? (8.0/15.0 * data[pos++]) - 380.0/3.0  : -1);
                let crc = (crcField ? data.readUInt16BE(pos++) : 0);
                let payload = data.slice(4, payloadlength + 4);

                if (crcField) {
                    if (that.calcChecksum(data) != crc) {
                        callback && callback(undefined, { message: 'Incorrect checksum' });
                        return;
                    }
                }

                if (msg_id_read == return_id) {
                    callback && callback({endpoint_id: end_id, msg_id: return_id, payload: payload, ts: ts, rssi: rssi, crc_ok: true});
                } else {
                    callback && callback(undefined, { message: 'The data received has a different confirmation ID than expected' });

                }
            }
        });

        that.readTimeouts.push(setTimeout(function() {
            that.logger("Message response timeout");
            that.readCallbacks.shift();
            that.readTimeouts.shift();
            callback && callback({endpoint_id: 0, msg_id: 0, payload: Buffer.alloc(0), ts: 0, rssi: 0, crc_ok: false});
        }, 3000));
    }

    sendPackage(msg_id, payload, callback) {
        let that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = Buffer.alloc(0);
        }

        let pkg = that.buildPayloadPackage(this.DEVMGMT_ID, msg_id, true, payload);

        that.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }

            that.readPayloadPackage(msg_id, function(res, err) {
                if (err) {
                    callback && callback(undefined, err);
                    return;
                }

                if (res.crc_ok) {
                    callback && callback(res); 
                    return;
                }
            });
        });
    }

    onData(data) {
        let that = this;
        that.parserBuffer = Buffer.concat([that.parserBuffer, data]);

        if (that.parserLength == -1) {
            if (that.parserBuffer.length < 4) {
                return;
            }
            let control = that.parserBuffer[1] >> 4;
            let add = (control & 0b0010 ? 4 : 0) + (control & 0b0100 ? 1 : 0) + (control & 0b1000 ? 2 : 0)
            that.parserLength = that.parserBuffer[3] + 4 + add;

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

        if ((typeof that.incomingData === 'function') && (data[0] == that.CMD_START) && ((data[1] & 0x0F) == that.RADIOLINK_ID)) { // telegram received
            let control = data[1] >> 4;
            let end_id = data[1] & 0x0F;
            let tsField = (control & 0b0010 ? true : false);
            let rssiField = (control & 0b0100 ? true : false);
            let crcField = (control & 0b1000 ? true : false);
            let return_id = data[2];
            let payloadlength = data[3];
            let pos = payloadlength + 4;
            let ts = (tsField ? data.readUInt32LE(pos) : new Date().getTime());
            if (tsField) { pos += 4; }
            let rssi = (rssiField ? (8.0/15.0 * data[pos++]) - 380.0/3.0  : -1);
            let crc = (crcField ? data.readUInt16BE(pos++) : 0);
            let payload = data.slice(3, payloadlength + 4);

            if (crcField && (that.calcChecksum(data) != crc)) {
                this.logger("CRC error");
                this.logFunc(data);
                return;
            }

            that.incomingData({frame_type: that.frame_type, contains_crc: false, raw_data: payload, rssi: rssi, ts: ts});
        } else {
            this.logger("Data but no callback!");
            this.logFunc(data);
        }
    }

    setMode(mode, callback) { // and also disable sleep mode - not saved to nvm
        this.frame_type = ((mode == this.LINK_MODE_C1B) || (mode == this.LINK_MODE_C2B) ? 'B': 'A');
        if (mode > 0x09) {
            callback && callback(undefined, { message: "Invalid mode!" });
            return;
        }
        let that = this;
        this.sendPackage(this.DEVMGMT_MSG_SET_CONFIG_REQ, Buffer.from([0x00, 0x03, 0x00, mode, 0x08, 0x00]), function (res, err) {
            if (err || res.msg_id != that.DEVMGMT_MSG_SET_CONFIG_RSP) {
                that.logger("Error setting link mode " + mode);
                callback && callback(false);
                return;
            }
            callback && callback(true);
        });            
    }


    init(dev, opts, mode) {
        let that = this;
        mode = (typeof mode !== 'undefined' ? mode : "T");
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));
        let m = this.LINK_MODE_T1;
        switch (mode) {
            case "S": m = this.LINK_MODE_S1; break;
            case "CA": m = this.LINK_MODE_C1A; break;
            case "CB": m = this.LINK_MODE_C1B; break;
            case "T": m = this.LINK_MODE_T1; break;
        }
        this.setMode(m, function(res) {
            if (!res) {
                that.logger("Error setting wMBus mode: " + mode);
                this.port.close();
                return;
            }
            that.logger("Receiver mode set to " + mode + " mode");
        });        
    }
}

module.exports = IMST_WMBUS;
