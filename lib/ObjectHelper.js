'use strict';

class ObjectHelper {

    constructor(adapter) {
        this.adapter = adapter;

        this.units2roles = {
            'value.power.consumption': [ 'Wh', 'kWh', 'MWh', 'GWh', 'J', 'kJ', 'MJ', 'GJ' ],
            'value.power': [ 'W', 'kW', 'MW', 'J/h', 'GJ/h' ],
            'value.temperature': [ '°C', 'K', '°F' ],
            'value.volume': [ 'm³', 'feet³' ],
            'value.duration': [ 's', 'min', 'h', 'd', 'months', 'years' ],
            'value.price': [ '€', '$', 'EUR', 'USD' ],
            'value.mass': [ 'kg', 't' ],
            'value.flow': [ 'm³/h', 'm³/min', 'm³/s', 'kg/h' ],
            'value.pressure': [ 'bar' ],
            'value.current': [ 'A' ],
            'value.voltage': [ 'V' ]
        };
    }

    async createObject(name, obj) {
        try {
            await this.adapter.setObjectNotExistsAsync(name, obj);
        } catch (err) {
            this.adapter.log.error(`Error creating state object: ${err}`);
        }
    }

    async updateState(name, value) {
        try {
            await this.adapter.setStateAsync(name, value, true);
        } catch (err) {
            this.adapter.log.error(err);
        }
    }

    async createDeviceOrChannel(type, name) {
        await this.createObject(name, {
            type: type,
            common: {
                name: name,
            },
            native: {}
        });
    }

    async createInfoState(deviceId, name) {
        await this.createObject(`${deviceId}.info.${name}`, {
            type: 'state',
            common: {
                name: name,
                role: 'value',
                type: 'mixed',
                read: true,
                write: false
            },
            native: {
                id: `.info.${name}`
            }
        });
    }

    async createDataState(deviceId, item) {
        const id = `.data.${item.number}-${item.storageNo}-${item.type}`;
        const unit = this.adapter.config.forcekWh && ((item.unit == 'Wh') || (item.unit == 'J')) ?  'kWh' : item.unit;
        const role = item.type.includes('TIME_POINT') ? 'date'
            : (Object.keys(this.units2roles).find(k => this.units2roles[k].includes(item.unit)) || 'value');

        let name;
        if (item.tariff) {
            name = `${item.description} (Tariff ${item.tariff}; ${item.functionFieldText})`;
        } else {
            name = `${item.description} (${item.functionFieldText})`;
        }

        await this.createObject(`${deviceId}${id}`, {
            type: 'state',
            common: {
                name: name,
                role: role,
                type: 'mixed',
                read: true,
                write: false,
                unit: unit
            },
            native: {
                id: id,
                StorageNumber: item.storageNo,
                Tariff: item.tariff,
            }
        });
    }
}

module.exports = ObjectHelper;
