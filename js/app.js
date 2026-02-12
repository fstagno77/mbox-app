/* MBOX Archive — client-side SPA */

var catalog = { total_emails: 0, total_sources: 0, sources: [] };
var emailStore = {};          // email_id → full email object (with attachment data)
var currentEmailId = null;
var blobUrls = [];            // track created blob URLs for cleanup

/* ─── SVG Icons ─── */
var ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>';
var ICON_PAPERCLIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.986 3A2.743 2.743 0 009.243.257a2.743 2.743 0 00-1.94.803L2.549 5.814a3.621 3.621 0 005.122 5.122l3.374-3.374a.75.75 0 00-1.06-1.06L6.61 9.875a2.121 2.121 0 01-3.001-3.001l4.754-4.754a1.243 1.243 0 011.758 1.758l-4.753 4.754a.364.364 0 01-.515-.515l3.374-3.374a.75.75 0 00-1.06-1.06L3.793 7.057a1.864 1.864 0 002.636 2.636l4.753-4.754A2.743 2.743 0 0011.986 3z" clip-rule="evenodd"/></svg>';
var ICON_INBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M1 11.27c0-.246.033-.492.099-.73l1.523-5.521A2.75 2.75 0 015.273 3h9.454a2.75 2.75 0 012.651 2.019l1.523 5.52c.066.239.099.485.099.732V15.25A2.75 2.75 0 0116.25 18H3.75A2.75 2.75 0 011 15.25V11.27zm3.057-5.064L2.813 10.5h3.17a1.25 1.25 0 011.114.683l.445.89a.25.25 0 00.224.14h4.468a.25.25 0 00.223-.14l.445-.89a1.25 1.25 0 011.114-.682h3.17l-1.244-4.294a1.25 1.25 0 00-1.205-.918H5.273c-.556 0-1.043.368-1.197.918l-.019.069z" clip-rule="evenodd"/></svg>';
var ICON_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V6.621a1.5 1.5 0 00-.44-1.06L10.94 2.94A1.5 1.5 0 009.878 2.5H9.5V5a1 1 0 01-1 1H5a1 1 0 01-1-1V2H3.5z"/><path d="M5 2h3v3H5V2z"/></svg>';
var ICON_SEARCH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style="width:14px;height:14px"><path fill-rule="evenodd" d="M9.965 11.026a5 5 0 111.06-1.06l2.755 2.754a.75.75 0 11-1.06 1.06l-2.755-2.754zM10.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" clip-rule="evenodd"/></svg>';

/* ─── IndexedDB persistence ─── */
var DB_NAME = 'mbox-archive';
var DB_VERSION = 1;
var db = null;

function openDB() {
    return new Promise(function (resolve) {
        try {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () { resolve(null); };
            req.onupgradeneeded = function (e) {
                var d = e.target.result;
                if (!d.objectStoreNames.contains('catalog')) d.createObjectStore('catalog', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('emails'))  d.createObjectStore('emails',  { keyPath: 'email_id' });
            };
            req.onsuccess = function (e) { db = e.target.result; resolve(db); };
        } catch (err) { resolve(null); }
    });
}

function saveToDB() {
    if (!db) return;
    try {
        var tx = db.transaction(['catalog', 'emails'], 'readwrite');
        tx.objectStore('catalog').put({ id: 'main', data: catalog });
        var es = tx.objectStore('emails');
        Object.keys(emailStore).forEach(function (id) {
            // Strip binary attachment data before storing (too large for IDB)
            var copy = Object.assign({}, emailStore[id]);
            copy.attachments = (copy.attachments || []).map(function (a) {
                var c = Object.assign({}, a);
                delete c.data;
                return c;
            });
            es.put(copy);
        });
    } catch (e) { console.warn('IDB save failed:', e); }
}

