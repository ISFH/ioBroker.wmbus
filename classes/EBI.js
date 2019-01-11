// Embit WMBUS Stack ported from Python tester demo
// Christian Landvogt - 2019

const SerialPort = require('serialport');

class EBI {

    constructor(logger) {
		this.logger = (typeof logger === 'function' ? logger : console.log);

        this.BAUDRATES = {
            1200: 0x01,
            2400: 0x02,
            4800: 0x03,
            9600: 0x04,
            19200: 0x05,
            38400: 0x06,
            57600: 0x07,
            115200: 0x08,
            230400: 0x09,
            460800: 0x0A,
            921600: 0x0B
        };

        this.BAUDRATE_DEFAULT = 9600;

        this.FLOW_CONTROL_DISABLED = 0x00;
        this.FLOW_CONTROL_MODEM_MODE = 0x01;
        this.FLOW_CONTROL_P2P_MODE = 0x02;

        this.RX_POLICY_ALLWAYS_ON = 0x00;
        this.RX_POLICY_ALLWAYS_OFF = 0x01;
        this.RX_POLICY_FOLLOW_MCU = 0x02;

        this.MCU_POLICY_ALLWAYS_ON = 0x00;
        this.MCU_POLICY_ALLWAYS_OFF = 0x01;
        this.MCU_POLICY_FOLLOW_UART = 0x02;
        this.MCU_POLICY_INTERVAL = 0x03;
        this.MCU_POLICY_W_MBUS = 0x04;

        this.JOINING_NETWORK_PREFERENCE = {
            "JOINING_NETWORK_NOT_PERMITTED": 0x00,
            "JOINING_NETWORK_PERMITTED": 0x01
        };

        this.SCAN_MODE = {
            "SCAN_MODE_ENERGY": 0x00,
            "SCAN_MODE_PASSIVE": 0x01,
            "SCAN_MODE_ACTIVE": 0x02
        };

        this.EXECUTION_STATUS_BYTE_VALUE = {
            0x00: "Success",
            0x01: "Generic error",
            0x02: "Parameters not accepted",
            0x03: "Operation timeout",
            0x04: "No memory",
            0x05: "Unsupported",
            0x06: "Busy",
            0x07: "Duty Cycle"
        };

        // Protocol and general device parameters
        this.CMD_DEVICE_INFORMATION = 0x01;
        this.CMD_DEVICE_STATE = 0x04;
        this.CMD_RESET = 0x05;
        this.CMD_FIRMWARE_VERSION = 0x06;
        this.CMD_RESTORE_SETTINGS = 0x07;
        this.CMD_SAVE_SETTINGS = 0x08;
        this.CMD_UART_CONFIG = 0x09;

        // Bootloader commands
        this.CMD_BOOTLOADER_ENTER = 0x70;
        this.CMD_BOOTLOADER_SETOPTIONS = 0x71;
        this.CMD_BOOTLOADER_ERASEMEMORY = 0x78;
        this.CMD_BOOTLOADER_WRITE = 0x7A;
        this.CMD_BOOTLOADER_READ = 0x7B;
        this.CMD_BOOTLOADER_COMMIT = 0x7F;

        this.port = null;

        this.__parser_buffer__ = Buffer.alloc(0);
        this.__parser_length__ = -1;

        this.__read_callbacks__ = [];
        this.__read_timeouts__ = [];
    }

