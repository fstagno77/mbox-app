/* MBOX Archive — client-side SPA */

var SOURCE_BATCH_SIZE = 5;          // parallel source downloads during init
var SEARCH_DEBOUNCE_MS = 300;       // debounce delay for search input

var catalog = { total_emails: 0, total_sources: 0, sources: [] };
var emailStore = {};          // email_id → metadata only (no body/attachments)
var currentEmailId = null;
var blobUrls = [];            // track created blob URLs for cleanup
var virtualList = null;       // VirtualList instance for sidebar
var openSources = {};         // source_id → true if expanded
var openGroups = {};          // group_id → true if expanded
var activeSourceId = null;    // source_id containing the currently viewed email
var activeGroupKey = null;    // "source_id_group_id" containing the currently viewed email
var currentSort = 'date';     // 'date' or 'alpha'
var currentSortDir = 'desc';  // 'asc' or 'desc'

/* ─── Persist accordion state in localStorage ─── */
function loadAccordionState() {
    try {
        var s = localStorage.getItem('mbox-openSources');
        var g = localStorage.getItem('mbox-openGroups');
        if (s) openSources = JSON.parse(s);
        if (g) openGroups = JSON.parse(g);
    } catch (e) { /* ignore corrupt data */ }
}

function saveAccordionState() {
    try {
        localStorage.setItem('mbox-openSources', JSON.stringify(openSources));
        localStorage.setItem('mbox-openGroups', JSON.stringify(openGroups));
    } catch (e) { /* ignore quota errors */ }
}

/* ─── Search index (Lunr.js) ─── */
var searchIndex = null;

function expandAttachmentNames(names) {
    var parts = [];
    (names || []).forEach(function (fn) {
        if (!fn) return;
        parts.push(fn);                         // "fattura.pdf"
        var dot = fn.lastIndexOf('.');
        if (dot > 0) {
            parts.push(fn.substring(0, dot));    // "fattura"
            parts.push(fn.substring(dot + 1));   // "pdf"
        }
    });
    return parts.join(' ');
}

function expandSender(sender) {
    if (!sender) return '';
    // "fatture@fornitore.it" → "fatture@fornitore.it fatture fornitore"
    // Lunr tokenizes on whitespace/hyphens only, so "@" and "." stay inside tokens.
    // Expanding lets users search by domain or local part.
    var parts = [sender];
    sender.split(/[@.]+/).forEach(function (t) {
        if (t && t.length > 1) parts.push(t);
    });
    return parts.join(' ');
}

