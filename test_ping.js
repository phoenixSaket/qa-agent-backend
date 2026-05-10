const http = require('http');
http.get('http://localhost:3000', (res) => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => console.log('HTTP', res.statusCode, 'Length:', raw.length));
}).on('error', e => console.error(e));
