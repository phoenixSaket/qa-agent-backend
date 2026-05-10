const AdbController = require('./adbController');
const adb = new AdbController();
adb.getDeviceDetails().then(console.log).catch(console.error);
