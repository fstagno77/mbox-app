/**
 * Node.js test for mbox-parser.js
 * Polyfills browser APIs, then tests against test.mbox
 */

const fs = require('fs');
const path = require('path');

// ─── Polyfill browser APIs ───
const { JSDOM } = (() => {
    // Minimal DOMParser polyfill
    class MinimalDOMParser {
        parseFromString(str, type) {
            // Very basic XML parser for daticert.xml testing
            return new MinimalDocument(str);
        }
    }
    class MinimalDocument {
        constructor(xml) { this._xml = xml; this._parsed = null; }
        get documentElement() {
            // Simple regex-based extraction (good enough for testing)
            const match = this._xml.match(/<(\w+)([^>]*)>/);
            if (!match) return null;
            return new MinimalElement(match[1], match[2], this._xml);
        }
    }
    class MinimalElement {
        constructor(tag, attrs, xml) {
            this.tagName = tag;
            this._attrs = attrs;
            this._xml = xml;
        }
        getAttribute(name) {
            const m = this._attrs.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']'));
            return m ? m[1] : '';
        }
        querySelector(sel) {
            // Simple tag match
            const re = new RegExp('<' + sel + '[^>]*>([\\s\\S]*?)</' + sel + '>');
            const m = this._xml.match(re);
            if (!m) return null;
            return new MinimalElement(sel, '', m[0]);
        }
        get textContent() {
            const m = this._xml.match(/>([^<]*)</);
            return m ? m[1] : '';
        }
    }
    return { JSDOM: null, MinimalDOMParser };
})();

global.DOMParser = (() => {
    class MinimalDOMParser {
        parseFromString(str, type) {
            return new MinimalDocument(str);
        }
    }
    class MinimalDocument {
        constructor(xml) { this._xml = xml; }
        get documentElement() {
            const m = this._xml.match(/<(\w+)([^>]*?)(?:\/>|>([\s\S]*)<\/\1>)/);
            if (!m) return null;
            return new MinimalElement(m[1], m[2] || '', this._xml);
        }
    }
    class MinimalElement {
        constructor(tag, attrs, xml) {
            this.tagName = tag;
            this._attrs = attrs || '';
            this._xml = xml || '';
        }
        getAttribute(name) {
            const m = this._attrs.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']'));
            return m ? m[1] : '';
        }
        querySelector(sel) {
            const escaped = sel.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const re = new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + escaped + '>');
            const m = this._xml.match(re);
            if (!m) return null;
            return new MinimalElement(sel, '', m[0]);
        }
        get textContent() {
            const stripped = this._xml.replace(/<[^>]+>/g, '');
            return stripped.trim();
        }
    }
    return MinimalDOMParser;
})();

global.TextDecoder = require('util').TextDecoder;

// ─── Load the parser ───
const parserCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'mbox-parser.js'), 'utf-8');
eval(parserCode);

// ─── Test runner ───
let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, msg) {
    total++;
    if (condition) {
        passed++;
        console.log('  PASS: ' + msg);
    } else {
        failed++;
        console.log('  FAIL: ' + msg);
    }
}

function assertEqual(actual, expected, msg) {
    total++;
    if (actual === expected) {
        passed++;
        console.log('  PASS: ' + msg);
    } else {
        failed++;
        console.log('  FAIL: ' + msg + ' (expected: ' + JSON.stringify(expected) + ', got: ' + JSON.stringify(actual) + ')');
    }
}

// ─── Tests ───

console.log('\n=== Test: parseMboxFile with test.mbox ===');
const mboxPath = path.join(__dirname, '..', 'test.mbox');
if (fs.existsSync(mboxPath)) {
    const mboxText = fs.readFileSync(mboxPath, { encoding: 'latin1' });
    const result = MboxParser.parseMboxFile(mboxText, 'test.mbox');

    assert(result !== null, 'parseMboxFile returns non-null result');
    assert(result.source !== null, 'result has source entry');
    assert(result.source.source_id.startsWith('src_'), 'source_id starts with src_');
    assertEqual(result.source.source_file, 'test.mbox', 'source_file matches');
    assert(result.source.email_count > 0, 'email_count > 0 (got ' + result.source.email_count + ')');
    assert(result.source.groups.length > 0, 'groups exist');
    assert(result.source.emails_summary.length > 0, 'emails_summary populated');

    // Check emailDataMap
    var emailIds = Object.keys(result.emailDataMap);
    assert(emailIds.length > 0, 'emailDataMap has entries (' + emailIds.length + ')');
    assertEqual(emailIds.length, result.source.email_count, 'emailDataMap count matches email_count');

    // Check a sample email
    var firstEmail = result.emailDataMap[emailIds[0]];
    assert(firstEmail.email_id.startsWith('email_'), 'email_id starts with email_');
    assert(typeof firstEmail.subject === 'string', 'subject is string');
    assert(typeof firstEmail.sender === 'string', 'sender is string');
    assert(typeof firstEmail.date === 'string', 'date is string');
    assert(firstEmail.source_file === 'test.mbox', 'source_file set');

    // Check that body text or html is extracted for at least some emails
    var withBody = emailIds.filter(function (id) {
        var e = result.emailDataMap[id];
        return e.body_text || e.body_html;
    });
    assert(withBody.length > 0, 'at least some emails have body content (' + withBody.length + '/' + emailIds.length + ')');

    // Check groups
    result.source.groups.forEach(function (g) {
        assert(g.group_id.startsWith('group_'), 'group_id valid: ' + g.group_id);
        assert(g.email_ids.length > 0, 'group "' + g.label.substring(0, 30) + '" has emails');
    });

    // Check all summary email_ids exist in emailDataMap
    var allSummaryIds = result.source.emails_summary.map(function (s) { return s.email_id; });
    var missingIds = allSummaryIds.filter(function (id) { return !result.emailDataMap[id]; });
    assertEqual(missingIds.length, 0, 'all summary email_ids exist in emailDataMap');

    // Check all group email_ids exist in summaries
    var summaryIdSet = new Set(allSummaryIds);
    var allGroupIds = [];
    result.source.groups.forEach(function (g) { allGroupIds = allGroupIds.concat(g.email_ids); });
    var missingGroupIds = allGroupIds.filter(function (id) { return !summaryIdSet.has(id); });
    assertEqual(missingGroupIds.length, 0, 'all group email_ids exist in summaries');

    // Print summary of parsed data
    console.log('\n  --- Parsed data summary ---');
    console.log('  Emails: ' + result.source.email_count);
    console.log('  Groups: ' + result.source.groups.length);
    var withAttachments = emailIds.filter(function (id) {
        return result.emailDataMap[id].attachments.length > 0;
    });
    console.log('  With attachments: ' + withAttachments.length);
    console.log('  With body: ' + withBody.length);

} else {
    console.log('  SKIP: test.mbox not found');
}

console.log('\n=== Summary ===');
console.log('Total: ' + total + ', Passed: ' + passed + ', Failed: ' + failed);
if (failed > 0) {
    process.exit(1);
} else {
    console.log('All tests passed!\n');
    process.exit(0);
}
