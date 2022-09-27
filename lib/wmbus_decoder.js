/*
 *
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * This work is part of the ioBroker wmbus adapter
 * and is licensed under the terms of the GPL2 license.
 * Copyright (C) 2019 ISFH
 *
 * ported from FHEM WMBus.pm # $Id: WMBus.pm 8659 2015-05-30 14:41:28Z kaihs $
 *           http://www.fhemwiki.de/wiki/WMBUS
 * extended by soef
 *
 * 'partially re-ported' at 2019-Jan-04 by Christian Landvogt
 * git-svn-id: https://svn.fhem.de/fhem/trunk@18058 2b470e98-0d58-463d-a4d8-8e2adae1ed80
 *
 * many bugfixes, refactoring and additional features by Christian Landvogt
 *
 */

const crypto = require('crypto');
const aesCmac = require('node-aes-cmac').aesCmac;
const VIFInfo = require('./vifinfo.js');
let tchDecoder;
try {
    tchDecoder = require('./tch-decoder.js');
} catch (ex) {
    tchDecoder = function() { return false; };
}
let priosDecoder;
try {
    priosDecoder = require('./prios-decoder.js');
} catch (ex) {
    priosDecoder = function() { return false; };
}


class CRC {
    constructor(polynom, initValue, finalXor) {
        this.polynom = (typeof polynom !== 'undefined' ? polynom : 0x3D65);
        this.initValue = (typeof initValue !== 'undefined' ? initValue : 0);
        this.finalXor = (typeof finalXor !== 'undefined' ? finalXor : 0xFFFF);
        this.table = [];
        for (let i = 0; i < 256; i++) {
            let r = i << 8;
            for (let j = 0; j < 8; j++) {
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

        const that = this;

        let chk = this.initValue;
        data.forEach(function(val) {
            chk = that.table[((chk >> 8) ^ val) & 0xFF] ^ (chk << 8);
        });
        chk ^= this.finalXor;
        chk &= 0xFFFF;
        return chk;
    }
}

class WMBUS_DECODER {
    constructor(logger, drCache) {
        this.logger = {};
        if (typeof logger === 'undefined') {
            this.logger.debug = console.log;
            this.logger.error = console.log;
        } else if (typeof logger === 'function') {
            this.logger.debug = logger;
            this.logger.error = logger;
        } else {
            this.logger.debug = (typeof logger.debug === 'function' ? logger.debug : function() {});
            this.logger.error = (typeof logger.error === 'function' ? logger.error : function() {});
        }

        this.crc = new CRC();
        this.drCache = [];

        this.constant = {
            // Data Link Layer
            DLL_SIZE: 10,
            // block size
            FRAME_A_BLOCK_SIZE: 16,
            FRAME_B_BLOCK_SIZE: 128,
            AES_BLOCK_SIZE: 16,

            // sent by meter
            SND_NR: 0x44, // Send, no reply
            SND_IR: 0x46, // Send installation request, must reply with CNF_IR
            ACC_NR: 0x47,
            ACC_DMD: 0x48,

            // sent by controller
            SND_NKE: 0x40, // Link reset
            CNF_IR: 0x06,

            // CI field
            CI_RESP_4: 0x7a,  // Response from device, 4 Bytes
            CI_RESP_12: 0x72, // Response from device, 12 Bytes
            CI_RESP_0: 0x78,  // Response from device, 0 Byte header, variable length
            CI_ERROR: 0x70,   // Error from device, only specified for wired M-Bus but used by Easymeter WMBUS module
            CI_TL_4: 0x8a,    // Transport layer from device, 4 Bytes
            CI_TL_12: 0x8b,   // Transport layer from device, 12 Bytes

            // see https://www.telit.com/wp-content/uploads/2017/09/Telit_Wireless_M-bus_2013_Part4_User_Guide_r14.pdf, 2.3.4
            CI_ELL_2: 0x8c,   // Extended Link Layer, 2 Bytes - OMS
            CI_ELL_8: 0x8d,   // Extended Link Layer, 8 Bytes
            CI_ELL_10: 0x8e,  // Extended Link Layer, 10 Bytes - OMS
            CI_ELL_16: 0x8f,  // Extended Link Layer, 16 Bytes

            CI_AFL: 0x90,     // Authentification and Fragmentation Layer, variable size
            CI_RESP_SML_4: 0x7e, // Response from device, 4 Bytes, application layer SML encoded
            CI_RESP_SML_12: 0x7f, // Response from device, 12 Bytes, application layer SML encoded
            CI_SND_UD_MODE_1: 0x51, // The master can send data to a slave using a SND_UD with CI-Field 51h for mode 1 or 55h for mode 2

            // DIF types (Data Information Field), see page 32
            DIF_NONE: 0x00,
            DIF_INT8: 0x01,
            DIF_INT16: 0x02,
            DIF_INT24: 0x03,
            DIF_INT32: 0x04,
            DIF_FLOAT32: 0x05,
            DIF_INT48: 0x06,
            DIF_INT64: 0x07,
            DIF_READOUT: 0x08,
            DIF_BCD2: 0x09,
            DIF_BCD4: 0x0a,
            DIF_BCD6: 0x0b,
            DIF_BCD8: 0x0c,
            DIF_VARLEN: 0x0d,
            DIF_BCD12: 0x0e,
            DIF_SPECIAL: 0x0f,

            DIF_IDLE_FILLER: 0x2f,

            DIF_EXTENSION_BIT: 0x80,

            VIF_EXTENSION: 0xFB, // true VIF is given in the first VIFE and is coded using table 8.4.4 b) (128 new VIF-Codes)
            VIF_EXTENSION_BIT: 0x80,

            ERR_NO_ERROR: 0,
            ERR_CRC_FAILED: 1,
            ERR_UNKNOWN_VIFE: 2,
            ERR_UNKNOWN_VIF: 3,
            ERR_TOO_MANY_DIFE: 4,
            ERR_UNKNOWN_LVAR: 5,
            ERR_UNKNOWN_DATAFIELD: 6,
            ERR_UNKNOWN_CIFIELD: 7,
            ERR_DECRYPTION_FAILED: 8,
            ERR_NO_AESKEY: 9,
            ERR_UNKNOWN_ENCRYPTION: 10,
            ERR_TOO_MANY_VIFE: 11,
            ERR_MSG_TOO_SHORT: 12,
            ERR_SML_PAYLOAD: 13,
            ERR_FRAGMENT_UNSUPPORTED: 14,
            ERR_UNKNOWN_COMPACT_FORMAT: 15,
            ERR_CIPHER_NOT_INSTALLED: 16,
            ERR_LINK_LAYER_INVALID: 17,

            VIF_TYPE_MANUFACTURER_SPECIFIC: 'MANUFACTURER SPECIFIC',

            // TYPE C transmission uses two different frame types
            // see http://www.st.com/content/ccc/resource/technical/document/application_note/3f/fb/35/5a/25/4e/41/ba/DM00233038.pdf/files/DM00233038.pdf/jcr:content/translations/en.DM00233038.pdf
            FRAME_TYPE_A: 'A',
            FRAME_TYPE_B: 'B',
            FRAME_TYPE_WIRED: 'W',
        };

        // see 4.2.3, page 24
        this.validDeviceTypes = {
            0x00: 'Other',
            0x01: 'Oil',
            0x02: 'Electricity',
            0x03: 'Gas',
            0x04: 'Heat',
            0x05: 'Steam',
            0x06: 'Warm Water (30 °C ... 90 °C)',
            0x07: 'Water',
            0x08: 'Heat Cost Allocator',
            0x09: 'Compressed Air',
            0x0a: 'Cooling load meter (Volume measured at return temperature: outlet)',
            0x0b: 'Cooling load meter (Volume measured at flow temperature: inlet)',
            0x0c: 'Heat (Volume measured at flow temperature: inlet)',
            0x0d: 'Heat / Cooling load meter',
            0x0e: 'Bus / System component',
            0x0f: 'Unknown Medium',
            0x10: 'Reserved for utility meter',
            0x11: 'Reserved for utility meter',
            0x12: 'Reserved for utility meter',
            0x13: 'Reserved for utility meter',
            0x14: 'Calorific value',
            0x15: 'Hot water (> 90 °C)',
            0x16: 'Cold water',
            0x17: 'Dual register (hot/cold) Water meter',
            0x18: 'Pressure',
            0x19: 'A/D Converter',
            0x1a: 'Smokedetector',
            0x1b: 'Room sensor (e.g. temperature or humidity)',
            0x1c: 'Gasdetector',
            0x1d: 'Reserved for sensors',
            0x1e: 'Reserved for sensors',
            0x1f: 'Reserved for sensors',
            0x20: 'Breaker (electricity)',
            0x21: 'Valve (gas)',
            0x22: 'Reserved for switching devices',
            0x23: 'Reserved for switching devices',
            0x24: 'Reserved for switching devices',
            0x25: 'Customer unit (Display device)',
            0x26: 'Reserved for customer units',
            0x27: 'Reserved for customer units',
            0x28: 'Waste water',
            0x29: 'Garbage',
            0x2a: 'Carbon dioxide',
            0x2b: 'Environmental meter',
            0x2c: 'Environmental meter',
            0x2d: 'Environmental meter',
            0x2e: 'Environmental meter',
            0x2f: 'Environmental meter',
            0x31: 'OMS MUC',
            0x32: 'OMS unidirectional repeater',
            0x33: 'OMS bidirectional repeater',
            0x37: 'Radio converter (Meter side)',
            0x43: 'Heat meter (TCH)',
            0x62: 'Hot water meter (TCH)',
            0x72: 'Cold water meter (TCH)',
            0x80: 'Heat cost allocator (TCH)',
            0xF0: 'Smoke detector (TCH)',
        };

        // bitfield, errors can be combined, see 4.2.3.2 on page 22
        this.validStates = {
            0x00: 'no errors',
            0x01: 'application busy',
            0x02: 'any application error',
            0x03: 'abnormal condition/alarm',
            0x04: 'battery low',
            0x08: 'permanent error',
            0x10: 'temporary error',
            0x20: 'specific to manufacturer',
            0x40: 'specific to manufacturer',
            0x80: 'specific to manufacturer',
        };

        this.encryptionModes = {
            0x00: 'standard unsigned',
            0x01: 'signed data telegram',
            0x02: 'static telegram (DES)',
            0x03: 'reserved (DES?)',
            0x04: 'AES128-CBC static initialisation vector',
            0x05: '(OMS) AES128-CBC persistent symmetric key',
            0x06: 'reserved',
            0x07: '(OMS) AES128-CBC ephemeral symmetric key',
            0x08: 'reserved',
            0x09: 'reserved',
            0x0A: 'reserved',
            0x0B: 'reserved',
            0x0C: 'reserved',
            0x0D: '(OMS) Asymetric encryption using TLS'
        };

        this.functionFieldTypes = {
            0b00: 'Instantaneous value',
            0b01: 'Maximum value',
            0b10: 'Minimum value',
            0b11: 'Value during error state',
        };

        this.errorCode = this.constant.ERR_NO_ERROR;
        this.errorMessage = '';
        this.frame_type = this.constant.FRAME_TYPE_A; // default
        this.alreadyDecrypted = false;
        this.enableDataRecordCache = (typeof drCache !== 'undefined' ? drCache : false);

    } // constructor end

    formatDate(date, format) {
        function pad(num) {
            return num < 10 ? '0' + num : '' + num;
        }

        let s = format.replace('YYYY', date.getFullYear());
        s = s.replace('MM', pad(date.getMonth()+1));
        s = s.replace('DD', pad(date.getDate()));
        s = s.replace('hh', pad(date.getHours()));
        s = s.replace('mm', pad(date.getMinutes()));
        return s;
    }

    valueCalcNumeric(value, VIB) {
        let num = value * VIB.valueFactor;
        if (VIB.valueFactor < 1 && num.toFixed(0) != num) {
            num = num.toFixed(VIB.valueFactor.toString().length - 2);
        }
        return num;
    }

    valueCalcDate(value, VIB) {  // eslint-disable-line no-unused-vars
        //value is a 16bit int

        //day: UI5 [1 to 5] <1 to 31>
        //month: UI4 [9 to 12] <1 to 12>
        //year: UI7[6 to 8,13 to 16] <0 to 99>

        //   YYYY MMMM YYY DDDDD
        // 0b0000 1100 111 11111 = 31.12.2007
        // 0b0000 0100 111 11110 = 30.04.2007

        const day = (value & 0b11111);
        const month = ((value & 0b111100000000) >> 8);
        const year = (((value & 0b1111000000000000) >> 9) | ((value & 0b11100000) >> 5)) + 2000;
        if (day > 31 || month > 12) {
            this.logger.debug('invalid date: ' + value);
            //return "invalid: " + value;
        }
        const date = new Date(year, month-1, day);
        return this.formatDate(date, 'YYYY-MM-DD');
    }

    valueCalcDateTime(value, VIB) {
        // min: UI6 [1 to 6] <0 to 59>
        // hour: UI5 [9 to13] <0 to 23>
        // day: UI5 [17 to 21] <1 to 31>
        // month: UI4 [25 to 28] <1 to 12>
        // year: UI7[22 to 24,29 to 32] <0 to 99>
        //  IV:
        //  B1[8] {time invalid}:
        //  IV<0> :=
        // valid,
        // IV>1> := invalid
        // SU: B1[16] {summer time}:
        // SU<0> := standard time,
        // SU<1> := summer time
        // RES1: B1[7] {reserved}: <0>
        // RES2: B1[14] {reserved}: <0>
        // RES3: B1[15] {reserved}: <0>

        const datePart = value >> 16;
        const timeInvalid = value & 0b10000000;

        let dateTime = this.valueCalcDate(datePart, VIB);
        if (timeInvalid == 0) {
            const min = (value & 0b111111);
            const hour = (value >> 8) & 0b11111;
            const su = (value & 0b1000000000000000);
            if (min > 59 || hour > 23) {
                dateTime = 'invalid: ' + value;
            } else {
                const date = new Date(0);
                date.setHours(hour);
                date.setMinutes(min);
                dateTime += ' ' + this.formatDate(date, 'hh:mm') + (su ? ' DST' : '');
            }
        }
        return dateTime;
    }

    valueCalcHex(value, VIB) { // eslint-disable-line no-unused-vars
        return value.toString(16);
    }

    valueCorrectionAdd(ext, VIB) {
        const exponent = ext.vif & ext.info.expMask;
        const value = Math.pow(10, exponent + ext.info.bias);
        VIB.value += value;
    }

    valueCorrectionMult(ext, VIB) {
        const exponent = ext.vif & ext.info.expMask;
        const value = Math.pow(10, exponent + ext.info.bias);
        VIB.value *= value;

        if (value < 1 && VIB.value.toFixed(0) != VIB.value) {
            VIB.value = VIB.value.toFixed(value.toString().length - 2);
        }
    }

    valueExtDescription(ext, VIB) {
        VIB.description += (VIB.description.length ? '; ' : '') + ext.info.unit;
    }

    valueExtUnit(ext, VIB) {
        VIB.unit += (VIB.unit.length ? ' ' : '') + ext.info.unit;
    }

    valueDurationDescription(ext, VIB) {
        const value = (ext.vif & ext.info.expMask) + ext.info.bias;
        VIB.description += (VIB.description.length ? '; ' : '') + ext.info.unit + ': ' + value.toString();
    }

    valueCalcTimeperiod(value, VIB) {
        switch (VIB.exponent) {
            case 0: VIB.unit = 's'; break;
            case 1: VIB.unit = 'min'; break;
            case 2: VIB.unit = 'h'; break;
            case 3: VIB.unit = 'd'; break;
            default: VIB.unit = '';
        }
        return value;
    }

    valueCalcTimeperiodPP(value, VIB) {
        switch (VIB.exponent) {
            case 0: VIB.unit = 'h'; break;
            case 1: VIB.unit = 'd'; break;
            case 2: VIB.unit = 'months'; break;
            case 3: VIB.unit = 'years'; break;
            default: VIB.unit = '';
        }
        return value;
    }

    valueCalcMap(type) {
        switch (type) {
            case 'numeric': return this.valueCalcNumeric;
            case 'date': return this.valueCalcDate;
            case 'datetime': return this.valueCalcDateTime;
            case 'hex': return this.valueCalcHex;
            case 'timeperiod': return this.valueCalcTimeperiod;
            case 'timeperiodPP': return this.valueCalcTimeperiodPP;
            case 'correctionAdd': return this.valueCorrectionAdd;
            case 'correctionMult': return this.valueCorrectionMult;
            case 'extendDescription': return this.valueExtDescription;
            case 'extendUnit': return this.valueExtUnit;
            case 'duration': return this.valueDurationDescription;
            default: return '';
        }
    }

    type2string(type) {
        return this.validDeviceTypes[type] || 'unknown' ;
    }

    state2string(state) {
        const result = [];
        if (state) {
            for (const i in this.validStates) {
                if (i & state) {
                    result.push(this.validStates[i]);
                }
            }
        } else {
            result.push(this.validStates[0]);
        }
        return result;
    }

    manId2hex(idascii) {
        return (idascii.charCodeAt(0) - 64) << 10 | (idascii.charCodeAt(1) - 64) << 5 | (idascii.charCodeAt(2) - 64);
    }

    manId2ascii(idhex) {
        return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & 0x1f) + 64) + String.fromCharCode((idhex & 0x1f) + 64);
    }

