![Logo](admin/wmbus.png)
# ioBroker.wmbus
=================

This adapter allows to receive wireless M-Bus data from supported receivers:
* Embit WMB modules
* Amber Wireless AMB8465 (**Beware:** UART_CMD_Out_Enable is enabled!)

The WMBUS stack been "re-ported" from FHEM project and was extensively fixed and refactored. Testing was done with raw data picked up on the internet, OMS sample data and some test data from the jmbus library. Some edge cases are still untested.

The device creation, updating, etc is mostly based of Apollon77's M-Bus adapter (see below).

If the adapter receives encrypted telegrams the AES key configuration tab should list the device ID automatically.

If the parser fails the raw telegram data will be saved to the info.rawdata state.

### Links:
* [WMBus Stack module](https://github.com/mhop/fhem-mirror/blob/master/fhem/FHEM/WMBus.pm)
* [ioBroker.mbus](https://github.com/Apollon77/ioBroker.mbus)
* [Original WMBUS Stack: wm-bus](https://github.com/soef/wm-bus)
* [M-Bus protocol](http://www.m-bus.com/files/MBDOC48.PDF)
* [OMS Specifications](https://oms-group.org/en/download4all/oms-specification/)

## ToDo

* CUL support?
* IMST support?

## Changelog

### 0.4.0
* (ChL) better Amber Stick support
* (ChL) Compact mode?
* (ChL) Nicer state names
* (ChL) wMBus mode partially selectable

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

## License

Licensed under GPLv2. See [LICENSE](LICENSE) and [NOTICE](NOTICE)

