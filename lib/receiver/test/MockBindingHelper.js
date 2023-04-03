'use strict';

const { MockPortBinding } = require('@serialport/binding-mock');
const EventEmitter = require('events');

const IS_DEBUG = process.env.DEBUG === 'true';

const EventHelper = {
    emitter: new EventEmitter(),

    writeEvent(buffer) {
        EventHelper.emitter.emit('write', buffer);
    }
};

class EmulatedMockBinding extends MockPortBinding {
    constructor(path, opt) {
        super(path, opt);
    }

    async write(buffer) {
        if (IS_DEBUG) {
            console.log(`<<< ${buffer.toString('hex')}`);
        }
        await super.write(buffer);
        EventHelper.writeEvent(buffer);
    }
}

const MockBinding = {
    ports: {},
    serialNumber: 0,

    resolveNextTick() {
        return new Promise(resolve => process.nextTick(() => resolve(true)));
    },

    reset() {
        MockBinding.ports = {};
        MockBinding.serialNumber = 0;
    },
    // Create a mock port
    createPort(path, options = {}) {
        MockBinding.serialNumber++;

        const optWithDefaults = Object.assign({
            echo: false,
            record: false,
            manufacturer: 'The J5 Robotics Company',
            vendorId: undefined,
            productId: undefined,
            maxReadSize: 1024,
            readyData: Buffer.alloc(0)
        }, options);

        MockBinding.ports[path] = {
            data: Buffer.alloc(0),
            echo: optWithDefaults.echo,
            record: optWithDefaults.record,
            readyData: optWithDefaults.readyData,
            maxReadSize: optWithDefaults.maxReadSize,
            info: {
                path,
                manufacturer: optWithDefaults.manufacturer,
                serialNumber: `${MockBinding.serialNumber}`,
                pnpId: undefined,
                locationId: undefined,
                vendorId: optWithDefaults.vendorId,
                productId: optWithDefaults.productId,
            },
        };
    },
    async list() {
        return Object.values(MockBinding.ports).map(port => port.info);
    },
    async open(options) {
        let _a;
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('"options" is not an object');
        }
        if (!options.path) {
            throw new TypeError('"path" is not a valid port');
        }
        if (!options.baudRate) {
            throw new TypeError('"baudRate" is not a valid baudRate');
        }
        const openOptions = Object.assign({ dataBits: 8, lock: true, stopBits: 1, parity: 'none', rtscts: false, xon: false, xoff: false, xany: false, hupcl: true }, options);
        const { path } = openOptions;
        const port = MockBinding.ports[path];
        await MockBinding.resolveNextTick();
        if (!port) {
            throw new Error(`Port does not exist - please call MockBinding.createPort('${path}') first`);
        }
        if ((_a = port.openOpt) === null || _a === void 0 ? void 0 : _a.lock) {
            throw new Error('Port is locked cannot open');
        }
        port.openOpt = Object.assign({}, openOptions);
        return new EmulatedMockBinding(port, openOptions);
    }
};

exports.MockBinding = MockBinding;
exports.EventHelper = EventHelper;