    decodeConfigword(cw) {
        this.config = {};

        this.config.mode = (cw & 0b0001111100000000) >> 8;
        switch (this.config.mode) {
            case 0:
            case 5:
                this.config.bidirectional    = (cw & 0b1000000000000000) >> 15; /* mode 5 */
                this.config.accessability    = (cw & 0b0100000000000000) >> 14; /* mode 5 */
                this.config.synchronous      = (cw & 0b0010000000000000) >> 13; /* mode 5 */
                /* 0b0001111100000000 - mode */
                this.config.encrypted_blocks = (cw & 0b0000000011110000) >> 4;  /* mode 5 + 7 */
                this.config.content          = (cw & 0b0000000000001100) >> 2;  /* mode 5 */
                this.config.hop_counter      = (cw & 0b0000000000000011);       /* mode 5 */
                break;
            case 7:
                this.config.content          = (cw & 0b1100000000000000) >> 14; /* mode 7 + 13 */
                /* 0b0010000000000000 - reserved for counter size */
                /* 0b0001111100000000 - mode */
                this.config.encrypted_blocks = (cw & 0b0000000011110000) >> 4;  /* mode 5 + 7 */
                /* 0b0000000000001111 - reserved for counter index */
                break;
            case 13:
                this.config.content          = (cw & 0b1100000000000000) >> 14; /* mode 7 + 13 */
                /* 0b0010000000000000 - reserved */
                /* 0b0001111100000000 - mode */
                this.config.encrypted_bytes  =  cw & 0b0000000011111111;  /* mode 13 */
                break;
            default:
                this.logger.error('Warning unknown security mode: ' + this.config.mode);
        }
    }

