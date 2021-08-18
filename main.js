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
const SerialPort = require('serialport');

let adapter;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {
        name: 'wmbus'
    });

    adapter = new utils.Adapter(options);

    adapter.on('ready', main);
    adapter.on('message', processMessage);
    adapter.on('unload', callback => {
        onClose(callback);
    });

    return adapter;
}

const receiverPath = '/lib/receiver/';
let ReceiverModule;
let receiver = null;
let receiverAvailable = {};
let decoder = null;
let createdDevices = [];
let connected = false;
let stateValues = {};
let needsKey = [];
let failedDevices = [];

let units2roles = {
    'value.power.consumption': [ 'Wh', 'kWh', 'MWh', 'GWh', 'J', 'kJ', 'MJ', 'GJ' ],
    'value.power': [ 'W', 'kW', 'MW', 'J/h', 'GJ/h' ],
    'value.temperature': [ '°C', 'K', '°F' ],
    'value.volume': [ 'm³', 'feet³' ],
    'value.duration': [ 's', 'min', 'h', 'd', 'months', 'years' ],
    'value.price': [ '€', '$', 'EUR', 'USD' ],
    'value.mass': [ 'kg', 't' ],
    'value.flow': [ 'm³/h', 'm³/min', 'm³/s', 'kg/h' ],
    'value.pressure': [ 'bar' ],
    'value.current': [ 'A' ],
    'value.voltage': [ 'V' ]
};

function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter.setState('info.connection', connected, true, err => {
            // analyse if the state could be set (because of permissions)
            if (err) {
                adapter.log.error(`Can not update connected state: ${err}`);
            } else {
                adapter.log.debug(`connected set to ${connected}`);
            }
        });
    }
}

function onClose(callback) {
    try {
        receiver.port.close();
    }
    catch (e) { }
    finally {
        decoder = undefined;
        receiver = undefined;
    }

    callback && callback();
}


function parseID(data) {
    if (data.length < 8) {
        return "ERR-XXXXXXXX";
    }

    let hexId = data.readUInt16LE(2);
    let manufacturer = String.fromCharCode((hexId >> 10) + 64)
        + String.fromCharCode(((hexId >> 5) & 0x1f) + 64)
        + String.fromCharCode((hexId & 0x1f) + 64);

    return `${manufacturer}-${data.readUInt32LE(4).toString(16).padStart(8, '0')}`;
}

