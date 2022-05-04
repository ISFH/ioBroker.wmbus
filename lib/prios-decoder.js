'use strict';

const key1 = Buffer.from('39BC8A10E66D83F8', 'hex');
const key2 = Buffer.from('51728910E66D83F8', 'hex');

function fakeMBUS(val, unit, vif, desc) {
    return {
        VIB: {
            value: val,
            unit: unit,
            type: vif,
            description: desc
        },
        DIB: {
            tariff: 0,
            storageNo: 0,
            devUnit: 0,
            functionFieldText: 'Instantaneous value',
            functionField: 0x00
        }
    };
}

function decodeBCD(digits, bcd) {
    // check for negative BCD (not allowed according to specs)
    let sign = 1;
    if (bcd[digits / 2 - 1] >> 4 > 9) {
        bcd[digits / 2 - 1] &= 0b00001111;
        sign = -1;
    }
    let val = 0;
    for (let i = 0; i < digits / 2; i++) {
        val += ((bcd[i] & 0x0f) + (((bcd[i] & 0xf0) >> 4) * 10)) * Math.pow(100, i);
    }
    return sign * val;
}

function formatDate(date, format) {
    function pad(num) {
        return num < 10 ? '0' + num : '' + num;
    }

    let s = format.replace('YYYY', date.getFullYear());
    s = s.replace('MM', pad(date.getMonth() + 1));
    s = s.replace('DD', pad(date.getDate()));
    s = s.replace('hh', pad(date.getHours()));
    s = s.replace('mm', pad(date.getMinutes()));
    return s;
}

function calcDate(value) {
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
        // invalid date
        year = 1970;
        month = 1;
        day = 1;
    }

    const date = new Date(year, month - 1, day);
    return formatDate(date, 'YYYY-MM-DD');
}

function splitCamelCase(s) {
    return s.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);
}

function getAlarmString(alarms) {
    let result = '';
    for (const i in alarms) {
        if (alarms[i]) {
            result += `, ${splitCamelCase(i)}`;
        }
    }
    if (!result.length) {
        return 'no alarms';
    } else {
        return result.substr(2);
    }
}

function prepareKey(key, original_raw_address, data) {
    return (key.readUint32BE(0) ^ key.readUint32BE(4)
        ^ original_raw_address.readUint32BE(0) ^ original_raw_address.readUint32BE(4)
        ^ data.readUint32BE(0)) >>> 0;
}

function decryptData(k1, k2, data, useSecondKey) {
    if (typeof useSecondKey === 'undefined') {
        useSecondKey = false;
    }

    let key = useSecondKey ? k2 : k1;

    const decryptedData = Buffer.alloc(data.length);
    data.copy(decryptedData, 0, 0, 10);

    for (let i = 5; i < data.length; i++) {
        for (let j = 0; j < 8; j++) {
            const bit = ((key & 0x2) != 0) ^ ((key & 0x4) != 0) ^ ((key & 0x800) != 0) ^ ((key & 0x80000000) != 0);
            key = (key << 1) | bit;
        }
        decryptedData[i] = data[i] ^ (key & 0xFF);

        if ((i == 5) && (decryptedData[i] != 0x04B)) {
            if (useSecondKey) {
                return 'Decryption key is probably incorrect!';
            } else {
                return decryptData(k1, k2, data, true);
            }
        }
    }

    return decryptedData;
}

function decodeData(data) {
    const dr = [];
    // data[3] is basically VIFInfo.VIF_VOLUME
    // data[3] >> 3 == 0b00010
    // unit => cubic meter
    const exp = (data[4] & 0x07) - 6;
    const correction = Math.pow(10, exp);

    const totalConsumption = data.readUint32LE(6) * correction;
    const historicConsumption = data.readUint32LE(10) * correction;
    dr.push(fakeMBUS(totalConsumption, 'm³', 'VIF_VOLUME', 'Volume'));
    dr.push(fakeMBUS(historicConsumption, 'm³', 'VIF_VOLUME', 'Volume (last billing period)'));

    const date = calcDate(data.readUint16LE(14));
    dr.push(fakeMBUS(date, '', 'VIF_TIME_POINT_DATE', 'End of last billing period'));

    const remainingBatteryLife = (data[2] & 0x1F) / 2.0;
    dr.push(fakeMBUS(remainingBatteryLife, 'years', 'VIF_BATTERY_REMAINING', 'Remaining battery life'));
    const transmitPeriod = 1 << ((data[1] & 0x0F) + 2);
    dr.push(fakeMBUS(transmitPeriod, 's', 'VIF_TRANSMIT_PERIOD', 'Transmit period'));

    // read the alarms:
    const currentAlarms = {
        general: data[1] >> 7,
        leakage: data[2] >> 7,
        meterBlocked: data[2] >> 5 & 0x1,
        backflow: data[3] >> 7,
        underflow: data[3] >> 6 & 0x1,
        overflow: data[3] >> 5 & 0x1,
        submarine: data[3] >> 4 & 0x1,
        sensorFraud: data[3] >> 3 & 0x1,
        mechanicalFraud: data[3] >> 1 & 0x1
    };
    const previousAlarms = {
        leakage: data[2] >> 6 & 0x1,
        sensorFraud: data[3] >> 2 & 0x1,
        mechanicalFraud: data[3] & 0x1
    };

    const currentAlarmString = getAlarmString(currentAlarms);
    const previousAlarmString = getAlarmString(previousAlarms);
    dr.push(fakeMBUS(currentAlarmString, '', 'VIF_ERROR_FLAGS', 'Alarm flags'));
    dr.push(fakeMBUS(previousAlarmString, '', 'VIF_ERROR_FLAGS', 'Previous alarm flags'));

    return dr;
}

function fixLinkLayer(link_layer, validDeviceTypes) {
    const version = link_layer.address_raw[2];
    const type = link_layer.address_raw[3];
    const versionAndType = Buffer.alloc(2);
    versionAndType.writeUInt8(version, 0);
    versionAndType.writeUInt8(type, 1);

    link_layer.address_raw = Buffer.concat([link_layer.address_raw.slice(0, 2), link_layer.address_raw.slice(4), Buffer.from(versionAndType)]);
    link_layer.afield_raw = link_layer.address_raw.slice(2);
    link_layer.afield = link_layer.afield_raw.readUint32LE(0);
    link_layer.afield_id = decodeBCD(8, link_layer.afield_raw).toString().padStart(8, '0');
    link_layer.afield_version = version;
    link_layer.afield_type = type;
    link_layer.typestring = validDeviceTypes[type] || 'unknown';
}

function handlePriosTelegram(data, link_layer, validDeviceTypes) {
    const preparedKey1 = prepareKey(key1, link_layer.address_raw, data);
    const preparedKey2 = prepareKey(key2, link_layer.address_raw, data);
    const decData = decryptData(preparedKey1, preparedKey2, data);
    if (typeof decData === 'string') {
        return decData;
    }

    const dataRecords = decodeData(decData);
    fixLinkLayer(link_layer, validDeviceTypes);
    return dataRecords;
}

function priosDecoder(data, link_layer, validDeviceTypes) {
    const ci_field = data[0];
    switch (ci_field) {
        case 0xA0:
        case 0xA1:
        case 0xA2:
        case 0xA3:
        case 0xA4:
        case 0xA5:
        case 0xA6:
        case 0xA7:
            return handlePriosTelegram(data, link_layer, validDeviceTypes);
        default:
            return `CI Field ${ci_field} is currently not supported by PRIOS Decoder`;
    }
}

module.exports = priosDecoder;