function buildSearchIndex() {
    var docs = [];
    (catalog.sources || []).forEach(function (source) {
        (source.emails_summary || []).forEach(function (s) {
            docs.push({
                id: s.email_id,
                subject: s.subject || '',
                sender: expandSender(s.sender),
                clean_subject: s.clean_subject || '',
                attachments: expandAttachmentNames(s.attachment_names)
            });
        });
    });

    searchIndex = lunr(function () {
        // Remove the English stemmer — the content is Italian, and the Porter
        // stemmer mangles Italian words causing search misses.
        this.pipeline.remove(lunr.stemmer);
        this.searchPipeline.remove(lunr.stemmer);

        this.ref('id');
        this.field('subject', { boost: 10 });
        this.field('clean_subject', { boost: 5 });
        this.field('sender', { boost: 3 });
        this.field('attachments', { boost: 2 });

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

/* ─── Version & Changelog ─── */
var APP_VERSION = '0.3';

var CHANGELOG = [
    {
        version: '0.3',
        date: 'Febbraio 2026',
        changes: [
            'Ricerca estesa: ora puoi cercare le email anche per nome dei file allegati (es. "fattura.pdf")',
            'Ricerca pi\u00f9 precisa: trova correttamente parole dentro date e codici (es. "2026" in "12/2026")',
            'Ordinamento sorgenti per data di caricamento o nome file',
            'Le sezioni aperte nella lista vengono ricordate tra una visita e l\'altra',
            'Indicazione visiva dell\'email e del gruppo attualmente selezionato',
            'Caricamento progressivo: gli archivi con molte sorgenti si aprono pi\u00f9 velocemente',
            'Nuova navigazione a schermo intero su dispositivi mobili',
        ]
    }
];

function renderChangelogContent() {
    var html = '';
    CHANGELOG.forEach(function (entry) {
        html += '<div class="changelog-version">' +
            '<div class="changelog-version-title">v' + entry.version + '</div>' +
            '<div class="changelog-version-date">' + entry.date + '</div>' +
            '<ul>';
        entry.changes.forEach(function (c) {
            html += '<li>' + c + '</li>';
        });
        html += '</ul></div>';
    });
    return html;
}

function showChangelogModal() {
    var overlay = document.getElementById('changelog-overlay');
    var body = document.getElementById('changelog-body');
    body.innerHTML = renderChangelogContent();
    overlay.classList.add('visible');

    function close() {
        overlay.classList.remove('visible');
        overlay.removeEventListener('click', onBackdrop);
        document.getElementById('changelog-close').removeEventListener('click', close);
        document.getElementById('changelog-cta').removeEventListener('click', close);
        document.removeEventListener('keydown', onKey);
    }
    function onBackdrop(e) { if (e.target === overlay) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    document.getElementById('changelog-close').addEventListener('click', close);
    document.getElementById('changelog-cta').addEventListener('click', close);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
}

function checkChangelog() {
    var lastSeen = localStorage.getItem('mbox-changelog-version');
    if (lastSeen !== APP_VERSION) {
        showChangelogModal();
        localStorage.setItem('mbox-changelog-version', APP_VERSION);
    }
}

function setupChangelog() {
    document.getElementById('changelog-link').addEventListener('click', function (e) {
        e.preventDefault();
        showChangelogModal();
    });
    checkChangelog();
}

/* ─── Remote API client (Netlify Functions + Blobs) ─── */
var API_BASE = '/.netlify/functions';

function apiCall(name, url, opts) {
    return fetch(url, opts).then(function (res) {
        return res;
    }).catch(function (e) {
        console.error('[API ' + name + '] NETWORK ERROR:', e);
        return null;
    });
}

var api = {
    getCatalogMeta: function () {
        return apiCall('getCatalogMeta', API_BASE + '/catalog').then(function (res) {
            if (!res || !res.ok) return null;
            return res.json();
        });
    },

    getCatalogSource: function (sourceId) {
        return apiCall('getCatalogSource', API_BASE + '/catalog?sourceId=' + sourceId).then(function (res) {
            if (!res || !res.ok) return null;
            return res.json();
        });
    },

    saveCatalogMeta: function (meta) {
        return apiCall('saveCatalogMeta', API_BASE + '/catalog', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(meta),
        });
    },

    saveCatalogSource: function (sourceId, source) {
        return apiCall('saveCatalogSource', API_BASE + '/catalog?sourceId=' + sourceId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(source),
        });
    },

    deleteCatalogSource: function (sourceId) {
        return apiCall('deleteCatalogSource', API_BASE + '/catalog?sourceId=' + sourceId, {
            method: 'DELETE',
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
                attachment_names: s.attachment_names || [],
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

    loadAccordionState();
    await openDB();

    // Try remote API first (shared state across devices)
    var meta = await api.getCatalogMeta();
    if (meta !== null && meta.source_ids && meta.source_ids.length > 0) {
        // API responded with paginated catalog
        catalog.total_emails = meta.total_emails || 0;
        catalog.total_sources = meta.total_sources || 0;
        catalog.sources = [];
        renderStats();

        // Download sources in parallel batches of 5
        for (var i = 0; i < meta.source_ids.length; i += SOURCE_BATCH_SIZE) {
            var batch = meta.source_ids.slice(i, i + SOURCE_BATCH_SIZE);
            var sources = await Promise.all(batch.map(function (sid) {
                return api.getCatalogSource(sid);
            }));
            sources.forEach(function (s) {
                if (s) {
                    catalog.sources.push(s);
                    (s.emails_summary || []).forEach(function (e) {
                        emailStore[e.email_id] = {
                            email_id: e.email_id,
                            subject: e.subject,
                            sender: e.sender,
                            date: e.date,
                            clean_subject: e.clean_subject,
                            attachment_count: e.attachment_count,
                            attachment_names: e.attachment_names || [],
                            pec_provider: e.pec_provider,
                            source_file: e.source_file
                        };
                    });
                }
            });
            // Progressive rendering
            hideWelcome();
            renderSources(catalog.sources);
        }

        saveCatalogToDB();
    } else if (meta !== null && meta.sources) {
        // Old monolithic format from API (retrocompat)
        catalog = meta;
        populateStoreFromCatalog();
        saveCatalogToDB();
    } else if (meta !== null) {
        // Empty catalog from API
        catalog = { total_emails: 0, total_sources: 0, sources: [] };
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

    setupSidebarClickHandler();
    setupSearch();
    setupSort();
    setupUpload();
    setupDragDrop();
    setupMobileNav();
    setupChangelog();
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
        var attNames = (email.attachments || [])
            .filter(function (a) { return !a.is_inline; })
            .map(function (a) { return a.filename; });
        emailStore[id] = {
            email_id: email.email_id,
            subject: email.subject,
            sender: email.sender,
            recipients: email.recipients,
            date: email.date,
            clean_subject: email.clean_subject,
            attachment_count: (email.attachments || []).length,
            attachment_names: attNames,
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

    // Sync to remote API (fire-and-forget, incremental)
    var sourceId = result.source.source_id;
    api.saveCatalogSource(sourceId, result.source);
    api.saveCatalogMeta({
        total_emails: catalog.total_emails,
        total_sources: catalog.total_sources,
        source_ids: catalog.sources.map(function (s) { return s.source_id; })
    });
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

    // Sync deletion to remote API — sources endpoint handles cascade cleanup
    api.deleteSource(sourceId);

    if (catalog.sources.length === 0) {
        var wb = document.getElementById('welcome-box');
        if (wb) wb.style.display = '';
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('email-detail').style.display = 'none';
        mobileShowList();
        clearDB();
    } else {
        saveCatalogToDB();
    }
}

/* ─── Rendering ─── */

function renderStats() {
    var total = catalog.total_emails || 0;
    var n = catalog.total_sources || (catalog.sources ? catalog.sources.length : 0);
    document.getElementById('stats').textContent =
        total + ' email in ' + n + ' sorgent' + (n === 1 ? 'e' : 'i');
}

function sortSources(sources) {
    var sorted = sources.slice();
    var dir = currentSortDir === 'asc' ? 1 : -1;
    if (currentSort === 'alpha') {
        sorted.sort(function (a, b) {
            return dir * (a.source_file || '').localeCompare(b.source_file || '');
        });
    } else {
        sorted.sort(function (a, b) {
            return dir * ((a._uploaded_ts || 0) - (b._uploaded_ts || 0));
        });
    }
    return sorted;
}

// Parse "dd/mm/yyyy HH:MM" into a comparable numeric value
function parseDateDDMMYYYY(str) {
    if (!str) return 0;
    var m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!m) return 0;
    // yyyyMMddHHmm as number for fast comparison
    return (+m[3]) * 100000000 + (+m[2]) * 1000000 + (+m[1]) * 10000 + (+m[4]) * 100 + (+m[5]);
}

function flattenSources(sources) {
    var flat = [];
    if (!sources) return flat;

    var sorted = sortSources(sources);
    var dateSort = currentSort === 'date';
    var dateDir = currentSortDir === 'asc' ? 1 : -1;

    sorted.forEach(function (source) {
        var summaryMap = {};
        (source.emails_summary || []).forEach(function (s) { summaryMap[s.email_id] = s; });

        flat.push({
            type: 'source-header',
            _key: 'sh_' + source.source_id,
            source: source
        });

        if (!openSources[source.source_id]) return;

        var groups = (source.groups || []).slice();
        if (dateSort) {
            // Sort groups by the most recent email date in the group
            groups.sort(function (a, b) {
                var aDate = 0, bDate = 0;
                a.email_ids.forEach(function (id) {
                    var s = summaryMap[id];
                    if (s) { var d = parseDateDDMMYYYY(s.date); if (d > aDate) aDate = d; }
                });
                b.email_ids.forEach(function (id) {
                    var s = summaryMap[id];
                    if (s) { var d = parseDateDDMMYYYY(s.date); if (d > bDate) bDate = d; }
                });
                return dateDir * (aDate - bDate);
            });
        }

        groups.forEach(function (group) {
            flat.push({
                type: 'group-header',
                _key: 'gh_' + source.source_id + '_' + group.group_id,
                group: group,
                sourceId: source.source_id
            });

            var gkey = source.source_id + '_' + group.group_id;
            if (!openGroups[gkey]) return;

            var eids = group.email_ids;
            if (dateSort) {
                eids = eids.slice().sort(function (a, b) {
                    var sa = summaryMap[a], sb = summaryMap[b];
                    return dateDir * (parseDateDDMMYYYY(sa && sa.date) - parseDateDDMMYYYY(sb && sb.date));
                });
            }

            eids.forEach(function (eid) {
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
    var scrollContainer = document.getElementById('sidebar-content');

    if (virtualList) virtualList.destroy();

    virtualList = new VirtualList(container, scrollContainer, {
        sourceHeader: function (item) {
            var source = item.source;
            var el = document.createElement('div');
            el.className = 'source-header' + (openSources[source.source_id] ? ' open' : '') + (activeSourceId === source.source_id ? ' has-active' : '');
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
            el.className = 'group-header' + (openGroups[gkey] ? ' open' : '') + (activeGroupKey === gkey ? ' has-active' : '');
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
}

function setupSidebarClickHandler() {
    var container = document.getElementById('groups-list');
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
            saveAccordionState();
            rebuildVirtualList();
            return;
        }

        // Group header toggle
        var grpH = target.closest('.group-header');
        if (grpH) {
            var gkey = grpH.dataset.sourceId + '_' + grpH.dataset.groupId;
            openGroups[gkey] = !openGroups[gkey];
            saveAccordionState();
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

    if (!virtualList) initVirtualList();
    rebuildVirtualList();
}

/* ─── Email detail ─── */

function updateActiveAncestors(emailId) {
    activeSourceId = null;
    activeGroupKey = null;
    if (!emailId) return;
    (_currentSources || []).forEach(function (source) {
        (source.groups || []).forEach(function (group) {
            if (group.email_ids.indexOf(emailId) !== -1) {
                activeSourceId = source.source_id;
                activeGroupKey = source.source_id + '_' + group.group_id;
            }
        });
    });
}

async function loadEmail(emailId) {
    currentEmailId = emailId;
    updateActiveAncestors(emailId);

    // Refresh virtual list to update active indicators
    rebuildVirtualList();

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
        }, SEARCH_DEBOUNCE_MS);
    });

    clearBtn.addEventListener('click', function () {
        input.value = '';
        updateClearBtn();
        input.focus();
        renderSources(catalog.sources);
        document.getElementById('sidebar').classList.remove('search-active');
    });
}

var SORT_ICON_DESC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">' +
    '<path d="M3.5 2a.5.5 0 0 1 .5.5v9.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L3 12.293V2.5a.5.5 0 0 1 .5-.5z"/>' +
    '<path d="M7.5 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1h-1zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zm0 3a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 3a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7z"/></svg>';

var SORT_ICON_ASC = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="14" height="14">' +
    '<path d="M3.5 14a.5.5 0 0 1-.5-.5V3.707L1.854 4.854a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L4 3.707V13.5a.5.5 0 0 1-.5.5z"/>' +
    '<path d="M7.5 3a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 3a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zm0 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1h-1z"/></svg>';

function setupSort() {
    var trigger = document.getElementById('sort-trigger');
    var popup = document.getElementById('sort-popup');
    if (!trigger || !popup) return;

    function updateTriggerIcon() {
        trigger.innerHTML = currentSortDir === 'asc' ? SORT_ICON_ASC : SORT_ICON_DESC;
    }

    function updatePopup() {
        popup.querySelectorAll('.sort-option').forEach(function (opt) {
            var mode = opt.getAttribute('data-sort');
            opt.classList.toggle('active', mode === currentSort);
            var arrow = opt.querySelector('.sort-option-arrow');
            if (arrow) {
                arrow.textContent = mode === currentSort
                    ? (currentSortDir === 'asc' ? '\u2191' : '\u2193')
                    : '';
            }
        });
    }

    function closePopup() {
        popup.classList.remove('open');
        document.removeEventListener('click', onOutside, true);
    }

    function onOutside(e) {
        if (!popup.contains(e.target) && !trigger.contains(e.target)) closePopup();
    }

    trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = popup.classList.toggle('open');
        if (isOpen) {
            updatePopup();
            document.addEventListener('click', onOutside, true);
        } else {
            document.removeEventListener('click', onOutside, true);
        }
    });

    popup.addEventListener('click', function (e) {
        var opt = e.target.closest('.sort-option');
        if (!opt) return;
        var mode = opt.getAttribute('data-sort');
        if (mode === currentSort) {
            currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort = mode;
            currentSortDir = mode === 'date' ? 'desc' : 'asc';
        }
        updatePopup();
        updateTriggerIcon();
        rebuildVirtualList();
        closePopup();
    });

    updateTriggerIcon();
}

function searchEmails(query) {
    if (!searchIndex) {
        try { buildSearchIndex(); } catch (e) { console.error('buildSearchIndex failed:', e); }
    }
    if (!searchIndex) return [];

    var safeQuery = query.replace(/[:\*\~\^]/g, '');
    var lunrResults = [];

    // Wildcard prefix search — stemmer is disabled so tokens are stored as-is,
    // and "circolare*" correctly matches "circolare" in the index.
    try {
        lunrResults = searchIndex.search(safeQuery + '*');
    } catch (e) { /* ignore parse errors */ }

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

    // Always merge substring matches so tokens Lunr's tokenizer misses
    // (e.g. "2026" inside "12/2026", words joined by special chars) are found.
    if (safeQuery.length >= 2) {
        var lower = safeQuery.toLowerCase();
        (catalog.sources || []).forEach(function (s) {
            (s.emails_summary || []).forEach(function (e) {
                if (seen[e.email_id]) return;
                var hay = ((e.subject || '') + ' ' + (e.clean_subject || '') + ' ' + (e.sender || '') + ' ' + (e.attachment_names || []).join(' ')).toLowerCase();
                if (hay.indexOf(lower) !== -1) {
                    summaries.push(e);
                    seen[e.email_id] = true;
                }
            });
        });
    }

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
