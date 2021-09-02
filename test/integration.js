const path = require('path');
const { tests } = require('@iobroker/testing');
const assert = require('chai').assert;

async function prepareAdapter(harness) {
    await harness._objects.getObject('system.adapter.wmbus.0', async (err, obj) => {
        obj.native.deviceType = 'mock';
        harness._objects.setObject(obj._id, obj);
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

                    harness.sendTo('wmbus.0', 'listUart', null, (ports) => {
                        assert.isAtLeast(ports.length, 1);
                        resolve();
                    });
                });
            });

            it('Test needsKey', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    harness.sendTo('wmbus.0', 'needsKey', null, (devices) => {
                        assert.lengthOf(devices, 0);
                        resolve();
                    });
                });
            });

            it('Test listReceiver', () => {
                return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
                    const harness = getHarness();

                    await prepareAdapter(harness);
                    await harness.startAdapterAndWait();

                    harness.sendTo('wmbus.0', 'listReceiver', null, (receivers) => {
                        assert.hasAllKeys(receivers, ['ebi.js', 'amber.js', 'imst.js', 'cul.js', 'simple.js']);
                        resolve();
                    });
                });
            });
        });
    },
});
