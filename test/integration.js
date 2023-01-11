const path = require('path');
const fs = require('fs');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const net = require('net');

const port = 5000;

function copyMocks(harness) {
    fs.mkdirSync(`${harness.testAdapterDir}/lib/receiver/test`);
    const files = fs.readdirSync(`${harness.adapterDir}/lib/receiver/test`, { withFileTypes: true });
    files.forEach((file) => {
        if (file.isDirectory()) {
            return;
        }

        fs.writeFileSync(`${harness.testAdapterDir}/lib/receiver/test/${file.name}`, fs.readFileSync(`${harness.adapterDir}/lib/receiver/test/${file.name}`));
    });

}

async function prepareAdapter(harness) {
    try {
        await harness.objects.getObject('system.adapter.wireless-mbus.0', async (err, obj) => {
            obj.native.deviceType = 'TcpReceiver.js';
            obj.native.serialPort = port;
            obj.native.aeskeys = [
                { id: 'ELS-1234567', key: 'FFF102030405060708090A0B0C0D0E0F' },
                { id: 'ELS-12345678', key: '000102030405060708090A0B0C0D0E0F' },
                { id: 'RAD-112233', key: '000102030405060708090A0B0C0D0E0F' }
            ];
            obj.native.blacklist = [
                { id: 'SEN-20222542' }
            ];
            harness.objects.setObject(obj._id, obj);
        });
    } catch (e) {
        console.dir(e);
    }
}

async function prepareAdapterWithMock(harness, mockType, forceFail) {
    try {
        await harness.objects.getObject('system.adapter.wireless-mbus.0', async (err, obj) => {
            const classFile = fs.readFileSync(`${harness.testAdapterDir}/lib/receiver/SerialDevice.js`, 'utf-8');
            const patchedClass = classFile.replace("'serialport'", `'./test/${mockType}DeviceMock'`);
            fs.writeFileSync(`${harness.testAdapterDir}/lib/receiver/SerialDevice.js`, patchedClass);

            if (forceFail) {
                if (mockType === 'Cul') {
                    obj.native.deviceType = 'amber';
                } else {
                    obj.native.deviceType = 'cul';
                }
            } else {
                obj.native.deviceType = mockType.toLowerCase();
            }
            obj.native.serialPort = '/dev/mockPort';
            harness.objects.setObject(obj._id, obj);
        });
    } catch (e) {
        console.dir(e);
    }
}

