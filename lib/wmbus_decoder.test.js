'use strict';

const { expect } = require('chai');
const WMBUS_DECODER = require('./wmbus_decoder.js');
let decoder;

describe('JMBus Test Cases', () => {
    beforeEach(() => {
        decoder = new WMBUS_DECODER();
    });

    it('Decode negative temperature', () => {
        const msg = '2C44A7320613996707047A821000202F2F0C06000000000C14000000000C22224101000B5A4102000B5E4000F05E';
        decoder.parse(msg, false, undefined, (err, res) => {
            expect(Number(res.dataRecord[4].value)).to.be.closeTo(-4, 0.01);
        });
    });

    it('Decryption Test - Good Key', () => {
        const msg = '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689';
        const key = '4E5508544202058100DFEFA06B0934A5';
        decoder.parse(msg, false, key, (err, res) => {
            expect(Number(res.dataRecord[1].value)).to.be.closeTo(474.24, 0.01);
        });
    });

    it('Decryption Test - Wrong Key', () => {
        const msg = '24442D2C692845631B168D3050209CD621B006B1140AEF4953AE5B86FAFC0B00E70705B84689';
        const key = '4E5508544202058100DFEFA06B0934AF';
        decoder.parse(msg, false, key, (err, res) => { // eslint-disable-line no-unused-vars
            expect(err.code).to.be.equal(1);
        });
    });

    it('General Test #1', () => {
        const msg = '2644333003000000011B72030000003330011B542000002F2F02FD1701002F2F2F2F2F2F2F2F2F80';
        decoder.parse(msg, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('LAS');
            expect(res.dataRecord[0].functionFieldText).to.be.equal('Instantaneous value');
            expect(Number(res.dataRecord[0].value)).to.be.equal(1);
            expect(res.dataRecord[0].description).to.be.equal('Error flags (binary)');
        });
    });

    it('General Test #2', () => {
        const msg = '2C44A7320613996707047A2A1000202F2F0C06000000000C14000000000C22381701000B5A1702000B5E1702006E';
        decoder.parse(msg, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('LUG');
            expect(res.dataRecord[0].functionFieldText).to.be.equal('Instantaneous value');
            expect(Number(res.dataRecord[0].value)).to.be.equal(0);
            expect(res.dataRecord[0].description).to.be.equal('Energy');
        });
    });

    it('Magnetic Sensor Test #1', () => {
        const msg = '2644333015010100021D72150101003330021D880400402F2F0E6E1001000000002F2F2F2F2F2F6E';
        decoder.parse(msg, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('LAS');
            expect(res.deviceInformation.Medium).to.be.equal('Reserved for sensors');
            expect(res.dataRecord).to.have.lengthOf(1);
            expect(res.dataRecord[0].functionFieldText).to.be.equal('Instantaneous value');
            expect(Number(res.dataRecord[0].value)).to.be.equal(110);
            expect(res.dataRecord[0].description).to.be.equal('Units for H.C.A.');
        });
    });

    it('Magnetic Sensor Test #2', () => {
        const msg = '2644333015010100021D72150101003330021D790400002F2F02FD971D000004FD08FC0800002F49';
        decoder.parse(msg, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('LAS');
            expect(res.deviceInformation.Medium).to.be.equal('Reserved for sensors');
            expect(res.dataRecord).to.have.lengthOf(2);
            expect(res.dataRecord[0].functionFieldText).to.be.equal('Instantaneous value');
            expect(Number(res.dataRecord[0].value)).to.be.equal(0);
            expect(res.dataRecord[0].description).to.be.equal('Error flags (binary); Standard conform');
        });
    });

    it('Short Telegram Test #1', () => {
        decoder = new WMBUS_DECODER(undefined, true);
        const msgShort = '3F442D2C06357260190C8D207C71032F21255C79DD829283011117650000BFA80000D24F0000B1FB00000000E919FF18F7640000E8FA00000B000000DB111C0B5B';
        const msgLong = '5C442D2C06357260190C8D207B70032F21271D7802F9FF15011104061765000004EEFF07BFA8000004EEFF08D24F00000414B1FB000002FD170000026CE919426CFF184406F76400004414E8FA0000043B0B0000000259DB11025D1C0B5B';
        decoder.parse(msgShort, false, undefined, (err, res) => expect(err.code).to.be.equal(15)); // eslint-disable-line no-unused-vars
        decoder.parse(msgLong, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('KAM');
            expect(res.dataRecord).to.have.lengthOf(13);
            expect(Number(res.dataRecord[12].value)).to.be.closeTo(28.44, 0.01);
        });
        decoder.parse(msgShort, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('KAM');
            expect(res.dataRecord).to.have.lengthOf(13);
            expect(Number(res.dataRecord[12].value)).to.be.closeTo(28.44, 0.01);
        });
    });

    it('Short Telegram Test #2', () => {
        decoder = new WMBUS_DECODER(undefined, true);
        const msgShort = '31442D2C713785691C0C8D2067585050202A4479C4D788B0A60B00004E11000013070000C91A0000000000000000B10B67095B';
        const msgLong = '40442D2C713785691C0C8D2066445050201E5E780406A60B000004FF074E11000004FF08130700000414C91A000002FD170000043B000000000259B10B025D67095B';
        decoder.parse(msgShort, false, undefined, (err, res) => expect(err.code).to.be.equal(15)); // eslint-disable-line no-unused-vars
        decoder.parse(msgLong, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('KAM');
            expect(res.dataRecord).to.have.lengthOf(8);
            expect(Number(res.dataRecord[7].value)).to.be.closeTo(24.07, 0.01);
        });
        decoder.parse(msgShort, false, undefined, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('KAM');
            expect(res.dataRecord).to.have.lengthOf(8);
            expect(Number(res.dataRecord[7].value)).to.be.closeTo(24.07, 0.01);
        });
    });

    it('WMBus Demo Message Test #1', () => {
        const msg = '2C446532821851582C067AE1000000046D1906D9180C1334120000426CBF1C4C1300000000326CFFFF01FD7300';
        const key = 'A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1';
        decoder.parse(msg, false, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('LSE');
            expect(res.deviceInformation.Id).to.be.equal('58511882');
            expect(res.deviceInformation.Version).to.be.equal(44);
            expect(res.deviceInformation.Medium).to.be.equal('Warm Water (30 °C ... 90 °C)');
        });
    });

    it('WMBus Demo Message Test #2', () => {
        const msg = '4D4424346855471650077AA5204005CBDBC661B08F97A2030904C7F724F8BA4EE2AD3DF64721F0C3B96DEC142750968836B66233AE629B63C4AAC392C42E61C85179EF1453F27EDDC2E88A990F8AFA0000';
        const key = 'A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1';
        decoder.parse(msg, false, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('MAD');
            expect(res.deviceInformation.Id).to.be.equal('16475568');
            expect(res.deviceInformation.Version).to.be.equal(80);
            expect(res.deviceInformation.Medium).to.be.equal('Water');
        });
    });

    it('WMBus Demo Message Test #3', () => {
        const msg = '3644496A0228004401377232597049496A01073500202518AC74B56F3119F53981507265B808AF7D423C429550112536BDD6F25BBB63D971';
        const key = 'A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1';
        decoder.parse(msg, false, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('ZRI');
            expect(res.deviceInformation.Id).to.be.equal('49705932');
            expect(res.deviceInformation.Version).to.be.equal(1);
            expect(res.deviceInformation.Medium).to.be.equal('Water');
        });
    });
});

