/**
 * Data-driven search accuracy test.
 * Compares Lunr wildcard search vs brute-force substring for every unique word.
 * Usage: node test-search.js [path-to-mbox]
 */

var fs = require('fs');

// Shim browser globals for MboxParser
global.atob = function (b64) { return Buffer.from(b64, 'base64').toString('binary'); };
global.TextDecoder = require('util').TextDecoder;
global.DOMParser = class {
    parseFromString() { return { documentElement: null }; }
};
global.Set = Set;

// Load parser & Lunr
eval(fs.readFileSync('js/mbox-parser.js', 'utf8'));
var lunr = require('./js/lunr.min.js');

// Parse mbox
var mboxFile = process.argv[2] || 'test.mbox';
var mboxText = fs.readFileSync(mboxFile, 'utf8');
var result = MboxParser.parseMboxFile(mboxText, mboxFile);
var summaries = result.source.emails_summary;

console.log('=== ' + mboxFile + ': ' + summaries.length + ' emails ===\n');

// ── Helpers (identical to app.js) ──

function expandAttachmentNames(names) {
    var parts = [];
    (names || []).forEach(function (fn) {
        if (!fn) return;
        parts.push(fn);
        var dot = fn.lastIndexOf('.');
        if (dot > 0) {
            parts.push(fn.substring(0, dot));
            parts.push(fn.substring(dot + 1));
        }
    });
    return parts.join(' ');
}

function expandSender(sender) {
    if (!sender) return '';
    var parts = [sender];
    sender.split(/[@.]+/).forEach(function (t) {
        if (t && t.length > 1) parts.push(t);
    });
    return parts.join(' ');
}

// ── Build Lunr index (identical to app.js) ──

var docs = [];
summaries.forEach(function (s) {
    docs.push({
        id: s.email_id,
        subject: s.subject || '',
        sender: expandSender(s.sender),
        clean_subject: s.clean_subject || '',
        attachments: expandAttachmentNames(s.attachment_names)
    });
});

var searchIndex = lunr(function () {
    this.pipeline.remove(lunr.stemmer);
    this.searchPipeline.remove(lunr.stemmer);
    this.ref('id');
    this.field('subject', { boost: 10 });
    this.field('clean_subject', { boost: 5 });
    this.field('sender', { boost: 3 });
    this.field('attachments', { boost: 2 });
    docs.forEach(function (doc) { this.add(doc); }, this);
});

// ── Lunr search (identical to app.js searchEmails) ──

function lunrSearch(query) {
    var safeQuery = query.replace(/[:\*\~\^]/g, '');
    var results = [];
    try { results = searchIndex.search(safeQuery + '*'); } catch (e) {}

    var ids = {};
    results.forEach(function (r) { ids[r.ref] = true; });

    var matched = [];
    summaries.forEach(function (s) {
        if (ids[s.email_id]) matched.push(s);
    });

    // Always merge substring matches (same as app.js)
    if (safeQuery.length >= 2) {
        var lower = safeQuery.toLowerCase();
        var seen = {};
        matched.forEach(function (s) { seen[s.email_id] = true; });
        summaries.forEach(function (s) {
            if (seen[s.email_id]) return;
            var hay = ((s.subject || '') + ' ' + (s.clean_subject || '') + ' ' + (s.sender || '') + ' ' + (s.attachment_names || []).join(' ')).toLowerCase();
            if (hay.indexOf(lower) !== -1) matched.push(s);
        });
    }
    return matched.map(function (s) { return s.email_id; }).sort();
}

// ── Brute-force substring search (ground truth) ──

function bruteSearch(query) {
    var lower = query.toLowerCase();
    var matched = [];
    summaries.forEach(function (s) {
        // Search the same fields that are indexed + expanded sender/attachment parts
        var hay = (
            (s.subject || '') + ' ' +
            (s.clean_subject || '') + ' ' +
            expandSender(s.sender) + ' ' +
            expandAttachmentNames(s.attachment_names)
        ).toLowerCase();
        if (hay.indexOf(lower) !== -1) matched.push(s);
    });
    return matched.map(function (s) { return s.email_id; }).sort();
}

