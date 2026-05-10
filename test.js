// test.js
const AdbController = require('./adbController');

async function runTest() {
    const adb = new AdbController();

    // Test 1: Get the XML
    const xml = await adb.getUiDump();
    console.log("Got XML length:", xml.length);

    // Test 2: Take a screenshot
    const imagePath = await adb.takeScreenshot('TEST-1');
    console.log("Screenshot saved to:", imagePath);

    // Test 3: Tap the center of the screen (assuming a 1080x2400 display)
    await adb.tap(540, 1200);
}

runTest();