    decodeConfigwordExt(cwe) {
        if (this.config.mode == 7) {
            /* 0b10000000 - reserved
                                         0b01000000 - reserved for version */
            this.config.kdf_sel = (cwe & 0b00110000) >> 4;
            this.config.keyid   =  cwe & 0b00001111;
            return;
        }

        if (this.config.mode == 13) {
            /* 0b11110000 - reserved */
            this.config.proto_type = cwe & 0b00001111;
            return;
        }
    }

    decodeBCD(digits, bcd) {
        // check for negative BCD (not allowed according to specs)
        let sign = 1;
        if (bcd[digits/2 - 1] >> 4 > 9) {
            bcd[digits/2 - 1] &= 0b00001111;
            sign = -1;
        }
        let val = 0;
        for (let i = 0; i < digits / 2; i++) {
            val += ((bcd[i] & 0x0f) + (((bcd[i] & 0xf0) >> 4) * 10)) * Math.pow(100, i);
        }
        return parseInt(sign*val);
    }

    decodeValueInformationBlock(data, offset, dataRecord) {
        function findTabIndex (el) {
            return (this.vif & this.table[el].typeMask) == this.table[el].type;
        }

        function processVIF(vif, info) {
            VIB.exponent = vif & info.expMask;
            VIB.unit = info.unit;
            VIB.description = info.description;
            if (VIB.type === 'VIF_TYPE_MANUFACTURER_UNKOWN') {
                VIB.description = '0x' + vif.toString(16) + ' ' + VIB.description;
            }
            if ((typeof VIB.exponent !== 'undefined') && (typeof info.bias !== 'undefined')) {
                VIB.valueFactor = Math.pow(10, (VIB.exponent + info.bias));
            } else {
                VIB.valueFactor = 1;
            }

            const func = this.valueCalcMap(info.calcFunc);
            if (typeof func === 'function') {
                VIB.calcFunc = func.bind(this);
            }
        }

        let vif;
        const vifs = [];
        let vifTable = VIFInfo.primary;
        let type = 'primary';

        const VIB = {};

        do {
            if (vifs.length > 10) {
                VIB.errorMessage = 'too many VIFE';
                VIB.errorCode = this.constant.ERR_TOO_MANY_VIFE;
                this.logger.error(VIB.errorMessage);
                // is breaking a good idea?
                break;
            }

            if (offset+1 >= data.length) {
                this.logger.error('Warning: no data but VIF extension bit still set!');
                break;
            }

            vif = data[offset++];

            if ((vif & 0x7F) == 0x7C) { // plain text vif
                const len = data[offset++];
                vifs.push({ table: null, vif: data.toString('ascii', offset, offset+len).split('').reverse().join(''), type: type + '-plain' });
                offset += len;
                if (vif & 0x80) { continue; } else { break;    }
            } else if (vif == 0xFB) { // just switch table
                vifTable = VIFInfo.primaryFB;
                vif = data[offset++];
                type += '-FB';
            } else if (vif == 0xFD) { // just switch table
                vifTable = VIFInfo.primaryFD;
                vif = data[offset++];
                type += '-FD';
            } else if (vif == 0xFF) { // manufacturer specific
                vif = data[offset++];
                if (typeof VIFInfo.manufacturer[this.link_layer.manufacturer] !== 'undefined') {
                    vifTable =  VIFInfo.manufacturer[this.link_layer.manufacturer];
                    type += '-' + this.link_layer.manufacturer;
                } else {
                    this.logger.debug('Unknown manufacturer specific vif: 0x' + vif.toString(16));
                    vifTable = VIFInfo.unknown;
                }
            }

            vifs.push({ table: vifTable, vif: vif & 0x7F, type: type });
            type = 'extension';
            vifTable = VIFInfo.extension;
        } while (vif & 0x80);

        VIB.ext = [];

        vifs.forEach(function (item) {
            if (item.type.startsWith('primary')) { // primary
                if (item.type.endsWith('plain')) {
                    VIB.type = 'VIF_PLAIN_TEXT';
                    VIB.unit = item.vif;
                } else {
                    const tabIndex = Object.keys(item.table).findIndex(findTabIndex, item);
                    if (tabIndex === -1) { // not found
                        VIB.errorMessage = 'unknown ' + item.type + ' VIF 0x' + item.vif.toString(16);
                        VIB.type = 'VIF' + item.type.replace('primary', '') + ' 0x' + item.vif.toString(16);
                        VIB.errorCode = this.constant.ERR_UNKNOWN_VIFE;
                    } else {
                        VIB.type = Object.keys(item.table)[tabIndex];
                        processVIF.call(this, item.vif, item.table[Object.keys(item.table)[tabIndex]]);
                    }
                }
            } else { // extension
                if (typeof item.table !== 'undefined') {
                    if (item.type.endsWith('plain')) {
                        item.unit = item.vif;
                    } else {
                        const tabIndex = Object.keys(item.table).findIndex(findTabIndex, item);
                        if (tabIndex === -1) { // not found
                            VIB.errorMessage = 'unknown ' + item.type + ' VIFExt 0x' + item.vif.toString(16);
                            VIB.errorCode = this.constant.ERR_UNKNOWN_VIFE;
                        } else {
                            item.info = item.table[Object.keys(item.table)[tabIndex]];
                            item.type = Object.keys(item.table)[tabIndex];
                            delete item.table;
                        }
                    }
                }
                VIB.ext.push(item);
            }
        }.bind(this));

        //this.logger.debug("VIB");
        //this.logger.debug(VIB);

        dataRecord.VIB = VIB;

        return offset;
    }

