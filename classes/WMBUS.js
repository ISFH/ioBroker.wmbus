/*
 *
# vim: noet ci pi sts=0 sw=4 ts=4
 * ported from FHEM WMBus.pm # $Id: WMBus.pm 8659 2015-05-30 14:41:28Z kaihs $
 *           http://www.fhemwiki.de/wiki/WMBUS
 * extended by soef
 * 'partially re-ported' at 2019-Jan-04 by Christian Landvogt
 * git-svn-id: https://svn.fhem.de/fhem/trunk@18058 2b470e98-0d58-463d-a4d8-8e2adae1ed80
 *
 * handling of CRC is still missing if more than one block sent?
 *
 */

const crypto = require('crypto');
const aesCmac = require('node-aes-cmac').aesCmac;

class CRC {
	constructor(polynom, initValue, finalXor) {
		this.polynom = (typeof polynom !== 'undefined' ? polynom : 0x3D65);
		this.initValue = (typeof initValue !== 'undefined' ? initValue : 0);
		this.finalXor = (typeof finalXor !== 'undefined' ? finalXor : 0xFFFF);
		this.table = [];
		for (var i = 0; i < 256; i++) {
			var r = i << 8;
			for (var j = 0; j < 8; j++) {
				if (r & (1 << 15)) {
					r = (r << 1) ^ this.polynom;
				} else {
					r = (r << 1);
				}
			}
			this.table[i] = r;
		}
	}

	crc(data) {
		if (!Buffer.isBuffer(data)) {
			data = Buffer.from(data);
		}

		let that = this;

		let chk = this.initValue;
		data.forEach(function(val) {
			chk = that.table[((chk >> 8) ^ val) & 0xFF] ^ (chk << 8);
		});
		chk ^= this.finalXor;
		chk &= 0xFFFF;
		return chk;
	}
}

