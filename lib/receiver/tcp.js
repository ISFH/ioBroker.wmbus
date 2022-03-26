/*
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * This work is part of the ioBroker wmbus adapter
 * and is licensed under the terms of the GPL2 license.
 *
 * Copyright (c) 2021 Christian Landvogt
 *
 * This is a simple receiver for testing: It opens a TCP port and waits
 * for \r terminated hexstrings
 *
 */

const net = require('net');

class TCP_WMBUS {
    constructor(logger) {
        this.logFunc = {};
        if (typeof logger === 'undefined') {
            this.logFunc.debug = console.log;
            this.logFunc.error = console.log;
        } else if (typeof logger === 'function') {
            this.logFunc.debug = logger;
            this.logFunc.error = logger;
        } else {
            this.logFunc.debug = (typeof logger.debug === 'function' ? logger.debug : function() {});
            this.logFunc.error = (typeof logger.error === 'function' ? logger.error : function() {});
        }

        this.port = { on: () => {  }, close: () => {  }};
        this.parserBuffer = Buffer.alloc(0);

        this.server = net.createServer();
        this.server.on('connection', (socket) => {
            socket.on('data', this.onData.bind(this));
        });
    }

    logDebug(msg) {
        this.logFunc.debug('TCP_WMBUS: ' + msg);
    }

    logError(msg) {
        this.logFunc.error('TCP_WMBUS: ' + msg);
    }

    onData(data) {
        const json = JSON.parse(data.toString('utf-8'));

        const incomingData = {
            frame_type: json.frameType,
            contains_crc: json.containsCrc,
            raw_data: Buffer.from(json.data, 'hex'),
            rssi: -1,
            ts: new Date().getTime()
        };

        this.logDebug(JSON.stringify(incomingData));

        if (typeof this.incomingData === 'function') {
            this.incomingData(incomingData);
        } else {
            this.logError('Data but no callback!');
            this.logError(data.toString('hex'));
        }
    }

    init(dev, opts, mode) { // eslint-disable-line no-unused-vars
        this.server.listen(Number(dev), '127.0.0.1');
        this.logDebug(`Listening on local port ${dev}`);

        this.port = {
            on: () => {  },
            close: () => { this.server.close(); }
        };
    }
}

module.exports = TCP_WMBUS;
