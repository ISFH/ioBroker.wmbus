![Logo](admin/wmbus.png)
# ioBroker.wmbus
=================

This adapter allows to receive wireless M-Bus data from supported receivers.

Currently only Embit WMB modules which implement the EBI interface protocol are well supported. However, the device configuration is currently hardcoded to T-Mode 868.950[MHz] @66.666[kbps]. Crude support for Amber Wireless AMB8465 receiver is implemented as well - device is only opened, no configuration is sent, so it must be configured beforehand.

The WMBUS stack been "re-ported" from FHEM project and was extensively fixed and refactored. Testing was done with raw data picked up on the internet, OMS sample data and some test data from the jmbus library. Some edge cases are still untested.

The device creation, updating, etc is mostly based of Apollon77's M-Bus adapter (see below).

If the adapter receives encrypted telegrams the AES key configuration tab should list the device ID automatically.

If the parser fails the raw telegram data will be saved to the info.rawdata state.

### Links:
* [WMBus Stack module](https://github.com/mhop/fhem-mirror/blob/master/fhem/FHEM/WMBus.pm)
* [ioBroker.mbus](https://github.com/Apollon77/ioBroker.mbus)
* [Original WMBUS Stack: wm-bus](https://github.com/soef/wm-bus)
* [OMS Specifications](https://oms-group.org/en/download4all/oms-specification/)

## Changelog

### 0.3.0
* (ChL) Implemented all VIF types from MBus doc
* (ChL) VIF extensions are handled better (again)
* (ChL) reorganised VIF info
* (ChL) reorganised receiver handling
* (ChL) blacklisting of devices possible

### 0.2.0 (not tagged)
* (ChL) Dramatically improved parser: support for security mode 7, frame type B, many small fixes
* (ChL) VIF extensions are handled better, but correct handling is still not fully clear
* (ChL) CRCs are checked and removed if still present
* (ChL) raw data is saved if parser fails

### 0.1.0
* (ChL) initial release