    __On_ebi_data__(data) {
        let that = this;

        that.__parser_buffer__ = Buffer.concat([that.__parser_buffer__, data]);

        if (that.__parser_length__ == -1) {
            if (that.__parser_buffer__.length < 2) {
                return
            }
            that.__parser_length__ = (that.__parser_buffer__[0] << 8) + that.__parser_buffer__[1];
            if ((that.__parser_length__ <= 4) || (that.__parser_length__ >= 513)) {
                that.__parser_length__ = -1;
                that.__parser_buffer__ = Buffer.alloc(0);
                this.logger("Error: Incorrect data length");
            }
        }

        if (that.__parser_buffer__.length >= that.__parser_length__) {
            let emitBuffer = that.__parser_buffer__.slice(0, that.__parser_length__);
            that.__parser_buffer__ = that.__parser_buffer__.slice(that.__parser_length__);
            that.__parser_length__ = -1;

            //this.logger(emitBuffer);
            if (that.__read_callbacks__.length) {
                clearTimeout(that.__read_timeouts__.shift());
                that.__read_callbacks__.shift()(emitBuffer);
            } else {
                that.__Default_ebi_callback__(emitBuffer);
            }
        }
    }

    __Checksum__(data) {
        let chksum = 0;
        //chksum = data.reduce(function(acc, cur) { return acc + cur; });
        for (const val of data.values()) {
            chksum += val;
        }
        return chksum % 256;
    }

    __Build_Ebi_package__(message_id, payload) {
        let that = this;
        if (!Buffer.isBuffer(payload)) {
            if (typeof payload === 'undefined') {
                payload = Buffer.alloc(0);
            } else {
                payload = Buffer.from(payload);
            }
        }

        var res = Buffer.alloc(3 + payload.length + 1);
        res[0] = payload.length >> 8;
        res[1] = (payload.length + 4) & 0xFF;
        res[2] = message_id;
        payload.copy(res, 3);
        //let sum = 0;
        //for (const val of res.values()) {
        //    sum += val;
        //}
        //res[res.length - 1] = sum % 256;
        res[res.length - 1] = that.__Checksum__(res);
        this.logger(res);
        return res;
    }

    __Read_ebi_package__(message_id, callback) {
        let that = this;
        let message_id_read = message_id | 0x80;

        that.__read_callbacks__.push(function(data) {
            if (!Buffer.isBuffer(data)) {
                callback && callback({message_id: 0, payload: Buffer.alloc(0), transmission_ok: false});
            } else {
                let payload = data.slice(3, data.length - 1);
                let chkRead = data[data.length - 1];
                data[data.length - 1] = 0;
                let chk = that.__Checksum__(data);
                if (chk !=  chkRead) {
                    callback && callback(undefined, { message: 'Incorrect checksum' });
                    return;
                }

                let return_id = data[2];
                if (message_id_read == return_id) {
                    callback && callback({message_id: return_id, payload: payload, transmission_ok: true});
                } else {
                    callback && callback(undefined, { message: 'The data received have a different ID from that expected' });

                }
            }
        });

        that.__read_timeouts__.push(setTimeout(function() {
            that.__read_callbacks__.shift();
            that.__read_timeouts__.shift();
            callback && callback({message_id: 0, payload: Buffer.alloc(0), transmission_ok: false});
        }, 3000));
    }

    __Default_ebi_callback__(data) {
        let that = this;
        if (!Buffer.isBuffer(data)) {
            return;
        } else {
            let payload = data.slice(3, data.length - 1);
            let chkRead = data[data.length - 1];
            data[data.length - 1] = 0;
            let chk = that.__Checksum__(data);
            if (chk !=  chkRead) { // silently discard packets with incorrect checksum
                return;
            }

            let return_id = data[2];
            if (return_id == 0xE0) { //Received data
                that.dataReceived(payload);
            } else {
                this.logger("Data but no callback!");
            }
        }
    }

    dataReceived(payload) {
        this.logger("No data handling for incoming packets defined!'");
    }

