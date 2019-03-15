const SerialPort = require('serialport');

class AMBER_WMBUS {
    constructor(logger) {
        this.logger = (typeof logger === 'function' ? logger : console.log);
    }
    
    checksum(data) {
        let csum = data[0];
        for (let i = 1; i < data.length-1; ++i) {
            csum ^= data[i];
        }
        
        return (csum === data[data.length-1]);
    }
    
    onData(data) {
        let that = this;
        if (!Buffer.isBuffer(data)) {
            that.logger('Unkown data received');
            that.logger(data);
            return;
        }

        if (data[0] === 0xFF) { // start of telegram
            that.frameBuffer = data;
            if (that.frameBuffer.byteLength > 2) {
                that.telegramLength = data[2] + 4;
            } else {
                that.telegramLength = -1;
                return;
            }
        } else {
            that.frameBuffer = that.frameBuffer ? Buffer.concat([that.frameBuffer, data]) : data;
        }
    
        if ((that.telegramLength === -1) && (that.frameBuffer.byteLength > 2)) {
            that.telegramLength = data[2] + 4;
        }
        if (that.telegramLength === -1) {
            return;
        }
    
        if (that.telegramLength <= that.frameBuffer.byteLength) {
            var crcPassed = that.checksum(that.frameBuffer.slice(0, that.telegramLength));
            if (!crcPassed) {
                that.logger('telegram received - check sum failed: ' + that.frameBuffer.toString('hex'));
            } else {
                that.logger('telegram received: ' + that.frameBuffer.toString('hex'));
                let data = that.frameBuffer.slice(2, that.telegramLength-2);
                // fix L field
                data[0] = data[0] - 1;
                if (typeof this.incomingData === 'function') {
                    this.incomingData({frame_type: 'A', contains_crc: false, raw_data: data, rssi: 0, ts: new Date().getTime()});
                }
            }
            that.frameBuffer = that.frameBuffer.slice(that.telegramLength);
            that.telegramLength = -1;
        }
    }

    init(dev, opts) {
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));
    }
}

module.exports = AMBER_WMBUS;
