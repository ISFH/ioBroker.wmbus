/*
 *
# vim: tabstop=4 shiftwidth=4 expandtab
 *
 * This work is part of the ioBroker wmbus adapter
 * and is licensed under the terms of the GPL2 license.
 * Copyright (C) 2019 ISFH
 *
 * ported from FHEM modules 32_TechemWZ.pm and 32_TechemHKV.pm
 * by Christian Landvogt
 *
 */

function pad(num) {
    return num < 10 ? '0' + num : '' + num;
}

function parseCurrentDate(val, val_month) {
    let wmz = (typeof val_month !== 'undefined' ? true : false);
    let day, month;
    if (!wmz) {
        day = (val >> 4) & 0x1F;
        month = (val >> 9) & 0x0F;
    } else {
        day = (val >> 7) & 0x1F;
        month = (val_month >> 3) & 0x0F;
    }
    let year = (new Date).getFullYear();
    return year + "-" + pad(month) + "-" + pad(day);
}

function parseLastDate(val) {
    let day = (val >> 0) & 0x1F;
    let month = (val >> 5) & 0x0F;
    let year = (val >> 9) & 0x3F;
    return (2000+year) + "-" + pad(month) + "-" + pad(day);
}

function parseWaterMeter(data) {
    if (data.length < 10) {
        return false;
    }
    // no idea about the units - m^3???
    let lastDate = parseLastDate(data.readUInt16LE(2));
    let lastPeriod = data.readUInt16LE(4) / 10;
    let currentDate = parseCurrentDate(data.readUInt16LE(6));
    let currentPeriod = data.readUInt16LE(8) / 10;

    let dr = [];
    dr.push(fakeMBUS(lastDate, '', 'VIF_TIME_POINT_DATE', 'End of last billing period'));
    dr.push(fakeMBUS(lastPeriod, 'm³', 'VIF_VOLUME', 'Volume (last billing period)'));
    dr.push(fakeMBUS(currentDate, '', 'VIF_TIME_POINT_DATE', 'Current billing period'));
    dr.push(fakeMBUS(currentPeriod, 'm³', 'VIF_VOLUME', 'Volume (current billing period)'));
    dr.push(fakeMBUS(currentPeriod + lastPeriod, 'm³', 'VIF_VOLUME', 'Volume'));
    return dr;
}

function parseHeatMeter(data) {
    if (data.length < 11) {
        return false;
    }
    // no idea about the units - kWh???
    let lastDate = parseLastDate(data.readUInt16LE(2));
    let lastPeriod = data.readUIntLE(4, 3) * 1000;
    let currentDate = parseCurrentDate(data.readUInt8(11), data.readUInt8(7));
    let currentPeriod = data.readUIntLE(8, 3) * 1000;

    let dr = [];
    dr.push(fakeMBUS(lastDate, '', 'VIF_TIME_POINT_DATE', 'End of last billing period'));
    dr.push(fakeMBUS(lastPeriod, 'Wh', 'VIF_ENERGY_WATT', 'Energy (last billing period)'));
    dr.push(fakeMBUS(currentDate, '', 'VIF_TIME_POINT_DATE', 'Current billing period'));
    dr.push(fakeMBUS(currentPeriod, 'Wh', 'VIF_ENERGY_WATT', 'Energy (current billing period)'));
    dr.push(fakeMBUS(currentPeriod + lastPeriod, 'Wh', 'VIF_ENERGY_WATT', 'Energy'));
    return dr;
}

function parseHCA(data, version) {
    if ((version != 0x61) && (version != 0x64) && (version != 0x69) && (version != 0x94)) {
        return false;
    }
    if (data.length < 10) {
        return false;
    }

    let lastDate = parseLastDate(data.readUInt16LE(2));
    let lastPeriod = data.readUInt16LE(4);
    let currentDate = parseCurrentDate(data.readUInt16LE(6));
    let currentPeriod = data.readUInt16LE(8);
    let temp1, temp2, diffT;

    if (version == 0x94) {
        if (data.length < 15) {
            return false;
        }
        temp1 = data.readUInt16LE(11);
        temp2 = data.readUInt16LE(13);
        diffT = (temp1 - temp2) / 100;
        temp1 /= 100;
        temp2 /= 100;
    } else if (version == 0x69) {
        if (data.length < 14) {
            return false;
        }
        temp1 = data.readUInt16LE(10);
        temp2 = data.readUInt16LE(12);
        diffT = (temp1 - temp2) / 100;
        temp1 /= 100;
        temp2 /= 100;
    } else {
        temp1 = false;
        temp2 = false;
        diffT = false;
    }

    let dr = [];
    dr.push(fakeMBUS(lastDate, '', 'VIF_TIME_POINT_DATE', 'End of last billing period'));
    dr.push(fakeMBUS(lastPeriod, '', 'VIF_HCA', 'Units for H.C.A. (last billding period)'));
    dr.push(fakeMBUS(currentDate, '', 'VIF_TIME_POINT_DATE', 'Current billing period'));
    dr.push(fakeMBUS(currentPeriod, '', 'VIF_HCA', 'Units for H.C.A.'));
    if (temp1) {
        dr.push(fakeMBUS(temp1, '°C', 'VIF_EXTERNAL_TEMP', 'HCA Temperature 1'));
    }
    if (temp2) {
        dr.push(fakeMBUS(temp2, '°C', 'VIF_EXTERNAL_TEMP', 'HCA Temperature 2'));
    }
    if (temp1 && temp2) {
        dr.push(fakeMBUS(diffT, 'K', 'VIF_TEMP_DIFF', 'Temperature Difference'));
    }

    return dr;
}

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

function tchDecoder(data, link_layer) {
    switch (link_layer.afield_type) {
        case 0x62: // Hot water meter
        case 0x72: // Cold water meter
            return parseWaterMeter(data);

        case 0x43: //Heat meter
        case 0x45: //Heat meter ???
            return parseHeatMeter(data);

        case 0x80: //Heat cost allocator
            return parseHCA(data, link_layer.afield_version);

        default:
            return false;
    }
    return [];
}

module.exports = tchDecoder;