    __Send_ebi_command__(message_id, payload, callback) {
        let that = this;

        if (typeof payload === 'function') {
            callback = payload;
            payload = Buffer.alloc(0);
        }

        // the EXECUTION STATUS BYTE (esb) is present only in function that have
        // a payload
        let esb_present = (payload.length ? true : false);

        // create a EBI_v1p0 frame
        let pkg = that.__Build_Ebi_package__(message_id, payload);

        // before give a timeout error, the function try 3 times to send the
        // command and read the answer
        // JS port: currently no retry!
        that.port.write(pkg, function(error) {
            if (error) {
                callback && callback(undefined, { message: 'Error writing to serial port' });
                return;
            }

            that.__Read_ebi_package__(message_id, function(res, err) {
                if (err) {
                    callback && callback(undefined, err);
                    return;
                }

                if (res.transmission_ok) {
                    let transmission_ok;
                    if (esb_present) {
                        transmission_ok = that.EXECUTION_STATUS_BYTE_VALUE[res.payload[0]];
                        if (res.payload.length == 1) {
                            //if payload is only 1 byte, this byte is the execution
                            // status byte, the function erase the payload's field
                            payload = Buffer.alloc(0);
                        } else {
                            payload = res.payload.slice(1);
                        }
                    } else {
                        // if the function doesn't have the esb, but trasmission_ok
                        // is True, then trasmission_ok assumes the value "Success"
                        payload = res.payload;
                        transmission_ok = "Success";
                    }
                    callback && callback({message_id: res.message_id, payload: payload, pkg: pkg, transmission_ok: transmission_ok}); 
                    return;
                }
            });
        });
    }

    Device_Information(callback) {
        let message_id = 0x01;
        this.__Send_ebi_command__(message_id, callback);
    }

    Device_State(callback) {
        let message_id = 0x04;
        this.__Send_ebi_command__(message_id, callback);
    }

    Reset(callback) {
        let message_id = 0x05;
        this.__Send_ebi_command__(message_id, callback);
    }

    Firmware_version(callback) {
        let message_id = 0x06;
        this.__Send_ebi_command__(message_id, callback);
    }

    Restore_factory_default_settings(callback) {
        let message_id = 0x07;
        this.__Send_ebi_command__(message_id, callback);
    }

    Save_settings(callback) {
        let message_id = 0x08;
        this.__Send_ebi_command__(message_id, callback);
    }

