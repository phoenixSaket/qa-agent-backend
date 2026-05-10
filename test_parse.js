const fs = require('fs');
const path = require('path');
function extractTopLevelDependencies(projectPath) {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return `No package.json found at ${projectPath}`;
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return "SUCCESS";
    } catch(err) {
        return "ERROR";
    }
}
console.log(extractTopLevelDependencies('/Users/admin/Desktop/Projects/Connect/connect.app'));
