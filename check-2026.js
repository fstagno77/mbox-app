var fs = require('fs');
global.atob = function(b64) { return Buffer.from(b64,'base64').toString('binary'); };
global.TextDecoder = require('util').TextDecoder;
global.DOMParser = class { parseFromString() { return { documentElement: null }; } };
global.Set = Set;
eval(fs.readFileSync('js/mbox-parser.js','utf8'));
var result = MboxParser.parseMboxFile(fs.readFileSync('test.mbox','utf8'), 'test.mbox');
var sums = result.source.emails_summary;
var found = [];
sums.forEach(function(s) {
    var hay = ((s.subject||'') + ' ' + (s.clean_subject||'') + ' ' + (s.sender||'') + ' ' + (s.attachment_names||[]).join(' ')).toLowerCase();
    if (hay.indexOf('2026') !== -1) found.push(s);
});
console.log('Totale email con "2026" in test.mbox: ' + found.length + '/' + sums.length);
found.forEach(function(s) {
    console.log('  ' + s.email_id + ': ' + s.subject + (s.attachment_names && s.attachment_names.length ? ' [' + s.attachment_names.join(', ') + ']' : ''));
});
