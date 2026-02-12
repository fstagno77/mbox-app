/* MBOX Archive — client-side SPA */

var catalog = { total_emails: 0, total_sources: 0, sources: [] };
var emailStore = {};          // email_id → metadata only (no body/attachments)
var currentEmailId = null;
var blobUrls = [];            // track created blob URLs for cleanup
var virtualList = null;       // VirtualList instance for sidebar
var openSources = {};         // source_id → true if expanded
var openGroups = {};          // group_id → true if expanded

/* ─── Search index (Lunr.js) ─── */
var searchIndex = null;

function buildSearchIndex() {
    var docs = [];
    (catalog.sources || []).forEach(function (source) {
        (source.emails_summary || []).forEach(function (s) {
            docs.push({
                id: s.email_id,
                subject: s.subject || '',
                sender: s.sender || '',
                clean_subject: s.clean_subject || ''
            });
        });
    });

    searchIndex = lunr(function () {
        this.ref('id');
        this.field('subject', { boost: 10 });
        this.field('clean_subject', { boost: 5 });
        this.field('sender', { boost: 3 });

        docs.forEach(function (doc) {
            this.add(doc);
        }, this);
    });
}

/* ─── LRU Cache for full email objects ─── */
var EMAIL_CACHE_SIZE = 50;
var emailCache = {};
var emailCacheOrder = [];

function cacheGet(emailId) {
    if (!emailCache[emailId]) return null;
    var idx = emailCacheOrder.indexOf(emailId);
    if (idx !== -1) emailCacheOrder.splice(idx, 1);
    emailCacheOrder.push(emailId);
    return emailCache[emailId];
}

function cachePut(emailId, email) {
    if (emailCache[emailId]) {
        var idx = emailCacheOrder.indexOf(emailId);
        if (idx !== -1) emailCacheOrder.splice(idx, 1);
    }
    emailCache[emailId] = email;
    emailCacheOrder.push(emailId);
    while (emailCacheOrder.length > EMAIL_CACHE_SIZE) {
        var evicted = emailCacheOrder.shift();
        delete emailCache[evicted];
    }
}

/* ─── SVG Icons ─── */
var ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>';
var ICON_PAPERCLIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.986 3A2.743 2.743 0 009.243.257a2.743 2.743 0 00-1.94.803L2.549 5.814a3.621 3.621 0 005.122 5.122l3.374-3.374a.75.75 0 00-1.06-1.06L6.61 9.875a2.121 2.121 0 01-3.001-3.001l4.754-4.754a1.243 1.243 0 011.758 1.758l-4.753 4.754a.364.364 0 01-.515-.515l3.374-3.374a.75.75 0 00-1.06-1.06L3.793 7.057a1.864 1.864 0 002.636 2.636l4.753-4.754A2.743 2.743 0 0011.986 3z" clip-rule="evenodd"/></svg>';
var ICON_INBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M1 11.27c0-.246.033-.492.099-.73l1.523-5.521A2.75 2.75 0 015.273 3h9.454a2.75 2.75 0 012.651 2.019l1.523 5.52c.066.239.099.485.099.732V15.25A2.75 2.75 0 0116.25 18H3.75A2.75 2.75 0 011 15.25V11.27zm3.057-5.064L2.813 10.5h3.17a1.25 1.25 0 011.114.683l.445.89a.25.25 0 00.224.14h4.468a.25.25 0 00.223-.14l.445-.89a1.25 1.25 0 011.114-.682h3.17l-1.244-4.294a1.25 1.25 0 00-1.205-.918H5.273c-.556 0-1.043.368-1.197.918l-.019.069z" clip-rule="evenodd"/></svg>';
var ICON_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="att-icon"><path d="M7 1a2 2 0 00-2 2v18a2 2 0 002 2h10a2 2 0 002-2V7l-6-6H7z" fill="#6B7280"/><path d="M13 1v4a2 2 0 002 2h4" fill="#D1D5DB"/></svg>';
var ICON_PDF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="att-icon"><path d="M7 1a2 2 0 00-2 2v18a2 2 0 002 2h10a2 2 0 002-2V7l-6-6H7z" fill="#DC2626"/><path d="M13 1v4a2 2 0 002 2h4" fill="#FCA5A5"/><text x="12" y="17.5" text-anchor="middle" font-size="7" font-weight="800" fill="white" font-family="Arial,sans-serif">PDF</text></svg>';
var ICON_IMG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="att-icon"><path d="M7 1a2 2 0 00-2 2v18a2 2 0 002 2h10a2 2 0 002-2V7l-6-6H7z" fill="#2563EB"/><path d="M13 1v4a2 2 0 002 2h4" fill="#93C5FD"/><circle cx="9.5" cy="12.5" r="1.5" fill="rgba(255,255,255,.6)"/><path d="M7 19l3-4 2 2.5 3-4L19 19H7z" fill="rgba(255,255,255,.85)"/></svg>';