function loadFromDB() {
    if (!db) return Promise.resolve(false);
    return new Promise(function (resolve) {
        try {
            var tx = db.transaction(['catalog', 'emails'], 'readonly');
            var cr = tx.objectStore('catalog').get('main');
            cr.onsuccess = function () {
                if (!cr.result) return resolve(false);
                catalog = cr.result.data;
                var er = tx.objectStore('emails').getAll();
                er.onsuccess = function () {
                    (er.result || []).forEach(function (e) { emailStore[e.email_id] = e; });
                    resolve(true);
                };
                er.onerror = function () { resolve(true); };
            };
            cr.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
    });
}

function clearDB() {
    if (!db) return;
    try {
        var tx = db.transaction(['catalog', 'emails'], 'readwrite');
        tx.objectStore('catalog').clear();
        tx.objectStore('emails').clear();
    } catch (e) { /* ignore */ }
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
    var searchIcon = document.querySelector('.search-icon');
    if (searchIcon) searchIcon.innerHTML = ICON_SEARCH;

    await openDB();
    var loaded = await loadFromDB();

    if (loaded && catalog.sources && catalog.sources.length > 0) {
        hideWelcome();
        renderStats();
        renderSources(catalog.sources);
    }

    setupSearch();
    setupUpload();
    setupDragDrop();
}

/* ─── File handling ─── */

function showLoading(text) {
    document.getElementById('loading-text').textContent = text || 'Analisi in corso...';
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

function hideWelcome() {
    var wb = document.getElementById('welcome-box');
    if (wb) wb.style.display = 'none';
    var es = document.getElementById('empty-state');
    if (es && catalog.sources.length > 0) {
        es.querySelector('p') && (es.innerHTML = '<p>Seleziona un\'email dalla lista per visualizzarne il contenuto.</p>');
    }
}

function processFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.mbox')) {
        alert('Sono accettati solo file .mbox');
        return;
    }

    showLoading('Lettura di ' + file.name + '...');

    var reader = new FileReader();
    reader.onload = function (e) {
        showLoading('Analisi di ' + file.name + '...');
        // Use setTimeout to let the UI update before heavy parsing
        setTimeout(function () {
            try {
                var result = MboxParser.parseMboxFile(e.target.result, file.name);

                // Store emails
                Object.keys(result.emailDataMap).forEach(function (id) {
                    emailStore[id] = result.emailDataMap[id];
                });

                // Add source
                catalog.sources.push(result.source);
                catalog.total_sources = catalog.sources.length;
                catalog.total_emails = catalog.sources.reduce(function (s, src) {
                    return s + src.email_count;
                }, 0);

                hideWelcome();
                renderStats();
                renderSources(catalog.sources);
                saveToDB();
            } catch (err) {
                console.error('Parse error:', err);
                alert('Errore durante l\'analisi: ' + err.message);
            }
            hideLoading();
        }, 50);
    };
    reader.onerror = function () {
        hideLoading();
        alert('Errore nella lettura del file.');
    };
    reader.readAsText(file, 'iso-8859-1'); // lossless byte reading
}

function setupUpload() {
    var btn = document.getElementById('upload-btn');
    var input = document.getElementById('upload-input');

    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
        if (!input.files) return;
        for (var i = 0; i < input.files.length; i++) {
            processFile(input.files[i]);
        }
        input.value = '';
    });
}

function setupDragDrop() {
    var overlay = document.getElementById('drop-overlay');
    var counter = 0;

    document.addEventListener('dragenter', function (e) {
        e.preventDefault();
        counter++;
        overlay.classList.add('active');
    });
    document.addEventListener('dragleave', function (e) {
        e.preventDefault();
        counter--;
        if (counter <= 0) { overlay.classList.remove('active'); counter = 0; }
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
        e.preventDefault();
        counter = 0;
        overlay.classList.remove('active');
        if (e.dataTransfer && e.dataTransfer.files) {
            for (var i = 0; i < e.dataTransfer.files.length; i++) {
                processFile(e.dataTransfer.files[i]);
            }
        }
    });
}

/* ─── Source management ─── */