async function sendTelegram(telegram) {
    return new Promise(function (resolve) {
        const client = new net.Socket();
        client.on('connect', () => {
            client.write(JSON.stringify(telegram));
            client.end();
            resolve(true);
        });

        setTimeout(() => {
            client.connect({ port: port, host: '127.0.0.1' });
        }, 1000);
    });
}

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests({ suite }) {
        const testedReceiver = ['Amber', 'Cul', 'Ebi', 'Imst', 'Simple'][Math.floor(Math.random() * 5)];

        suite('Test receiver with mocks', (getHarness) => {
            it(`Test ${testedReceiver}`, () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    copyMocks(harness);
                    await prepareAdapterWithMock(harness, testedReceiver);
                    await harness.startAdapterAndWait();

                    await new Promise(r => setTimeout(r, 2000));

                    await harness.states.getState('wireless-mbus.0.info.connection', async (err, state) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(state.ack).to.be.true;
                        expect(state.val).to.equal(true);
                        resolve(true);
                    });
                });
            }).timeout(10000);
        });

        suite('Test receiver with mocks', (getHarness) => {
            it('Test receiver fails', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapterWithMock(harness, testedReceiver, true);
                    await harness.startAdapterAndWait();

                    await new Promise(r => setTimeout(r, 2000));

                    await harness.states.getState('wireless-mbus.0.info.connection', async (err, state) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(state.ack).to.be.true;
                        expect(state.val).to.equal(false);
                        resolve(true);
                    });
                });
            }).timeout(10000);
        });

        suite('Test sendTo()', (getHarness) => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test listUart', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    harness.sendTo('wireless-mbus.0', 'listUart', null, (ports) => {
                        expect(ports).to.have.lengthOf.at.least(0);
                        resolve(true);
                    });
                });
            }).timeout(10000);

            it('Test listReceiver', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    await new Promise(r => setTimeout(r, 2000));

                    harness.sendTo('wireless-mbus.0', 'listReceiver', null, (receivers) => {
                        expect(receivers).to.have.all.keys('ebi', 'amber', 'imst', 'cul', 'simple');
                        resolve(true);
                    });
                });
            }).timeout(10000);

            it('Test needsKey', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const telegram = {
                        frameType: 'A',
                        containsCrc: false,
                        data: '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689'
                    };
                    await sendTelegram(telegram);

                    await new Promise(r => setTimeout(r, 2000));

                    harness.sendTo('wireless-mbus.0', 'needsKey', null, (devices) => {
                        expect(devices).to.have.lengthOf(1);
                        expect(devices[0]).to.equal('KAM-63452869');
                        resolve(true);
                    });
                });
            }).timeout(10000);
        });

        suite('Test telegrams', (getHarness) => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test telegram', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const telegram = {
                        frameType: 'B',
                        containsCrc: true,
                        data: '1444AE0C7856341201078C2027780B134365877AC5'
                    };
                    await sendTelegram(telegram);

                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.CEN-12345678.data.1-0-VIF_VOLUME', async (err, obj) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(obj.type).to.equal('state');
                        expect(obj.common.unit).to.equal('m³');
                        resolve(true);
                    });
                });
            }).timeout(10000);

            it('Test encrypted telegram', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const telegram = {
                        frameType: 'A',
                        containsCrc: true,
                        data: '434493157856341233037AC98C2075900F002C25B30A000021924D4FBA372FB66E017A75002007109058475F4BC9D1281DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1'
                    };
                    await sendTelegram(telegram);

                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.ELS-12345678', async (err, obj) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(obj.type).to.equal('device');
                        expect(obj.common.name).to.equal('ELS-12345678');
                        resolve(true);
                    });
                });
            }).timeout(10000);
        });

        suite('Test telegrams', (getHarness) => {
            it('Test encrypted telegram with radio adapter', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    const telegram = {
                        frameType: 'A',
                        containsCrc: true,
                        data: '53082448443322110337D0468E80753A63665544330A31900F002C25E00AB30A0000AF5D74DF73A600D972785634C027129315330375002007109058475F4BC955CF1DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1'
                    };
                    await sendTelegram(telegram);

                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.ELS-12345678', async (err, obj) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(obj.type).to.equal('device');
                        expect(obj.common.name).to.equal('ELS-12345678');
                        resolve(true);
                    });
                });
            }).timeout(10000);
        });

        suite('Other tests', (getHarness) => {
            let harness;
            before(async () => {
                harness = getHarness();
                await prepareAdapter(harness);
                await harness.startAdapterAndWait();
            });

            it('Test wmbus decoder failed', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const telegramCutOff = {
                        frameType: 'A',
                        containsCrc: true,
                        data: '53082448443322110337D0468E80753A63665544'
                    };

                    await sendTelegram(telegramCutOff);
                    await new Promise(r => setTimeout(r, 2000));

                    await harness.states.getState('wireless-mbus.0.info.rawdata', async (err, state) => {
                        if (err) {
                            reject(`Error return ${err}`);
                        }
                        expect(state.ack).to.be.true;
                        expect(state.val.toUpperCase()).to.equal('53082448443322110337D0468E80753A63665544');
                        resolve(true);
                    });
                });
            }).timeout(10000);

            it('Test blocking of device', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const telegram = {
                        frameType: 'A',
                        containsCrc: false,
                        data: '1844AE4C4225222068077A670000000413CFE20100023B0000'
                    };

                    await sendTelegram(telegram);
                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.SEN-20222542', async (err, obj) => {
                        if (obj === null) {
                            resolve(true);
                        } else {
                            reject('Device should have been rejected!');
                        }
                    });
                });
            }).timeout(10000);

            it('Test temporary block of device', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const telegramCutOff = {
                        frameType: 'A',
                        containsCrc: true,
                        data: '53082448443322110337D0468E80753A63665544'
                    };

                    for (let i = 0; i < 10; i++) {
                        await sendTelegram(telegramCutOff);
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    const telegram = {
                        frameType: 'A',
                        containsCrc: true,
                        data: '53082448443322110337D0468E80753A63665544330A31900F002C25E00AB30A0000AF5D74DF73A600D972785634C027129315330375002007109058475F4BC955CF1DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1'
                    };

                    await sendTelegram(telegram);
                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.ELS-12345678', async (err, obj) => {
                        if (obj === null) {
                            resolve(true);
                        } else {
                            reject('Device should have been rejected!');
                        }
                    });
                });
            }).timeout(60000);
        });
    },
});