    decodeDataInformationBlock(data, offset, dataRecord) {
        let dif = data[offset++];
        let difExtNo = 0;
        const DIB = {};

        DIB.tariff = 0;
        DIB.devUnit = 0;
        DIB.storageNo     = (dif & 0b01000000) >> 6;
        DIB.functionField = (dif & 0b00110000) >> 4;
        DIB.dataField     =  dif & 0b00001111;
        DIB.functionFieldText = this.functionFieldTypes[DIB.functionField];

        while (dif & this.constant.DIF_EXTENSION_BIT) {

            if (offset >= data.length) {
                this.logger.error('Warning: no data but DIF extension bit still set!');
                break;
            }
            dif = data[offset++];

            if (difExtNo > 9) {
                DIB.errorMessage = 'too many DIFE';
                DIB.errorCode = this.constant.ERR_TOO_MANY_DIFE;
                this.logger.error(DIB.errorMessage);
                break;
            }

            DIB.storageNo |=  (dif & 0b00001111)       << (difExtNo * 4) + 1;
            DIB.tariff    |= ((dif & 0b00110000 >> 4)) << (difExtNo * 2);
            DIB.devUnit   |= ((dif & 0b01000000 >> 6)) <<  difExtNo;
            difExtNo++;
        }

        //this.logger.debug("DIB");
        //this.logger.debug(DIB);

        dataRecord.DIB = DIB;

        return offset;
    }

    decodeDataRecords(data) {
        const use_cache = (this.application_layer.format_signature ? true : false);
        let offset = 0;
        let dataRecord;
        let drCount = 1;
        let value;
        this.dataRecords = [];
        let crcBuffer = Buffer.alloc(0);
        let drStart;

        if (use_cache) {
            this.logger.debug('Using data record cache');
        }

        DataLoop:
        while (offset < data.length)
        {
            while (data[offset] == this.constant.DIF_IDLE_FILLER) {
                offset++;
                if (offset >= data.length) {
                    break DataLoop;
                }
            }

            if (!use_cache) {
                dataRecord = {};
                drStart = offset;
                offset = this.decodeDataInformationBlock(data, offset, dataRecord);
                if (dataRecord.DIB.dataField == this.constant.DIF_SPECIAL) {
                    if (offset < data.length) {
                        this.logger.debug('DIF_SPECIAL at ' + offset + ': ');
                        this.logger.debug(data.toString('hex', offset));
                    }
                    break DataLoop;
                }
                offset = this.decodeValueInformationBlock(data, offset, dataRecord);
                crcBuffer = Buffer.concat([crcBuffer, data.slice(drStart, offset)]);
            } else {
                dataRecord = this.drCache[this.application_layer.full_frame_payload_index].record[drCount-1];
            }

            try {
                this.logger.debug(`DIB dataField ${dataRecord.DIB.dataField}`);
                switch (dataRecord.DIB.dataField) {
                    case this.constant.DIF_NONE: value = ''; offset++; this.logger.debug('DIF_NONE found!'); break;
                    case this.constant.DIF_READOUT: value = ''; offset++; this.logger.debug('DIF_READOUT found!'); break;
                    case this.constant.DIF_BCD2: value = this.decodeBCD(2, data.slice(offset, offset+1)); offset += 1; break;
                    case this.constant.DIF_BCD4: value = this.decodeBCD(4, data.slice(offset, offset+2)); offset += 2; break;
                    case this.constant.DIF_BCD6: value = this.decodeBCD(6, data.slice(offset, offset+3)); offset += 3; break;
                    case this.constant.DIF_BCD8: value = this.decodeBCD(8, data.slice(offset, offset+4)); offset += 4; break;
                    case this.constant.DIF_BCD12: value = this.decodeBCD(12, data.slice(offset, offset+6)); offset += 6; break;
                    case this.constant.DIF_INT8: value = data.readInt8(offset); offset += 1; break;
                    case this.constant.DIF_INT16: value = data.readUInt16LE(offset); offset += 2; break;
                    case this.constant.DIF_INT24: value = data.readUIntLE(offset, 3); offset += 3; break;
                    case this.constant.DIF_INT32: value = data.readUInt32LE(offset); offset += 4; break;
                    case this.constant.DIF_INT48: value = data.readUIntLE(offset, 6); offset += 6; break;

                    case this.constant.DIF_INT64:
                        // correct?
                        value = data.readUInt32LE(offset) + (data.readUInt32LE(offset+4) << 32);
                        offset += 8;
                        break;
                    case this.constant.DIF_FLOAT32:
                        // correct?
                        value = data.readFloatLE(offset);
                        offset += 4;
                        break;
                    case this.constant.DIF_VARLEN:
                        let lvar = data[offset++]; // eslint-disable-line no-case-declarations
                        if (lvar <= 0xBF) {
                            if (this.constant[dataRecord.VIB.type] === this.constant.VIF_TYPE_MANUFACTURER_SPECIFIC) { // get as hex string
                                value = data.toString('hex', offset, offset+lvar);
                            } else { //  ASCII string with lvar characters
                                value = data.toString('ascii', offset, offset+lvar).split('').reverse().join('');
                            }
                            offset += lvar;
                        } else if ((lvar >= 0xC0) && (lvar <= 0xCF)) {
                            lvar -= 0xC0;
                            // positive BCD number with (lvar - C0h) * 2 digits
                            value = this.decodeBCD(lvar * 2, data.slice(offset, offset+lvar));
                            offset += lvar;
                        } else if ((lvar >= 0xD0) && (lvar <= 0xDF)) {
                            lvar -= 0xD0;
                            //  negative BCD number with (lvar - D0h) * 2 digits
                            value = -1 * this.decodeBCD(lvar * 2, data.slice(offset, offset+lvar));
                            offset += lvar;
                        } else {
                            this.errorMessage = 'in datablock ' + drCount + ': unhandled LVAR field 0x' + lvar.toString(16);
                            this.errorCode = this.constant.ERR_UNKNOWN_LVAR;
                            this.logger.error(this.errorMessage);
                            return 0;
                        }
                        break;
                    default:
                        this.errorMessage = 'in datablock ' + drCount + ': unhandled datafield 0x' + dataRecord.DIB.dataField.toString(16);
                        this.errorCode = this.constant.ERR_UNKNOWN_DATAFIELD;
                        this.logger.error(this.errorMessage);
                        return 0;
                }

                if (typeof dataRecord.VIB.calcFunc === 'function') {
                    dataRecord.VIB.value = dataRecord.VIB.calcFunc(value, dataRecord.VIB);
                    this.logger.debug(dataRecord.VIB.type + ': Value raw ' + value + ' value calc ' + dataRecord.VIB.value);
                } else if (typeof value !== 'undefined') {
                    dataRecord.VIB.value = value;
                    this.logger.debug(dataRecord.VIB.type + ': Value ' + JSON.stringify(value));
                } else {
                    dataRecord.VIB.value = '';
                    this.logger.debug(dataRecord.VIB.type + ': Empty DataRecord?');
                }

                dataRecord.VIB.ext.forEach(function (ext) {
                    if (typeof ext.info === 'undefined') {
                        this.logger.error('Unknown VIFExt 0x' + ext.vif.toString(16));
                        return;
                    }
                    const func = this.valueCalcMap(ext.info.calcFunc);
                    if (typeof func === 'function') {
                        func.call(this, ext, dataRecord.VIB);
                    }
                }.bind(this));

                //this.logger.debug(dataRecord);
                this.dataRecords.push(dataRecord);
                drCount++;

            } catch (e) {
                this.logger.debug(e);
                this.logger.error('Warning: Not enough data for DIB.dataField type! Incomplete telegram data?');
            }
        }

        if (this.enableDataRecordCache && !use_cache) {
            const crc = this.crc.calc(crcBuffer);
            if (this.drCache.findIndex(function(i) { return i.crc == this; }, crc) === -1) {
                this.drCache.push({crc: crc, record: this.dataRecords});
            }
        }

        return 1;
    }