function getFileIcon(filename) {
    var ext = (filename || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return ICON_PDF;
    if (['png','jpg','jpeg','gif','bmp','webp','svg'].indexOf(ext) !== -1) return ICON_IMG;
    return ICON_FILE;
}
var ICON_SEARCH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style="width:14px;height:14px"><path fill-rule="evenodd" d="M9.965 11.026a5 5 0 111.06-1.06l2.755 2.754a.75.75 0 11-1.06 1.06l-2.755-2.754zM10.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" clip-rule="evenodd"/></svg>';

/* ─── Remote API client (Netlify Functions + Blobs) ─── */
var API_BASE = '/.netlify/functions';

function apiCall(name, url, opts) {
    return fetch(url, opts).then(function (res) {
        console.log('[API ' + name + '] ' + (opts && opts.method || 'GET') + ' ' + url + ' → ' + res.status);
        return res;
    }).catch(function (e) {
        console.error('[API ' + name + '] NETWORK ERROR:', e);
        return null;
    });
}

var api = {
    getCatalog: function () {
        return apiCall('getCatalog', API_BASE + '/catalog').then(function (res) {
            if (!res || !res.ok) return null;
            return res.json();
        });
    },

    saveCatalog: function (catalogObj) {
        return apiCall('saveCatalog', API_BASE + '/catalog', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(catalogObj),
        });
    },

    getAllEmails: function () {
        return apiCall('getAllEmails', API_BASE + '/emails?all=true').then(function (res) {
            if (!res || !res.ok) return null;
            return res.json();
        });
    },

    saveEmails: function (emailsObj) {
        return apiCall('saveEmails', API_BASE + '/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails: emailsObj }),
        });
    },

    saveAttachments: function (emailId, attachments) {
        var toSend = attachments
            .filter(function (a) { return a.data && a.data.length < 4 * 1024 * 1024; })
            .map(function (a) {
                var binary = '';
                var bytes = a.data instanceof Uint8Array ? a.data : new Uint8Array(a.data);
                for (var i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return {
                    filename: a.filename,
                    content_type: a.content_type,
                    data: btoa(binary),
                };
            });
        if (toSend.length === 0) return Promise.resolve();
        return apiCall('saveAttachments', API_BASE + '/attachments?emailId=' + emailId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachments: toSend }),
        });
    },

    deleteSource: function (sourceId) {
        return apiCall('deleteSource', API_BASE + '/sources?id=' + sourceId, {
            method: 'DELETE',
        }).then(function (res) { return res && res.ok; });
    },
};

/* ─── IndexedDB persistence (local cache) ─── */
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

function saveCatalogToDB() {
    if (!db) return;
    try {
        var tx = db.transaction(['catalog'], 'readwrite');
        tx.objectStore('catalog').put({ id: 'main', data: catalog });
    } catch (e) { console.warn('IDB catalog save failed:', e); }
}

