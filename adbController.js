const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

// Convert exec to return Promises so we can use async/await
const execAsync = util.promisify(exec);

class AdbController {
    constructor() {
        this.tempDir = path.join(__dirname, 'temp_captures');
        this.maxScreenshots = 3; // The rolling buffer limit
        this.currentScreenshots = [];

        // Ensure temp directory exists
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir);
        }
    }

    /**
     * Executes a raw ADB command
     */
    async _runAdb(command, timeoutMs = 15000) {
        try {
            const { stdout } = await execAsync(`adb ${command}`, { timeout: timeoutMs });
            return stdout.trim();
        } catch (error) {
            console.error(`ADB Error executing '${command}':`, error.message);
            throw error;
        }
    }

    /**
     * Retrieves basic device screen parameters for the LLM context
     */
    async getDeviceDetails() {
        try {
            console.log('🤖 [ADB] Fetching device screen details...');
            const sizeOutput = await this._runAdb('shell wm size');
            const resolution = sizeOutput.replace('Physical size:', '').trim() || 'Unknown';
            let width = 1080;
            let height = 2400;
            if (resolution !== 'Unknown') {
                const parts = resolution.split('x');
                if (parts.length === 2) {
                    width = parseInt(parts[0], 10);
                    height = parseInt(parts[1], 10);
                }
            }
            this.width = width;
            this.height = height;
            return { resolution, width, height };
        } catch (error) {
            console.warn('⚠️ Could not fetch device details:', error.message);
            return { resolution: 'Unknown', width: 1080, height: 2400 };
        }
    }

    /**
     * Structural Eyes: Dumps the current UI hierarchy as an XML string
     */
    async getUiDump() {
        console.log('🤖 [ADB] Fetching UI XML dump...');
        // uiautomator dumps to the device's SD card first, then we pull the content
        await this._runAdb('shell uiautomator dump /sdcard/window_dump.xml');
        const xmlContent = await this._runAdb('shell cat /sdcard/window_dump.xml');
        return xmlContent;
    }

    /**
     * Visual Eyes: Captures the screen directly to the Mac and manages the buffer
     */
    async takeScreenshot(runId) {
        console.log(`🤖 [ADB] Taking visual screencap for run ${runId}...`);
        const timestamp = Date.now();
        const filename = `bug_capture_${runId}_${timestamp}.png`;
        const filepath = path.join(this.tempDir, filename);

        // exec-out pipes the binary data directly to the Mac without saving on the phone. Quoted filepath handles spaces.
        await this._runAdb(`exec-out screencap -p > "${filepath}"`);

        this.currentScreenshots.push(filepath);
        this._cleanupOldScreenshots();

        return filepath;
    }

    /**
     * Garbage Collection: Keeps only the most recent N screenshots
     */
    _cleanupOldScreenshots() {
        while (this.currentScreenshots.length > this.maxScreenshots) {
            const oldestFile = this.currentScreenshots.shift();
            if (fs.existsSync(oldestFile)) {
                fs.unlinkSync(oldestFile);
                console.log(`🧹 [Cleanup] Deleted old screenshot: ${path.basename(oldestFile)}`);
            }
        }
    }

    /**
     * Manual wipe of all screenshots (called when a bug is resolved)
     */
    clearAllScreenshots() {
        this.currentScreenshots.forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
        this.currentScreenshots = [];
        console.log('🧹 [Cleanup] All screenshots wiped for the new session.');
    }

    /**
     * Action: Taps a specific [x, y] coordinate
     */
    async tap(x, y) {
        const intX = Math.round(x);
        const intY = Math.round(y);
        console.log(`🤖 [ADB] Tapping at [${intX}, ${intY}]`);
        // Execute proper ADB tap. Floats are pre-rounded to avoid silent ADB failures.
        await this._runAdb(`shell input tap ${intX} ${intY}`);
    }

    /**
     * Action: Types text into the currently focused input field
     */
    async type(text) {
        console.log(`🤖 [ADB] Typing text: "${text}"`);
        // ADB struggles with spaces in text input, so we replace them with %s
        const formattedText = text.replace(/ /g, '%s');
        await this._runAdb(`shell input text "${formattedText}"`);
    }

    /**
     * Action: Simulates the Android back button
     */
    async goBack() {
        console.log('🤖 [ADB] Pressing Back button');
        await this._runAdb('shell input keyevent 4'); // 4 is the keycode for BACK
    }

    /**
     * Action: Double taps a specific [x, y] coordinate
     */
    async doubleTap(x, y) {
        const intX = Math.round(x);
        const intY = Math.round(y);
        console.log(`🤖 [ADB] Double Tapping at [${intX}, ${intY}]`);
        await this._runAdb(`shell input tap ${intX} ${intY}`);
        await this._runAdb(`shell input tap ${intX} ${intY}`);
    }

    /**
     * Action: Long presses a specific [x, y] coordinate (simulated via 1000ms swipe in place)
     */
    async longPress(x, y) {
        const intX = Math.round(x);
        const intY = Math.round(y);
        console.log(`🤖 [ADB] Long Pressing at [${intX}, ${intY}]`);
        await this._runAdb(`shell input swipe ${intX} ${intY} ${intX} ${intY} 1000`);
    }

    /**
     * Action: Scrolls DOWN (swipes screen up to reveal lower content)
     */
    async scrollDown() {
        console.log('🤖 [ADB] Scrolling DOWN');
        const cx = Math.floor((this.width || 1080) / 2);
        const startY = Math.floor((this.height || 2400) * 0.8);
        const endY = Math.floor((this.height || 2400) * 0.2);
        // Using a longer duration ensures the swipe registers reliably as a scroll instead of a fling
        await this._runAdb(`shell input swipe ${cx} ${startY} ${cx} ${endY} 800`);
    }

    /**
     * Action: Scrolls UP (swipes screen down to reveal higher content)
     */
    async scrollUp() {
        console.log('🤖 [ADB] Scrolling UP');
        const cx = Math.floor((this.width || 1080) / 2);
        const startY = Math.floor((this.height || 2400) * 0.2);
        const endY = Math.floor((this.height || 2400) * 0.8);
        await this._runAdb(`shell input swipe ${cx} ${startY} ${cx} ${endY} 800`);
    }
}

module.exports = AdbController;