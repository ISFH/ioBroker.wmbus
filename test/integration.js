const path = require('path');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const fs = require('fs');
const net = require('net');

const port = 5000;

async function prepareAdapter(harness) {
    try {
        await harness.objects.getObject('system.adapter.wireless-mbus.0', async (err, obj) => {
            // overwrite simple.js with tcp.js
            const tcpReceiver = fs.readFileSync('lib/receiver/tcp.js');
            fs.writeFileSync(`${harness.testAdapterDir}/lib/receiver/simple.js`, tcpReceiver);

            obj.native.deviceType = 'simple';
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

async function sendTelegram(telegram) {
    return new Promise(function(resolve) {
        const client = new net.Socket();
        client.on('connect', () => {
            client.write(JSON.stringify(telegram));
            client.end();
            resolve();
        });

        setTimeout(() => {
            client.connect({ port: port });
        }, 1000);
    });
}

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],

    defineAdditionalTests(getHarness) {
        describe('Test sendTo()', () => {
            it('Test listUart', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    harness.sendTo('wireless-mbus.0', 'listUart', null, (ports) => {
                        expect(ports).to.have.lengthOf.at.least(1);
                        resolve();
                    });
                });
            }).timeout(10000);

            it('Test listReceiver', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    await new Promise(r => setTimeout(r, 2000));

                    harness.sendTo('wireless-mbus.0', 'listReceiver', null, (receivers) => {
                        expect(receivers).to.have.all.keys('ebi.js', 'amber.js', 'imst.js', 'cul.js', 'simple.js');
                        resolve();
                    });
                });
            }).timeout(10000);

            it('Test needsKey', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

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
                        resolve();
                    });
                });
            }).timeout(10000);
        });

        describe('Test telegrams', () => {
            it('Test telegram', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

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
                        resolve();
                    });
                });
            }).timeout(10000);

            it('Test encrypted telegram', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

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
                        resolve();
                    });
                });
            }).timeout(10000);

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
                        resolve();
                    });
                });
            }).timeout(10000);
        });

        describe('Other tests', () => {
            it('Test blocking of device', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    const telegram = {
                        frameType: 'A',
                        containsCrc: false,
                        data: '1844AE4C4225222068077A670000000413CFE20100023B0000'
                    };

                    await sendTelegram(telegram);
                    await new Promise(r => setTimeout(r, 2000));

                    await harness.objects.getObject('wireless-mbus.0.SEN-20222542', async (err, obj) => {
                        if (obj === null) {
                            resolve();
                        } else {
                            reject('Device should have been rejected!');
                        }
                    });
                });
            }).timeout(10000);

            it('Test temporary block of device', () => {
                return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

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
                            resolve();
                        } else {
                            reject('Device should have been rejected!');
                        }
                    });
                });
            }).timeout(60000);
        });
    },
});