class WMBUS_DECODER {
	constructor(logger) {
		this.logger = {};
		if (typeof logger === 'undefined') {
			this.logger.debug = console.log;
			this.logger.error = console.log;
		} else if (typeof logger === 'function') {
			this.logger.debug = logger;
			this.logger.error = logger;
		} else {
			this.logger.debug = (typeof logger.debug === 'function' ? logger.debug : function() {});
			this.logger.error = (typeof logger.error === 'function' ? logger.error : function() {});
		}

		this.crc = new CRC();

		this.constant = {
			// Data Link Layer
			DLL_SIZE: 10,
			// block size
			BLOCK_SIZE: 16,
			// size of CRC in bytes
			CRC_SIZE: 2,
			FRAME_B_LENGTH: 129,

			// sent by meter
			SND_NR: 0x44, // Send, no reply
			SND_IR: 0x46, // Send installation request, must reply with CNF_IR
			ACC_NR: 0x47,
			ACC_DMD: 0x48,

			// sent by controller
			SND_NKE: 0x40, // Link reset
			CNF_IR: 0x06,

			// CI field
			CI_RESP_4: 0x7a,  // Response from device, 4 Bytes
			CI_RESP_12: 0x72, // Response from device, 12 Bytes
			CI_RESP_0: 0x78,  // Response from device, 0 Byte header, variable length
			CI_ERROR: 0x70,   // Error from device, only specified for wired M-Bus but used by Easymeter WMBUS module
			CI_TL_4: 0x8a,    // Transport layer from device, 4 Bytes
			CI_TL_12: 0x8b,   // Transport layer from device, 12 Bytes

			// see https://www.telit.com/wp-content/uploads/2017/09/Telit_Wireless_M-bus_2013_Part4_User_Guide_r14.pdf, 2.3.4
			CI_ELL_2: 0x8c,   // Extended Link Layer, 2 Bytes - OMS
			CI_ELL_8: 0x8d,   // Extended Link Layer, 8 Bytes
			CI_ELL_10: 0x8e,  // Extended Link Layer, 10 Bytes - OMS
			CI_ELL_16: 0x8f,  // Extended Link Layer, 16 Bytes

			CI_AFL: 0x90,     // Authentification and Fragmentation Layer, variable size
			CI_RESP_SML_4: 0x7e, // Response from device, 4 Bytes, application layer SML encoded
			CI_RESP_SML_12: 0x7f, // Response from device, 12 Bytes, application layer SML encoded

			// DIF types (Data Information Field), see page 32
			DIF_NONE: 0x00,
			DIF_INT8: 0x01,
			DIF_INT16: 0x02,
			DIF_INT24: 0x03,
			DIF_INT32: 0x04,
			DIF_FLOAT32: 0x05,
			DIF_INT48: 0x06,
			DIF_INT64: 0x07,
			DIF_READOUT: 0x08,
			DIF_BCD2: 0x09,
			DIF_BCD4: 0x0a,
			DIF_BCD6: 0x0b,
			DIF_BCD8: 0x0c,
			DIF_VARLEN: 0x0d,
			DIF_BCD12: 0x0e,
			DIF_SPECIAL: 0x0f,

			DIF_IDLE_FILLER: 0x2f,

			DIF_EXTENSION_BIT: 0x80,

			VIF_EXTENSION: 0xFB, // true VIF is given in the first VIFE and is coded using table 8.4.4 b) (128 new VIF-Codes)
			VIF_EXTENSION_BIT: 0x80,

			ERR_NO_ERROR: 0,
			ERR_CRC_FAILED: 1,
			ERR_UNKNOWN_VIFE: 2,
			ERR_UNKNOWN_VIF: 3,
			ERR_TOO_MANY_DIFE: 4,
			ERR_UNKNOWN_LVAR: 5,
			ERR_UNKNOWN_DATAFIELD: 6,
			ERR_UNKNOWN_CIFIELD: 7,
			ERR_DECRYPTION_FAILED: 8,
			ERR_NO_AESKEY: 9,
			ERR_UNKNOWN_ENCRYPTION: 10,
			ERR_TOO_MANY_VIFE: 11,
			ERR_MSG_TOO_SHORT: 12,
			ERR_SML_PAYLOAD: 13,
			ERR_FRAGMENT_UNSUPPORTED: 14,
			ERR_UNKNOWN_COMPACT_FORMAT: 15,
			ERR_CIPHER_NOT_INSTALLED: 16,
			ERR_LINK_LAYER_INVALID: 17,

			VIF_TYPE_MANUFACTURER_SPECIFIC: 'MANUFACTURER SPECIFIC',

			// TYPE C transmission uses two different frame types
			// see http://www.st.com/content/ccc/resource/technical/document/application_note/3f/fb/35/5a/25/4e/41/ba/DM00233038.pdf/files/DM00233038.pdf/jcr:content/translations/en.DM00233038.pdf
			FRAME_TYPE_A: 'A',
			FRAME_TYPE_B: 'B',
		};

		// VIF types (Value Information Field), see page 32
		this.VIFInfo = {
			//  10(nnn-3) Wh  0.001Wh to 10000Wh
			VIF_ENERGY_WATT: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00000000,
				bias    : -3,
				unit    : 'Wh',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn) J		 0.001kJ to 10000kJ
			VIF_ENERGY_JOULE: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00001000,
				bias    : 0,
				unit    : 'J',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-6) m3  0.001l to 10000l
			VIF_VOLUME: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00010000,
				bias    : -6,
				unit    : 'm³',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-3) kg  0.001kg to 10000kg
			VIF_MASS: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00011000,
				bias    : -3,
				unit    : 'kg',
				calcFunc: this.valueCalcNumeric,
			},
			//  seconds
			VIF_ON_TIME_SEC: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100000,
				bias    : 0,
				unit    : 'sec',
				calcFunc: this.valueCalcNumeric,
			},
			//  minutes
			VIF_ON_TIME_MIN: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100001,
				bias    : 0,
				unit    : 'min',
				calcFunc: this.valueCalcNumeric,
			},
			//  hours
			VIF_ON_TIME_HOURS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100010,
				bias    : 0,
				unit    : 'hours',
			},
			//  days
			VIF_ON_TIME_DAYS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100011,
				bias    : 0,
				unit    : 'days',
			},
			//  seconds
			VIF_OP_TIME_SEC: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100100,
				bias    : 0,
				unit    : 'sec',
			},
			//  minutes
			VIF_OP_TIME_MIN: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100101,
				bias    : 0,
				unit    : 'min',
			},
			//  hours
			VIF_OP_TIME_HOURS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100110,
				bias    : 0,
				unit    : 'hours',
			},
			//  days
			VIF_OP_TIME_DAYS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100111,
				bias    : 0,
				unit    : 'days',
			},
			//  10(nnn-3) W   0.001W to 10000W
			VIF_ELECTRIC_POWER: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00101000,
				bias    : -3,
				unit    : 'W',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn) J/h   0.001kJ/h to 10000kJ/h
			VIF_THERMAL_POWER: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00110000,
				bias    : 0,
				unit    : 'J/h',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-6) m3/h 0.001l/h to 10000l/h
			VIF_VOLUME_FLOW: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b00111000,
				bias    : -6,
				unit    : 'm³/h',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-7) m3/min 0.0001l/min to 10000l/min
			VIF_VOLUME_FLOW_EXT1: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b01000000,
				bias    : -7,
				unit    : 'm³/min',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-9) m3/s 0.001ml/s to 10000ml/s
			VIF_VOLUME_FLOW_EXT2: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b01001000,
				bias    : -9,
				unit    : 'm³/s',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nnn-3) kg/h 0.001kg/h to 10000kg/h
			VIF_MASS_FLOW: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b01010000,
				bias    : -3,
				unit    : 'kg/h',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nn-3) °C 0.001°C to 1°C
			VIF_FLOW_TEMP: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b01011000,
				bias    : -3,
				unit    : '°C',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nn-3) °C 0.001°C to 1°C
			VIF_RETURN_TEMP: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b01011100,
				bias    : -3,
				unit    : '°C',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nn-3) K 1mK to 1000mK
			VIF_TEMP_DIFF: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b01100000,
				bias    : -3,
				unit    : 'K',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nn-3) °C 0.001°C to 1°C
			VIF_EXTERNAL_TEMP: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b01100100,
				bias    : -3,
				unit    : '°C',
				calcFunc: this.valueCalcNumeric,
			},
			//  10(nn-3) bar  1mbar to 1000mbar
			VIF_PRESSURE: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b01101000,
				bias    : -3,
				unit    : 'bar',
				calcFunc: this.valueCalcNumeric,
			},
			//  data type G
			VIF_TIME_POINT_DATE: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01101100,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcDate,
			},
			//  data type F
			VIF_TIME_POINT_DATE_TIME: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01101101,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcDateTime,
			},
			// Unit for Heat Cost Allocator, dimensonless
			VIF_HCA: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01101110,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcNumeric,
			},
			// Fabrication No
			VIF_FABRICATION_NO: {
				typeMask	: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01111000,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcNumeric,
			},
			// Eigentumsnummer (used by Easymeter even though the standard allows this only for writing to a slave)
			VIF_OWNER_NO: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01111001,
				bias    : 0,
				unit    : '',
			},
			//  seconds
			VIF_AVERAGING_DURATION_SEC: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110000,
				bias    : 0,
				unit    : 'sec',
				calcFunc: this.valueCalcNumeric,
			},
			//  minutes
			VIF_AVERAGING_DURATION_MIN: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110001,
				bias    : 0,
				unit    : 'min',
				calcFunc: this.valueCalcNumeric,
			},
			//  hours
			VIF_AVERAGING_DURATION_HOURS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110010,
				bias    : 0,
				unit    : 'hours',
			},
			//  days
			VIF_AVERAGING_DURATION_DAYS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110011,
				bias    : 0,
				unit    : 'days',
			},
			//  seconds
			VIF_ACTUALITY_DURATION_SEC: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110100,
				bias    : 0,
				unit    : 'sec',
				calcFunc: this.valueCalcNumeric,
			},
			//  minutes
			VIF_ACTUALITY_DURATION_MIN: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110101,
				bias    : 0,
				unit    : 'min',
				calcFunc: this.valueCalcNumeric,
			},
			//  hours
			VIF_ACTUALITY_DURATION_HOURS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110110,
				bias    : 0,
				unit    : 'hours',
			},
			//  days
			VIF_ACTUALITY_DURATION_DAYS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110111,
				bias    : 0,
				unit    : 'days',
			}
		};

		// Codes used with extension indicator $FD, see 8.4.4 on page 80
		this.VIFInfo_FD = {
			//  Credit of 10nn-3 of the nominal local legal currency units
			VIF_CREDIT: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b00000000,
				bias    : -3,
				unit    : '€',
				calcFunc: this.valueCalcNumeric,
			},
			//  Debit of 10nn-3 of the nominal local legal currency units
			VIF_DEBIT: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b00000100,
				bias    : -3,
				unit    : '€',
				calcFunc: this.valueCalcNumeric,
			},
			//  Access number (transmission count)
			VIF_ACCESS_NO: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00001000,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcNumeric,
			},
			//  Medium (as in fixed header)
			VIF_MEDIUM: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00001001,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcNumeric,
			},
			//  Parameter set identification
			VIF_PARAMETER_SET_IDENTIFICATION: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00001011,
				bias    : 0,
				unit    : ''
			},
			//  Model / Version
			VIF_MODEL_VERSION: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00001100,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcNumeric,
			},
			//  Error flags (binary)
			VIF_ERROR_FLAGS: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00010111,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcHex,
			},
			//   Duration since last readout [sec(s)..day(s)]
			VIF_DURATION_SINCE_LAST_READOUT: {
				typeMask: 0b01111100,
				expMask : 0b00000011,
				type    : 0b00101100,
				bias    : 0,
				unit    : 's',
				calcFunc: this.valueCalcTimeperiod,
			},
			//  10nnnn-9 Volts
			VIF_VOLTAGE: {
				typeMask: 0b01110000,
				expMask : 0b00001111,
				type    : 0b01000000,
				bias    : -9,
				unit    : 'V',
				calcFunc: this.valueCalcNumeric,
			},
			//  10nnnn-12 Ampere
			VIF_ELECTRICAL_CURRENT: {
				typeMask: 0b01110000,
				expMask : 0b00001111,
				type    : 0b01010000,
				bias    : -12,
				unit    : 'A',
				calcFunc: this.valueCalcNumeric,
			},
			//   reception level of a received radio device.
			VIF_RECEPTION_LEVEL: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01110001,
				bias    : 0,
				unit    : 'dBm',
				calcFunc: this.valueCalcNumeric,
			},
			// Reserved
			VIF_FD_RESERVED: {
				typeMask: 0b01110000,
				expMask : 0b00000000,
				type    : 0b01110000,
				bias    : 0,
				unit    : 'Reserved',
			}
		};
		// Codes used with extension indicator $FB
		this.VIFInfo_FB = {
			//  Energy 10(n-1) MWh  0.1MWh to 1MWh
			VIF_ENERGY: {
				typeMask: 0b01111110,
				expMask : 0b00000001,
				type    : 0b00000000,
				bias    : -1,
				unit    : 'MWh',
				calcFunc: this.valueCalcNumeric,
			},
		};
		// Codes used for an enhancement of VIFs other than $FD and $FB
		this.VIFInfo_other = {
			VIF_ERROR_NONE: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00000000,
				bias    : 0,
				unit    : 'No error',
			},
			VIF_TOO_MANY_DIFES: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00000001,
				bias    : 0,
				unit    : 'Too many DIFEs',
			},
			VIF_ILLEGAL_VIF_GROUP: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00001100,
				bias    : 0,
				unit    : 'Illegal VIF-Group',
			},
			VIF_PER_SECOND: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100000,
				bias    : 0,
				unit    : 'per second',
			},
			VIF_PER_MINUTE: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100001,
				bias    : 0,
				unit    : 'per minute',
			},
			VIF_PER_HOUR: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100010,
				bias    : 0,
				unit    : 'per hour',
			},
			VIF_PER_DAY: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100011,
				bias    : 0,
				unit    : 'per day',
			},
			VIF_PER_WEEK: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100100,
				bias    : 0,
				unit    : 'per week',
			},
			VIF_PER_MONTH: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100101,
				bias    : 0,
				unit    : 'per month',
			},
			VIF_PER_YEAR: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100110,
				bias    : 0,
				unit    : 'per year',
			},
			VIF_PER_REVOLUTION: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00100111,
				bias    : 0,
				unit    : 'per revolution/measurement',
			},
			VIF_PER_INCREMENT_INPUT: {
				typeMask: 0b01111110,
				expMask : 0b00000000,
				type    : 0b00101000,
				bias    : 0,
				unit    : 'increment per input pulse on input channnel //',
				calcFunc: this.valueCalcNumeric,
			},
			VIF_PER_INCREMENT_OUTPUT: {
				typeMask: 0b01111110,
				expMask : 0b00000000,
				type    : 0b00101010,
				bias    : 0,
				unit    : 'increment per output pulse on output channnel //',
				calcFunc: this.valueCalcNumeric,
			},
			VIF_PER_LITER: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00101100,
				bias    : 0,
				unit    : 'per liter',
			},
			VIF_START_DATE_TIME: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00111001,
				bias    : 0,
				unit    : 'start date(/time) of',
			},
			VIF_ACCUMULATION_IF_POSITIVE: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b00111011,
				bias    : 0,
				unit    : 'Accumulation only if positive contribution',
			},
			VIF_DURATION_NO_EXCEEDS: {
				typeMask: 0b01110111,
				expMask : 0b00000000,
				type    : 0b01000001,
				bias    : 0,
				unit    : '// of exceeds',
				calcFunc: this.valueCalcu,
			},
			VIF_DURATION_LIMIT_EXCEEDED: {
				typeMask: 0b01110000,
				expMask : 0b00000000,
				type    : 0b01010000,
				bias    : 0,
				unit    : 'duration of limit exceeded',
				calcFunc: this.valueCalcufnn,
			},
			VIF_MULTIPLICATIVE_CORRECTION_FACTOR: {
				typeMask: 0b01111000,
				expMask : 0b00000111,
				type    : 0b01110000,
				bias    : -6,
				unit    : '',
			},
			VIF_MULTIPLICATIVE_CORRECTION_FACTOR_1000: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01111101,
				bias    : 0,
				unit    : '',
				calcFunc: this.valueCalcMultCorr1000,
			},
			VIF_FUTURE_VALUE: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01111110,
				bias    : 0,
				unit    : '',
			},
			VIF_MANUFACTURER_SPECIFIC: {
				typeMask: 0b01111111,
				expMask : 0b00000000,
				type    : 0b01111111,
				bias    : 0,
				unit    : 'manufacturer specific',
			}
		};
		// For Easymeter (manufacturer specific)
		this.VIFInfo_ESY = {
			VIF_ELECTRIC_POWER_PHASE: {
				typeMask: 0b01000000,
				expMask : 0b00000000,
				type    : 0b00000000,
				bias    : -2,
				unit    : 'W',
				calcFunc: this.valueCalcNumeric,
			},
			VIF_ELECTRIC_POWER_PHASE_NO: {
				typeMask: 0b01111110,
				expMask : 0b00000000,
				type    : 0b00101000,
				bias    : 0,
				unit    : 'phase //',
				calcFunc: this.valueCalcNumeric,
			}
		};
		// For Kamstrup (manufacturer specific)
		this.VIFInfo_KAM = {
			VIF_KAMSTRUP_INFO: {
				typeMask: 0b00000000,
				expMask : 0b00000000,
				type    : 0b00000000,
				bias    : 0,
				unit    : '',
			}
		};

		// see 4.2.3, page 24
		this.validDeviceTypes = {
			0x00: 'Other',
			0x01: 'Oil',
			0x02: 'Electricity',
			0x03: 'Gas',
			0x04: 'Heat',
			0x05: 'Steam',
			0x06: 'Warm Water (30 °C ... 90 °C)',
			0x07: 'Water',
			0x08: 'Heat Cost Allocator',
			0x09: 'Compressed Air',
			0x0a: 'Cooling load meter (Volume measured at return temperature: outlet)',
			0x0b: 'Cooling load meter (Volume measured at flow temperature: inlet)',
			0x0c: 'Heat (Volume measured at flow temperature: inlet)',
			0x0d: 'Heat / Cooling load meter',
			0x0e: 'Bus / System component',
			0x0f: 'Unknown Medium',
			0x10: 'Reserved for utility meter',
			0x11: 'Reserved for utility meter',
			0x12: 'Reserved for utility meter',
			0x13: 'Reserved for utility meter',
			0x14: 'Calorific value',
			0x15: 'Hot water (> 90 °C)',
			0x16: 'Cold water',
			0x17: 'Dual register (hot/cold) Water meter',
			0x18: 'Pressure',
			0x19: 'A/D Converter',
			0x1a: 'Smokedetector',
			0x1b: 'Room sensor (e.g. temperature or humidity)',
			0x1c: 'Gasdetector',
			0x1d: 'Reserved for sensors',
			0x1e: 'Reserved for sensors',
			0x1f: 'Reserved for sensors',
			0x20: 'Breaker (electricity)',
			0x21: 'Valve (gas)',
			0x22: 'Reserved for switching devices',
			0x23: 'Reserved for switching devices',
			0x24: 'Reserved for switching devices',
			0x25: 'Customer unit (Display device)',
			0x26: 'Reserved for customer units',
			0x27: 'Reserved for customer units',
			0x28: 'Waste water',
			0x29: 'Garbage',
			0x2a: 'Carbon dioxide',
			0x2b: 'Environmental meter',
			0x2c: 'Environmental meter',
			0x2d: 'Environmental meter',
			0x2e: 'Environmental meter',
			0x2f: 'Environmental meter',
			0x31: 'OMS MUC',
			0x32: 'OMS unidirectional repeater',
			0x33: 'OMS bidirectional repeater',
			0x37: 'Radio converter (Meter side)',
		};

		// bitfield, errors can be combined, see 4.2.3.2 on page 22
		this.validStates = {
			0x00: 'no errors',
			0x01: 'application busy',
			0x02: 'any application error',
			0x03: 'abnormal condition/alarm',
			0x04: 'battery low',
			0x08: 'permanent error',
			0x10: 'temporary error',
			0x20: 'specific to manufacturer',
			0x40: 'specific to manufacturer',
			0x80: 'specific to manufacturer',
		};

		this.encryptionModes = {
			0x00: 'standard unsigned',
			0x01: 'signed data telegram',
			0x02: 'static telegram',
			0x03: 'reserved',
		};

		this.functionFieldTypes = {
			0b00: 'Instantaneous value',
			0b01: 'Maximum value',
			0b10: 'Minimum value',
			0b11: 'Value during error state',
		};

		// not all CRC related code is ported !!!
		this.crc_size = this.constant.CRC_SIZE;
		this.errorCode = this.constant.ERR_NO_ERROR;
		this.errorMessage = '';
		this.frame_type = this.constant.FRAME_TYPE_A; // default
		this.alreadyDecrypted = false;

	} // constructor end

	removeCRC(data) {
		let out = data.slice(0, this.constant.BLOCK_SIZE);
		let offset = this.constant.BLOCK_SIZE + this.constant.CRC_SIZE;
		while ((offset + this.constant.BLOCK_SIZE + this.constant.CRC_SIZE) < data.length) {
			out = Buffer.concat([out, data.slice(offset, offset + this.constant.BLOCK_SIZE)]);
			offset += this.constant.BLOCK_SIZE + this.constant.CRC_SIZE;
		}

		out = Buffer.concat([out, data.slice(offset, data.length - this.constant.CRC_SIZE)]);
		return out;
	}

	formatDate(date, format) {
        function pad(num) {
            return num < 10 ? '0' + num : '' + num;
        }

        let s = format.replace('YYYY', date.getFullYear());
        s = s.replace('MM', pad(date.getMonth()+1));
        s = s.replace('DD', pad(date.getDate()));
        s = s.replace('hh', pad(date.getHours()));
        s = s.replace('mm', pad(date.getMinutes()));
        return s;
    }

	valueCalcNumeric(value, VIB) {
		let num = value * VIB.valueFactor;
		if (VIB.valueFactor < 1 && num.toFixed(0) != num) {
			num = num.toFixed(VIB.valueFactor.toString().length - 2);
		}
		return num;
	}

	valueCalcDate(value, VIB) {
		//value is a 16bit int

		//day: UI5 [1 to 5] <1 to 31>
		//month: UI4 [9 to 12] <1 to 12>
		//year: UI7[6 to 8,13 to 16] <0 to 99>

		//   YYYY MMMM YYY DDDDD
		// 0b0000 1100 111 11111 = 31.12.2007
		// 0b0000 0100 111 11110 = 30.04.2007

		let day = (value & 0b11111);
		let month = ((value & 0b111100000000) >> 8);
		let year = (((value & 0b1111000000000000) >> 9) | ((value & 0b11100000) >> 5)) + 2000;
		if (day > 31 || month > 12 || year > 2099) {
			this.logger.error("invalid date: " + value);
			//return "invalid: " + value;
		}
		let date = new Date(year, month-1, day);
		return this.formatDate(date, 'YYYY-MM-DD');
	}

	valueCalcDateTime(value, VIB) {
		// min: UI6 [1 to 6] <0 to 59>
		// hour: UI5 [9 to13] <0 to 23>
		// day: UI5 [17 to 21] <1 to 31>
		// month: UI4 [25 to 28] <1 to 12>
		// year: UI7[22 to 24,29 to 32] <0 to 99>
		//  IV:
		//  B1[8] {time invalid}:
		//  IV<0> :=
		// valid,
		// IV>1> := invalid
		// SU: B1[16] {summer time}:
		// SU<0> := standard time,
		// SU<1> := summer time
		// RES1: B1[7] {reserved}: <0>
		// RES2: B1[14] {reserved}: <0>
		// RES3: B1[15] {reserved}: <0>

		let datePart = value >> 16;
		let timeInvalid = value & 0b10000000;

		let dateTime = this.valueCalcDate(datePart, VIB);
		if (timeInvalid == 0) {
			let min = (value & 0b111111);
			let hour = (value >> 8) & 0b11111;
			let su = (value & 0b1000000000000000);
			if (min > 59 || hour > 23) {
				dateTime = 'invalid: ' + value;
			} else {
				let date = new Date(0);
				date.setHours(hour);
				date.setMinutes(min);
				dateTime += ' ' + this.formatDate(date, "hh:mm") + (su ? ' DST' : '');
			}
		}
		return dateTime;
	}

	valueCalcHex(value, VIB) {
		return value.toString(16);
	}

	valueCalcu(value, VIB) {
		return (value & 0b00001000 ? 'upper' : 'lower') + ' limit';
	}

	valueCalcufnn(value, VIB) {
		let result = (value & 0b00001000 ? 'upper' : 'lower') + ' limit';
		result += ', ' + (value & 0b00000100 ? 'first' : 'last');
		result += ', duration ' + (value & 0b11);
		return result;
	}

	valueCalcMultCorr1000(value, VIB) {
		VIB.value *= 1000;
		return "correction by factor 1000";
	}

	valueCalcTimeperiod(value, VIB) {
		switch (VIB.exponent) {
			case 0: VIB.unit = 's'; break;
			case 1: VIB.unit = 'm'; break;
			case 2: VIB.unit = 'h'; break;
			case 3: VIB.unit = 'd'; break;
			default: VIB.unit = '';
		}
		return value;
	}

	type2string(type) {
		return this.validDeviceTypes[type] || 'unknown' ;
	}

	state2string(state) {
		let result = [];
		if (state) {
			for (let i in this.validStates) {
				if (i & state) {
					result.push(this.validStates[i]);
				}
			}
		} else {
			result.push(this.validStates[0]);
		}
		return result;
	}

	manId2hex(idascii) {
		return (idascii.charCodeAt(0) - 64) << 10 | (idascii.charCodeAt(1) - 64) << 5 | (idascii.charCodeAt(2) - 64);
	}

	manId2ascii(idhex) {
		return String.fromCharCode((idhex >> 10) + 64) + String.fromCharCode(((idhex >> 5) & 0x1f) + 64) + String.fromCharCode((idhex & 0x1f) + 64);
	}

	decodeConfigword(cw) {
		this.config = {};

		this.config.mode = (cw & 0b0001111100000000) >> 8;
		switch (this.config.mode) {
			case 0:
			case 5:
				this.config.bidirectional    = (cw & 0b1000000000000000) >> 15; /* mode 5 */
				this.config.accessability    = (cw & 0b0100000000000000) >> 14; /* mode 5 */
				this.config.synchronous      = (cw & 0b0010000000000000) >> 13; /* mode 5 */
				                                  /* 0b0001111100000000 - mode */
				this.config.encrypted_blocks = (cw & 0b0000000011110000) >> 4;  /* mode 5 + 7 */
				this.config.content          = (cw & 0b0000000000001100) >> 2;  /* mode 5 */
				this.config.hop_counter      = (cw & 0b0000000000000011);       /* mode 5 */
				break;
			case 7:
				this.config.content          = (cw & 0b1100000000000000) >> 14; /* mode 7 + 13 */
				                                  /* 0b0010000000000000 - reserved for counter size */
												  /* 0b0001111100000000 - mode */
				this.config.encrypted_blocks = (cw & 0b0000000011110000) >> 4;  /* mode 5 + 7 */
				                                  /* 0b0000000000001111 - reserved for counter index */
				break;
			case 13:
				this.config.content          = (cw & 0b1100000000000000) >> 14; /* mode 7 + 13 */
				                                  /* 0b0010000000000000 - reserved */
												  /* 0b0001111100000000 - mode */
				this.config.encrypted_bytes  =  cw & 0b0000000011111111;  /* mode 13 */
				break;
			default:
				this.logger.debug("Warning unknown security mode: " + this.config.mode);
		}
	}

	decodeConfigwordExt(cwe) {
		if (this.config.mode == 7) {
			                          /* 0b10000000 - reserved
			                             0b01000000 - reserved for version */
			this.config.kdf_sel = (cwe & 0b00110000) >> 4;
			this.config.keyid   =  cwe & 0b00001111;
			return;
		}

		if (this.config.mode == 13) {
			                            /* 0b11110000 - reserved */
			this.config.proto_type = cwe & 0b00001111;
			return;
		}
	}

	decodeBCD(digits, bcd) {
		// check for negative BCD (not allowed according to specs)
		let sign = 1;
		if (bcd[digits/2 - 1] >> 4 > 9) {
			bcd[digits/2 - 1] &= 0b00001111;
			sign = -1;
		}
		let val = 0;
		for (let i = 0; i < digits / 2; i++) {
			val += ((bcd[i] & 0x0f) + (((bcd[i] & 0xf0) >> 4) * 10)) * Math.pow(100, i);
		}
		return parseInt(sign*val);
	}

	decodeValueInformationBlock(data, offset, dataRecord) {
		function findTabIndex (el) {
			return (this.vif & this.table[el].typeMask) == this.table[el].type;
		}

		function processVIF(vif, info) {
			VIB.exponent = vif & info.expMask;
			VIB.unit = info.unit;
			if ((typeof VIB.exponent !== 'undefined') && (typeof info.bias !== 'undefined')) {
				VIB.valueFactor = Math.pow(10, (VIB.exponent + info.bias))
			} else {
				info.valueFactor = 1;
			}

			if (typeof info.calcFunc === 'function') {
				VIB.calcFunc = info.calcFunc.bind(this);
			}
		}

		let vif;
		let vifs = [];
		let vifTable;
		let type = 'primary';

		let VIB = {};

		do {
			if (vifs.length > 10) {
				VIB.errorMessage = 'too many VIFE';
				VIB.errorCode = this.constant.ERR_TOO_MANY_VIFE;
				this.logger.error(VIB.errorMessage);
				// is breaking a good idea?
				break;
			}

			vifTable = this.VIFInfo;
			if (offset >= data.length) {
				this.logger.debug("Warning: no data but VIF extension bit still set!");
				break;
			}

			vif = data[offset++];

			if (vif & 0x7F == 0x7C) { // plain text vif
				let len = data[offset++];
				vifs.push({ table: null, vif: data.toString('ascii', offset, offset+len), type: 'plain' });
				offset += len;
				if (vif & 0x80) { continue; } else { break;	}
			} else if (vif == 0xFB) { // just switch table
				vifTable = this.VIFInfo_FB;
				vif = data[offset++];
				type += '-FB';
			} else if (vif == 0xFD) { // just switch table
				vifTable = this.VIFInfo_FD;
				vif = data[offset++];
				type += '-FB';
			} else if (vif == 0xFF) { // manufacturer specific
				let tab = "VIFInfo_" + this.link_layer.manufacturer;
				vif = data[offset++];
				if (typeof this[tab] !== 'undefined') {
					vifTable = this[tab];
					type += '-' + this.link_layer.manufacturer;
				} else {
					this.logger.debug("WARNING: Unkown manufacturer specific vif: 0x" + vif.toString(16));
				}
			} else if (vif & 0x80) { // other extension
				vifTable = this.VIFInfo_other;
			}

			vifs.push({ table: vifTable, vif: vif & 0x7F, type: type });
			type = 'extension';
		} while (vif & 0x80);

		VIB.ext = [];

		vifs.forEach(function (item) {
			if (item.type.startsWith('primary')) { // primary
				let tabIndex = Object.keys(item.table).findIndex(findTabIndex, item);
				if (tabIndex === -1) { // not found
					VIB.errorMessage = "unknown " + item.type + " VIF 0x" + item.vif.toString(16);
					VIB.type = "VIF" + item.type.replace("primary", "") + " 0x" + item.vif.toString(16);
					VIB.errorCode = this.constant.ERR_UNKNOWN_VIFE;
				} else {
					processVIF.call(this, item.vif, item.table[Object.keys(item.table)[tabIndex]]);
					VIB.type = Object.keys(item.table)[tabIndex];
				}
			} else if (item.type === 'plain') { // plain
				VIB.type = 'VIF_PLAIN_TEXT';
				VIB.unit = item.vif;
			} else { // extension
				if (typeof item.table !== 'undefined') {
					let tabIndex = Object.keys(item.table).findIndex(findTabIndex, item);
					if (tabIndex === -1) { // not found
						VIB.errorMessage = "unknown " + item.type + " VIFExt 0x" + item.vif.toString(16);
						VIB.errorCode = this.constant.ERR_UNKNOWN_VIFE;
					} else {
						item.info = item.table[Object.keys(item.table)[tabIndex]];
						item.type = Object.keys(item.table)[tabIndex];
						delete item.table;
					}
				}
				VIB.ext.push(item);
			}
		}.bind(this));

		//this.logger.debug("VIB");
		//this.logger.debug(VIB);

		dataRecord.VIB = VIB;

		return offset;
	}

	decodeDataInformationBlock(data, offset, dataRecord) {
		let dif = data[offset++];
		let difExtNo = 0;
		let DIB = {};

		DIB.tariff = 0;
		DIB.devUnit = 0;
		DIB.storageNo     = (dif & 0b01000000) >> 6;
		DIB.functionField = (dif & 0b00110000) >> 4;
		DIB.dataField     =  dif & 0b00001111;
		DIB.functionFieldText = this.functionFieldTypes[DIB.functionField];

		while (dif & this.constant.DIF_EXTENSION_BIT) {

			if (offset >= data.length) {
				this.logger.debug("Warning: no data but DIF extension bit still set!");
				break;
			}
			dif = data[offset++];

			if (difExtNo > 9) {
				DIB.errorMessage = 'too many DIFE';
				DIB.errorCode = this.constant.ERR_TOO_MANY_DIFE;
				this.logger.error(DIB.errorMessage);
				break;
			}

			DIB.storageNo |=  (dif & 0b00001111)       << (difExtNo * 4) + 1;
			DIB.tariff    |= ((dif & 0b00110000 >> 4)) << (difExtNo * 2);
			DIB.devUnit   |= ((dif & 0b01000000 >> 6)) <<  difExtNo;
			difExtNo++;
		}

		//this.logger.debug("DIB");
		//this.logger.debug(DIB);

		dataRecord.DIB = DIB;

		return offset;
	}

	decodeDataRecords(data) {
		let offset = 0;
		let dataRecord;
		let drCount = 1;
		let value;
		this.dataRecords = [];

		DataLoop:
		while (offset < data.length)
		{
			dataRecord = {};

			while (data[offset] == this.constant.DIF_IDLE_FILLER) {
				offset++
				if (offset >= data.length) {
					break DataLoop;
				}
			}

			offset = this.decodeDataInformationBlock(data, offset, dataRecord);
			offset = this.decodeValueInformationBlock(data, offset, dataRecord);

			try {
				switch (dataRecord.DIB.dataField) {
					case this.constant.DIF_NONE: value = ''; break;
					case this.constant.DIF_BCD2: value = this.decodeBCD(2, data.slice(offset, offset+1)); offset += 1; break;
					case this.constant.DIF_BCD4: value = this.decodeBCD(4, data.slice(offset, offset+2)); offset += 2; break;
					case this.constant.DIF_BCD6: value = this.decodeBCD(6, data.slice(offset, offset+3)); offset += 3; break;
					case this.constant.DIF_BCD8: value = this.decodeBCD(8, data.slice(offset, offset+4)); offset += 4; break;
					case this.constant.DIF_BCD12: value = this.decodeBCD(12, data.slice(offset, offset+6)); offset += 6; break;
					case this.constant.DIF_INT8: value = data.readInt8(offset); offset += 1; break;
					case this.constant.DIF_INT16: value = data.readUInt16LE(offset); offset += 2; break;
					case this.constant.DIF_INT24: value = data.readUIntLE(offset, 3); offset += 3; break;
					case this.constant.DIF_INT32: value = data.readUInt32LE(offset); offset += 4; break;
					case this.constant.DIF_INT48: value = data.readUIntLE(offset, 6); offset += 6; break;

					case this.constant.DIF_INT64:
						// correct?
						value = data.readUInt32LE(offset) + (data.readUInt32LE(offset+4) << 32);
						offset += 8;
						break;
					case this.constant.DIF_FLOAT32:
						// correct?
						value = data.readFloatLE(offset);
						offset += 4;
						break;
					case this.constant.DIF_VARLEN:
						let lvar = data[offset++];
						if (lvar <= 0xBF) {
							if (dataRecord.VIB.type === this.constant.VIF_TYPE_MANUFACTURER_SPECIFIC) { // special handling, LSE seems to lie about this
								value = data.toString('hex', offset, offset+lvar);
							} else { //  ASCII string with lvar characters
								value = data.toString('ascii', offset, offset+lvar);
								if (this.link_layer.manufacturer === 'ESY') { value = value.split('').reverse().join(''); } // Easymeter stores the string backwards!
							}
							offset += lvar;
						} else if ((lvar >= 0xC0) && (lvar <= 0xCF)) {
							lvar -= 0xC0;
							// positive BCD number with (lvar - C0h) * 2 digits
							value = this.decodeBCD(lvar * 2, data.slice(offset, offset+lvar));
							offset += lvar;
						} else if ((lvar >= 0xD0) && (lvar <= 0xDF)) {
							lvar -= 0xD0;
							//  negative BCD number with (lvar - D0h) * 2 digits
							value = -1 * this.decodeBCD(lvar * 2, data.slice(offset, offset+lvar));
							offset += lvar;
						} else {
							this.errorMessage = "in datablock " + drCount + ": unhandled LVAR field 0x" + lvar.toString(16);
							this.errorCode = this.constant.ERR_UNKNOWN_LVAR;
							this.logger.error(this.errorMessage);
							return 0;
						}
						break;
					case this.constant.DIF_READOUT:
						this.errorMessage = "in datablock " + drCount + ": unexpected DIF_READOUT";
						this.errorCode = this.constant.ERR_UNKNOWN_DATAFIELD;
						this.logger.error(this.errorMessage);
						return 0;
					case this.constant.DIF_SPECIAL:
						// special functions
						this.logger.debug("DIF_SPECIAL at " + offset + ": ");
						value = data.toString('hex', offset);
						this.logger.debug(value);
						break DataLoop;
					default:
						this.errorMessage = "in datablock " + drCount + ": unhandled datafield 0x" + dataRecord.DIB.dataField.toString(16);
						this.errorCode = this.constant.ERR_UNKNOWN_DATAFIELD;
						this.logger.error(this.errorMessage);
						return 0;
				}

				if (typeof dataRecord.VIB.calcFunc === 'function') {
					dataRecord.VIB.value = dataRecord.VIB.calcFunc(value, dataRecord.VIB);
					this.logger.debug(dataRecord.VIB.type + ": Value raw " + value + " value calc " + dataRecord.VIB.value);
				} else if (typeof value != null) {
					dataRecord.VIB.value = value;
					this.logger.debug(dataRecord.VIB.type + ": Value " + value);
				} else {
					dataRecord.VIB.value = "";
					this.logger.debug(dataRecord.VIB.type + ": Empty DataRecord?");
				}

				dataRecord.VIB.extension = '';
				dataRecord.VIB.ext.forEach(function (ext) {
					dataRecord.VIB.extension += ext.info.unit + ", ";
					if (typeof ext.info.calcFunc === 'function') {
						let ret = ext.info.calcFunc.call(this, ext.vif, dataRecord.VIB);
						if (ret) {
							dataRecord.VIB.extension += ret + ", ";
						}
					}
				}.bind(this));

				dataRecord.VIB.extension = dataRecord.VIB.extension.substr(0, dataRecord.VIB.extension.length - 2);

				//this.logger.debug(dataRecord);
				this.dataRecords.push(dataRecord);
				drCount++;

			} catch (e) {
				this.logger.debug(e);
				this.logger.debug("Warning: Not enough data for DIB.dataField type! Incomplete telegram data?");
			}
		}

		return 1;
	}

	decrypt(encrypted, key, iv, algorithm) {
		// see 4.2.5.3, page 26
		let initVector;
		if (typeof iv === 'undefined') {
			initVector = Buffer.concat([Buffer.alloc(2), this.link_layer.afield, Buffer.alloc(8, this.application_layer.access_no)]);
			if (typeof this.application_layer.meter_id !== 'undefined') {
				initVector.writeUInt32LE(this.application_layer.meter_id, 2);
				initVector.writeUInt8(this.application_layer.meter_vers, 6);
				initVector.writeUInt8(this.application_layer.meter_dev, 7);
			}
			if (typeof this.application_layer.meter_man !== 'undefined') {
				initVector.writeUInt16LE(this.application_layer.meter_man);
			} else {
				initVector.writeUInt16LE(this.link_layer.mfield);
			}
		} else {
			initVector = iv;
		}
		this.logger.debug("IV: " + initVector.toString('hex'));
		algorithm = (typeof algorithm === 'undefined' ? 'aes-128-cbc' : algorithm);
		const decipher = crypto.createDecipheriv(algorithm, key, initVector);
		decipher.setAutoPadding(false);
		let padding = encrypted.length % 16;
		if (padding) {
			this.logger.debug("Added padding: " + padding);
			let len = encrypted.length;
			encrypted = Buffer.concat([encrypted, Buffer.alloc(16-padding)]);
			return Buffer.concat([decipher.update(encrypted), decipher.final()]).slice(0, len);
		}
		return Buffer.concat([decipher.update(encrypted), decipher.final()]);
	}

	decrypt_mode7(encrypted, key, tpl) {
		// see 9.2.4, page 59
		let initVector = Buffer.alloc(16, 0x00);
		// KDF
		let msg = Buffer.alloc(16, 0x07);
		msg[0] = 0x00 // derivation constant (see. 9.5.3) 00 = Kenc (from meter) 01 = Kmac (from meter)
		msg.writeUInt32LE(this.afl.mcr, 1);
		if (typeof this.application_layer.meter_id !== 'undefined') {
			msg.writeUInt32LE(this.application_layer.meter_id, 5);
		} else {
			msg.writeUInt32LE(this.link_layer.afield.readUInt32LE(0), 5);
		}
		let kenc = aesCmac(key, msg, {returnAsBuffer: true});
		this.logger.debug("Kenc: " + kenc.toString('hex'));

		// MAC verification - could be skipped...
		msg[0] = 0x01; // derivation constant
		let kmac = aesCmac(key, msg, {returnAsBuffer: true});
		this.logger.debug("Kmac: " + kmac.toString('hex'));

		let len = 5 + (this.afl.fcl_mlp * 2);
		msg = Buffer.alloc(len);
		msg[0] = this.afl.mcl;
		msg.writeUInt32LE(this.afl.mcr, 1);
		if (this.afl.fcl_mlp) {
			msg.writeUInt16LE(this.afl.ml, 5);
		}
		msg = Buffer.concat([msg, tpl, encrypted]);
		let mac = aesCmac(kmac, msg, {returnAsBuffer: true});

		this.logger.debug("MAC: " + mac.toString('hex'));
		if (this.afl.mac.compare(mac.slice(0, 8)) !== 0) {
			this.logger.debug("Warning: received MAC is incorrect. Corrupted data?");
			this.logger.debug("MAC received:  " + this.afl.mac.toString('hex'));
		}
		return this.decrypt(encrypted, kenc, initVector, 'aes-128-cbc');
	}

	decodeAFL(data, offset) {
		// reset afl object
		this.afl = {};
		this.afl.ci = data[offset++];
		this.afl.afll = data[offset++];
		this.logger.debug("AFL AFLL " + this.afl.afll);

		this.afl.fcl = data.readUInt16LE(offset);
		offset += 2;
		                                 /* 0b1000000000000000 - reserved */
		this.afl.fcl_mf   = (this.afl.fcl & 0b0100000000000000) != 0; /* More fragments: 0 last fragment; 1 more following */
		this.afl.fcl_mclp = (this.afl.fcl & 0b0010000000000000) != 0; /* Message Control Field present in fragment */
		this.afl.fcl_mlp  = (this.afl.fcl & 0b0001000000000000) != 0; /* Message Length Field present in fragment */
		this.afl.fcl_mcrp = (this.afl.fcl & 0b0000100000000000) != 0; /* Message Counter Field present in fragment */
		this.afl.fcl_macp = (this.afl.fcl & 0b0000010000000000) != 0; /* MAC Field present in fragment */
		this.afl.fcl_kip  = (this.afl.fcl & 0b0000001000000000) != 0; /* Key Information present in fragment */
		                                 /* 0b0000000100000000 - reserved */
		this.afl.fcl_fid  =  this.afl.fcl & 0b0000000011111111; /* fragment ID */

		if (this.afl.fcl_mclp) {
			// AFL Message Control Field (AFL.MCL)
			this.afl.mcl = data[offset++];
			                                 /* 0b10000000 - reserved */
			this.afl.mcl_mlmp = (this.afl.mcl & 0b01000000) != 0; /* Message Length Field present in message */
			this.afl.mcl_mcmp = (this.afl.mcl & 0b00100000) != 0; /* Message Counter Field present in message */
			this.afl.mcl_kimp = (this.afl.mcl & 0b00010000) != 0; /* Key Information Field present in message */
			this.afl.mcl_at   = (this.afl.mcl & 0b00001111); /* Authentication-Type */
		}

		if (this.afl.fcl_kip) {
			// AFL Key Information Field (AFL.KI)
			this.afl.ki = data.readUInt16LE(offset);
			offset += 2;
			this.afl.ki_key_version   = (this.afl.ki & 0b1111111100000000) >> 8;
			                                        /* 0b0000000011000000 - reserved */
			this.afl.ki_kdf_selection = (this.afl.ki & 0b0000000000110000) >> 4;
			this.afl.ki_key_id        = (this.afl.ki & 0b0000000000001111);
		}

		if (this.afl.fcl_mcrp) {
			// AFL Message Counter Field (AFL.MCR)
			this.afl.mcr = data.readUInt32LE(offset);
			this.logger.debug("AFL MC " + this.afl.mcr);
			offset += 4;
		}
		if (this.afl.fcl_macp) {
			// AFL MAC Field (AFL.MAC)
			// length of the MAC field depends on AFL.MCL.AT indicated by the AFL.MCL field
			// currently only AT = 5 is used (AES-CMAC-128 8bytes truncated)
			let mac_len = 0;
			if (this.afl.mcl_at == 4) {
				mac_len = 4;
			} else if (this.afl.mcl_at == 5) {
				mac_len = 8;
			} else if (this.afl.mcl_at == 6) {
				mac_len = 12;
			} else if (this.afl.mcl_at == 7) {
				mac_len = 16;
			}
			this.afl.mac = data.slice(offset, offset+mac_len);
			offset += mac_len;
			this.logger.debug("AFL MAC " + this.afl.mac.toString('hex'));
		}
		if (this.afl.fcl_mlp) {
			// AFL Message Length Field (AFL.ML)
			this.afl.ml = data.readUInt16LE(offset);
			offset += 2;
		}

		return offset;
	}

	decodeELL(data, offset) {
		// reset ell object
		this.ell = {}
		this.ell.ci = data[offset++];

		// common to all headers
		this.ell.communication_control = data[offset++];
		this.ell.access_number = data[offset++];

		switch (this.ell.ci) {
			case this.constant.CI_ELL_2: // OMS
				// nothing more to do here
			break;
			case this.constant.CI_ELL_8:
				// session_number see below
				// payload CRC is part (encrypted) payload - so deal with it later
				break;
			break;
			case this.constant.CI_ELL_10: // OMS
			case this.constant.CI_ELL_16:
				this.ell.manufacturer = data.readUInt16LE(offset);
				offset += 2;
				this.ell.address = data.slice(offset, offset+6);
				offset += 6;
				// session_number see below
			break;
			default:
				this.logger.debug("Warning: unknown extended link layer CI: 0x" + this.ell.ci.toString(16));
		}

		// a little tested - what happens to CRC is still not clear
		if ((this.ell.ci === this.constant.CI_ELL_16) || (this.ell.ci === this.constant.CI_ELL_8)){
			this.ell.session_number = data.readUInt32LE(offset);
			offset += 4;
			// payload CRC is part (encrypted) payload - so deal with it later

			// parse session number
			this.ell.session_number_enc     = (this.ell.session_number & 0b11100000000000000000000000000000) >> 29;
			this.ell.session_number_time    = (this.ell.session_number & 0b00011111111111111111111111110000) >> 4;
			this.ell.session_number_session =  this.ell.session_number & 0b00000000000000000000000000001111;
			this.isEncrypted = this.ell.session_number_enc != 0;
			this.decrypted = 0;

			if (this.isEncrypted) {
				if (this.aeskey) {
					// AES IV
					// M-field, A-field, CC, SN, (00, 0000 vs FN     BC ???)
					let initVector = Buffer.concat([
						Buffer.alloc(2),
						(typeof this.ell.address !== 'undefined' ? this.ell.address : this.link_layer.afield),
						Buffer.alloc(8)
					]);
					initVector.writeUInt16LE((typeof this.ell.manufacturer !== 'undefined' ? this.ell.manufacturer : this.link_layer.mfield));
					initVector[8] = this.ell.communication_control;
					initVector.writeUInt32LE(this.ell.session_number, 9);
					data = this.decrypt(data.slice(offset), this.aeskey, initVector, 'aes-128-ctr');
					this.logger.debug("Dec: "+  data.toString('hex'));
				} else {
					this.errorMessage = 'encrypted message and no aeskey provided';
					this.errorCode = this.constant.ERR_NO_AESKEY;
					this.logger.error(this.errorMessage);
					return 0;
				}

				this.ell.crc = data.readUInt16LE(0);
				offset += 2;
				// PayloadCRC is a cyclic redundancy check covering the remainder of the frame (excluding the CRC fields)
				// payloadCRC is also encrypted
				let crc = this.crc.crc(data.slice(2));
				if (this.ell.crc != crc) {
					this.logger.debug("crc " + this.ell.crc.toString(16) + ", calculated " + crc.toString(16));
					this.errorMessage = "Payload CRC check failed on ELL" + (this.isEncrypted ? ", wrong AES key?" : "");
					this.errorCode = this.constant.ERR_CRC_FAILED;
					this.logger.error(this.errorMessage);
					return 0;
				} else {
					this.decrypted = 1;
				}
				offset = data.slice(2); // skip PayloadCRC
			}
		}

		return offset;
	}

	decodeApplicationLayer(applayer) {
		this.logger.debug(applayer.toString('hex'));
		if (this.errorCode != this.constant.ERR_NO_ERROR) {
			return 0;
		}

		let offset = 0;
		let current_ci = applayer[offset];
		this.application_layer = {};

		if ((current_ci >= this.constant.CI_ELL_2) && (current_ci <= this.constant.CI_ELL_16)) {
			// Extended Link Layer
			this.logger.debug("Extended Link Layer");
			let ell_return = this.decodeELL(applayer, offset);
			if (Buffer.isBuffer(ell_return)) {
				applayer = ell_return;
				offset = 0;
			} else {
				offset = ell_return;
			}
			current_ci = applayer[offset];
		}

		if (current_ci == this.constant.CI_AFL) {
			// Authentification and Fragmentation Layer
			this.logger.debug("Authentification and Fragmentation Layer");
			offset = this.decodeAFL(applayer, offset);
			current_ci = applayer[offset];

			if (this.afl.fcl_mf) {
				this.errorMessage = "fragmented messages are not yet supported";
				this.errorCode = this.constant.ERR_FRAGMENT_UNSUPPORTED;
				this.logger.error(this.errorMessage);
				return 0;
			}
		}

		// initialize some fields
		this.application_layer.status = 0;
		this.application_layer.statusstring = "";
		this.application_layer.access_no = 0;
		this.application_layer.cifield = current_ci;
		this.config = { mode: 0 };

		let appStart = offset;
		offset++;

		switch (current_ci) {
			case this.constant.CI_RESP_0:
				// no header - only M-Bus?
				this.logger.debug("No header");
				break;

			case this.constant.CI_RESP_4:
			case this.constant.CI_RESP_SML_4:
				this.logger.debug("Short header");
				this.application_layer.access_no = applayer[offset++];
				this.application_layer.status = applayer[offset++];
				this.decodeConfigword(applayer.readUInt16LE(offset));
				offset += 2;
				if ((this.config.mode == 7) || (this.config.mode == 13)) {
					this.decodeConfigwordExt(applayer[offset++]);
				}
				break;

			case this.constant.CI_RESP_12:
			case this.constant.CI_RESP_SML_12:
				this.logger.debug("Long header");
				this.application_layer.meter_id = applayer.readUInt32LE(offset);
				offset += 4;
				this.application_layer.meter_man = applayer.readUInt16LE(offset);
				offset += 2;
				this.application_layer.meter_vers = applayer[offset++];
				this.application_layer.meter_dev = applayer[offset++];
				this.application_layer.access_no = applayer[offset++];
				this.application_layer.status = applayer[offset++];
				this.decodeConfigword(applayer.readUInt16LE(offset));
				offset += 2;
				if ((this.config.mode == 7) || (this.config.mode == 13)) {
					this.decodeConfigwordExt(applayer[offset++]);
				}
				//this.application_layer.meter_id = this.application_layer.meter_id.toString().padStart(8, '0');
				this.application_layer.meter_devtypestring = this.validDeviceTypes[this.application_layer.meter_dev] || 'unknown';
				this.application_layer.meter_manufacturer = this.manId2ascii(this.application_layer.meter_man).toUpperCase();
				break;

			case 0x79:
				this.logger.debug("MANUFACTURER header");
				if (this.link_layer.manufacturer === 'KAM') {
					//print "Kamstrup compact frame header\n";
					this.application_layer.format_signature = applayer.readUInt16LE(offset);
					offset += 2;
					this.application_layer.full_frame_payload_crc = applayer.readUInt16LE(offset);
					offset += 2;
					if (this.application_layer.format_signature == this.crc.crc(Buffer.from([0x02, 0xFF, 0x20, 0x04, 0x13, 0x44, 0x13]))) {
						// Info, Volume, Target Volume
						// convert into full frame
						applayer = Buffer.concat([
							Buffer.from([0x02, 0xFF, 0x20]), applayer.slice(5, 5+2), // info
							Buffer.from([0x04, 0x13]), applayer.slice(7, 7+4),       // volume
							Buffer.from([0x44, 0x13]), applayer.slice(11, 11+4)      // target volume
						]);
						offset = 0;
					} else if (this.application_layer.format_signature == this.crc.crc(Buffer.from([0x02, 0xFF, 0x20, 0x04, 0x16, 0x44, 0x16]))) {
						// Info, ???
						// convert into full frame
						applayer = Buffer.concat([
							Buffer.from([0x02, 0xFF, 0x20]), applayer.slice(5, 5+2), // info
							Buffer.from([0x04, 0x16]), applayer.slice(7, 7+4),       // ???
							Buffer.from([0x44, 0x16]), applayer.slice(11, 11+4)      // ???
						]);
						offset = 0;
					} else if (this.application_layer.format_signature == this.crc.crc(Buffer.from([0x02, 0xFF, 0x20, 0x04, 0x13, 0x52, 0x3B]))) {
						// Info, Volume, Max flow
						// convert into full frame
						applayer = Buffer.concat([
							Buffer.from([0x02, 0xFF, 0x20]), applayer.slice(5, 5+2), // info
							Buffer.from([0x04, 0x13]), applayer.slice(7, 7+4),       // volume
							Buffer.from([0x52, 0x3B]), applayer.slice(11, 11+2)      // max flow
						]);
						offset = 0;
					} else if (this.application_layer.format_signature == this.crc.crc(Buffer.from([0x02, 0xFF, 0x20, 0x04, 0x13, 0x44, 0x13, 0x61, 0x5B, 0x61, 0x67]))) {
						// Info, Volume, Max flow, flow temp, external temp
						// convert into full frame
						applayer = Buffer.concat([
							Buffer.from([0x02, 0xFF, 0x20]), applayer.slice(5, 5+2), // info
							Buffer.from([0x04, 0x13]), applayer.slice(7, 7+4),       // volume
							Buffer.from([0x44, 0x13]), applayer.slice(11, 11+4),     // target volume
							Buffer.from([0x61, 0x5B]), applayer.slice(15, 15+1),     // flow temp
							Buffer.from([0x61, 0x67]), applayer.slice(16, 16+1)      // external temp
						]);
						offset = 0;
					} else {
						this.errorMessage = 'Unknown Kamstrup compact frame format';
						this.errorCode = this.constant.ERR_UNKNOWN_COMPACT_FORMAT;
						this.logger.error(this.errorMessage);
						return 0;
					}
					if (this.application_layer.full_frame_payload_crc != this.crc.crc(applayer)) {
						this.errorMessage = 'Kamstrup compact frame format payload CRC error';
						this.errorCode = this.constant.ERR_CRC_FAILED;
						this.logger.error(this.errorMessage);
						return 0;
					}
					break;
				}
				// no break so unhandled manufacturer for CI 0x79 are treated as default too
			default:
				// unsupported
				this.errorMessage = 'Unsupported CI Field ' + current_ci.toString(16) + ", remaining payload is " + applayer.toString('hex', offset);
				this.errorCode = this.constant.ERR_UNKNOWN_CIFIELD;
				this.logger.error(this.errorMessage);
				return 0;
		}

		this.application_layer.statusstring = this.state2string(this.application_layer.status).join(", ");

		let payload;
		this.encryptionMode = this.encryptionModes[this.config.mode];
		switch (this.config.mode) {
			case 0: // no encryption
				this.isEncrypted = 0;
				this.decrypted = 1;
				payload = applayer.slice(offset);
				break;

			case 5: // data is encrypted with AES 128, dynamic init vector
					// decrypt data before further processing
			case 7: // ephemeral key is used (see 9.2.4)

				// data got decrypted by gateway or similar
				if (this.alreadyDecrypted) {
					payload = applayer.slice(offset);
					this.logger.debug("Data already decrypted");
					break;
				}
				this.isEncrypted = 1;
				this.decrypted = 0;

				if (this.aeskey) {
						let encrypted_length = this.config.encrypted_blocks * this.constant.BLOCK_SIZE;
						this.logger.debug("encrypted payload: " + applayer.slice(offset, offset+encrypted_length).toString('hex'));
						if (this.config.mode == 5) {
							payload = Buffer.concat([this.decrypt(applayer.slice(offset, offset+encrypted_length), this.aeskey), applayer.slice(offset+encrypted_length)]);
						} else { // mode 7
							payload = Buffer.concat([this.decrypt_mode7(applayer.slice(offset, offset+encrypted_length), this.aeskey, applayer.slice(appStart, offset)), applayer.slice(offset+encrypted_length)]);
						}
						this.logger.debug("decrypted payload " + payload.toString('hex'));
						if (payload.readUInt16LE(0) == 0x2f2f) {
							this.decrypted = 1;
						} else {
							// Decryption verification failed
							this.errorMessage = 'Decryption failed, wrong key?';
							this.errorCode = this.constant.ERR_DECRYPTION_FAILED;
							this.logger.error(payload.toString('hex'));
							return 0;
						}
				} else {
					this.errorMessage = 'encrypted message and no aeskey provided';
					this.errorCode = this.constant.ERR_NO_AESKEY;
					this.logger.error(this.errorMessage);
					return 0;
				}
				break;

			default:
				// error, encryption mode not implemented
				this.errorMessage = 'Encryption mode ' + this.config.mode.toString(16) + ' not implemented';
				this.errorCode = this.constant.ERR_UNKNOWN_ENCRYPTION;
				this.logger.error(this.errorMessage);
				this.isEncrypted = 1;
				this.decrypted = 0;
				return 0;
		}

		if (this.application_layer.cifield == this.constant.CI_RESP_SML_4 || this.application_layer.cifield == this.constant.CI_RESP_SML_12) {
			// payload is SML encoded, that's not implemented
			this.errorMessage = "payload is SML encoded, can't be decoded, SML payload is " . applayer.toString('hex', offset);
			this.errorCode = this.constant.ERR_SML_PAYLOAD;
			this.logger.error(this.errorMessage);
			return 0;
		} else {
			return this.decodeDataRecords(payload);
		}
	}

	decodeLinkLayer(ll, applayer) {
		this.link_layer = ll;
		if ((typeof applayer === 'undefined') && (typeof ll.data !== 'undefined')) {
			applayer = ll.data;
		}

		ll.afield_id = this.decodeBCD(8, ll.afield.slice(0, 4)).toString().padStart(8, '0');

		if (ll.bframe) {
			this.frame_type = this.constant.FRAME_TYPE_B;
		}

		let datalen;
		//let msglen;

		if (this.frame_type == this.constant.FRAME_TYPE_A) {
			// header block is 10 bytes + 2 bytes CRC, each following block is 16 bytes + 2 bytes CRC, the last block may be smaller
			datalen = ll.lfield - (this.constant.DLL_SIZE - 1); // this is without CRCs and the lfield itself
			this.block_count = Math.ceil(datalen / this.constant.BLOCK_SIZE);
			//msglen = this.constant.TL_BLOCK_SIZE + this.crc_size + datalen + this.block_count * this.crc_size;
			//this.logger.debug("calc len " + msglen + ", actual " + applayer.length);

			//applayer = this.removeCRC(applayer); //substr($self->{msg},TL_BLOCK_SIZE + $self->{crc_size}));
		} else if (this.frame_type == this.constant.FRAME_TYPE_B) {
			// FRAME TYPE B
			// each block is at most 129 bytes long.
			// first contains the header (TL_BLOCK), L field and trailing crc
			// L field is included in crc calculation
			// each following block contains only data and trailing crc
			// not yet ported
			this.errorCode == this.constant.ERR_LINK_LAYER_INVALID;
			this.errorMessage = "Frame type B is not implemented (yet)!";
			this.logger.error(this.errorMessage);
			return 0;
		} else {
			this.errorCode == this.constant.ERR_LINK_LAYER_INVALID;
			this.errorMessage = "Unkown FRAME_TYPE! " + this.frame_type;
			this.logger.error(this.errorMessage);
			return 0;
		}

		this.remainingData = undefined;
		if (applayer.length > datalen) {
			this.remainingData = applayer.slice(datalen);
			applayer = applayer.slice(0, datalen);
		} else if (applayer.length < datalen) {
			this.errorMessage = "application layer message too short, expected " + datalen + ", got " . applayer.length + " bytes";
			this.errorCode = this.constant.ERR_MSG_TOO_SHORT;
			this.logger.error(this.errorMessage);
			return 0;
		}

		// according to the MBus spec only upper case letters are allowed.
		// some devices send lower case letters none the less
		// convert to upper case to make them spec conformant
		this.link_layer.manufacturer = this.manId2ascii(ll.mfield).toUpperCase();
		this.link_layer.typestring =  this.validDeviceTypes[ll.afield_type] || 'unknown';
		return applayer;
	}

	parse(ll, applayer, key, callback) {
		if (typeof applayer === 'function') {
			callback = applayer;
			applayer = undefined;
		} else if (typeof key === 'function') {
			callback = key;
			key = undefined;
		}

		let removeCRC = (typeof ll.withCRC !== 'undefined' ? ll.withCRC : false);
		if (removeCRC) {
			applayer = this.removeCRC(applayer);
		}

		this.errorCode = this.constant.ERR_NO_ERROR;
		this.errorMessage = '';
		this.alreadyDecrypted = (typeof ll.decrypted !== 'undefined' ? ll.decrypted : false);

		if (typeof key !== 'undefined') {
			this.aeskey = key;
		}
		applayer = (typeof applayer !== 'undefined' ? applayer : ll.data);
		let ret = this.decodeApplicationLayer(this.decodeLinkLayer(ll, applayer));
		if (ret == 1) { // all okay
			callback && callback(undefined, this.collectData());
		} else {
			//this.logger.error(this.errorMessage);
			callback && callback({message: this.errorMessage, code: this.errorCode});
		}
	}

	parseRaw(data, containsCRC, key, callback) {
		let applayer;
		let alreadyDec = false;

		if ((typeof key !== 'undefined') && !Buffer.isBuffer(key) && (key === "DECRYPTED")) {
			alreadyDec = true;
			key = undefined;
		}

		let result = {
			decrypted: alreadyDec,
			lfield: data[0],
			cfield: data[1],
			mfield: data.readUInt16LE(2),
			manufacturer: this.manId2ascii(data.readUInt16LE(2)),
			afield: data.slice(4, 10),
			afield_id: data.readUInt32LE(4),
			afield_ver: data[8],
			afield_type: data[9],
		};

		if (containsCRC) {
			applayer = data.slice(this.constant.DLL_SIZE + this.constant.CRC_SIZE);
			applayer = this.removeCRC(applayer);
		} else {
			applayer = data.slice(this.constant.DLL_SIZE);
		}
		this.parse(result, applayer, key, callback);
	}

	collectData() {
		let result = {};
		let address = Buffer.concat([Buffer.alloc(2), this.link_layer.afield]);
		address.writeUInt16LE(this.link_layer.mfield, 0);

		result.deviceInformation = {
			AccessNumber: this.application_layer.access_no,
            Id: (typeof this.application_layer.meter_id !== 'undefined' ? this.application_layer.meter_id.toString(16) : this.link_layer.afield_id),
            Manufacturer: (typeof this.application_layer.meter_manufacturer !== 'undefined' ? this.application_layer.meter_manufacturer : this.link_layer.manufacturer),
            Medium: (typeof this.application_layer.meter_devtypestring !== 'undefined' ? this.application_layer.meter_devtypestring : this.link_layer.typestring),
			Status: this.application_layer.status,
			StatusString: this.application_layer.statusstring,
			Version: (typeof this.application_layer.meter_vers !== 'undefined' ?  this.application_layer.meter_vers : this.link_layer.afield_ver),
			Address: address.toString('hex')
		}
		result.dataRecord = this.dataRecords;

		return result;
	}

}

module.exports = WMBUS_DECODER;