function handleDeleteSource(sourceId, sourceFile) {
    if (!confirm('Eliminare la sorgente "' + sourceFile + '" e tutti i dati associati?')) return;

    var target = null;
    var remaining = [];
    catalog.sources.forEach(function (s) {
        if (s.source_id === sourceId) target = s;
        else remaining.push(s);
    });
    if (!target) return;

    // Delete exclusive email data
    var removedIds = new Set();
    (target.emails_summary || []).forEach(function (e) { removedIds.add(e.email_id); });
    var keptIds = new Set();
    remaining.forEach(function (s) {
        (s.emails_summary || []).forEach(function (e) { keptIds.add(e.email_id); });
    });
    removedIds.forEach(function (id) {
        if (!keptIds.has(id)) delete emailStore[id];
    });

    catalog.sources = remaining;
    catalog.total_sources = remaining.length;
    catalog.total_emails = remaining.reduce(function (s, src) { return s + src.email_count; }, 0);

    renderStats();
    renderSources(catalog.sources);

    if (catalog.sources.length === 0) {
        var wb = document.getElementById('welcome-box');
        if (wb) wb.style.display = '';
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('email-detail').style.display = 'none';
        clearDB();
    } else {
        saveToDB();
    }
}

/* ─── Rendering ─── */

function renderStats() {
    var total = catalog.total_emails || 0;
    var n = catalog.total_sources || (catalog.sources ? catalog.sources.length : 0);
    document.getElementById('stats').textContent =
        total + ' email in ' + n + ' sorgent' + (n === 1 ? 'e' : 'i');
}

function renderSources(sources) {
    var container = document.getElementById('groups-list');
    container.innerHTML = '';

    if (!sources || sources.length === 0) {
        container.innerHTML = '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessuna sorgente disponibile.</div>';
        return;
    }

    var autoExpand = sources.length === 1;

    sources.forEach(function (source) {
        var sourceHeader = document.createElement('div');
        sourceHeader.className = 'source-header' + (autoExpand ? ' open' : '');
        sourceHeader.innerHTML =
            '<span class="source-arrow">&#9654;</span>' +
            '<div class="source-icon">' + ICON_INBOX + '</div>' +
            '<div class="source-info">' +
                '<span class="source-name" title="' + escapeHtml(source.source_file) + '">' + escapeHtml(source.source_file) + '</span>' +
                '<div class="source-meta">' +
                    '<span class="source-date">' + escapeHtml(source.uploaded_at || '') + '</span>' +
                    '<span class="source-count">' + source.email_count + ' email</span>' +
                '</div>' +
            '</div>' +
            '<button class="delete-source-btn" title="Elimina sorgente">' + ICON_TRASH + '</button>';

        var sourceContent = document.createElement('div');
        sourceContent.className = 'source-content' + (autoExpand ? ' open' : '');

        var summaryMap = {};
        (source.emails_summary || []).forEach(function (s) { summaryMap[s.email_id] = s; });

        (source.groups || []).forEach(function (group) {
            var header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML =
                '<span class="arrow">&#9654;</span>' +
                '<span class="group-label" title="' + escapeHtml(group.label) + '">' + escapeHtml(group.label) + '</span>' +
                '<span class="count">' + group.email_ids.length + '</span>';

            var emailsDiv = document.createElement('div');
            emailsDiv.className = 'group-emails';

            group.email_ids.forEach(function (eid) {
                var s = summaryMap[eid];
                if (!s) return;
                var item = document.createElement('div');
                item.className = 'email-item';
                item.dataset.emailId = eid;

                var senderName = s.sender;
                var atIdx = senderName.indexOf('@');
                if (atIdx > 0) senderName = senderName.substring(0, atIdx);
                senderName = senderName.charAt(0).toUpperCase() + senderName.slice(1);

                var badges = '';
                if (s.attachment_count > 0) {
                    badges = '<div class="email-badges"><span class="att-badge">' +
                        ICON_PAPERCLIP + ' ' + s.attachment_count + '</span></div>';
                }

                item.innerHTML =
                    '<div class="email-sender">' +
                        '<span class="email-sender-name">' + escapeHtml(senderName) + '</span>' +
                        '<span class="email-date">' + escapeHtml(s.date) + '</span>' +
                    '</div>' +
                    '<div class="email-subject">' + escapeHtml(s.subject) + '</div>' +
                    badges;

                item.addEventListener('click', function () { loadEmail(eid); });
                emailsDiv.appendChild(item);
            });

            header.addEventListener('click', function () {
                header.classList.toggle('open');
                emailsDiv.classList.toggle('open');
            });

            // Auto-open small groups
            if (group.email_ids.length <= 3) {
                header.classList.add('open');
                emailsDiv.classList.add('open');
            }

            sourceContent.appendChild(header);
            sourceContent.appendChild(emailsDiv);
        });

        sourceHeader.addEventListener('click', function (e) {
            if (e.target.closest('.delete-source-btn')) return;
            sourceHeader.classList.toggle('open');
            sourceContent.classList.toggle('open');
        });

        sourceHeader.querySelector('.delete-source-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleDeleteSource(source.source_id, source.source_file);
        });

        container.appendChild(sourceHeader);
        container.appendChild(sourceContent);
    });
}

