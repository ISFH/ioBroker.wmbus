/*
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * ioBroker wmbus adapter
 *
 * Copyright (c) 2019 ISFH
 * This work is licensed under the terms of the GPL2 license.
 * See NOTICE for detailed listing of other contributors
 *
 * This file contains large portions from the ioBroker mbus adapter
 * by Apollon77 which is originally published under the MIT License.
 *
 * Adapter loading data from an wM-Bus devices
 *
 */

'use strict';

const utils = require('@iobroker/adapter-core');
const fs = require('fs');

const WMBusDecoder = require('./lib/wmbus_decoder.js');
const ObjectHelper = require('./lib/ObjectHelper.js');
const SerialPort = require('serialport');

let ReceiverModule;

const receiverPath = '/lib/receiver/';

class Wmbus extends utils.Adapter {

    constructor(options) {
        super({
            ...options,
            name: 'wmbus',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.objectHelper = new ObjectHelper(this);

        this.receivers = {};

        this.connected = false;
        this.receiver = null;
        this.decoder = null;

        this.failedDevices = [];
        this.needsKey = [];

        this.createdDevices = [];
        this.stateValues = {};
    }

    onUnload(callback) {
        try {
            this.receiver.port.close();
            this.receiver = undefined;
            this.decoder = undefined;
            callback && callback();
        } catch (e) {
            callback && callback();
        }
    }

    async onReady() {
        let objConnection = {
            "_id":  "info.connection",
            "type": "state",
            "common": {
                "role": "indicator.connected",
                "name": "If connected to wM-Bus receiver",
                "type": "boolean",
                "read": true,
                "write": false,
                "def": false
            },
            "native": {}
        };
        await this.objectHelper.createObject(objConnection._id, objConnection);

        let objRaw = {
            "_id":  "info.rawdata",
            "type": "state",
            "common": {
                "role": "value",
                "name": "Telegram raw data if parser failed",
                "type": "string",
                "read": true,
                "write": false,
                "def": false
            },
            "native": {}
        };
        await this.objectHelper.createObject(objRaw._id, objRaw);

        if (typeof this.config.aeskeys !== 'undefined') {
            this.config.aeskeys.forEach(function (item) {
                if (item.key === "UNKNOWN") {
                    needsKey.push(item.id);
                }
            });
        }

        this.receivers = this.getReceivers();
        this.setConnected(false);

        let port = (typeof this.config.serialPort !== 'undefined' ? this.config.serialPort : '/dev/ttyWMBUS');
        let baud = (typeof this.config.serialBaudRate !== 'undefined' ? this.config.serialBaudRate : 9600);
        let mode = (typeof this.config.wmbusMode !== 'undefined' ? this.config.wmbusMode : 'T');


        try {
            let receiverJs = `${this.config.deviceType}.js`;

            if (Object.keys(this.receivers).includes(receiverJs)) {
                let adapter = this;

                ReceiverModule = require(`.${receiverPath}${receiverJs}`);
                this.receiver = new ReceiverModule(this.log.debug);
                this.receiver.incomingData = this.dataReceived;
                this.receiver.init(port, { baudRate: parseInt(baud) }, mode);
                this.receiver.port.on('error', this.serialError);

                this.log.debug(`Created device of type: ${this.receivers[receiverJs].name}`);

                this.decoder = new WMBusDecoder({
                    debug: this.log.debug,
                    error: this.log.error
                }, this.config.drCacheEnabled);
            } else {
                this.log.error(`No or unknown adapter type selected! ${this.config.deviceType}`);
            }
        } catch(e) {
            this.log.error(`Error opening serial port ${port} with baudrate ${baud}`);
            this.log.error(e);
            this.setConnected(false);
            return;
        }

        this.setConnected(true);
    }

    getReceivers() {
        let receivers = {};
        let json = JSON.parse(fs.readFileSync(`${this.adapterDir}${receiverPath}receiver.json`, 'utf8'));
        Object.keys(json).forEach((item) => {
            if (fs.existsSync(this.adapterDir + receiverPath + item)) {
                receivers[item] = json[item];
            }
        });

        return receivers;
    }

    serialError(err) {
        adapter.log.error(`Serialport errror: ${err.message}`);
        adapter.setConnected(false);
        adapter.onUnload();
    }

    setConnected(isConnected) {
        if (this.connected !== isConnected) {
            this.connected = isConnected;
            this.setState('info.connection', this.connected, true, err => {
                if (err) {
                    this.log.error(`Can not update connected state: ${err}`);
                } else {
                    this.log.debug(`connected set to ${this.connected}`);
                }
            });
        }
    }

    async dataReceived(data) {
        adapter.setConnected(true);

        let id = adapter.parseID(data.raw_data);

        if (data.raw_data.length < 11) {
            if (id == "ERR-XXXXXXXX") {
                this.log.info(`Invalid telegram received? ${data.raw_data.toString('hex')}`);
            } else {
                this.log.debug(`Beacon of device: ${id}`);
            }
            return;
        }

        // check block list
        if (adapter.isDeviceBlocked(id)) {
            return;
        }

        // look for AES key
        let key = adapter.getAesKey(id);

        if (typeof key !== 'undefined') {
            if (key === "UNKNOWN") {
                key = undefined;
            } else {
                this.log.debug(`Found AES key: ${key}`);
            }
        }

        adapter.decoder.parse(data.raw_data, data.contains_crc, key, data.frame_type, (err, result) => {
            if (err) {
                if (adapter.config.autoBlocklist) {
                  adapter.checkAutoBlocklist(id);
                }

                adapter.checkWrongKey(id, err.code);
                return;
            }

            adapter.resetAutoBlocklist(id);

            let deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
            adapter.updateDevice(deviceId, result);
        });
    }

    parseID(data) {
        if (data.length < 8) {
            return "ERR-XXXXXXXX";
        }

        let hexId = data.readUInt16LE(2);
        let manufacturer = String.fromCharCode((hexId >> 10) + 64)
            + String.fromCharCode(((hexId >> 5) & 0x1f) + 64)
            + String.fromCharCode((hexId & 0x1f) + 64);

        return `${manufacturer}-${data.readUInt32LE(4).toString(16).padStart(8, '0')}`;
    }

    isDeviceBlocked(id) {
        if ((typeof this.config.blacklist === 'undefined') || this.config.blacklist.length) {
            return false;
        }

        let found = this.config.blacklist.find((item) => {
            if (typeof item.id === 'undefined') {
                return false;
            } else {
                return item.id == id;
            }
        });

        if (typeof found !== 'undefined') { // found
            return true;
        }
        return false;
    }

    checkAutoBlocklist(id) {
        let i = this.failedDevices.findIndex((dev) => dev.id == id);
        if (i === -1) {
            this.failedDevices.push({ id: id, count: 1 });
        } else {
            this.failedDevices[i].count++;
            if (this.failedDevices[i].count > 10) {
                this.config.blacklist.push({ id: id });
                this.log.warn(`Device ${id} is now blocked until adapter restart!`);
            }
        }
    }

    resetAutoBlocklist(id) {
        let i = this.failedDevices.findIndex((dev) => dev.id == id);
        if ((i !== -1) && (this.failedDevices[i].count)) {
            this.failedDevices[i].count = 0;
        }
    }

    checkWrongKey(id, code) {
        if (code == 9) { // ERR_NO_AESKEY
            if (typeof this.needsKey.find((el) => el == id) === 'undefined') {
                this.needsKey.push(id);
            }
        }
    }

    getAesKey(id) {
        if ((typeof this.config.aeskeys === 'undefined') || this.config.aeskeys.length) {
            return undefined;
        }

        let key;

        // look for perfect match
        let found = this.config.aeskeys.find((item) => {
            if (typeof item.id === 'undefined') {
                return false;
            } else {
                return item.id == id;
            }
        });

        if (typeof found !== 'undefined') { // found
            key = found.key;
        } else { // which devices names start with our id
            found = this.config.aeskeys.filter((item) => {
                if (typeof item.id === 'undefined') {
                    return false;
                } else {
                    return id.startsWith(item.id);
                }
            });

            if (found.length == 1) { // only 1 match - take it
                key = found[0].key;
            } else if (found.length > 1) { // more than one, find the best
                let len = found[0].id.length;
                let pos = 0;
                for (let i = 1; i < found.length; i++) {
                    if (found[i].id.length > len) {
                        len = found[i].id.length;
                        pos = i;
                    }
                }
                key = found[pos].key;
            }
        }

        return key;
    }

    async updateDevice(deviceId, result) {
        if (this.createdDevices.indexOf(deviceId) == -1) {
            await this.createDeviceObjects(deviceId, result);
        }

        this.updateDeviceStates(deviceId, result);
    }

    async createDeviceObjects(deviceId, data) {
        this.log.debug(`Creating device: ${deviceId}`);
        await this.objectHelper.createDeviceOrChannel('device', deviceId);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.data`);
        await this.objectHelper.createDeviceOrChannel('channel', `${deviceId}.info`);

        for (const key of Object.keys(data.deviceInformation)) {
            await this.objectHelper.createInfoState(deviceId, key);
        }

        await this.objectHelper.createInfoState(deviceId, 'Updated');

        for (const item of data.dataRecord) {
            await this.objectHelper.createDataState(deviceId, item);
        }

        this.createdDevices.push(deviceId);
    }

    async updateDeviceStates(deviceId, data) {
        this.log.debug(`Updating device: ${deviceId}`);
        for (const key of Object.keys(data.deviceInformation)) {
            let name = `${deviceId}.info.${key}`;
            if ((typeof this.stateValues[name] === 'undefined') || (this.stateValues[name] !== data.deviceInformation[key])) {
                this.stateValues[name] = data.deviceInformation[key];
                await this.objectHelper.updateState(name, data.deviceInformation[key]);
            }
        }

        await this.objectHelper.updateState(`${deviceId}.info.Updated`, Math.floor(Date.now() / 1000));

        for (const item of data.dataRecord) {
            let name = `${deviceId}.data.${item.number}-${item.storageNo}-${item.type}`;
            if (this.config.alwaysUpdate || (typeof this.stateValues[name] === 'undefined') || (this.stateValues[name] !== item.value)) {
                this.stateValues[name] = item.value;

                let val = item.value;
                if (this.config.forcekWh) {
                    if (item.unit == "Wh") {
                        val = val / 1000;
                    } else if (item.unit == "J") {
                        val = val / 3600000;
                    }
                }

                this.log.debug(`Value ${name}: ${val}`);
                await this.objectHelper.updateState(name, val);
            }
        }
    }

    onMessage(obj) {
        if (typeof obj === 'object' && obj.callback) {
            switch (obj.command) {
                case 'listUart':
                    if (SerialPort) {
                        SerialPort.list().then(
                            ports => {
                                this.log.info('List of port: ' + JSON.stringify(ports));
                                this.sendTo(obj.from, obj.command, ports, obj.callback);
                            },
                            err => this.log.error(JSON.stringify(err))
                        );
                    } else {
                        this.log.warn('Module serialport is not available');
                        this.sendTo(obj.from, obj.command, [{ comName: 'Not available'}], obj.callback);
                    }
                    break;
                case 'listReceiver':
                    this.sendTo(obj.from, obj.command, this.receivers, obj.callback);
                    break;
                case 'needsKey':
                    this.sendTo(obj.from, obj.command, this.needsKey, obj.callback);
                    break;
            }
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new Wmbus(options);
} else {
    new Wmbus();
}
