'use strict';

const { SerialPort } = require('serialport');
const SimpleLogger = require('../SimpleLogger');

class SerialDevice {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        this.log = new SimpleLogger(loggerFunction);

        if (typeof onMessage !== 'function') {
            throw new Error('onMessage must be of type "function(data)"');
        }

        this.options = options;
        this.port = null;
        this.mode = mode;

        this.parserBuffer = Buffer.alloc(0);
        this.maxParserBufferLength = 1024;

        this.readTimeout = 3000;
        this.readPromises = [];

        this.onMessage = onMessage;
        this.onError = onError;
    }

    /* eslint-disable no-unused-vars */

    buildPayloadPackage(command, payload) {
        throw new Error('buildPayloadPackage is unimplemented!');
    }

    validateResponse(pkg, response) { }

    checkAndExtractMessage() {
        throw new Error('checkAndExtractMessage is unimplemented!');
    }

    parseRawMessage(messageBuffer) {
        throw new Error('parseRawMessage is unimplemented!');
    }

    /* eslint-enable no-unused-vars */

    initDevice() {
        throw new Error('initDevice is unimplemented!');
    }

    async readResponse() {
        let timeoutHandle;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutHandle = setTimeout(() => {
                this.readPromises.pop();
                reject('Timeout waiting for response');
            }, this.readTimeout);
        });

        const waitForReadPromise = new Promise((resolve) => {
            this.readPromises.push((data) => {
                resolve(data);
            });
        });

        return Promise.race([
            waitForReadPromise,
            timeoutPromise,
        ]).then((result) => {
            clearTimeout(timeoutHandle);
            return result;
        });
    }

    async sendPackage(command, payload) {
        const pkg = this.buildPayloadPackage(command, payload);
        this.log.debug(`TX: ${Buffer.isBuffer(pkg) ? pkg.toString('hex') : pkg}`);

        return new Promise(async (resolve, reject) => { // eslint-disable-line no-async-promise-executor
            if (this.port == null) {
                throw new Error('serial port has not been created yet or creation was unsuccessful!');
            }

            this.port.write(pkg, async (error) => {
                if (error) {
                    reject('Error writing to serial port');
                    return;
                }

                try {
                    const response = await this.readResponse();
                    this.validateResponse(pkg, response);
                    resolve(response);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    concatAndTrimParserBuffer(data) {
        this.parserBuffer = Buffer.concat([this.parserBuffer, data]);
        if (this.parserBuffer.length > this.maxParserBufferLength) {
            this.log.debug('Buffer too large - cutting to max length!');
            this.parserBuffer = this.parserBuffer.subarray(-1 * this.maxParserBufferLength);
        }
    }

    onData(data) {
        this.log.debug(`RX: ${data.toString('hex')}`);

        this.concatAndTrimParserBuffer(data);

        const messageBuffer = this.checkAndExtractMessage();

        if (messageBuffer !== null) {
            if (this.readPromises.length) {
                this.readPromises.shift()(messageBuffer);
            } else {
                this.emitMessage(messageBuffer);
            }
        }
    }

    emitMessage(messageBuffer) {
        this.log.debug(`Message received: ${messageBuffer.toString('hex')}`);
        const messageObject = this.parseRawMessage(messageBuffer);
        this.onMessage(messageObject);
    }

    async init() {
        this.port = new SerialPort(this.options);
        this.port.on('data', this.onData.bind(this));
        this.port.on('error', this.onError);

        try {
            await this.initDevice();
        } catch (error) {
            this.log.error(`Failed to init device: ${error}`);
            this.port.close();

            throw(error);
        }
    }
}

module.exports = SerialDevice;
