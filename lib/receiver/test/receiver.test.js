'use strict';

const { expect } = require('chai');
const fs = require('fs');
const net = require('net');
const mockery = require('mockery');

const options = { path: '/dev/mockPort', baudRate: 38400 };

const showReceiverLogMessages = false;

const IS_DEBUG = process.env.DEBUG === 'true';

let messages = [];

const logger = {
    info: (msg) => console.log('INFO: ' + msg),
    error: (msg) => console.log('ERROR: ' + msg),
    debug: (msg) => console.log('DEBUG: ' + msg)
};

const emptyLogger = {
    info: () => { },
    error: () => { },
    debug: () => { }
};

const telegram = '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300';

function onMessage(msg) {
    messages.push(msg);
    if (IS_DEBUG) {
        console.log(msg);
    }
}

let ReceiverClass;
let receiver;
let tcpMockServer;

function assertWithValidationFile(actual, filename) {
    const path = `./lib/receiver/test/validation/${filename}.json`;
    if (!fs.existsSync(path)) {
        fs.writeFileSync(path, '=== new file ===\n' + JSON.stringify(actual, null, 4));
    }

    const rawdata = fs.readFileSync(path);
    const expected = JSON.parse(rawdata.toString('utf8'));

    expect(actual).to.eql(expected);
}

async function initDevice(deviceClass, mode, port) {
    const opts = {
        ...options
    };
    if (typeof port !== 'undefined') {
        opts.path = port;
    }

    ReceiverClass = require(`../${deviceClass}`);
    receiver = new ReceiverClass(opts, mode, onMessage, console.log, showReceiverLogMessages ? logger : emptyLogger);
    await receiver.init();
}

async function testInit(deviceClass, mode, deviceConfig, suffix) {
    const path = `./${deviceClass}.config.json`;
    if (typeof deviceConfig !== 'undefined') {
        fs.writeFileSync(path, JSON.stringify(deviceConfig, null, 4));
    }

    await initDevice(deviceClass, mode);

    const actual = receiver.port.communicationLog;
    receiver = null;

    const filename = `${deviceClass.replace('Receiver', '')}.init-${mode}${typeof suffix === 'undefined' ? '' : suffix}`;
    assertWithValidationFile(actual, filename);
}

async function testTelegram(deviceClass, rssi, frameType, ts, withCrc) {
    await initDevice(deviceClass, 'T');

    if (deviceClass == 'SimpleReceiver') {
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    receiver.port.sendTelegram(telegram, rssi, frameType, ts, withCrc);
    await new Promise(resolve => setTimeout(resolve, 300));

    receiver = null;

    expect(messages).to.have.lengthOf(1);
    return messages[0];
}

async function sendTelegramViaTcp(port, dataString, frameType, withCrc) {
    return new Promise(function (resolve) {
        const telegram = {
            frameType: frameType,
            containsCrc: withCrc,
            data: dataString
        };

        const client = new net.Socket();
        client.on('connect', () => {
            client.write(JSON.stringify(telegram));
            client.end();
            resolve(true);
        });

        setTimeout(() => {
            client.connect({ port: port, host: '127.0.0.1' });
        }, 200);
    });
}

function initMockery(receiverClass) {
    mockery.enable({ useCleanCache: true });
    mockery.registerSubstitute('serialport', `./test/${receiverClass}DeviceMock`);
    mockery.registerAllowables(['./SerialDevice', './DeviceMock', './MockBindingHelper',
        '@serialport/binding-mock', '@serialport/stream', 'fs', 'stream', './node.js', 'net',
        'util', 'supports-color', 'os', 'tty', 'has-flag', './common', 'ms', 'debug', 'events',
        '../SimpleLogger', '../CulReceiver', '../SimpleReceiver',
        '../AmberReceiver', '../AmberMessage', './AmberMessage',
        '../ImstReceiver', './HciMessage', '../HciMessage',
        '../EbiReceiver', './EbiMessage', '../EbiMessage']);
}

function stopMockery(receiverClass) {
    mockery.deregisterAll();
    mockery.disable();
    messages = [];

    const path = `./${receiverClass}Receiver.config.json`;
    if (fs.existsSync(path)) {
        fs.unlinkSync(path);
    }
}

describe('Test CUL receiver', () => {
    beforeEach(() => initMockery('Cul'));
    afterEach(() => stopMockery('Cul'));

    it('init T mode', async () => {
        await testInit('CulReceiver', 'T');
    });

    it('init S mode', async () => {
        await testInit('CulReceiver', 'S');
    });

    it('init C mode', async () => {
        await testInit('CulReceiver', 'C');
    });

    it('send telegram', async () => {
        const msg = await testTelegram('CulReceiver');

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', true);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -74);
        expect(msg).to.have.property('ts');
    }).timeout(3000);

    it('send telegram - frame type B', async () => {
        const msg = await testTelegram('CulReceiver', null, 'B');

        expect(msg).to.have.property('frameType', 'B');
        expect(msg).to.have.property('containsCrc', true);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -74);
        expect(msg).to.have.property('ts');
    }).timeout(3000);
});

