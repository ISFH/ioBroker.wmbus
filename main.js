/**
# vim: tabstop=4 shiftwidth=4 expandtab 
 *
 * NUT adapter
 *
 * Adapter loading data from an wM-Bus devices
 *
 */
/* jshint -W097 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */

'use strict';

const path       = require('path');
const utils      = require(path.join(__dirname, 'lib', 'utils')); // Get common adapter utils
const EBI_WMBUS = require('./classes/EBI.js');
const WMBUS_DECODER = require('./classes/WMBUS.js');
const AMBER_WMBUS = require('./classes/AMBER.js');
const SerialPort = require('serialport');

const adapter = new utils.Adapter('wmbus');

let receiver = null;
let decoder = null;
let wmBusDevices = {};

let connected = null;
let stateValues = {};
let needsKey = [];

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

adapter.on('ready', main);

adapter.on('message', processMessage);

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

adapter.on('unload', callback => {
    onClose(callback);
});

process.on('SIGINT', () => {
    onClose();
});

process.on('uncaughtException', err => {
    if (adapter && adapter.log) {
        adapter.log.warn('Exception: ' + err);
    }
    onClose();
});

function dataReceived(raw_data) {
    // id == 'PIK-20104317'
    let id = raw_data.manufacturer + '-' + raw_data.afield_id;
    // look for AES key
    let key;
    if ((typeof adapter.config.aeskeys !== 'undefined') && adapter.config.aeskeys.length) {
        // look for perfect match
        let found = adapter.config.aeskeys.find(function(item) { if (typeof item[0] === 'undefined') return false; else return item[0] == this; }, id);
        if (typeof found !== 'undefined') { // found
            key = found[1];
        } else { // which devices names start with our id
            found = adapter.config.aeskeys.filter(function(item) { if (typeof item[0] === 'undefined') return false; else return this.startsWith(item[0]); }, id);
            if (found.length == 1) { // only 1 match - take it
                key = found[0][1];
            } else if (found.length > 1) { // more than one, find the best
                let len = found[0][0].length;
                let pos = 0;
                for (let i = 1; i < found.length; i++) {
                    if (found[i][0].length > len) {
                        len = found[i][0].lenght;
                        pos = i;
                    }
                }
                key = found[pos][1];
            } 
        }
    }

    if (typeof key !== 'undefined') {
        adapter.log.debug("Found AES key: " + key);
    }

    decoder.parse(raw_data, raw_data.data, key, function(err, data) {
        if (err) {
            adapter.log.error('Error parseing wMBus device: ' + id);
            if (err.code == 9) { // ERR_NO_AESKEY
                needsKey.push(id);
            }
            adapter.log.error(err.message);
            return;
        }
        updateDevice(data.deviceInformation.Manufacturer + '-' + data.deviceInformation.Id, data);
    });
}

function updateDevice(deviceId, data) {
    adapter.log.debug('Updating device: ' + deviceId);
    initializeDeviceObjects(deviceId, data, () => {
        updateDeviceStates(wmBusDevices.deviceId.deviceNamespace, deviceId, data);
    });
}

function initializeDeviceObjects(deviceId, data, callback) {
    let neededStates = [];
    function createStates() {
        if (!neededStates.length) {
            callback();
            return;
        }
        const state = neededStates.shift();
        let name = (typeof state.name !== 'undefined' ? state.name : '');
        adapter.setObjectNotExists(deviceNamespace + state.id, {
            type: 'state',
            common: {
                name: (name ? name : state.id),
                role: 'value',
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
    
    if (typeof wmBusDevices.deviceId !== 'undefined') {
        callback();
        return;
    }

    const deviceNamespace = deviceId;
    wmBusDevices.deviceId = {};
    wmBusDevices.deviceId.deviceNamespace = deviceNamespace;
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
                    currentState.name = data.deviceInformation[key].name;
                    currentState.unit = data.deviceInformation[key].unit;
                    neededStates.push(currentState);
                });
                
                data.dataRecord.forEach(function(item) {
                    currentState = {};
                    currentState.id = '.data.' + item.number + '-' + item.storageNo + '-' + item.type;
                    currentState.name = item.type + ' (' + item.functionFieldText + ')';
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


function updateDeviceStates(deviceNamespace, deviceId, data, callback) {
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
            adapter.setState(deviceNamespace + stateId, item.value, true, err => { if (err) adapter.log.error(err) }); //{
        }
    });
    callback && callback();
}

function serialError(err) {
    adapter.log.error('Serialport errror: ' + err.message);
    setConnected(false);
    onClose(main);
}


function main() {
    setConnected(false);
    
    if (!adapter.config.deviceType) {
        adapter.config.deviceType = 'EBI';
    }
    let port = (typeof adapter.config.serialPort !== 'undefined' ? adapter.config.serialPort : '/dev/ttyWMBUS');
    let baud = (typeof adapter.config.serialBaudRate !== 'undefined' ? adapter.config.serialBaudRate : 9600);
    
    try {
        switch (adapter.config.deviceType) {
            case 'EBI':
                receiver = new EBI_WMBUS(adapter.log.debug); 
                adapter.log.debug('Created device of type: ' + adapter.config.deviceType);
                break;
            case 'AMBER':
                receiver = new AMBER_WMBUS(adapter.log.debug);
                adapter.log.debug('Created device of type: ' + adapter.config.deviceType);
                break;
            default: adapter.log.error('Unkown adapter type selected! ' + adapter.config.deviceType);
        }
        decoder = new WMBUS_DECODER({debug: adapter.log.debug, error: adapter.log.error});
        receiver.incomingData = dataReceived;
        receiver.init(port, {baudRate: baud});
        receiver.port.on('error', serialError);
    } catch(e) {
        adapter.log.error("Error opening serial port " + port + " with baudrate " + baud);
        adapter.log.error(e);
        setConnected(false);
        onClose(main);
    }

    setConnected(true);
}

function processMessage(obj) {
    if (!obj) return;

    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (receiver.port) {
                        // read all found serial ports
                        receiver.port.list(function (err, ports) {
                            adapter.log.info('List of port: ' + JSON.stringify(ports));
                            adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                        });
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                    }
                }
                break;
        }
    }
}