/* ─── Email detail ─── */

function loadEmail(emailId) {
    document.querySelectorAll('.email-item.active').forEach(function (el) {
        el.classList.remove('active');
    });
    var active = document.querySelector('[data-email-id="' + emailId + '"]');
    if (active) active.classList.add('active');

    var email = emailStore[emailId];
    if (!email) return;

    currentEmailId = emailId;
    renderDetail(email);
}

function getInitials(sender) {
    if (!sender) return '?';
    var name = sender.split('@')[0] || '';
    var parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function renderDetail(email) {
    // Clean up previous blob URLs
    blobUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    blobUrls = [];

    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('email-detail').style.display = 'block';

    document.getElementById('sender-avatar').textContent = getInitials(email.sender);
    document.getElementById('detail-subject').textContent = email.subject;
    document.getElementById('detail-sender-line').innerHTML =
        '<strong>' + escapeHtml((email.sender || '').split('@')[0]) + '</strong> ' + escapeHtml(email.sender);
    document.getElementById('detail-recipients').textContent = (email.recipients || []).join(', ');
    document.getElementById('detail-date').textContent = email.date;
    document.getElementById('detail-provider').textContent = email.pec_provider || '-';
    document.getElementById('detail-source').textContent = email.source_file || '-';

    // Attachments
    var attSection = document.getElementById('attachments-section');
    var attList = document.getElementById('attachments-list');
    var realAtts = (email.attachments || []).filter(function (a) { return !a.is_inline; });

    if (realAtts.length > 0) {
        attSection.style.display = 'block';
        attList.innerHTML = '';
        realAtts.forEach(function (att) {
            var a = document.createElement('a');
            a.className = 'att-chip';
            if (att.data) {
                var blob = new Blob([att.data], { type: att.content_type || 'application/octet-stream' });
                var url = URL.createObjectURL(blob);
                blobUrls.push(url);
                a.href = url;
                a.download = att.filename;
            } else {
                a.href = '#';
                a.title = 'Allegato non disponibile (ricarica il file .mbox)';
            }
            a.innerHTML = ICON_FILE + ' ' + escapeHtml(att.filename) +
                ' <span class="att-size">' + formatSize(att.size) + '</span>';
            attList.appendChild(a);
        });
    } else {
        attSection.style.display = 'none';
    }

    // Body HTML — rewrite cid: references to blob URLs
    var bodyHtml = email.body_html;
    if (bodyHtml && email.attachments) {
        email.attachments.forEach(function (att) {
            if (att.content_id && att.data) {
                var blob = new Blob([att.data], { type: att.content_type || 'image/png' });
                var url = URL.createObjectURL(blob);
                blobUrls.push(url);
                bodyHtml = bodyHtml.split('cid:' + att.content_id).join(url);
            }
        });
    }

    var iframe = document.getElementById('body-iframe');
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    if (bodyHtml) {
        doc.open();
        doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif;font-size:14px;line-height:1.6;color:#333;padding:20px;margin:0;}img{max-width:100%;height:auto;}</style></head><body>' + bodyHtml + '</body></html>');
        doc.close();
        setTimeout(function () {
            try {
                var h = doc.documentElement.scrollHeight;
                iframe.style.height = Math.max(300, Math.min(h + 40, 800)) + 'px';
            } catch (e) {}
        }, 100);
    } else {
        doc.open();
        doc.write('<html><body><p style="color:#9ca3af;font-family:-apple-system,sans-serif;font-size:14px;">Nessun contenuto HTML disponibile.</p></body></html>');
        doc.close();
    }

    document.getElementById('body-text').textContent = email.body_text || '(Nessun testo disponibile)';
    switchTab('html');
}

/* ─── Search ─── */

function setupSearch() {
    var input = document.getElementById('search-input');
    var box = input.closest('.search-box');
    var clearBtn = document.getElementById('search-clear');
    var timer = null;

    function updateClearBtn() {
        box.classList.toggle('has-text', input.value.length > 0);
    }

    input.addEventListener('input', function () {
        clearTimeout(timer);
        updateClearBtn();
        var q = input.value.trim();
        timer = setTimeout(function () {
            if (q.length < 2) {
                renderSources(catalog.sources);
                document.getElementById('sidebar').classList.remove('search-active');
                return;
            }
            searchEmails(q);
        }, 300);
    });

    clearBtn.addEventListener('click', function () {
        input.value = '';
        updateClearBtn();
        input.focus();
        renderSources(catalog.sources);
        document.getElementById('sidebar').classList.remove('search-active');
    });
}

function searchEmails(query) {
    var q = query.toLowerCase();
    var allSummaries = [];
    catalog.sources.forEach(function (s) {
        (s.emails_summary || []).forEach(function (e) { allSummaries.push(e); });
    });

    var seen = {};
    var results = [];

    allSummaries.forEach(function (summary) {
        if (seen[summary.email_id]) return;
        var searchable = [summary.subject || '', summary.sender || '', summary.clean_subject || ''].join(' ').toLowerCase();
        if (searchable.indexOf(q) !== -1) {
            results.push(summary);
            seen[summary.email_id] = true;
            return;
        }
        // Search in body
        var email = emailStore[summary.email_id];
        if (email) {
            var body = [email.body_text || '', email.body_html || ''].join(' ').toLowerCase();
            if (body.indexOf(q) !== -1) {
                results.push(summary);
                seen[summary.email_id] = true;
            }
        }
    });

    if (results.length === 0) {
        document.getElementById('groups-list').innerHTML =
            '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessun risultato per "' +
            escapeHtml(query) + '"</div>';
        return;
    }

    var fakeSource = {
        source_id: 'search',
        source_file: results.length + ' risultati per "' + query + '"',
        uploaded_at: '',
        email_count: results.length,
        groups: [{ group_id: 'search', label: 'Risultati', email_ids: results.map(function (r) { return r.email_id; }) }],
        emails_summary: results,
    };
    renderSources([fakeSource]);
    document.getElementById('sidebar').classList.add('search-active');

    document.querySelectorAll('.source-header').forEach(function (h) { h.classList.add('open'); });
    document.querySelectorAll('.source-content').forEach(function (c) { c.classList.add('open'); });
    document.querySelectorAll('.group-header').forEach(function (h) { h.classList.add('open'); });
    document.querySelectorAll('.group-emails').forEach(function (g) { g.classList.add('open'); });
}

/* ─── Tab switching ─── */
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('tab-btn')) switchTab(e.target.dataset.tab);
});

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('tab-html').style.display = tab === 'html' ? 'block' : 'none';
    document.getElementById('tab-text').style.display = tab === 'text' ? 'block' : 'none';
}

/* ─── Utilities ─── */
function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}