function saveEmailsToDB(emailDataMap) {
    if (!db) return;
    try {
        var tx = db.transaction(['emails'], 'readwrite');
        var es = tx.objectStore('emails');
        Object.keys(emailDataMap).forEach(function (id) {
            // Strip binary attachment data before storing (too large for IDB)
            var copy = Object.assign({}, emailDataMap[id]);
            copy.attachments = (copy.attachments || []).map(function (a) {
                var c = Object.assign({}, a);
                delete c.data;
                return c;
            });
            es.put(copy);
        });
    } catch (e) { console.warn('IDB emails save failed:', e); }
}

function saveToDB() {
    saveCatalogToDB();
}

function loadEmailFromDB(emailId) {
    if (!db) return Promise.resolve(null);
    return new Promise(function (resolve) {
        try {
            var tx = db.transaction(['emails'], 'readonly');
            var req = tx.objectStore('emails').get(emailId);
            req.onsuccess = function () { resolve(req.result || null); };
            req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
    });
}

function loadFromDB() {
    if (!db) return Promise.resolve(false);
    return new Promise(function (resolve) {
        try {
            var tx = db.transaction(['catalog'], 'readonly');
            var cr = tx.objectStore('catalog').get('main');
            cr.onsuccess = function () {
                if (!cr.result) return resolve(false);
                catalog = cr.result.data;
                populateStoreFromCatalog();
                resolve(true);
            };
            cr.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
    });
}

function populateStoreFromCatalog() {
    emailStore = {};
    (catalog.sources || []).forEach(function (source) {
        (source.emails_summary || []).forEach(function (s) {
            emailStore[s.email_id] = {
                email_id: s.email_id,
                subject: s.subject,
                sender: s.sender,
                date: s.date,
                clean_subject: s.clean_subject,
                attachment_count: s.attachment_count,
                pec_provider: s.pec_provider,
                source_file: s.source_file
            };
        });
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

/* ─── Mobile navigation ─── */

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function mobileShowDetail() {
    if (!isMobile()) return;
    document.querySelector('.main-layout').classList.add('mobile-detail-open');
    // Push history state so the hardware/browser back button works
    history.pushState({ mobileView: 'detail' }, '');
}

function mobileShowList() {
    document.querySelector('.main-layout').classList.remove('mobile-detail-open');
}

function setupMobileNav() {
    document.getElementById('mobile-back-btn').addEventListener('click', function () {
        mobileShowList();
    });

    window.addEventListener('popstate', function (e) {
        if (isMobile() && document.querySelector('.main-layout').classList.contains('mobile-detail-open')) {
            mobileShowList();
        }
    });

    // If window resizes from mobile to desktop, ensure clean state
    window.addEventListener('resize', function () {
        if (!isMobile()) {
            document.querySelector('.main-layout').classList.remove('mobile-detail-open');
        }
    });
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
    var searchIcon = document.querySelector('.search-icon');
    if (searchIcon) searchIcon.innerHTML = ICON_SEARCH;

    await openDB();

    // Try remote API first (shared state across devices)
    var remoteCatalog = await api.getCatalog();
    if (remoteCatalog !== null) {
        // API responded — trust remote as source of truth
        catalog = remoteCatalog;
        populateStoreFromCatalog();
        saveCatalogToDB();

        // Background: download full emails to IDB for offline access
        if (remoteCatalog.sources && remoteCatalog.sources.length > 0) {
            api.getAllEmails().then(function (remoteEmails) {
                if (remoteEmails) saveEmailsToDB(remoteEmails);
            });
        }
    } else {
        // API unreachable — fall back to local IndexedDB (offline mode)
        await loadFromDB();
    }

    if (catalog.sources && catalog.sources.length > 0) {
        hideWelcome();
        renderStats();
        renderSources(catalog.sources);
        buildSearchIndex();
    }

    setupSearch();
    setupUpload();
    setupDragDrop();
    setupMobileNav();
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

function handleParseResult(result) {
    // Store only metadata in emailStore; cache full emails in LRU
    Object.keys(result.emailDataMap).forEach(function (id) {
        var email = result.emailDataMap[id];
        emailStore[id] = {
            email_id: email.email_id,
            subject: email.subject,
            sender: email.sender,
            recipients: email.recipients,
            date: email.date,
            clean_subject: email.clean_subject,
            attachment_count: (email.attachments || []).length,
            pec_provider: email.pec_provider,
            source_file: email.source_file
        };
        cachePut(id, email);
    });

    // Clear "new" flag from previous sources
    catalog.sources.forEach(function (s) { s.isNew = false; });

    // Add source marked as new
    result.source.isNew = true;
    catalog.sources.push(result.source);
    catalog.total_sources = catalog.sources.length;
    catalog.total_emails = catalog.sources.reduce(function (s, src) {
        return s + src.email_count;
    }, 0);

    hideWelcome();
    renderStats();
    renderSources(catalog.sources);
    saveCatalogToDB();
    saveEmailsToDB(result.emailDataMap);
    searchIndex = null; // invalidate — will rebuild on next search

    // Sync to remote API (fire-and-forget)
    api.saveCatalog(catalog);
    var newEmails = {};
    Object.keys(result.emailDataMap).forEach(function (id) {
        var copy = Object.assign({}, result.emailDataMap[id]);
        copy.attachments = (copy.attachments || []).map(function (a) {
            var c = Object.assign({}, a); delete c.data; return c;
        });
        newEmails[id] = copy;
    });
    api.saveEmails(newEmails);
    // Save attachments per-email (binary data)
    Object.keys(result.emailDataMap).forEach(function (id) {
        var email = result.emailDataMap[id];
        if (email.attachments && email.attachments.some(function (a) { return a.data; })) {
            api.saveAttachments(id, email.attachments);
        }
    });
}

function processFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.mbox')) {
        alert('Sono accettati solo file .mbox');
        return;
    }

    showLoading('Lettura di ' + file.name + '...');

    var reader = new FileReader();
    reader.onload = function (e) {
        var text = e.target.result;
        showLoading('Analisi di ' + file.name + '...');

        if (typeof Worker !== 'undefined') {
            // Web Worker path — keeps UI responsive
            var worker = new Worker('js/parse-worker.js');
            worker.onmessage = function (msg) {
                var data = msg.data;
                if (data.type === 'result') {
                    try {
                        handleParseResult(data);
                    } catch (err) {
                        console.error('Post-parse error:', err);
                        alert('Errore durante l\'elaborazione: ' + err.message);
                    }
                } else if (data.type === 'error') {
                    console.error('Worker parse error:', data.message);
                    alert('Errore durante l\'analisi: ' + data.message);
                }
                hideLoading();
                worker.terminate();
            };
            worker.onerror = function (err) {
                console.error('Worker error:', err);
                alert('Errore nel worker di analisi: ' + (err.message || 'errore sconosciuto'));
                hideLoading();
                worker.terminate();
            };
            worker.postMessage({ type: 'parse', text: text, sourceFile: file.name });
        } else {
            // Fallback — synchronous parsing on main thread
            setTimeout(function () {
                try {
                    var result = MboxParser.parseMboxFile(text, file.name);
                    handleParseResult(result);
                } catch (err) {
                    console.error('Parse error:', err);
                    alert('Errore durante l\'analisi: ' + err.message);
                }
                hideLoading();
            }, 50);
        }
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

/* ─── Confirm modal ─── */

function showConfirmModal(message) {
    return new Promise(function (resolve) {
        var overlay = document.getElementById('confirm-overlay');
        var msg = document.getElementById('confirm-message');
        var btnOk = document.getElementById('confirm-ok');
        var btnCancel = document.getElementById('confirm-cancel');

        msg.textContent = message;
        overlay.classList.add('visible');
        btnOk.focus();

        function cleanup() {
            overlay.classList.remove('visible');
            btnOk.removeEventListener('click', onOk);
            btnCancel.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
        }
        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }
        function onBackdrop(e) { if (e.target === overlay) onCancel(); }
        function onKey(e) { if (e.key === 'Escape') onCancel(); }

        btnOk.addEventListener('click', onOk);
        btnCancel.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

/* ─── Source management ─── */

async function handleDeleteSource(sourceId, sourceFile) {
    var ok = await showConfirmModal('Eliminare la sorgente "' + sourceFile + '" e tutti i dati associati?');
    if (!ok) return;

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
        if (!keptIds.has(id)) {
            delete emailStore[id];
            delete emailCache[id];
            var ci = emailCacheOrder.indexOf(id);
            if (ci !== -1) emailCacheOrder.splice(ci, 1);
        }
    });

    catalog.sources = remaining;
    catalog.total_sources = remaining.length;
    catalog.total_emails = remaining.reduce(function (s, src) { return s + src.email_count; }, 0);

    renderStats();
    renderSources(catalog.sources);
    searchIndex = null; // invalidate search index

    // Sync deletion to remote API (two approaches for reliability)
    api.deleteSource(sourceId);
    api.saveCatalog(catalog);

    if (catalog.sources.length === 0) {
        var wb = document.getElementById('welcome-box');
        if (wb) wb.style.display = '';
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('email-detail').style.display = 'none';
        mobileShowList();
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

function flattenSources(sources) {
    var flat = [];
    if (!sources) return flat;

    sources.forEach(function (source) {
        var summaryMap = {};
        (source.emails_summary || []).forEach(function (s) { summaryMap[s.email_id] = s; });

        flat.push({
            type: 'source-header',
            _key: 'sh_' + source.source_id,
            source: source
        });

        if (!openSources[source.source_id]) return;

        (source.groups || []).forEach(function (group) {
            flat.push({
                type: 'group-header',
                _key: 'gh_' + source.source_id + '_' + group.group_id,
                group: group,
                sourceId: source.source_id
            });

            var gkey = source.source_id + '_' + group.group_id;
            if (!openGroups[gkey]) return;

            group.email_ids.forEach(function (eid) {
                var s = summaryMap[eid];
                if (!s) return;
                flat.push({
                    type: 'email-item',
                    _key: 'ei_' + eid,
                    summary: s,
                    emailId: eid
                });
            });
        });
    });
    return flat;
}

function initVirtualList() {
    var container = document.getElementById('groups-list');
    var scrollContainer = document.getElementById('sidebar');

    if (virtualList) virtualList.destroy();

    virtualList = new VirtualList(container, scrollContainer, {
        sourceHeader: function (item) {
            var source = item.source;
            var el = document.createElement('div');
            el.className = 'source-header' + (openSources[source.source_id] ? ' open' : '');
            el.dataset.sourceId = source.source_id;
            var newBadge = source.isNew ? '<span class="new-badge">New</span>' : '';
            el.innerHTML =
                '<span class="source-arrow">&#9654;</span>' +
                '<div class="source-icon">' + ICON_INBOX + '</div>' +
                '<div class="source-info">' +
                    '<span class="source-name" title="' + escapeHtml(source.source_file) + '">' + escapeHtml(source.source_file) + newBadge + '</span>' +
                    '<div class="source-meta">' +
                        '<span class="source-date">' + escapeHtml(source.uploaded_at || '') + '</span>' +
                        '<span class="source-count">' + source.email_count + ' email</span>' +
                    '</div>' +
                '</div>' +
                '<button class="delete-source-btn" title="Elimina sorgente">' + ICON_TRASH + '</button>';
            return el;
        },

        groupHeader: function (item) {
            var group = item.group;
            var gkey = item.sourceId + '_' + group.group_id;
            var el = document.createElement('div');
            el.className = 'group-header' + (openGroups[gkey] ? ' open' : '');
            el.dataset.sourceId = item.sourceId;
            el.dataset.groupId = group.group_id;
            el.innerHTML =
                '<span class="arrow">&#9654;</span>' +
                '<span class="group-label" title="' + escapeHtml(group.label) + '">' + escapeHtml(group.label) + '</span>' +
                '<span class="count">' + group.email_ids.length + '</span>';
            return el;
        },

        emailItem: function (item) {
            var s = item.summary;
            var el = document.createElement('div');
            el.className = 'email-item' + (currentEmailId === item.emailId ? ' active' : '');
            el.dataset.emailId = item.emailId;

            var senderName = s.sender;
            var atIdx = senderName.indexOf('@');
            if (atIdx > 0) senderName = senderName.substring(0, atIdx);
            senderName = senderName.charAt(0).toUpperCase() + senderName.slice(1);

            var badges = '';
            if (s.attachment_count > 0) {
                badges = '<div class="email-badges"><span class="att-badge">' +
                    ICON_PAPERCLIP + ' ' + s.attachment_count + '</span></div>';
            }

            el.innerHTML =
                '<div class="email-sender">' +
                    '<span class="email-sender-name">' + escapeHtml(senderName) + '</span>' +
                    '<span class="email-date">' + escapeHtml(s.date) + '</span>' +
                '</div>' +
                '<div class="email-subject">' + escapeHtml(s.subject) + '</div>' +
                badges;
            return el;
        }
    });

    // Event delegation for clicks on the container
    container.addEventListener('click', function (e) {
        var target = e.target;

        // Delete source button
        var deleteBtn = target.closest('.delete-source-btn');
        if (deleteBtn) {
            e.stopPropagation();
            var srcHeader = deleteBtn.closest('.source-header');
            if (srcHeader) handleDeleteSource(srcHeader.dataset.sourceId,
                catalog.sources.filter(function (s) { return s.source_id === srcHeader.dataset.sourceId; })[0].source_file);
            return;
        }

        // Source header toggle
        var srcH = target.closest('.source-header');
        if (srcH) {
            var sid = srcH.dataset.sourceId;
            openSources[sid] = !openSources[sid];
            // Auto-open small groups when source is opened
            if (openSources[sid]) {
                var src = _currentSources.filter(function (s) { return s.source_id === sid; })[0];
                if (src) {
                    (src.groups || []).forEach(function (g) {
                        var gk = sid + '_' + g.group_id;
                        if (!(gk in openGroups) && g.email_ids.length <= 3) openGroups[gk] = true;
                    });
                }
            }
            rebuildVirtualList();
            return;
        }

        // Group header toggle
        var grpH = target.closest('.group-header');
        if (grpH) {
            var gkey = grpH.dataset.sourceId + '_' + grpH.dataset.groupId;
            openGroups[gkey] = !openGroups[gkey];
            rebuildVirtualList();
            return;
        }

        // Email item click
        var emailItem = target.closest('.email-item');
        if (emailItem && emailItem.dataset.emailId) {
            loadEmail(emailItem.dataset.emailId);
            return;
        }
    });
}

var _currentSources = [];

function rebuildVirtualList() {
    if (!virtualList) return;
    var flat = flattenSources(_currentSources);
    virtualList.setData(flat);
}

function renderSources(sources) {
    _currentSources = sources || [];
    var container = document.getElementById('groups-list');

    if (!sources || sources.length === 0) {
        if (virtualList) virtualList.destroy();
        virtualList = null;
        container.style.position = '';
        container.style.height = '';
        container.innerHTML = '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessuna sorgente disponibile.</div>';
        return;
    }

    // Auto-open new sources and their small groups
    sources.forEach(function (source) {
        if (source.isNew || !(source.source_id in openSources)) {
            openSources[source.source_id] = true;
        }
        if (openSources[source.source_id]) {
            (source.groups || []).forEach(function (g) {
                var gk = source.source_id + '_' + g.group_id;
                if (!(gk in openGroups) && g.email_ids.length <= 3) {
                    openGroups[gk] = true;
                }
            });
        }
    });

    if (!virtualList) initVirtualList();
    rebuildVirtualList();
}

/* ─── Email detail ─── */

async function loadEmail(emailId) {
    // Update active state in virtual list
    document.querySelectorAll('.email-item.active').forEach(function (el) {
        el.classList.remove('active');
    });
    var active = document.querySelector('[data-email-id="' + emailId + '"]');
    if (active) active.classList.add('active');

    currentEmailId = emailId;
    mobileShowDetail();

    // 1. LRU cache
    var email = cacheGet(emailId);
    if (email && email.body_html !== undefined) {
        renderDetail(email);
        return;
    }

    // 2. IndexedDB
    email = await loadEmailFromDB(emailId);
    if (email) {
        cachePut(emailId, email);
        renderDetail(email);
        return;
    }

    // 3. Fallback: metadata from emailStore
    renderDetail(emailStore[emailId] || { email_id: emailId, subject: '(Caricamento...)' });
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
                // Fallback: download from remote API
                a.href = '/.netlify/functions/attachments?emailId=' + email.email_id + '&filename=' + encodeURIComponent(att.filename);
                a.download = att.filename;
            }
            a.innerHTML = getFileIcon(att.filename) + ' ' + escapeHtml(att.filename) +
                ' <span class="att-size">' + formatSize(att.size) + '</span>';
            attList.appendChild(a);
        });
    } else {
        attSection.style.display = 'none';
    }

    // Body HTML — rewrite cid: references to blob URLs or API fallback
    var bodyHtml = email.body_html;
    if (bodyHtml && email.attachments) {
        email.attachments.forEach(function (att) {
            if (att.content_id) {
                var imgUrl;
                if (att.data) {
                    var blob = new Blob([att.data], { type: att.content_type || 'image/png' });
                    imgUrl = URL.createObjectURL(blob);
                    blobUrls.push(imgUrl);
                } else {
                    // Fallback: use remote API for inline images
                    imgUrl = '/.netlify/functions/attachments?emailId=' + email.email_id + '&filename=' + encodeURIComponent(att.filename);
                }
                bodyHtml = bodyHtml.split('cid:' + att.content_id).join(imgUrl);
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
    if (!searchIndex) buildSearchIndex();

    var lunrResults;
    try {
        lunrResults = searchIndex.search(query + '*');
    } catch (e) {
        try {
            lunrResults = searchIndex.search(query.replace(/[:\*\~\^]/g, ''));
        } catch (e2) {
            lunrResults = [];
        }
    }

    // Map Lunr results to summary objects
    var resultIds = {};
    lunrResults.forEach(function (r) { resultIds[r.ref] = true; });

    var summaries = [];
    var seen = {};
    (catalog.sources || []).forEach(function (s) {
        (s.emails_summary || []).forEach(function (e) {
            if (resultIds[e.email_id] && !seen[e.email_id]) {
                summaries.push(e);
                seen[e.email_id] = true;
            }
        });
    });

    if (summaries.length === 0) {
        if (virtualList) virtualList.destroy();
        virtualList = null;
        var gl = document.getElementById('groups-list');
        gl.style.position = '';
        gl.style.height = '';
        gl.innerHTML =
            '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessun risultato per "' +
            escapeHtml(query) + '"</div>';
        return;
    }

    var fakeSource = {
        source_id: 'search',
        source_file: summaries.length + ' risultati per "' + query + '"',
        uploaded_at: '',
        email_count: summaries.length,
        groups: [{ group_id: 'search', label: 'Risultati', email_ids: summaries.map(function (r) { return r.email_id; }) }],
        emails_summary: summaries,
    };

    // Auto-open search results in the virtual list
    openSources['search'] = true;
    openGroups['search_search'] = true;

    renderSources([fakeSource]);
    document.getElementById('sidebar').classList.add('search-active');
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