describe('Test AMBER receiver', () => {
    beforeEach(() => initMockery('Amber'));
    afterEach(() => stopMockery('Amber'));

    it('init T mode', async () => {
        await testInit('AmberReceiver', 'T');
    });

    it('init S mode', async () => {
        await testInit('AmberReceiver', 'S');
    });

    it('init C mode', async () => {
        await testInit('AmberReceiver', 'C');
    });

    it('init C/T mode', async () => {
        await testInit('AmberReceiver', 'CT');
    });

    it('init T mode enable CMDOut', async () => {
        await testInit('AmberReceiver', 'T', { cmdOutEnabled: false }, '-cmdout');
    });

    it('send telegram', async () => {
        const msg = await testTelegram('AmberReceiver', 0x77);

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', false);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -14.5);
        expect(msg).to.have.property('ts');
    }).timeout(3000);
});


describe('Test IMST receiver', () => {
    beforeEach(() => initMockery('Imst'));
    afterEach(() => stopMockery('Imst'));

    it('init T mode', async () => {
        await testInit('ImstReceiver', 'T');
    });

    it('init S mode', async () => {
        await testInit('ImstReceiver', 'S');
    });

    it('init CA mode', async () => {
        await testInit('ImstReceiver', 'CA');
    });

    it('init CB mode', async () => {
        await testInit('ImstReceiver', 'CB');
    });

    it('send telegram', async () => {
        const msg = await testTelegram('ImstReceiver', 0x55, undefined, 1234567890);

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', false);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -52);
        expect(msg).to.have.property('ts', 1234567890);
    }).timeout(3000);
});


describe('Test EMBIT receiver', () => {
    beforeEach(() => initMockery('Ebi'));
    afterEach(() => stopMockery('Ebi'));

    it('init T mode', async () => {
        await testInit('EbiReceiver', 'T');
    });

    it('init S mode', async () => {
        await testInit('EbiReceiver', 'S');
    });

    it('init C mode', async () => {
        await testInit('EbiReceiver', 'C');
    });

    it('init T mode device not ready', async () => {
        await testInit('EbiReceiver', 'T', { deviceState: 0x01 }, '-notready');
    });

    it('send telegram', async () => {
        const msg = await testTelegram('EbiReceiver', 0xDE, 'B', 123 * 32768);

        expect(msg).to.have.property('frameType', 'B');
        expect(msg).to.have.property('containsCrc', false);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -34);
        expect(msg).to.have.property('ts', 123);
    }).timeout(3000);
});

describe('Test SIMPLE receiver', () => {
    beforeEach(() => initMockery('Simple'));
    afterEach(() => stopMockery('Simple'));

    it('init A mode', async () => {
        await testInit('SimpleReceiver', 'A');
    });

    it('init B mode', async () => {
        await testInit('SimpleReceiver', 'B');
    });

    it('send telegram', async () => {
        const msg = await testTelegram('SimpleReceiver', 0xDE);

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', false);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -1);
        expect(msg).to.have.property('ts');
    }).timeout(3000);

    it('send telegram with CRC', async () => {
        const msg = await testTelegram('SimpleReceiver', 0xDE, undefined, undefined, true);

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', true);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -1);
        expect(msg).to.have.property('ts');
    }).timeout(3000);
});

describe('Test TCP receiver', () => {
    afterEach(() => messages = []);

    it('send telegram', async () => {
        await initDevice('TcpReceiver', '', '5000');

        await sendTelegramViaTcp(5000, telegram, 'A', false);
        await new Promise(resolve => setTimeout(resolve, 500));
        receiver.port.close();

        expect(messages).to.have.lengthOf(1);

        const msg = messages[0];

        expect(msg).to.have.property('frameType', 'A');
        expect(msg).to.have.property('containsCrc', false);
        expect(msg).to.have.deep.property('rawData', Buffer.from(telegram, 'hex'));
        expect(msg).to.have.property('rssi', -1);
        expect(msg).to.have.property('ts');
    }).timeout(3000);
});

describe('Test CUL over TCP receiver', () => {
    beforeEach(() => {
        const CulTcpDeviceMock = require('./CulTcpDeviceMock');
        tcpMockServer = new CulTcpDeviceMock({ host: '127.0.0.1', port: '5005'});
    });
    afterEach(() => {
        messages = [];
        tcpMockServer.server.close();
        tcpMockServer = null;
    });

    it('init T mode', async () => {
        const CulReceiver = require('../CulReceiver');
        receiver = new CulReceiver({ isTcp: true, host: '127.0.0.1', port: 5005 }, 'T', onMessage, console.log, showReceiverLogMessages ? logger : emptyLogger);
        await receiver.init();

        const actual = tcpMockServer.communicationLog;
        receiver.closeConnection();
        receiver = null;

        const filename = `Cul.init-T`;
        assertWithValidationFile(actual, filename);
    });
});