// ── Extract all unique words from indexed fields ──

var wordCounts = {};
summaries.forEach(function (s) {
    var text = (
        (s.subject || '') + ' ' +
        (s.clean_subject || '') + ' ' +
        expandSender(s.sender) + ' ' +
        expandAttachmentNames(s.attachment_names)
    ).toLowerCase();
    // Split on non-alphanumeric (keep accented chars)
    text.split(/[^a-z0-9àèìòùáéíóúâêîôûäëïöü]+/).forEach(function (w) {
        if (w.length >= 3) {
            wordCounts[w] = (wordCounts[w] || 0) + 1;
        }
    });
});

var allWords = Object.keys(wordCounts).sort(function (a, b) {
    return wordCounts[b] - wordCounts[a]; // most frequent first
});

console.log('Unique words (len>=3): ' + allWords.length);
console.log('Top 20 by frequency:');
allWords.slice(0, 20).forEach(function (w) {
    console.log('  ' + w + ' → ' + wordCounts[w] + ' occurrences');
});

// ── Run comparison tests ──

console.log('\n=== SEARCH ACCURACY TEST ===\n');

var passed = 0, failed = 0, fallbackUsed = 0;
var failures = [];

allWords.forEach(function (word) {
    var lunrIds = lunrSearch(word);
    var bruteIds = bruteSearch(word);

    // Check if Lunr missed any results that brute-force found
    var missed = bruteIds.filter(function (id) { return lunrIds.indexOf(id) === -1; });
    // Check if Lunr returned extra results (shouldn't happen, but check)
    var extra = lunrIds.filter(function (id) { return bruteIds.indexOf(id) === -1; });

    if (missed.length === 0 && extra.length === 0) {
        passed++;
    } else {
        failed++;
        failures.push({
            word: word,
            lunrCount: lunrIds.length,
            bruteCount: bruteIds.length,
            missed: missed.length,
            extra: extra.length
        });
    }
});

// ── Report ──

if (failures.length > 0) {
    console.log('FAILURES (' + failures.length + '):\n');
    failures.forEach(function (f) {
        console.log('  "' + f.word + '" → Lunr: ' + f.lunrCount + ', Brute: ' + f.bruteCount +
            ' (missed: ' + f.missed + ', extra: ' + f.extra + ')');
    });
}

// Stats by result count buckets
var buckets = { '1': 0, '2-5': 0, '6-10': 0, '11-20': 0, '20+': 0 };
var bucketFail = { '1': 0, '2-5': 0, '6-10': 0, '11-20': 0, '20+': 0 };

allWords.forEach(function (word) {
    var n = bruteSearch(word).length;
    var bucket = n <= 1 ? '1' : n <= 5 ? '2-5' : n <= 10 ? '6-10' : n <= 20 ? '11-20' : '20+';
    buckets[bucket]++;
    var lunrIds = lunrSearch(word);
    var bruteIds = bruteSearch(word);
    var missed = bruteIds.filter(function (id) { return lunrIds.indexOf(id) === -1; });
    if (missed.length > 0) bucketFail[bucket]++;
});

console.log('\n=== RESULTS BY BUCKET ===\n');
Object.keys(buckets).forEach(function (b) {
    var total = buckets[b];
    var fail = bucketFail[b];
    console.log('  ' + b + ' results: ' + total + ' words tested, ' + fail + ' failures');
});

console.log('\n=== SUMMARY: ' + passed + '/' + (passed + failed) + ' words match (' + failed + ' mismatches) ===');

// Show sample searches with many results
console.log('\n=== SAMPLE HIGH-COUNT SEARCHES ===\n');
var highCount = allWords.filter(function (w) { return bruteSearch(w).length >= 5; });
highCount.slice(0, 15).forEach(function (w) {
    var bIds = bruteSearch(w);
    var lIds = lunrSearch(w);
    var status = lIds.length === bIds.length ? 'OK' : 'MISMATCH';
    console.log('  "' + w + '" → brute: ' + bIds.length + ', lunr: ' + lIds.length + ' [' + status + ']');
});

process.exit(failed > 0 ? 1 : 0);