function isDeviceBlocked(id) {
    if ((typeof adapter.config.blacklist === 'undefined') || adapter.config.blacklist.length) {
        return false;
    }

    let found = adapter.config.blacklist.find((item) => {
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

function getAesKey(id) {
    if ((typeof adapter.config.aeskeys === 'undefined') || adapter.config.aeskeys.length) {
        return undefined;
    }

    let key;

    // look for perfect match
    let found = adapter.config.aeskeys.find((item) => {
        if (typeof item.id === 'undefined') {
            return false;
        } else {
            return item.id == id;
        }
    });

    if (typeof found !== 'undefined') { // found
        key = found.key;
    } else { // which devices names start with our id
        found = adapter.config.aeskeys.filter((item) => {
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

async function dataReceived(data) {
    setConnected(true);

    let id = parseID(data.raw_data);

    if (data.raw_data.length < 11) {
        if (id == "ERR-XXXXXXXX") {
            adapter.log.info(`Invalid telegram received? ${data.raw_data.toString('hex')}`);
        } else {
            adapter.log.debug(`Beacon of device: ${id}`);
        }
        return;
    }

    // check block list
    if (isDeviceBlocked(id)) {
        return;
    }

    // look for AES key
    let key = getAesKey(id);

    if (typeof key !== 'undefined') {
        if (key === "UNKNOWN") {
            key = undefined;
        } else {
            adapter.log.debug(`Found AES key: ${key}`);
        }
    }

    decoder.parse(data.raw_data, data.contains_crc, key, data.frame_type, function(err, result) {
        let i = failedDevices.findIndex((dev) => dev.id == id);

        if (err) {
            adapter.log.error(`Error parsing wMBus device: ${id}`);

            if (i === -1) {
                failedDevices.push({ id: id, count: 1 });
            } else {
                failedDevices[i].count++;
                if (failedDevices[i].count > 10) {
                    adapter.config.blacklist.push({ id: id });
                    adapter.log.warn(`Device ${id} is now blocked until adapter restart!`);
                    return;
                }
            }

            if (err.code == 9) { // ERR_NO_AESKEY
                if (typeof needsKey.find((el) => el == id) === 'undefined') {
                    needsKey.push(id);
                }
            }
            adapter.setState('info.rawdata', data.raw_data.toString('hex'), true);
            adapter.log.error(err.message);
            return;
        }

        if ((i !== -1) && (failedDevices[i].count)) {
            failedDevices[i].count = 0;
        }

        let deviceId = `${result.deviceInformation.Manufacturer}-${result.deviceInformation.Id}`;
        updateDevice(deviceId, result);
    });
}

async function updateDevice(deviceId, result) {
    if (createdDevices.indexOf(deviceId) == -1) {
        await createDeviceObjects(deviceId, result);
    }

    updateDeviceStates(deviceId, result);
}

async function createObject(name, obj) {
    try {
        await adapter.setObjectNotExistsAsync(name, obj);
    } catch (err) {
        adapter.log.error(`Error creating state object: ${err}`);
    }
}

async function updateState(name, value) {
    try {
        await adapter.setStateAsync(name, value, true);
    } catch (err) {
        adapter.log.error(err);
    }
}

async function createDeviceOrChannel(type, name) {
    await createObject(name, {
        type: type,
        common: {
            name: name,
        },
        native: {}
    });
}

async function createInfoState(deviceId, name) {
    await createObject(`${deviceId}.info.${name}`, {
        type: 'state',
        common: {
            name: name,
            role: 'value',
            type: 'mixed',
            read: true,
            write: false
        },
        native: {
            id: `.info.${name}`
        }
    });
}

async function createDataState(deviceId, item) {
    let id = `.data.${item.number}-${item.storageNo}-${item.type}`;
    let unit = adapter.config.forcekWh && ((item.unit == "Wh") || (item.unit == "J")) ?  "kWh" : item.unit;
    let role = item.type.includes('TIME_POINT') ? "date"
        : (Object.keys(units2roles).find(k => units2roles[k].includes(item.unit)) || 'value');

    let name;
    if (item.tariff) {
        name = `${item.description} (Tariff ${item.tariff}; ${item.functionFieldText})`;
    } else {
        name = `${item.description} (${item.functionFieldText})`;
    }

    await createObject(`${deviceId}${id}`, {
        type: 'state',
        common: {
            name: name,
            role: role,
            type: 'mixed',
            read: true,
            write: false,
            unit: unit
        },
        native: {
            id: id,
            StorageNumber: item.storageNo,
            Tariff: item.tariff,
        }
    });
}

async function createDeviceObjects(deviceId, data) {
    adapter.log.debug(`Creating device: ${deviceId}`);
    await createDeviceOrChannel('device', deviceId);
    await createDeviceOrChannel('channel', `${deviceId}.data`);
    await createDeviceOrChannel('channel', `${deviceId}.info`);

    for (const key of Object.keys(data.deviceInformation)) {
        await createInfoState(deviceId, key);
    }

    await createInfoState(deviceId, 'Updated');

    for (const item of data.dataRecord) {
        await createDataState(deviceId, item);
    }

    createdDevices.push(deviceId);
}

async function updateDeviceStates(deviceId, data) {
    adapter.log.debug(`Updating device: ${deviceId}`);
    for (const key of Object.keys(data.deviceInformation)) {
        let name = `${deviceId}.info.${key}`;
        if ((typeof stateValues[name] === 'undefined') || (stateValues[name] !== data.deviceInformation[key])) {
            stateValues[name] = data.deviceInformation[key];
            await updateState(name, data.deviceInformation[key]);
        }
    }

    await updateState(`${deviceId}.info.Updated`, Math.floor(Date.now() / 1000));

    for (const item of data.dataRecord) {
        let name = `${deviceId}.data.${item.number}-${item.storageNo}-${item.type}`;
        if (adapter.config.alwaysUpdate || (typeof stateValues[name] === 'undefined') || (stateValues[name] !== item.value)) {
            stateValues[name] = item.value;

            let val = item.value;
            if (adapter.config.forcekWh) {
                if (item.unit == "Wh") {
                    val = val / 1000;
                } else if (item.unit == "J") {
                    val = val / 3600000;
                }
            }

            adapter.log.debug(`Value ${name}: ${val}`);
            await updateState(name, val);
        }
    }
}

function serialError(err) {
    adapter.log.error(`Serialport errror: ${err.message}`);
    setConnected(false);
    onClose();
}

function getAllReceivers() {
    receiverAvailable = {};
    let json = JSON.parse(fs.readFileSync(`${adapter.adapterDir}${receiverPath}receiver.json`, 'utf8'));
    Object.keys(json).forEach(function (item) {
        if (fs.existsSync(adapter.adapterDir + receiverPath + item)) {
            receiverAvailable[item] = json[item];
        }
    });
}

async function main() {
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
    await createObject(objConnection._id, objConnection);

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
    await createObject(objRaw._id, objRaw);

    if (typeof adapter.config.aeskeys !== 'undefined') {
        adapter.config.aeskeys.forEach(function (item) {
            if (item.key === "UNKNOWN") {
                needsKey.push(item.id);
            }
        });
    }

    getAllReceivers();
    setConnected(false);

    let port = (typeof adapter.config.serialPort !== 'undefined' ? adapter.config.serialPort : '/dev/ttyWMBUS');
    let baud = (typeof adapter.config.serialBaudRate !== 'undefined' ? adapter.config.serialBaudRate : 9600);
    let mode = (typeof adapter.config.wmbusMode !== 'undefined' ? adapter.config.wmbusMode : 'T');

    try {
        let receiverJs = `${adapter.config.deviceType}.js`;

        if (Object.keys(receiverAvailable).includes(receiverJs)) {
            ReceiverModule = require('.' + receiverPath + receiverJs);
            receiver = new ReceiverModule(adapter.log.debug);
            receiver.incomingData = dataReceived;
            receiver.init(port, { baudRate: parseInt(baud) }, mode);
            receiver.port.on('error', serialError);

            adapter.log.debug(`Created device of type: ${receiverAvailable[receiverJs].name}`);

            decoder = new WMBusDecoder({
                debug: adapter.log.debug,
                error: adapter.log.error
            }, adapter.config.drCacheEnabled);
        } else {
            adapter.log.error(`No or unknown adapter type selected! ${adapter.config.deviceType}`);
        }
    } catch(e) {
        adapter.log.error(`Error opening serial port ${port} with baudrate ${baud}`);
        adapter.log.error(e);
        setConnected(false);
        return;
    }

    setConnected(true);
}

function processMessage(obj) {
    if (!obj) {
        return;
    }

    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (SerialPort) {
                        // read all found serial ports
                        SerialPort.list().then(
                            ports => {
                                adapter.log.info('List of port: ' + JSON.stringify(ports));
                                adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                            },
                            err => adapter.log.error(JSON.stringify(err))
                        );
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{ comName: 'Not available'}], obj.callback);
                    }
                }
                break;
            case 'listReceiver':
                if (obj.callback) {
                    adapter.sendTo(obj.from, obj.command, receiverAvailable, obj.callback);
                }
                break;
            case 'needsKey':
                if (obj.callback) {
                    adapter.sendTo(obj.from, obj.command, needsKey, obj.callback);
                }
                break;
        }
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