    Serial_port_configuration(baudrate, flow_control, callback) {
        let that = this;
        if (typeof flow_control === 'function') {
            callback = flow_control;
            flow_control = this.FLOW_CONTROL_DISABLED;
        }

        let message_id = 0x09;
        // If the baud rate is wrong to assign the default
        if (!(baudrate in this.BAUDRATES)) {
            baudrate = this.BAUDRATE_DEFAULT;
        }
        payload = Buffer.from([this.BAUDRATES[baudrate], flow_control]);

        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Output_power_set(power, callback) {
        if (typeof power == 'function') {
            callback = power;
            power = null;
        }

        let message_id = 0x10;
        let payload = null;
        // TODO: Check: is this correct???
        if (power != null) {
            if (power >= 0) {
                payload = Buffer.from([power]);
            } else {
                payload = Buffer.from([(-power) & 0x80]);
            }
            this.__Send_ebi_command__(message_id, payload, callback);
        } else {
            this.__Send_ebi_command__(message_id, callback);
        }
    }

    Output_power_get(callback) {
        this.Output_power_set(callback)
    }

    Physical_address_set(address, callback) {
        let message_id = 0x20;

        if (typeof address === 'function') {
            callback = address;
            this.__Send_ebi_command__(message_id, callback);
            return;
        }

        let payload = Buffer.from(address);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Physical_address_get(callback) {
        this.Physical_address_set(callback);
    }

    Network_stop(callback) {
        let message_id = 0x30;
        this.__Send_ebi_command__(message_id, callback);
    }

    Network_start(callback) {
        let message_id = 0x31;
        this.__Send_ebi_command__(message_id, callback);
    }

    // Bootloader commands are not ported (yet)
}


class EBI_WMBUS extends EBI {

    constructor(logger) {
        super(typeof logger === 'function' ? logger : console.log);
        this.CHANNELS_WMB = {
            1: 0x01,  // 169.40625[MHz] @4.8[kbps]
            2: 0x02,  // 169,41875[MHz] @4.8[kbps]
            3: 0x03,  // 169,43125[MHz] @2.4[kbps]
            4: 0x04,  // 169,44375[MHz] @2.4[kbps]
            5: 0x05,  // 169,45625[MHz] @4.8[kbps]
            6: 0x06,  // 169,46875[MHz] @4.8[kbps]
            7: 0x07,  // 169,43750[MHz] @19.2[kbps]
            13: 0x0D,  // 868.030[MHz] @4.8[kbps]
            14: 0x0E,  // 868,090[MHz] @4.8[kbps]
            15: 0x0F,  // 868,150[MHz] @4.8[kbps]
            16: 0x10,  // 868.210[MHz] @4.8[kbps]
            17: 0x11,  // 868.270[MHz] @4.8[kbps]
            18: 0x12,  // 868.330[MHz] @4.8[kbps]
            19: 0x13,  // 868.390[MHz] @4.8[kbps]
            20: 0x14,  // 868.450[MHz] @4.8[kbps]
            21: 0x15,  // 868.510[MHz] @4.8[kbps]
            22: 0x16,  // 868.570[MHz] @4.8[kbps]
            23: 0x17,  // 868,300[MHz] @16,384[kbps]
            24: 0x18,  // 868,300[MHz] @16,384[kbps]
            25: 0x19,  // 868,950[MHz] @66.666[kbps]
            26: 0x1A,  // 868.300[MHz] @16.384[kbps]
            27: 0x1B,  // 868.030[MHz] @2.4[kbps]
            28: 0x1C,  // 868.090[MHz] @2.4[kbps]
            29: 0x1D,  // 868.150[MHz] @2.4[kbps]
            30: 0x1E,  // 868.210[MHz] @2.4[kbps]
            31: 0x1F,  // 868.270[MHz] @2.4[kbps]
            32: 0x20,  // 868.330[MHz] @2.4[kbps]
            33: 0x21,  // 868.390[MHz] @2.4[kbps]
            34: 0x22,  // 868.450[MHz] @2.4[kbps]
            35: 0x23,  // 868.510[MHz] @2.4[kbps]
            36: 0x24,  // 868.570[MHz] @2.4[kbps]
            37: 0x25,  // 868.950[MHz] @100[kbps]
            38: 0x26  // 869,525[MHz] @50[kbps]
        };

        this.RX_POLICY_ALLWAYS_ON_WMB = 0x00;
        this.RX_POLICY_ALLWAYS_OFF_WMB = 0x01;
        // Receive window after transmission (whose duration is defined by WMBUS
        // standard [3]); a notification (received data notification 0xE0) is
        // generated if a packet is received during this receive window.
        this.RX_POLICY_RECEIVED_WINDOW_WMB = 0x02;
        // Receive window after transmission (whose duration is defined by WMBUS
        // standard [3]); a notification will be generated if a packet is received
        // (just like mode 0x02); however, even if no packet is received, a
        // notification (device state notification, 0x84, with code 0x51) is
        // generated to indicate the end of the receiving window.
        this.RX_POLICY_RECEIVED_WITH_END_WINDOW_WMB = 0X03;

        this.MCU_POLICY_ALLWAYS_ON_WMB = 0x00;
        this.MCU_POLICY_ALLWAYS_OFF_WMB = 0x01;

        this.NETWORK_ROLE_WMB = {
            "NETWORK_ROLE_METER": 0x00,
            "NETWORK_ROLE_OTHER_DEVICE": 0x01
        };
    }

    Operating_channel_set(channel, callback) {
        if (typeof channel === 'function') {
            callback = channel;
            channel = null;
        }

        let message_id = 0x11;
        if (channel in this.CHANNELS_WMB) {
            let payload = Buffer.from([this.CHANNELS_WMB[channel]]);
            this.__Send_ebi_command__(message_id, payload, callback);
        } else {
            this.__Send_ebi_command__(message_id, callback);
        }
    }

    Operating_channel_get(callback) {
        this.Operating_channel_set(callback);
    }

    Energy_save_set(rx_policy, mcu_policy, callback) {
        let message_id = 0x13;
        let payload = null;
        if (typeof rx_policy === 'function') {
            callback = rx_policy;
            //rx_policy = this.RX_POLICY_ALLWAYS_ON_WMB;
            //mcu_policy = this. MCU_POLICY_ALLWAYS_ON_WMB;
            this.__Send_ebi_command__(message_id, callback);
            return;
        } 

        if (typeof mcu_policy === 'function') {
            callback = mcu_policy;
            mcu_policy = this. MCU_POLICY_ALLWAYS_ON_WMB;
        } 
        payload = Buffer.from([rx_policy, mcu_policy]);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Energy_save_get(callback) {
        this.Energy_save_set(callback);
    }

    Network_address_set(address, callback) {
        let message_id = 0x21;

        if (typeof address == 'function') {
            callback = address;
            this.__Send_ebi_command__(message_id, callback);
            return;
        }

        let payload = Buffer.from(address);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Network_address_get(callback) {
        this.Network_address_set(callback);
    }

    Network_role_set(role, callback) {
        let message_id = 0x23;
        if (typeof role === 'function') {
            callback = role;
            this.__Send_ebi_command__(message_id, callback);
            return;
        }

        let payload = Buffer.from([this.NETWORK_ROLE_WMB[role]]);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Network_role_get(callback) {
        this.Network_role_set(callback);
    }

    Network_automated_settings_set(creation, callback) {
        let message_id = 0x24;
        if (typeof creation === 'function') {
            callback = creation;
            this.__Send_ebi_command__(message_id, callback);
            return;
        }

        let payload = Buffer.from([creation << 7 | 0x00, creation << 15 | 0x00]);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Network_automated_settings_get(callback) {
        this.Network_automated_settings_set(callback);
    }

    Network_preferences_set(network_preference, callback) {
        let message_id = 0x25;
        if (typeof network_preference === 'function') {
            callback = network_preference;
            this.__Send_ebi_command__(message_id, callback);
            return;
        }

        let payload = Buffer.from([network_preference]);
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    Network_preferences_get(callback) {
        this.Network_preferences_set(callback);
    }

    // TODO: Does not work?
    network_security(enable_security, key_shared, use_encryption, update_key, network_key, callback) {
        let message_id = 0x26;

        if (typeof enable_security === 'function') {
            callback = enable_security;
            enable_security = false;
        }
        if (typeof key_shared === 'function') {
            callback = key_shared;
            key_shared = false;
        }
        if (typeof use_encryption === 'function') {
            callback = use_encryption;
            use_encryption = false;
        }
        if (typeof update_key === 'function') {
            callback = update_key;
            update_key = false;
        }
        if (typeof network_key === 'function') {
            callback = network_key;
            network_key = false;
        }

        let payload = null;
        if ((typeof update_key !== 'undefined') && (typeof network_key !== 'undefined')) {
            let key = Buffer.from(network_key);
            payload = Buffer.alloc(key.length + 1);
            key.copy(payload, 1);
        } else {
            payload = Buffer.alloc(1);
        }

        enable_security = (typeof enable_security !== 'undefined' ? enable_security : false);
        key_shared = (typeof key_shared !== 'undefined' ? key_shared : false);
        use_encryption = (typeof use_encryption !== 'undefined' ? use_encryption : false);
        update_key = (typeof update_key !== 'undefined' ? update_key : false);

        let mask = 0x00;
        if (enable_security) mask |= (1 << 7);
        if (key_shared) mask |= (1 << 6);
        if (use_encryption) mask |= (1 << 5);
        if (update_key) mask |= (1 << 0);

        payload[0] = mask;
        this.__Send_ebi_command__(message_id, payload, callback);
    }

    // TODO: Send_data untested - seems fishy
    Send_data(data, channel, output_power, slow, type_b, timing, l_field, c_field, address, opts, callback) {
        let message_id = 0x50;
        //let OPTION_DEFAULT = 0x0000;
		let opt = (opts ? opts : 0x0000);
        let mask = 0x0000;
        let payload = [];

        /*if (opts) {
            payload.push((option >> 8) & 0xFF);
            payload.push(option & 0xFF);
        } else {
            payload.push(0x00);
            payload.push(0x00);
        }*/

        if (channel) {
            mask |= 1 << 15;
            payload.push(channel);
        }
        if (output_power) {
            mask |= 1 << 14;
            payload.push(output_power);
        }
		if (slow) {
			mask |= 1 << 6;
		}
		if (type_b) {
			mask |= 1 << 5;
		}
		if (timing) {
			mask |= 1 << 4;
			payload.push(timing);
		}
        if (l_field) {
            mask |= 1 << 2;
            payload.push(l_field);
        }
        if (c_field) {
            mask |= 1 << 1;
            payload.push(c_field);
        }

        if (address) {
            mask |= 1;
            opt |= mask;
            payload = Buffer.concat([Buffer.from([(opt >> 8) & 0xFF, opt & 0xFF]), Buffer.from(payload), Buffer.from(address), data]);
        } else {
            opt |= mask;
            payload = Buffer.concat([Buffer.from([(opt >> 8) & 0xFF, opt & 0xFF]), Buffer.from(payload), data]);
        }

        this.__Send_ebi_command__(message_id, payload, callback);
    }

    init(dev, opts) {
        let that = this;
        that.port = new SerialPort(dev, opts);
        that.port.on('data', that.__On_ebi_data__.bind(that));
    }

    dataReceived(payload) {
        //this.logger("Telegram received");

        let opts = payload[0] * 0x100 + payload[1];
        let rssi = false;
        let ts = false;
        let type_b = false;
        let l_field = false;
        let c_field = false;
        let address = false;
        let i = 2;
        if (opts & 0x8000) { // rssi
            rssi = payload.readInt8(i);
            i++;
        }
        if (opts & 0x0010) { // frame type B
            type_b = true;
        }
        if (opts & 0x0008) { // timestamp since power on
            ts = payload.readUInt32BE(i) / 32768;
            i += 4;
        }
        if (opts & 0x0004) { // L field
            l_field = payload[i];
            i++;
        }
        if (opts & 0x0002) { // C Field
            c_field = payload[i];
            i++;
        }

		let m_field = 0;
		let manufacturer_id = "";
		let a_field = 0;
		let a_field_id = "";
		let a_field_ver = 0;
		let a_field_type = 0;
        if (opts & 0x0001) { // address
			m_field = payload.readUInt16LE(i);
			manufacturer_id = String.fromCharCode((m_field >> 10) + 64) + String.fromCharCode(((m_field >> 5) & 0x1f) + 64) + String.fromCharCode((m_field & 0x1f) + 64);
			i += 2;
			a_field = payload.slice(i, i+6);
			a_field_id = a_field.readUInt32LE(0).toString(16);
			i += 4;
			a_field_ver = payload[i++];
			a_field_type = payload[i++];
        }

        let res = {
			rssi: rssi,
			bframe: type_b,
			TS: ts,
			lfield: l_field,
			cfield: c_field,
			mfield: m_field,
			manufacturer: manufacturer_id,
			afield: a_field,
			afield_id: a_field_id,
			afield_type: a_field_type,
			afield_ver: a_field_type,
			data: payload.slice(i)
		};

		//this.logger(res);

		if (typeof this.incomingData === 'function') {
			this.incomingData(res);
		}
    }
}

module.exports = EBI_WMBUS;
