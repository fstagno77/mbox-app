/**
 * Client-side mbox/MIME parser with PEC (Posta Elettronica Certificata) support.
 * Parses .mbox files entirely in the browser — no server needed.
 */
var MboxParser = (function () {
    'use strict';

    var PEC_INFRA_FILES = new Set(['smime.p7s', 'daticert.xml', 'postacert.eml']);
    var PREFIX_RE = /^(?:POSTA\s+CERTIFICATA:\s*|(?:Re|R|Fwd|I|Oggetto)\s*:\s*)+/i;
    var WHITESPACE_RE = /\s+/g;
    var ENCODED_WORD_RE = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

    /* ──────────── Low-level helpers ──────────── */

    function base64ToBytes(b64) {
        try {
            var bin = atob(b64.replace(/\s/g, ''));
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        } catch (e) { return new Uint8Array(0); }
    }

    function decodeBytes(bytes, charset) {
        charset = (charset || 'utf-8').toLowerCase().replace(/^(x-|cs)/, '');
        var map = {
            'ascii': 'utf-8', 'us-ascii': 'utf-8',
            'latin1': 'iso-8859-1', 'latin-1': 'iso-8859-1',
            'iso_8859-1': 'iso-8859-1', 'cp1252': 'windows-1252',
        };
        charset = map[charset] || charset;
        try { return new TextDecoder(charset).decode(bytes); }
        catch (e) {
            try { return new TextDecoder('utf-8').decode(bytes); }
            catch (e2) { return String.fromCharCode.apply(null, bytes); }
        }
    }

    function stringToBytes(str) {
        var bytes = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
        return bytes;
    }

    /* ──────────── RFC 2047 header decoding ──────────── */

    function decodeHeaderValue(raw) {
        if (!raw) return '';
        return raw.replace(ENCODED_WORD_RE, function (_, charset, enc, text) {
            try {
                if (enc.toUpperCase() === 'B') {
                    return decodeBytes(base64ToBytes(text), charset);
                }
                // Q encoding
                var decoded = text.replace(/_/g, ' ')
                    .replace(/=([0-9A-Fa-f]{2})/g, function (__, h) {
                        return String.fromCharCode(parseInt(h, 16));
                    });
                return decodeBytes(stringToBytes(decoded), charset);
            } catch (e) { return _; }
        });
    }

    /* ──────────── MIME parsing ──────────── */

    function extractParam(header, name) {
        var re = new RegExp(name + '\\s*=\\s*"?([^";\\s]+)"?', 'i');
        var m = header.match(re);
        return m ? m[1].trim() : null;
    }

    function getMimeType(ct) {
        return (ct.split(';')[0] || 'text/plain').trim().toLowerCase();
    }

    function extractFilename(headers) {
        var cd = headers['content-disposition'] || '';
        // filename*=UTF-8''encoded
        var m = cd.match(/filename\*\s*=\s*[^']*'[^']*'([^;\s]+)/i);
        if (m) {
            try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
        }
        m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
        if (m) return decodeHeaderValue(m[1].trim());
        var ct = headers['content-type'] || '';
        m = ct.match(/name\s*=\s*"?([^";]+)"?/i);
        if (m) return decodeHeaderValue(m[1].trim());
        return null;
    }

    function parseHeaders(text) {
        var headers = {};
        var lines = text.split(/\r?\n/);
        var key = null, val = '';
        for (var i = 0; i < lines.length; i++) {
            if (/^\s/.test(lines[i]) && key) {
                val += ' ' + lines[i].trim();
            } else {
                if (key) headers[key] = val;
                var ci = lines[i].indexOf(':');
                if (ci > 0) {
                    key = lines[i].substring(0, ci).trim().toLowerCase();
                    val = lines[i].substring(ci + 1).trim();
                } else { key = null; val = ''; }
            }
        }
        if (key) headers[key] = val;
        return headers;
    }

    function parseMessage(raw) {
        var sepIdx = raw.indexOf('\n\n');
        if (sepIdx === -1) sepIdx = raw.indexOf('\r\n\r\n');
        var headerText, bodyText;
        if (sepIdx === -1) {
            headerText = raw; bodyText = '';
        } else {
            headerText = raw.substring(0, sepIdx);
            var skip = raw.charAt(sepIdx + 1) === '\n' ? 2 : 4;
            bodyText = raw.substring(sepIdx + skip);
        }

        var headers = parseHeaders(headerText);
        var ct = headers['content-type'] || 'text/plain';
        var boundary = extractParam(ct, 'boundary');

        var msg = {
            headers: headers,
            contentType: getMimeType(ct),
            charset: extractParam(ct, 'charset'),
            boundary: boundary,
            encoding: (headers['content-transfer-encoding'] || '7bit').trim().toLowerCase(),
            filename: extractFilename(headers),
            contentId: (headers['content-id'] || '').replace(/^<|>$/g, ''),
            contentDisposition: headers['content-disposition'] || '',
            body: bodyText,
            parts: [],
            isMultipart: false,
        };

        if (boundary && bodyText) {
            msg.isMultipart = true;
            msg.parts = parseMultipart(bodyText, boundary);
        }
        return msg;
    }

    function parseMultipart(body, boundary) {
        var delim = '--' + boundary;
        var parts = [];
        var sections = body.split(delim);

        for (var i = 1; i < sections.length; i++) {
            var s = sections[i];
            if (s.substring(0, 2) === '--') continue; // end boundary
            // trim leading CRLF
            if (s.charAt(0) === '\r' && s.charAt(1) === '\n') s = s.substring(2);
            else if (s.charAt(0) === '\n') s = s.substring(1);
            // trim trailing CRLF
            if (s.slice(-2) === '\r\n') s = s.slice(0, -2);
            else if (s.slice(-1) === '\n') s = s.slice(0, -1);
            if (s.trim()) parts.push(parseMessage(s));
        }
        return parts;
    }

    /* ──────────── Payload decoding ──────────── */

    function decodePayload(msg, asBinary) {
        var enc = msg.encoding;
        var body = msg.body;
        var charset = msg.charset || 'utf-8';

        if (enc === 'base64') {
            var bytes = base64ToBytes(body);
            return asBinary ? bytes : decodeBytes(bytes, charset);
        }
        if (enc === 'quoted-printable') {
            var decoded = body.replace(/=\r?\n/g, '')
                .replace(/=([0-9A-Fa-f]{2})/g, function (_, h) {
                    return String.fromCharCode(parseInt(h, 16));
                });
            var qpBytes = stringToBytes(decoded);
            return asBinary ? qpBytes : decodeBytes(qpBytes, charset);
        }
        // 7bit / 8bit / binary
        if (asBinary) return stringToBytes(body);
        // For 8bit text, re-decode with proper charset
        if (charset.toLowerCase() !== 'utf-8' && charset.toLowerCase() !== 'us-ascii') {
            return decodeBytes(stringToBytes(body), charset);
        }
        return body;
    }

    /* ──────────── MIME tree traversal ──────────── */

    function walkParts(msg, cb) {
        cb(msg);
        if (msg.parts) msg.parts.forEach(function (p) { walkParts(p, cb); });
    }

    function findMixedPart(msg) {
        if (msg.contentType === 'multipart/mixed') return msg;
        if (msg.isMultipart) {
            for (var i = 0; i < msg.parts.length; i++) {
                var p = msg.parts[i];
                if (p.contentType === 'multipart/mixed') return p;
                if (p.isMultipart) {
                    for (var j = 0; j < p.parts.length; j++) {
                        if (p.parts[j].contentType === 'multipart/mixed') return p.parts[j];
                    }
                }
            }
        }
        return null;
    }

    /* ──────────── PEC-specific logic ──────────── */

    function findPecParts(msg) {
        var daticert = null, postacert = null;
        var container = findMixedPart(msg) || msg;
        if (!container.isMultipart) return { daticert: null, postacert: null };

        for (var i = 0; i < container.parts.length; i++) {
            var part = container.parts[i];
            var fn = part.filename || '';
            var ct = part.contentType;

            if (fn === 'daticert.xml' || (ct === 'application/xml' && !fn)) {
                daticert = part;
            } else if (fn === 'postacert.eml' || ct === 'message/rfc822') {
                var decoded = decodePayload(part, false);
                postacert = parseMessage(decoded);
            }
        }
        return { daticert: daticert, postacert: postacert };
    }

    function parseDaticert(part) {
        var meta = {};
        try {
            var xml = decodePayload(part, false);
            var doc = new DOMParser().parseFromString(xml, 'text/xml');
            var root = doc.documentElement;
            if (!root || root.tagName === 'parsererror') return meta;

            meta.tipo = root.getAttribute('tipo') || '';
            meta.errore = root.getAttribute('errore') || '';

            var int = root.querySelector('intestazione');
            if (int) {
                var m = int.querySelector('mittente');
                if (m && m.textContent) meta.mittente = m.textContent.trim();
                var o = int.querySelector('oggetto');
                if (o && o.textContent) meta.oggetto = o.textContent.trim();
            }
            var dati = root.querySelector('dati');
            if (dati) {
                var g = dati.querySelector('gestore-emittente');
                if (g && g.textContent) meta.gestore = g.textContent.trim();
                var d = dati.querySelector('data');
                if (d) {
                    var gg = d.querySelector('giorno'), ora = d.querySelector('ora');
                    if (gg && ora) meta.data = (gg.textContent || '').trim() + ' ' + (ora.textContent || '').trim();
                }
            }
        } catch (e) { /* ignore */ }
        return meta;
    }

    /* ──────────── Body & attachment extraction ──────────── */

    function sanitizeFilename(name) {
        if (!name) return 'unnamed';
        var d = decodeHeaderValue(name);
        return d.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || 'unnamed';
    }

    function extractBodyAndAttachments(msg) {
        var bodyText = null, bodyHtml = null, attachments = [];

        if (!msg.isMultipart) {
            if (msg.contentType === 'text/plain') bodyText = decodePayload(msg, false);
            else if (msg.contentType === 'text/html') bodyHtml = decodePayload(msg, false);
            return { bodyText: bodyText, bodyHtml: bodyHtml, attachments: attachments };
        }

        walkParts(msg, function (part) {
            if (part.isMultipart) return;
            var ct = part.contentType;
            var cd = (part.contentDisposition || '').toLowerCase();
            var fn = part.filename;

            if (fn && PEC_INFRA_FILES.has(fn.toLowerCase())) return;

            var isAtt = cd.indexOf('attachment') !== -1 || (fn && cd.indexOf('inline') === -1);
            var isInline = cd.indexOf('inline') !== -1 && ct.indexOf('image/') === 0;

            if (ct === 'text/plain' && !isAtt) {
                var t = decodePayload(part, false);
                if (t && (bodyText === null || t.length > bodyText.length)) bodyText = t;
            } else if (ct === 'text/html' && !isAtt) {
                var h = decodePayload(part, false);
                if (h && (bodyHtml === null || h.length > bodyHtml.length)) bodyHtml = h;
            } else if (fn || isAtt || isInline) {
                var data = decodePayload(part, true);
                attachments.push({
                    filename: sanitizeFilename(fn || ('file.' + (ct.split('/')[1] || 'bin'))),
                    content_type: ct,
                    size: data ? data.length : 0,
                    content_id: part.contentId || null,
                    is_inline: isInline,
                    data: data,
                });
            }
        });

        return { bodyText: bodyText, bodyHtml: bodyHtml, attachments: attachments };
    }

    /* ──────────── Address parsing ──────────── */

    function extractEmailAddress(raw) {
        if (!raw) return '';
        var d = decodeHeaderValue(raw);
        var m = d.match(/<([^>]+)>/);
        return m ? m[1] : d;
    }

    function extractAllRecipients(msg) {
        var addrs = [];
        ['to', 'cc'].forEach(function (h) {
            var raw = msg.headers[h];
            if (!raw) return;
            decodeHeaderValue(raw).split(',').forEach(function (part) {
                var m = part.match(/<([^>]+)>/);
                var a = m ? m[1].trim() : part.trim();
                if (a && a.indexOf('@') !== -1) addrs.push(a);
            });
        });
        return addrs;
    }

    /* ──────────── Subject cleaning & grouping ──────────── */

    function cleanSubject(subject) {
        if (!subject) return '';
        return subject.replace(WHITESPACE_RE, ' ').trim().replace(PREFIX_RE, '').trim();
    }

    function simpleHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h = h & h;
        }
        return Math.abs(h).toString(16).padStart(8, '0').substring(0, 12);
    }

    function similarityRatio(a, b) {
        if (a === b) return 1;
        if (!a || !b) return 0;
        var s = a.length <= b.length ? a : b;
        var l = a.length > b.length ? a : b;
        var m = [];
        for (var i = 0; i <= s.length; i++) { m[i] = [0]; }
        for (var j = 0; j <= l.length; j++) { m[0][j] = 0; }
        for (i = 1; i <= s.length; i++) {
            for (j = 1; j <= l.length; j++) {
                m[i][j] = s[i - 1] === l[j - 1]
                    ? m[i - 1][j - 1] + 1
                    : Math.max(m[i - 1][j], m[i][j - 1]);
            }
        }
        return (2 * m[s.length][l.length]) / (a.length + b.length);
    }

    function groupEmails(emails, threshold) {
        threshold = threshold || 0.85;
        emails.forEach(function (e) { e.clean_subject = cleanSubject(e.subject); });

        var exact = {};
        emails.forEach(function (e) {
            var k = e.clean_subject.toLowerCase();
            if (!exact[k]) exact[k] = [];
            exact[k].push(e);
        });

        var keys = Object.keys(exact);
        var used = new Array(keys.length).fill(false);
        var groups = [];

        for (var i = 0; i < keys.length; i++) {
            if (used[i]) continue;
            var cur = [].concat(exact[keys[i]]);
            used[i] = true;
            for (var j = i + 1; j < keys.length; j++) {
                if (used[j]) continue;
                if (similarityRatio(keys[i], keys[j]) >= threshold) {
                    cur = cur.concat(exact[keys[j]]);
                    used[j] = true;
                }
            }
            groups.push(cur);
        }

        groups.sort(function (a, b) {
            return b.length !== a.length ? b.length - a.length : (a[0].date || '').localeCompare(b[0].date || '');
        });

        return groups.map(function (g) {
            var label = g.reduce(function (best, e) {
                return e.clean_subject.length > best.length ? e.clean_subject : best;
            }, '');
            return {
                group_id: 'group_' + simpleHash(label),
                label: label,
                email_ids: g.map(function (e) { return e.email_id; }),
            };
        });
    }

    /* ──────────── Date formatting ──────────── */

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            var d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            var pad = function (n) { return String(n).padStart(2, '0'); };
            return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
                ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) { return dateStr; }
    }

    /* ──────────── Main entry point ──────────── */

    function parseMboxFile(text, sourceFile) {
        var rawMessages = splitMbox(text);
        var emailDataMap = {};
        var emails = [];

        for (var idx = 0; idx < rawMessages.length; idx++) {
            var msg = parseMessage(rawMessages[idx]);
            var pec = findPecParts(msg);
            var pecMeta = pec.daticert ? parseDaticert(pec.daticert) : {};
            var inner = pec.postacert || msg;

            var subject = decodeHeaderValue(inner.headers['subject'] || '');
            var sender = extractEmailAddress(inner.headers['from'] || '');
            var recipients = extractAllRecipients(inner);
            var messageId = inner.headers['message-id'] || msg.headers['message-id'] || '';
            var dateStr = inner.headers['date'] || msg.headers['date'] || '';
            var dateDisplay = formatDate(dateStr);

            var extracted = extractBodyAndAttachments(inner);

            var rawId = messageId || (sender + '_' + subject + '_' + dateStr);
            var emailId = 'email_' + simpleHash(rawId);

            var email = {
                email_id: emailId,
                message_id: messageId,
                subject: subject,
                sender: sender,
                recipients: recipients,
                date: dateDisplay,
                body_text: extracted.bodyText,
                body_html: extracted.bodyHtml,
                attachments: extracted.attachments,
                pec_provider: pecMeta.gestore || null,
                pec_type: pecMeta.tipo || null,
                pec_date: pecMeta.data || null,
                clean_subject: cleanSubject(subject),
                source_file: sourceFile,
            };
            emails.push(email);
            emailDataMap[emailId] = email;
        }

        var groups = groupEmails(emails);
        var now = new Date();
        var sourceId = 'src_' + simpleHash(sourceFile + now.toISOString());

        return {
            source: {
                source_id: sourceId,
                source_file: sourceFile,
                uploaded_at: formatDate(now.toString()),
                _uploaded_ts: now.getTime(),
                email_count: emails.length,
                groups: groups,
                emails_summary: emails.map(function (e) {
                    var attNames = e.attachments
                        .filter(function (a) { return !a.is_inline; })
                        .map(function (a) { return a.filename; });
                    return {
                        email_id: e.email_id, subject: e.subject,
                        sender: e.sender, date: e.date,
                        clean_subject: e.clean_subject,
                        attachment_count: e.attachments.length,
                        attachment_names: attNames,
                        pec_provider: e.pec_provider,
                        source_file: e.source_file,
                    };
                }),
            },
            emailDataMap: emailDataMap,
        };
    }

    function splitMbox(text) {
        var messages = [];
        var lines = text.split(/\r?\n/);
        var current = [];
        var started = false;

        for (var i = 0; i < lines.length; i++) {
            if (/^From /.test(lines[i])) {
                if (started && current.length > 0) messages.push(current.join('\n'));
                current = [];
                started = true;
            } else if (started) {
                current.push(lines[i].charAt(0) === '>' && lines[i].substring(0, 6) === '>From '
                    ? lines[i].substring(1)
                    : lines[i]);
            }
        }
        if (current.length > 0) messages.push(current.join('\n'));
        return messages;
    }

    return { parseMboxFile: parseMboxFile };
})();
