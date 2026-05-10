const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
    
    await page.goto('http://localhost:3001');
    await new Promise(r => setTimeout(r, 2000));
    const btn = await page.$('#send-btn');
    console.log('SEND BTN EXISTS?', !!btn);
    await page.type('#prompt-input', 'Test prompt');
    await page.click('#send-btn');
    console.log('SEND BTN CLICKED');
    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
})();
