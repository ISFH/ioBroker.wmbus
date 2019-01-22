![Logo](admin/wmbus.png)
# ioBroker.wmbus
=================

This adapter allows to receive wireless M-Bus data from supported receivers.

Currently only Embit WMB modules which implement the EBI interface protocol are well supported. However, the device configuration is currently hardcoded to T-Mode 868.950[MHz] @66.666[kbps]. Crude support for Amber Wireless AMB8465 receiver is implemented as well - device is only opened, no configuration is sent.

The WMBUS stack been "re-ported" from FHEM project, but is mostly untested as of now. The device creation, updating, etc is mostly based of Apollon77's M-Bus adapter (see below).

It is possible to supply AES keys in the configuration page, but decryption is currently untested. If the adapter receive encrypted telegrams the AES key configuration tab should list the device ID automatically.

### Links:
* [WMBus Stack module](https://github.com/mhop/fhem-mirror/blob/master/fhem/FHEM/WMBus.pm)
* [FHEM WMBus](https://github.com/mhop/fhem-mirror/blob/master/fhem/FHEM/36_WMBUS.pm)
* [ioBroker.mbus](https://github.com/Apollon77/ioBroker.mbus)
* [Original WMBUS Stack: wm-bus](https://github.com/soef/wm-bus)

## Changelog

### 0.1.0
* (ChL) initial release

