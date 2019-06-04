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
let wmBusDevices = {};
let connected = false;
let stateValues = {};
let needsKey = [];
let failedDevices = [];

function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter.setState('info.connection', connected, true, err => {
            // analyse if the state could be set (because of permissions)
            if (err) {
                adapter.log.error('Can not update connected state: ' + err);
            } else {
                adapter.log.debug('connected set to ' + connected);
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
    function man2ascii(idhex) {
        return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & 0x1f) + 64) + String.fromCharCode((idhex & 0x1f) + 64);
    }
    if (data.length < 8) {
        return "ERR-XXXXXXXX";
    }
    return man2ascii(data.readUInt16LE(2)) + "-" + data.readUInt32LE(4).toString(16).padStart(8,'0');
}

function dataReceived(data) {
    // id == 'PIK-20104317'
    let id = parseID(data.raw_data);
    if (data.raw_data.length < 11) {
        if (id == "ERR-XXXXXXXX") {
            adapter.log.info("Invalid telegram received? " + data.raw_data.toString('hex'));
        } else {
            adapter.log.debug("Beacon of device: " + id);
        }
        return;
    }
    
    // check blacklist
    if ((typeof adapter.config.blacklist !== 'undefined') && adapter.config.blacklist.length) {
        let found = adapter.config.blacklist.find(function(item) { if (typeof item.id === 'undefined') return false; else return item.id == this; }, id);
        if (typeof found !== 'undefined') { // found
            return;
        }
    }
    
    // look for AES key
    let key;
    if ((typeof adapter.config.aeskeys !== 'undefined') && adapter.config.aeskeys.length) {
        // look for perfect match
        let found = adapter.config.aeskeys.find(function(item) { if (typeof item.id === 'undefined') return false; else return item.id == this; }, id);
        if (typeof found !== 'undefined') { // found
            key = found.key;
        } else { // which devices names start with our id
            found = adapter.config.aeskeys.filter(function(item) { if (typeof item.id === 'undefined') return false; else return this.startsWith(item.id); }, id);
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
    }

    if (typeof key !== 'undefined') {
        if (key === "UNKNOWN") {
            key = undefined;
        } else {
            adapter.log.debug("Found AES key: " + key);
        }
    }

    decoder.parse(data.raw_data, data.contains_crc, key, data.frame_type, function(err, result) {
        let i = failedDevices.findIndex(function(d) { return d.id == this; }, id);

        if (err) {
            if (i === -1) {
                failedDevices.push({ id: id, count: 1 });
            } else {
                failedDevices[i].count++;
                if (failedDevices[i].count > 10) {
                    adapter.config.blacklist.push({ id: id });
                    adapter.log.warn("Device " + id + " was blacklisted until adapter restart!");
                    return;
                }
            }
            adapter.log.error('Error parsing wMBus device: ' + id);
            if (err.code == 9) { // ERR_NO_AESKEY
                if (typeof needsKey.find(function (el) { return el == this; }, id) === 'undefined') {
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
        updateDevice(result.deviceInformation.Manufacturer + '-' + result.deviceInformation.Id, result);
    });
}

function updateDevice(deviceId, data) {
    adapter.log.debug('Updating device: ' + deviceId);
    initializeDeviceObjects(deviceId, data, () => {
        updateDeviceStates(wmBusDevices[deviceId], data);
    });
}

function initializeDeviceObjects(deviceId, data, callback) {
    let neededStates = [];

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

    function createStates() {
        if (!neededStates.length) {
            callback();
            return;
        }
        const state = neededStates.shift();
        let name = (typeof state.name !== 'undefined' ? state.name : '');
        let role;
        if (state.id.includes('TIME_POINT')) {
            role = "date";
        } else {
            role = Object.keys(units2roles).find(function(k) { return units2roles[k].includes(state.unit); }) || 'value';
        }
        adapter.setObjectNotExists(deviceNamespace + state.id, {
            type: 'state',
            common: {
                name: (name ? name : state.id),
                role: role,
                read: true,
                write: false,
                unit: state.unit
            },
            native: {
                id: state.id,
                StorageNumber: state.StorageNumber,
                Tariff: state.Tariff,
            }
        }, (err, obj) => {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            createStates();
        });
    }
    
    if (typeof wmBusDevices[deviceId] !== 'undefined') {
        callback();
        return;
    }

    wmBusDevices[deviceId] = deviceId;
    let deviceNamespace = wmBusDevices[deviceId];
    adapter.setObjectNotExists(deviceNamespace, {
        type: 'device',
        common: {name: deviceNamespace},
        native: {}
    }, (err, obj) => {
        if (err) {
            adapter.log.error('Error creating State: ' + err);
        }
        adapter.setObjectNotExists(deviceNamespace + '.info', {
            type: 'channel',
            common: {name: deviceNamespace + '.info'},
            native: {}
        }, err => {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.setObjectNotExists(deviceNamespace + '.data', {
                type: 'channel',
                common: {name: deviceNamespace + '.data'},
                native: {}
            }, err => {
                if (err) {
                    adapter.log.error('Error creating State: ' + err);
                }
                let currentState;
                let currentType;
                Object.keys(data.deviceInformation).forEach(function (key) {
                    currentState = {};
                    currentState.id = '.info.' + key;
                    currentState.name = key;
                    neededStates.push(currentState);
                });
                
                data.dataRecord.forEach(function(item) {
                    currentState = {};
                    currentState.id = '.data.' + item.number + '-' + item.storageNo + '-' + item.type;
                    let name = item.description + ' (';
                    if (item.tariff) {
                        name += 'Tariff ' + item.tariff + '; ';
                    }
                    name +=  item.functionFieldText + ')';
                    currentState.name = name;
                    currentState.unit = item.unit;
                    currentState.Tariff = item.tariff;
                    currentState.StorageNumber = item.storageNo;
                    neededStates.push(currentState);
                });
                
                createStates();
            });
        });
        
    });
}


function updateDeviceStates(deviceNamespace, data, callback) {
    Object.keys(data.deviceInformation).forEach(function (key) {
        if ((typeof stateValues[deviceNamespace + '.info.' + key] === 'undefined') || stateValues[deviceNamespace + '.info.' + key] !== data.deviceInformation[key]) {
            stateValues[deviceNamespace + '.info.' + key] = data.deviceInformation[key];
            adapter.setState(deviceNamespace + '.info.' + key, data.deviceInformation[key], true, err => { if (err) adapter.log.error(err) });
        }
    });
    
    data.dataRecord.forEach(function(item) {
        let stateId = '.data.' + item.number + '-' + item.storageNo + '-' + item.type;
        if (adapter.config.alwaysUpdate || (typeof stateValues[deviceNamespace + stateId] === 'undefined') || stateValues[deviceNamespace + stateId] !== item.value) {
            stateValues[deviceNamespace + stateId] = item.value;
            
            adapter.log.debug('Value ' + deviceNamespace + stateId + ': ' + item.value);
            adapter.setState(deviceNamespace + stateId, item.value, true, err => { if (err) adapter.log.error(err) });
        }
    });
    callback && callback();
}

function serialError(err) {
    adapter.log.error('Serialport errror: ' + err.message);
    setConnected(false);
    onClose();
}

function getAllReceivers() {
    receiverAvailable = {};
    let json = JSON.parse(fs.readFileSync(adapter.adapterDir + receiverPath + 'receiver.json', 'utf8'));
    Object.keys(json).forEach(function (item) {
        if (fs.existsSync(adapter.adapterDir + receiverPath + item)) {
            receiverAvailable[item] = json[item];
        }
    });
}

function main() {
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
    adapter.setObject(objConnection._id, objConnection);

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
    adapter.setObject(objRaw._id, objRaw);

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
        if (Object.keys(receiverAvailable).includes(adapter.config.deviceType + '.js')) {
            ReceiverModule = require('.' + receiverPath + adapter.config.deviceType + '.js');
            receiver = new ReceiverModule(adapter.log.debug); 
            adapter.log.debug('Created device of type: ' + receiverAvailable[adapter.config.deviceType + '.js'].name);
            decoder = new WMBusDecoder({debug: adapter.log.debug, error: adapter.log.error}, adapter.config.drCacheEnabled);
            receiver.incomingData = dataReceived;
            receiver.init(port, {baudRate: parseInt(baud)}, mode);
            receiver.port.on('error', serialError);
        } else {
            adapter.log.error('No or unknown adapter type selected! ' + adapter.config.deviceType);
        }
    } catch(e) {
        adapter.log.error("Error opening serial port " + port + " with baudrate " + baud);
        adapter.log.error(e);
        setConnected(false);
        return;
        //onClose(main);
    }

    setConnected(true);
}

function processMessage(obj) {
    if (!obj) return;

    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (SerialPort) {
                        // read all found serial ports
                        SerialPort.list(function (err, ports) {
                            adapter.log.info('List of port: ' + JSON.stringify(ports));
                            adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                        });
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
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