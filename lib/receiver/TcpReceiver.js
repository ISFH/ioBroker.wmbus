'use strict';

const SimpleLogger = require('../SimpleLogger');
const net = require('net');

class TcpReceiver {
    constructor(options, mode, onMessage, onError, loggerFunction) {
        this.log = new SimpleLogger(loggerFunction);
        this.log.prefix = 'TCP';

        if (typeof onMessage !== 'function') {
            throw new Error('onMessage must be of type "function(data)"');
        }

        this.options = options;
        this.mode = mode;

        this.onMessage = onMessage;
        this.onError = onError;

        this.port = { on: () => { }, close: () => { } };

        this.parserBuffer = Buffer.alloc(0);

        this.server = net.createServer();
        this.server.on('connection', (socket) => {
            socket.on('data', this.onData.bind(this));
        });
    }

    onData(data) {
        const jsonString = data.toString('utf-8');
        this.log.debug(`Message received: ${jsonString}`);
        const json = JSON.parse(jsonString);

        const message = {
            frameType: json.frameType,
            containsCrc: json.containsCrc,
            rawData: Buffer.from(json.data, 'hex'),
            rssi: -1,
            ts: new Date().getTime()
        };

        this.onMessage(message);
    }

    async init() {
        this.server.listen(Number(this.options.path), '127.0.0.1');
        this.log.info(`Listening on local port ${this.options.path}`);

        this.port = {
            on: () => { },
            close: () => { this.server.close(); }
        };
    }
}

module.exports = TcpReceiver;
