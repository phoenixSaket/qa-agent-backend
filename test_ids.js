const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const ids = [...html.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
ids.forEach(id => {
    if (!html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")) {
        console.log("MISSING ID:", id);
    }
});