    decrypt(encrypted, key, iv, algorithm) {
        // see 4.2.5.3, page 26
        let initVector;
        if (typeof iv === 'undefined') {
            initVector = Buffer.concat([Buffer.alloc(2), this.link_layer.afield_raw, Buffer.alloc(8, this.application_layer.access_no)]);
            if (typeof this.application_layer.meter_id !== 'undefined') {
                initVector.writeUInt32LE(this.application_layer.meter_id, 2);
                initVector.writeUInt8(this.application_layer.meter_vers, 6);
                initVector.writeUInt8(this.application_layer.meter_dev, 7);
            }
            if (typeof this.application_layer.meter_man !== 'undefined') {
                initVector.writeUInt16LE(this.application_layer.meter_man);
            } else {
                initVector.writeUInt16LE(this.link_layer.mfield);
            }
        } else {
            initVector = iv;
        }
        this.logger.debug('IV: ' + initVector.toString('hex'));
        algorithm = (typeof algorithm === 'undefined' ? 'aes-128-cbc' : algorithm);
        const decipher = crypto.createDecipheriv(algorithm, key, initVector);
        decipher.setAutoPadding(false);
        const padding = encrypted.length % 16;
        if (padding) {
            this.logger.debug('Added padding: ' + padding);
            const len = encrypted.length;
            encrypted = Buffer.concat([encrypted, Buffer.alloc(16-padding)]);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]).slice(0, len);
        }
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }

    decrypt_mode7(encrypted, key, tpl) {
        // see 9.2.4, page 59
        const initVector = Buffer.alloc(16, 0x00);
        // KDF
        let msg = Buffer.alloc(16, 0x07);
        msg[0] = 0x00; // derivation constant (see. 9.5.3) 00 = Kenc (from meter) 01 = Kmac (from meter)
        msg.writeUInt32LE(this.afl.mcr, 1);
        if (typeof this.application_layer.meter_id !== 'undefined') {
            msg.writeUInt32LE(this.application_layer.meter_id, 5);
        } else {
            msg.writeUInt32LE(this.link_layer.afield, 5);
        }
        const kenc = aesCmac(key, msg, {returnAsBuffer: true});
        this.logger.debug('Kenc: ' + kenc.toString('hex'));

        // MAC verification - could be skipped...
        msg[0] = 0x01; // derivation constant
        const kmac = aesCmac(key, msg, {returnAsBuffer: true});
        this.logger.debug('Kmac: ' + kmac.toString('hex'));

        const len = 5 + (this.afl.fcl_mlp * 2);
        msg = Buffer.alloc(len);
        msg[0] = this.afl.mcl;
        msg.writeUInt32LE(this.afl.mcr, 1);
        if (this.afl.fcl_mlp) {
            msg.writeUInt16LE(this.afl.ml, 5);
        }
        msg = Buffer.concat([msg, tpl, encrypted]);
        const mac = aesCmac(kmac, msg, {returnAsBuffer: true});

        this.logger.debug('MAC: ' + mac.toString('hex'));
        if (this.afl.mac.compare(mac.slice(0, 8)) !== 0) {
            this.logger.debug('Warning: received MAC is incorrect. Corrupted data?');
            this.logger.debug('MAC received:  ' + this.afl.mac.toString('hex'));
        }
        return this.decrypt(encrypted, kenc, initVector, 'aes-128-cbc');
    }

    decodeAFL(data, offset) {
        // reset afl object
        this.afl = {};
        this.afl.ci = data[offset++];
        this.afl.afll = data[offset++];
        this.logger.debug('AFL AFLL ' + this.afl.afll);

        this.afl.fcl = data.readUInt16LE(offset);
        offset += 2;
        /* 0b1000000000000000 - reserved */
        this.afl.fcl_mf   = (this.afl.fcl & 0b0100000000000000) != 0; /* More fragments: 0 last fragment; 1 more following */
        this.afl.fcl_mclp = (this.afl.fcl & 0b0010000000000000) != 0; /* Message Control Field present in fragment */
        this.afl.fcl_mlp  = (this.afl.fcl & 0b0001000000000000) != 0; /* Message Length Field present in fragment */
        this.afl.fcl_mcrp = (this.afl.fcl & 0b0000100000000000) != 0; /* Message Counter Field present in fragment */
        this.afl.fcl_macp = (this.afl.fcl & 0b0000010000000000) != 0; /* MAC Field present in fragment */
        this.afl.fcl_kip  = (this.afl.fcl & 0b0000001000000000) != 0; /* Key Information present in fragment */
        /* 0b0000000100000000 - reserved */
        this.afl.fcl_fid  =  this.afl.fcl & 0b0000000011111111; /* fragment ID */

        if (this.afl.fcl_mclp) {
            // AFL Message Control Field (AFL.MCL)
            this.afl.mcl = data[offset++];
            /* 0b10000000 - reserved */
            this.afl.mcl_mlmp = (this.afl.mcl & 0b01000000) != 0; /* Message Length Field present in message */
            this.afl.mcl_mcmp = (this.afl.mcl & 0b00100000) != 0; /* Message Counter Field present in message */
            this.afl.mcl_kimp = (this.afl.mcl & 0b00010000) != 0; /* Key Information Field present in message */
            this.afl.mcl_at   = (this.afl.mcl & 0b00001111); /* Authentication-Type */
        }

        if (this.afl.fcl_kip) {
            // AFL Key Information Field (AFL.KI)
            this.afl.ki = data.readUInt16LE(offset);
            offset += 2;
            this.afl.ki_key_version   = (this.afl.ki & 0b1111111100000000) >> 8;
            /* 0b0000000011000000 - reserved */
            this.afl.ki_kdf_selection = (this.afl.ki & 0b0000000000110000) >> 4;
            this.afl.ki_key_id        = (this.afl.ki & 0b0000000000001111);
        }

        if (this.afl.fcl_mcrp) {
            // AFL Message Counter Field (AFL.MCR)
            this.afl.mcr = data.readUInt32LE(offset);
            this.logger.debug('AFL MC ' + this.afl.mcr);
            offset += 4;
        }
        if (this.afl.fcl_macp) {
            // AFL MAC Field (AFL.MAC)
            // length of the MAC field depends on AFL.MCL.AT indicated by the AFL.MCL field
            // currently only AT = 5 is used (AES-CMAC-128 8bytes truncated)
            let mac_len = 0;
            if (this.afl.mcl_at == 4) {
                mac_len = 4;
            } else if (this.afl.mcl_at == 5) {
                mac_len = 8;
            } else if (this.afl.mcl_at == 6) {
                mac_len = 12;
            } else if (this.afl.mcl_at == 7) {
                mac_len = 16;
            }
            this.afl.mac = data.slice(offset, offset+mac_len);
            offset += mac_len;
            this.logger.debug('AFL MAC ' + this.afl.mac.toString('hex'));
        }
        if (this.afl.fcl_mlp) {
            // AFL Message Length Field (AFL.ML)
            this.afl.ml = data.readUInt16LE(offset);
            offset += 2;
        }

        return offset;
    }

    decodeELL(data, offset) {
        // reset ell object
        this.ell = {};
        this.ell.ci = data[offset++];

        // common to all headers
        this.ell.communication_control = data[offset++];
        this.ell.access_number = data[offset++];

        switch (this.ell.ci) {
            case this.constant.CI_ELL_2: // OMS
                // nothing more to do here
                break;
            case this.constant.CI_ELL_8:
                // session_number see below
                // payload CRC is part (encrypted) payload - so deal with it later
                break;
            case this.constant.CI_ELL_10: // OMS
            case this.constant.CI_ELL_16:
                this.ell.manufacturer = data.readUInt16LE(offset);
                offset += 2;
                this.ell.address = data.slice(offset, offset+6);
                offset += 6;
                // session_number see below
                break;
            default:
                this.logger.error('Warning: unknown extended link layer CI: 0x' + this.ell.ci.toString(16));
        }

        // a little tested - what happens to CRC is still not clear
        if ((this.ell.ci === this.constant.CI_ELL_16) || (this.ell.ci === this.constant.CI_ELL_8)){
            this.ell.session_number = data.readUInt32LE(offset);
            offset += 4;
            // payload CRC is part (encrypted) payload - so deal with it later

            // parse session number
            this.ell.session_number_enc     = (this.ell.session_number & 0b11100000000000000000000000000000) >> 29;
            this.ell.session_number_time    = (this.ell.session_number & 0b00011111111111111111111111110000) >> 4;
            this.ell.session_number_session =  this.ell.session_number & 0b00000000000000000000000000001111;
            const isEncrypted = this.ell.session_number_enc != 0;

            // is this already decrypted? check against CRC
            const rawCRC = data.readUInt16LE(offset);
            const rawCRCcalc = this.crc.calc(data.slice(offset+2));
            this.logger.debug('crc ' + rawCRC.toString(16) + ', calculated ' + rawCRCcalc.toString(16));

            if (rawCRC == rawCRCcalc) {
                this.logger.debug('ELL encryption found, but data already seems to be decrypted - CRC match');
                return offset + 2;
            }

            if (isEncrypted) {
                if (this.aeskey) {
                    // AES IV
                    // M-field, A-field, CC, SN, (00, 0000 vs FN     BC ???)
                    const initVector = Buffer.concat([
                        Buffer.alloc(2),
                        (typeof this.ell.address !== 'undefined' ? this.ell.address : this.link_layer.afield_raw),
                        Buffer.alloc(8)
                    ]);
                    initVector.writeUInt16LE((typeof this.ell.manufacturer !== 'undefined' ? this.ell.manufacturer : this.link_layer.mfield));
                    initVector[8] = this.ell.communication_control & 0xEF; // reset hop counter
                    initVector.writeUInt32LE(this.ell.session_number, 9);
                    data = this.decrypt(data.slice(offset), this.aeskey, initVector, 'aes-128-ctr');
                    this.logger.debug('Dec: '+  data.toString('hex'));
                } else {
                    this.errorMessage = 'encrypted message and no aeskey provided';
                    this.errorCode = this.constant.ERR_NO_AESKEY;
                    this.logger.error(this.errorMessage);
                    return 0;
                }

                this.ell.crc = data.readUInt16LE(0);
                offset += 2;
                // PayloadCRC is a cyclic redundancy check covering the remainder of the frame (excluding the CRC fields)
                // payloadCRC is also encrypted
                const crc = this.crc.calc(data.slice(2));
                if (this.ell.crc != crc) {
                    this.logger.debug('crc ' + this.ell.crc.toString(16) + ', calculated ' + crc.toString(16));
                    this.errorMessage = 'Payload CRC check failed on ELL' + (isEncrypted ? ', wrong AES key?' : '');
                    this.errorCode = this.constant.ERR_CRC_FAILED;
                    this.logger.error(this.errorMessage);
                    return 0;
                }
                offset = data.slice(2); // skip PayloadCRC
            }
        }

        return offset;
    }

    decodeApplicationLayer(data, offset) {
        // initialize some fields
        this.application_layer = {};
        this.application_layer.status = 0;
        this.application_layer.statusstring = '';
        this.application_layer.access_no = 0;
        this.config = { mode: 0 };

        const appStart = offset;
        this.application_layer.cifield = data[offset++];

        switch (this.application_layer.cifield) {
            case this.constant.CI_RESP_0:
            case this.constant.CI_SND_UD_MODE_1: // seems to be okay?
                // no header - only M-Bus?
                this.logger.debug('No header');
                break;

            case this.constant.CI_RESP_4:
            case this.constant.CI_RESP_SML_4:
                this.logger.debug('Short header');
                this.application_layer.access_no = data[offset++];
                this.application_layer.status = data[offset++];
                this.decodeConfigword(data.readUInt16LE(offset));
                offset += 2;
                if ((this.config.mode == 7) || (this.config.mode == 13)) {
                    this.decodeConfigwordExt(data[offset++]);
                }
                break;

            case this.constant.CI_RESP_12:
            case this.constant.CI_RESP_SML_12:
                this.logger.debug('Long header');
                this.application_layer.meter_id = data.readUInt32LE(offset);
                offset += 4;
                this.application_layer.meter_man = data.readUInt16LE(offset);
                offset += 2;
                this.application_layer.meter_vers = data[offset++];
                this.application_layer.meter_dev = data[offset++];
                this.application_layer.access_no = data[offset++];
                this.application_layer.status = data[offset++];
                this.decodeConfigword(data.readUInt16LE(offset));
                offset += 2;
                if ((this.config.mode == 7) || (this.config.mode == 13)) {
                    this.decodeConfigwordExt(data[offset++]);
                }
                //this.application_layer.meter_id = this.application_layer.meter_id.toString().padStart(8, '0');
                this.application_layer.meter_devtypestring = this.validDeviceTypes[this.application_layer.meter_dev] || 'unknown';
                this.application_layer.meter_manufacturer = this.manId2ascii(this.application_layer.meter_man).toUpperCase();
                break;

            case 0x79:
                if (this.link_layer.manufacturer === 'KAM') {
                    this.logger.debug('Kamstrup compact frame header');
                    this.application_layer.format_signature = data.readUInt16LE(offset);
                    offset += 2;
                    // full frame payload checksum is not checked!
                    this.application_layer.full_frame_payload_crc = data.readUInt16LE(offset);
                    offset += 2;
                    this.application_layer.full_frame_payload_index = this.drCache.findIndex(function(i) { return i.crc == this; }, this.application_layer.format_signature);
                    if (this.application_layer.full_frame_payload_index === -1) {
                        this.errorMessage = 'Unknown Kamstrup compact frame format';
                        this.errorCode = this.constant.ERR_UNKNOWN_COMPACT_FORMAT;
                        this.logger.error(this.errorMessage);
                        return 0;
                    }
                    break;
                }
                this.logger.debug('Unhandled MANUFACTURER header');
                // no break so unhandled manufacturer for CI 0x79 are treated as default too
            case 0xA0: // eslint-disable-line no-fallthrough
            case 0xA1:
            case 0xA2:
                if (this.link_layer.manufacturer === 'TCH') {
                    this.logger.debug('Trying to decode using TCH specific module');
                    const tchRet = tchDecoder(data, this.link_layer);
                    if (tchRet !== false) {
                        this.dataRecords = tchRet;
                        return 1;
                    }
                } else if (this.link_layer.manufacturer === 'DME') {
                    this.logger.debug('Trying to decode using Diehl PRIOS module');
                    console.log(data.toString('hex'));
                    const priosRet = priosDecoder(data, this.link_layer, this.validDeviceTypes);
                    this.logger.debug(`retVal ${priosRet}`);
                    if (typeof priosRet !== 'string') {
                        this.dataRecords = priosRet;
                        return 1;
                    } else {
                        this.logger.error(priosRet);
                    }
                }
            default: // eslint-disable-line no-fallthrough
                // unsupported
                this.errorMessage = 'Unsupported CI Field ' + this.application_layer.cifield.toString(16) + ', remaining payload is ' + data.toString('hex', offset);
                this.errorCode = this.constant.ERR_UNKNOWN_CIFIELD;
                this.logger.error(this.errorMessage);
                return 0;
        }

        // copy over application data meter and address info to link layer data for compatibility
        if (this.frame_type == this.constant.FRAME_TYPE_WIRED) {
            this.link_layer.typestring = this.application_layer.meter_devtypestring || 'unkown';
            this.link_layer.manufacturer = this.application_layer.meter_manufacturer || 'ERR';
            this.link_layer.afield_id = (this.application_layer.meter_id ? this.application_layer.meter_id.toString(16).padStart(8, '0') : '00000000');
            this.link_layer.afield_type = this.application_layer.meter_dev || 0;
            this.link_layer.afield_version = this.application_layer.meter_vers || 0;
            this.link_layer.mfield = this.application_layer.meter_man || 0;

            this.link_layer.afield_raw = Buffer.alloc(6);
            this.link_layer.afield_raw.writeUInt32LE(this.application_layer.meter_id);
            this.link_layer.afield_raw[4] = this.link_layer.afield_version;
            this.link_layer.afield_raw[5] = this.link_layer.afield_type;

            this.link_layer.address_raw = Buffer.alloc(8);
            this.link_layer.address_raw.writeUInt32LE(this.link_layer.mfield);
            this.link_layer.address_raw.writeUInt32LE(this.application_layer.meter_id, 2);
            this.link_layer.address_raw[6] = this.link_layer.afield_version;
            this.link_layer.address_raw[7] = this.link_layer.afield_type;
        }

        this.application_layer.statusstring = this.state2string(this.application_layer.status).join(', ');

        let payload;
        this.encryptionMode = this.encryptionModes[this.config.mode];
        switch (this.config.mode) {
            case 0: // no encryption
                payload = data.slice(offset);
                break;

            case 5: // data is encrypted with AES 128, dynamic init vector
            case 7: // ephemeral key is used (see 9.2.4)

                // data got decrypted by gateway or similar
                if (this.alreadyDecrypted) {
                    payload = data.slice(offset);
                    this.logger.debug('Data already decrypted');
                    break;
                }

                if (this.aeskey) {
                    const encrypted_length = this.config.encrypted_blocks * this.constant.AES_BLOCK_SIZE;
                    this.logger.debug('encrypted payload: ' + data.slice(offset, offset+encrypted_length).toString('hex'));
                    if (this.config.mode == 5) {
                        payload = Buffer.concat([this.decrypt(data.slice(offset, offset+encrypted_length), this.aeskey), data.slice(offset+encrypted_length)]);
                    } else { // mode 7
                        payload = Buffer.concat([this.decrypt_mode7(data.slice(offset, offset+encrypted_length), this.aeskey, data.slice(appStart, offset)), data.slice(offset+encrypted_length)]);
                    }
                    this.logger.debug('decrypted payload ' + payload.toString('hex'));
                    if (payload.readUInt16LE(0) != 0x2F2F) {
                        // Decryption verification failed
                        this.errorMessage = 'Decryption failed, wrong key?';
                        this.errorCode = this.constant.ERR_DECRYPTION_FAILED;
                        this.logger.error(payload.toString('hex'));
                        return 0;
                    }
                } else {
                    this.errorMessage = 'encrypted message and no aeskey provided';
                    this.errorCode = this.constant.ERR_NO_AESKEY;
                    this.logger.error(this.errorMessage);
                    return 0;
                }
                break;

            default:
                // error, encryption mode not implemented
                this.errorMessage = 'Encryption mode ' + this.config.mode.toString(16) + ' not implemented';
                this.errorCode = this.constant.ERR_UNKNOWN_ENCRYPTION;
                this.logger.error(this.errorMessage);
                return 0;
        }

        if (this.application_layer.cifield == this.constant.CI_RESP_SML_4 || this.application_layer.cifield == this.constant.CI_RESP_SML_12) {
            // payload is SML encoded, that's not implemented
            this.errorMessage = "payload is SML encoded, can't be decoded, SML payload is " . data.toString('hex', offset);
            this.errorCode = this.constant.ERR_SML_PAYLOAD;
            this.logger.error(this.errorMessage);
            return 0;
        } else {
            return this.decodeDataRecords(payload);
        }
    }

    decodeLinkLayerWired(data) {
        //68 LL LL 68 PAYLOAD CS 16
        this.link_layer = {};

        if ((data[0] != 0x68) || (data[3] != 0x68) || (data[data.length-1] != 0x16) || (data[1] != data[2])) {
            this.errorCode == this.constant.ERR_LINK_LAYER_INVALID;
            this.errorMessage = 'Not a valid (wired) M-bus frame';
            this.logger.error(this.errorMessage);
            return 0;
        }

        this.link_layer.lfield = data[1];

        // check checksum
        let csum = 0;
        for (let k = 0; k < this.link_layer.lfield; k++) {
            csum = (csum + data[4+k]) & 0xFF;
        }
        if (csum != data[data.length-2]) {
            // CRC failed
            this.errorCode == this.constant.ERR_CRC_FAILED;
            this.errorMessage = 'CRC for wired M-Bus frame failed! calc: ' + csum.toString(16) + ' read: ' + data[data.length-2].toString(16);
            this.logger.error(this.errorMessage);
            return 0;
        }
        let i = 4;
        this.link_layer.cfield = data[i++];
        this.link_layer.afield = data[i++];
        return data.slice(i, data.length - 2);
    }

    decodeLinkLayer(data, contains_crc) {
        this.link_layer = {};
        let i = 0;
        // assume data starts with L field (as it should)
        // L field is total length without itself and CRC (for type A!)!
        // L field is total length including CRC without itself (for type B!)!
        // L field might need adjustement by device class - e.g. AMBER includes its own CRC in it!
        this.link_layer.lfield = data[i++];
        this.link_layer.cfield = data[i++];
        this.link_layer.address_raw = data.slice(i, i+8);
        this.link_layer.mfield = data.readUInt16LE(i);
        i += 2;
        this.link_layer.afield_raw = data.slice(i, i+6);
        this.link_layer.afield = data.readUInt32LE(i);
        i += 4;
        this.link_layer.afield_version = data[i++];
        this.link_layer.afield_type = data[i++];

        this.link_layer.manufacturer = this.manId2ascii(this.link_layer.mfield);
        this.link_layer.typestring = this.validDeviceTypes[this.link_layer.afield_type] || 'unknown';
        this.link_layer.afield_id = this.decodeBCD(8, this.link_layer.afield_raw).toString().padStart(8, '0');

        if (this.frame_type == this.constant.FRAME_TYPE_A) {
            const remainingSize = this.link_layer.lfield + 1 - this.constant.DLL_SIZE;
            if (contains_crc) {
                // check CRC of block 1
                const crc = this.crc.calc(data.slice(0, this.constant.DLL_SIZE));
                if (data.readUInt16BE(i) != crc) {
                    // CRC failed
                    this.errorCode == this.constant.ERR_CRC_FAILED;
                    this.errorMessage = 'CRC for frame type A block 1 failed! calc: ' + crc.toString(16) + ' read: ' + data.readUInt16BE(i).toString(16);
                    this.logger.error(this.errorMessage);
                    return 0;
                }
                i += 2;

                // calc total remaining size including CRC
                const blockCount = Math.ceil(remainingSize / 16);
                const remainingTotalSize = blockCount * 2 + remainingSize;

                if (remainingTotalSize + i > data.length) {
                    this.errorMessage = 'application layer message too short, expected ' + (remainingTotalSize + i) + ', got ' + data.length + ' bytes';
                    this.logger.debug(data.toString('hex'));
                    this.errorCode = this.constant.ERR_MSG_TOO_SHORT;
                    this.logger.error(this.errorMessage);
                    return 0;
                }

                // too much data
                if (data.length > remainingTotalSize + i) {
                    this.remainingData = data.slice(i + remainingTotalSize);
                    data = data.slice(0, i + remainingTotalSize);
                }

                let new_data = Buffer.alloc(0);

                // check remaining blocks and remove CRC
                let bcount = 2;
                do {
                    const blockSize = (i + this.constant.FRAME_A_BLOCK_SIZE + 2 <= data.length ? this.constant.FRAME_A_BLOCK_SIZE : data.length - 2 - i);
                    const block = data.slice(i, i + blockSize);
                    const crc = this.crc.calc(block);
                    i += blockSize;
                    if (data.readUInt16BE(i) != crc) {
                        // CRC failed
                        this.errorCode == this.constant.ERR_CRC_FAILED;
                        this.errorMessage = 'CRC for frame type A block ' + bcount + ' failed! calc: ' + crc.toString(16) + ' read: ' + data.readUInt16BE(i).toString(16);
                        this.logger.error(this.errorMessage);
                        return 0;
                    }

                    new_data = Buffer.concat([new_data, block]);
                    i += 2;
                    bcount++;
                }
                while (i < data.length);

                // done
                return new_data;
            } // else
            this.remainingData = data.slice(i + remainingSize);
            if (remainingSize + i > data.length) {
                this.errorMessage = 'application layer message too short, expected ' + (remainingSize + i) + ', got ' + data.length + ' bytes';
                this.logger.debug(data.toString('hex'));
                this.errorCode = this.constant.ERR_MSG_TOO_SHORT;
                this.logger.error(this.errorMessage);
                return 0;
            }

            return data.slice(i, i + remainingSize);

        } else if (this.frame_type == this.constant.FRAME_TYPE_B) {
            const remainingSize = this.link_layer.lfield + 1 - this.constant.DLL_SIZE;

            if (remainingSize + i > data.length) {
                this.errorMessage = 'application layer message too short, expected ' + (remainingSize + i) + ', got ' + data.length + ' bytes';
                this.logger.debug(data.toString('hex'));
                this.errorCode = this.constant.ERR_MSG_TOO_SHORT;
                this.logger.error(this.errorMessage);
                return 0;
            }

            // too much data
            if (data.length > remainingSize + i) {
                this.remainingData = data.slice(remainingSize);
                data = data.slice(0, i + remainingSize);
            }

            let block3;
            if (this.link_layer.lfield >= this.constant.FRAME_B_BLOCK_SIZE) { // message has 3 blocks
                block3 = data.slice(this.constant.FRAME_B_BLOCK_SIZE, data.length - 2);
                const crc = this.crc.calc(block3);
                if (data.readUInt16BE(data.length - 2) != crc) {
                    // CRC failed
                    this.errorCode == this.constant.ERR_CRC_FAILED;
                    this.errorMessage = 'CRC for frame type B block 3 failed! calc: ' + crc.toString(16) + ' read: ' + data.readUInt16BE(data.length - 2).toString(16);
                    this.logger.error(this.errorMessage);
                    return 0;
                }
            } else {
                block3 = Buffer.alloc(0);
            }

            const len2 = this.link_layer.lfield + 1 - (block3.length ? block3.length + 2 : 0) - this.constant.DLL_SIZE - 2;
            const crc = this.crc.calc(data.slice(0, len2 + this.constant.DLL_SIZE));
            if (data.readUInt16BE(len2 + this.constant.DLL_SIZE) != crc) {
                // CRC failed
                this.errorCode == this.constant.ERR_CRC_FAILED;
                this.errorMessage = 'CRC for frame type B block 1+2 failed! calc: ' + crc.toString(16) + ' read: ' + data.readUInt16BE(len2 + this.constant.DLL_SIZE).toString(16);
                this.logger.error(this.errorMessage);
                return 0;
            }

            return Buffer.concat([data.slice(i, i+len2), block3]);

        } else {
            this.errorCode == this.constant.ERR_LINK_LAYER_INVALID;
            this.errorMessage = 'Frame type ' + this.frame_type + ' is not implemented!';
            this.logger.error(this.errorMessage);
            return 0;
        }
    }

    parse(raw_data, contains_crc, key, frame_type, callback) {
        this.errorCode = this.constant.ERR_NO_ERROR;
        this.errorMessage = '';
        if (typeof frame_type === 'function') {
            callback = frame_type;
            frame_type = this.constant.FRAME_TYPE_A;
        }
        this.frame_type = frame_type;

        if (typeof key === 'function') {
            callback = key;
            key = undefined;
        }

        if (typeof contains_crc === 'function') {
            callback = contains_crc;
            contains_crc = true;
        }

        contains_crc = (typeof contains_crc !== 'undefined' ? contains_crc : false);
        this.alreadyDecrypted = false;
        if (typeof key === 'string') {
            if (key.toUpperCase() === 'DECRYPTED') {
                this.alreadyDecrypted = true;
                key = undefined;
            } else {
                if (key.length == 16) { // plain-text key
                    key = Buffer.from(key);
                } else if (key.length == 32) {
                    key = Buffer.from(key, 'hex');
                } else {
                    key = undefined;
                    this.logger.error('Warning: invalid key length! Key rejected!');
                }
            }
        }
        this.aeskey = key;

        if (!Buffer.isBuffer(raw_data)) {
            this.raw_data = Buffer.from(raw_data, 'hex');
        } else {
            this.raw_data = raw_data;
        }

        this.logger.debug(this.raw_data.toString('hex'));

        let data;
        if (this.frame_type == this.constant.FRAME_TYPE_WIRED) {
            data = this.decodeLinkLayerWired(this.raw_data);
        } else {
            data = this.decodeLinkLayer(this.raw_data, contains_crc);
        }

        if (Buffer.isBuffer(data)) { // seems to be all okay
            let offset = 0;
            let current_ci = data[offset];

            if ((current_ci >= this.constant.CI_ELL_2) && (current_ci <= this.constant.CI_ELL_16)) {
                // Extended Link Layer
                this.logger.debug('Extended Link Layer');
                const ell_return = this.decodeELL(data, offset);
                if (this.errorCode != this.constant.ERR_NO_ERROR) {
                    callback && callback({message: this.errorMessage, code: this.errorCode});
                    return 0;
                }
                if (Buffer.isBuffer(ell_return)) {
                    data = ell_return;
                    offset = 0;
                } else {
                    offset = ell_return;
                }
                current_ci = data[offset];
            }

            if (current_ci == this.constant.CI_AFL) {
                // Authentification and Fragmentation Layer
                this.logger.debug('Authentification and Fragmentation Layer');
                offset = this.decodeAFL(data, offset);
                current_ci = data[offset];

                if (this.afl.fcl_mf) {
                    this.errorMessage = 'fragmented messages are not yet supported';
                    this.errorCode = this.constant.ERR_FRAGMENT_UNSUPPORTED;
                    this.logger.error(this.errorMessage);
                    callback && callback({message: this.errorMessage, code: this.errorCode});
                    return 0;
                }
            }

            // we are finally at the application layer
            const app_return = this.decodeApplicationLayer(data, offset);
            if (app_return == 1) { // all okay
                callback && callback(undefined, this.collectData());
            } else {
                callback && callback({message: this.errorMessage, code: this.errorCode});
            }
            return app_return;
        }
        callback && callback({message: this.errorMessage, code: this.errorCode});
        return 0;
    }

    collectData() {
        const result = {};
        const address = Buffer.concat([Buffer.alloc(2), this.link_layer.afield_raw]);
        address.writeUInt16LE(this.link_layer.mfield, 0);

        result.deviceInformation = {
            AccessNumber: this.application_layer.access_no,
            Id: (typeof this.application_layer.meter_id !== 'undefined' ? this.application_layer.meter_id.toString(16).padStart(8, '0') : this.link_layer.afield_id),
            Manufacturer: (typeof this.application_layer.meter_manufacturer !== 'undefined' ? this.application_layer.meter_manufacturer : this.link_layer.manufacturer).toUpperCase(),
            Medium: (typeof this.application_layer.meter_devtypestring !== 'undefined' ? this.application_layer.meter_devtypestring : this.link_layer.typestring),
            Status: this.application_layer.status,
            StatusString: this.application_layer.statusstring,
            Version: (typeof this.application_layer.meter_vers !== 'undefined' ?  this.application_layer.meter_vers : this.link_layer.afield_version),
            Address: address.toString('hex')
        };

        result.dataRecord = [];

        let count = 0;
        this.dataRecords.forEach(function(item) {
            count++;
            result.dataRecord.push({
                number: count,
                value: item.VIB.value,
                unit: item.VIB.unit,
                type: item.VIB.type,
                description: item.VIB.description,
                tariff: item.DIB.tariff,
                storageNo: item.DIB.storageNo,
                devUnit: item.DIB.devUnit,
                functionFieldText: item.DIB.functionFieldText,
                functionField: item.DIB.functionField
            });
        });

        return result;
    }
}

module.exports = WMBUS_DECODER;
