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
			var crcPassed = that.checkSum(that.frameBuffer.slice(0, that.telegramLength));
			if (!crcPassed) {
				that.logger('telegram received - check sum failed: ' + that.frameBuffer.toString('hex'));
			} else {
				that.logger('telegram received: ' + that.frameBuffer.toString('hex'));
				that.parseLinkLayer();	
			}
			that.frameBuffer = that.frameBuffer.slice(that.telegramLength);
			that.telegramLength = -1;
		}
	}
	
	parseLinkLayer(data) {
		let i = 2;
		
		let l_field = data[i++];;
		let c_field = data[i++];
		let address = false;
		
		let m_field = data.readUInt16LE(i);
		let manufacturer_id = String.fromCharCode((m_field >> 10) + 64) + String.fromCharCode(((m_field >> 5) & 0x1f) + 64) + String.fromCharCode((m_field & 0x1f) + 64);
		i += 2;
		let a_field = data.slice(i, i+6);;
		let a_field_id = a_field.readUInt32LE(0).toString(16);
		i += 4;
		let a_field_ver = data[i++];
		let a_field_type = data[i++];

		let result = {
			bframe: false,
			lfield: l_field,
			cfield: c_field,
			mfield: m_field,
			manufacturer: manufacturer_id,
			afield: a_field,
			afield_id: a_field_id,
			afield_type: a_field_type,
			data: data.slice(i)
		};

		//this.logger(result);		
		
		if (typeof this.incomingData === 'function') {
			this.incomingData(result);
		}
	}
	
	init(dev, opts) {
        this.port = new SerialPort(dev, opts);
        this.port.on('data', this.onData.bind(this));
	}
}

module.exports = AMBER_WMBUS;
