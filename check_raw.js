const fs = require('fs');
const lines = fs.readFileSync('akun.txt', 'utf8').split('\n');
lines.slice(0, 4).forEach((l, i) => {
  console.log(`Line ${i}: length=${l.length} | raw=${JSON.stringify(l)}`);
});
