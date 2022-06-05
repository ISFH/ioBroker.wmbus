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
const { SerialPort } = require('serialport');

let ReceiverModule;

const receiverPath = '/lib/receiver/';

class WirelessMbus extends utils.Adapter {

    constructor(options) {
        super({
            ...options,
            name: 'wireless-mbus',
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
        const objConnection = {
            '_id': 'info.connection',
            'type': 'state',
            'common': {
                'role': 'indicator.connected',
                'name': 'If connected to wM-Bus receiver',
                'type': 'boolean',
                'read': true,
                'write': false,
                'def': false
            },
            'native': {}
        };
        await this.objectHelper.createObject(objConnection._id, objConnection);

        const objRaw = {
            '_id': 'info.rawdata',
            'type': 'state',
            'common': {
                'role': 'value',
                'name': 'Telegram raw data if parser failed',
                'type': 'string',
                'read': true,
                'write': false,
                'def': false
            },
            'native': {}
        };
        await this.objectHelper.createObject(objRaw._id, objRaw);

        if (typeof this.config.aeskeys !== 'undefined') {
            this.config.aeskeys.forEach((item) => {
                if (item.key === 'UNKNOWN') {
                    this.needsKey.push(item.id);
                }
            });
        }

        this.receivers = this.getReceivers();
        this.setConnected(false);

        const port = (typeof this.config.serialPort !== 'undefined' ? this.config.serialPort : '/dev/ttyWMBUS');
        // @ts-ignore
        const baud = (typeof this.config.serialBaudRate !== 'undefined' ? parseInt(this.config.serialBaudRate) : 9600);
        const mode = (typeof this.config.wmbusMode !== 'undefined' ? this.config.wmbusMode : 'T');

        const receiverClass = this.getReceiverClass(this.config.deviceType);
        const receiverName = this.getReceiverName(this.config.deviceType);
        const receiverJs = `.${receiverPath}${receiverClass}`;

        try {
            if (fs.existsSync(receiverJs)) {
                ReceiverModule = require(receiverJs);
                this.receiver = new ReceiverModule({ path: port, baudRate: baud }, mode, this.dataReceived.bind(this), this.serialError.bind(this), {
                    debug: this.log.debug,
                    info: this.log.info,
                    error: this.log.error
                });
                this.log.debug(`Created device of type: ${receiverName}`);

                this.decoder = new WMBusDecoder({
                    debug: this.log.debug,
                    error: this.log.error
                }, this.config.drCacheEnabled);

                await this.receiver.init();
                this.setConnected(true);
            } else {
                this.log.error(`No or unknown adapter type selected! ${receiverClass}`);
            }
        } catch (e) {
            this.log.error(`Error opening serial port ${port} with baudrate ${baud}`);
            // @ts-ignore
            this.log.error(e);
            this.setConnected(false);
            return;
        }
    }

    getReceivers() {
        const receivers = {};
        const json = JSON.parse(fs.readFileSync(`${this.adapterDir}${receiverPath}receiver.json`, 'utf8'));
        Object.keys(json).forEach((item) => {
            if (fs.existsSync(this.adapterDir + receiverPath + json[item].js)) {
                receivers[item] = json[item];
            }
        });

        return receivers;
    }

    getReceiverClass(type) {
        if (type in this.receivers) {
            return this.receivers[type].js;
        }
        return type;
    }

    getReceiverName(type) {
        if (type in this.receivers) {
            return this.receivers[type].name;
        }
        return type;
    }

    getReceiverJs(type) {
        if (type in this.receivers) {
            return `.${receiverPath}${this.receivers[type].js}`;
        }
        return `.${receiverPath}${type}`;
    }

    serialError(err) {
        this.log.error(`Serialport error: ${err.message}`);
        this.setConnected(false);
        this.onUnload();
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
        this.setConnected(true);

        const id = this.parseID(data.rawData);

        if (data.rawData.length < 11) {
            if (id == 'ERR-XXXXXXXX') {
                this.log.info(`Invalid telegram received? ${data.rawData.toString('hex')}`);
            } else {
                this.log.debug(`Beacon of device: ${id}`);
            }
            return;
        }

        // check block list
        if (this.isDeviceBlocked(id)) {
            this.log.debug(`Device is blocked: ${id}`);
            return;
        }

        // look for AES key
        let key = this.getAesKey(id);

        if (typeof key !== 'undefined') {
            if (key === 'UNKNOWN') {
                key = undefined;
            } else {
                this.log.debug(`Found AES key: ${key}`);
            }
        }

        if (!this.decoder) {
            this.log.error('wmbus decoder has not be initialized!');
            return;
        }

        this.decoder.parse(data.rawData, data.containsCrc, key, data.frameType, (err, result) => {
            if (err) {
                this.log.debug(`Parser failed to parse telegram from device ${id}`);
                if (this.config.autoBlocklist) {
                    this.checkAutoBlocklist(id);
                }

                this.setState('info.rawdata', data.rawData.toString('hex'), true);
                this.checkWrongKey(id, err.code);
                return;
            }

            this.resetAutoBlocklist(id);

            const deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
            this.updateDevice(deviceId, result);
        });
    }

    parseID(data) {
        if (data.length < 8) {
            return 'ERR-XXXXXXXX';
        }

        const hexId = data.readUInt16LE(2);
        const manufacturer = String.fromCharCode((hexId >> 10) + 64)
            + String.fromCharCode(((hexId >> 5) & 0x1f) + 64)
            + String.fromCharCode((hexId & 0x1f) + 64);

        return `${manufacturer}-${data.readUInt32LE(4).toString(16).padStart(8, '0')}`;
    }

    isDeviceBlocked(id) {
        if ((typeof this.config.blacklist === 'undefined') || !this.config.blacklist.length) {
            return false;
        }

        const found = this.config.blacklist.find((item) => {
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
        const i = this.failedDevices.findIndex((dev) => dev.id == id);
        if (i === -1) {
            this.failedDevices.push({ id: id, count: 1 });
        } else {
            this.failedDevices[i].count++;
            if (this.failedDevices[i].count >= 10) {
                this.config.blacklist.push({ id: id });
                this.log.warn(`Device ${id} is now blocked until adapter restart!`);
            }
        }
    }

    resetAutoBlocklist(id) {
        const i = this.failedDevices.findIndex((dev) => dev.id == id);
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
        if ((typeof this.config.aeskeys === 'undefined') || !this.config.aeskeys.length) {
            return undefined;
        }

        // look for perfect match
        const perfectMatch = this.config.aeskeys.find((item) => {
            if (typeof item.id === 'undefined') {
                return false;
            } else {
                return item.id == id;
            }
        });

        if (typeof perfectMatch !== 'undefined') { // found
            return perfectMatch.key;
        }

        // which device names start with our id
        const candidates = this.config.aeskeys.filter((item) => {
            if (typeof item.id === 'undefined') {
                return false;
            } else {
                return id.startsWith(item.id);
            }
        });

        if (candidates.length == 1) { // only 1 match - take it
            return candidates[0].key;
        }

        if (candidates.length > 1) { // more than one, find the best
            let len = candidates[0].id.length;
            let pos = 0;
            for (let i = 1; i < candidates.length; i++) {
                if (candidates[i].id.length > len) {
                    len = candidates[i].id.length;
                    pos = i;
                }
            }
            return candidates[pos].key;
        }

        return undefined;
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
            const name = `${deviceId}.info.${key}`;
            if ((typeof this.stateValues[name] === 'undefined') || (this.stateValues[name] !== data.deviceInformation[key])) {
                this.stateValues[name] = data.deviceInformation[key];
                await this.objectHelper.updateState(name, data.deviceInformation[key]);
            }
        }

        await this.objectHelper.updateState(`${deviceId}.info.Updated`, Math.floor(Date.now() / 1000));

        for (const item of data.dataRecord) {
            const name = `${deviceId}.data.${item.number}-${item.storageNo}-${item.type}`;
            if (this.config.alwaysUpdate || (typeof this.stateValues[name] === 'undefined') || (this.stateValues[name] !== item.value)) {
                this.stateValues[name] = item.value;

                let val = item.value;
                if (this.config.forcekWh) {
                    if (item.unit == 'Wh') {
                        val = val / 1000;
                    } else if (item.unit == 'J') {
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
                        this.sendTo(obj.from, obj.command, [{ comName: 'Not available' }], obj.callback);
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
    module.exports = (options) => new WirelessMbus(options);
} else {
    new WirelessMbus();
}
