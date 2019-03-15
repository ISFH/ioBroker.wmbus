/**
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * Adapter loading data from an wM-Bus devices
 *
 */

'use strict';

const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const WMBusDecoder = require('./lib/wmbus_decoder.js');
const SerialPort = require('serialport');
const receiverPath = '/lib/receiver/';
let ReceiverModule;

const adapter = new utils.Adapter('wmbus');

let receiver = null;
let receiverAvailable = {};
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

function parseID(data) {
    function man2ascii(idhex) {
        return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & 0x1f) + 64) + String.fromCharCode((idhex & 0x1f) + 64);
    }
    return man2ascii(data.readUInt16LE(2)) + "-" + data.readUInt32LE(4).toString(16).padStart(8,'0');
}

function dataReceived(data) {
    // id == 'PIK-20104317'
    let id = parseID(data.raw_data);
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
        if (key === "UNKOWN") {
            key = undefined;
        } else {
            adapter.log.debug("Found AES key: " + key);
        }
    }

    decoder.parse(data.raw_data, data.contains_crc, key, data.frame_type, function(err, result) {
        if (err) {
            adapter.log.error('Error parsing wMBus device: ' + id);
            if (err.code == 9) { // ERR_NO_AESKEY
                needsKey.push(id);
            }
            adapter.setState('info.rawdata', data.raw_data.toString('hex'), true);
            adapter.log.error(err.message);
            return;
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
	getAllReceivers();
    setConnected(false);
    
    let port = (typeof adapter.config.serialPort !== 'undefined' ? adapter.config.serialPort : '/dev/ttyWMBUS');
    let baud = (typeof adapter.config.serialBaudRate !== 'undefined' ? adapter.config.serialBaudRate : 9600);
    
    try {
		if (Object.keys(receiverAvailable).includes(adapter.config.deviceType + '.js') {
			ReceiverModule = require('.' + receiverPath + adapter.config.deviceType + '.js');
			receiver = new ReceiverModule(adapter.log.debug); 
            adapter.log.debug('Created device of type: ' + receiverAvailable[adapter.config.deviceType + '.js']);
			decoder = new WMBusDecoder({debug: adapter.log.debug, error: adapter.log.error});
			receiver.incomingData = dataReceived;
			receiver.init(port, {baudRate: parseInt(baud)});
			receiver.port.on('error', serialError);
		} else {
			adapter.log.error('No or unkown adapter type selected! ' + adapter.config.deviceType);
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
