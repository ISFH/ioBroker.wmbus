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
        this.logFunc = (typeof logger === 'function' ? logger : console.log);
        this.port = { on: () => {  }, close: () => {  }};
        this.parserBuffer = Buffer.alloc(0);

        this.server = net.createServer();
        this.server.on('connection', (socket) => {
            socket.on('data', this.onData.bind(this));
        });
    }

    logger(msg) {
        this.logFunc('TCP_WMBUS: ' + msg);
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

        this.logger(JSON.stringify(incomingData));

        if (typeof this.incomingData === 'function') {
            this.incomingData(incomingData);
        } else {
            this.logger('Data but no callback!');
            this.logFunc(data.toString('hex'));
        }
    }

    init(dev, opts, mode) { // eslint-disable-line no-unused-vars
        this.server.listen(Number(dev), '127.0.0.1');
        this.logger(`Listening on local port ${dev}`);

        this.port = {
            on: () => {  },
            close: () => { this.server.close(); }
        };
    }
}

module.exports = TCP_WMBUS;