describe('OMS Examples', () => {
    beforeEach(() => {
        decoder = new WMBUS_DECODER();
    });

    it('wM-Bus Meter with Security profile A', () => {
        const msg = '2E44931578563412330333637A2A0020255923C95AAA26D1B2E7493BC2AD013EC4A6F6D3529B520EDFF0EA6DEFC955B29D6D69EBF3EC8A';
        const key = '0102030405060708090A0B0C0D0E0F11';
        decoder.parse(msg, true, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('ELS');
            expect(res.deviceInformation.Medium).to.be.equal('Gas');
            expect(res.deviceInformation.Id).to.be.equal('12345678');
            expect(res.dataRecord).to.have.lengthOf(3);
            expect(Number(res.dataRecord[0].value)).to.be.closeTo(28504.27, 0.01);
        });
    });

    it('wM-Bus Meter with integrated radio and Security profile B', () => {
        const msg = '434493157856341233037AC98C2075900F002C25B30A000021924D4FBA372FB66E017A75002007109058475F4BC9D1281DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1';
        const key = '000102030405060708090A0B0C0D0E0F';
        decoder.parse(msg, true, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('ELS');
            expect(res.deviceInformation.Medium).to.be.equal('Gas');
            expect(res.deviceInformation.Id).to.be.equal('12345678');
            expect(res.dataRecord).to.have.lengthOf(3);
            expect(Number(res.dataRecord[0].value)).to.be.closeTo(28504.27, 0.01);
        });
    });

    it('wM-Bus Meter with radio adapter and Security profile B', () => {
        const msg = '53082448443322110337D0468E80753A63665544330A31900F002C25E00AB30A0000AF5D74DF73A600D972785634C027129315330375002007109058475F4BC955CF1DF878B80A1B0F98B629024AAC7279429398BFC549233C0140829B93BAA1';
        const key = '000102030405060708090A0B0C0D0E0F';
        decoder.parse(msg, true, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('ELS');
            expect(res.deviceInformation.Medium).to.be.equal('Gas');
            expect(res.deviceInformation.Id).to.be.equal('12345678');
            expect(res.dataRecord).to.have.lengthOf(3);
            expect(Number(res.dataRecord[0].value)).to.be.closeTo(28504.27, 0.01);
        });
    });

    it('wM-Bus Example with partial encryption', () => {
        const msg = '2D44934444332211553769EF7288776655934455080004100500DFE227F9A782146D1513581CD2F83F39040CFD1040C4785634128134';
        const key = '000102030405060708090A0B0C0D0E0F';
        decoder.parse(msg, true, key, (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('QDS');
            expect(res.deviceInformation.Medium).to.be.equal('Heat Cost Allocator');
            expect(res.deviceInformation.Id).to.be.equal('55667788');
            expect(res.dataRecord).to.have.lengthOf(4);
            expect(Number(res.dataRecord[0].value)).to.be.equal(1234);
            expect(res.dataRecord[3].value).to.be.equal(12345678);
        });
    });

    it('Frame type B', () => {
        const msg = '1444AE0C7856341201078C2027780B134365877AC5';
        decoder.parse(msg, true, undefined, 'B', (err, res) => {
            expect(res.deviceInformation.Manufacturer).to.be.equal('CEN');
            expect(res.deviceInformation.Medium).to.be.equal('Water');
            expect(res.deviceInformation.Id).to.be.equal('12345678');
            expect(res.dataRecord).to.have.lengthOf(1);
            expect(Number(res.dataRecord[0].value)).to.be.closeTo(876.543, 0.01);
        });
    });
});
