/* PEC Email Catalog - Frontend */

let catalog = null;
let currentEmailId = null;

/* SVG Icons */
var ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>';
var ICON_PAPERCLIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.986 3A2.743 2.743 0 009.243.257a2.743 2.743 0 00-1.94.803L2.549 5.814a3.621 3.621 0 005.122 5.122l3.374-3.374a.75.75 0 00-1.06-1.06L6.61 9.875a2.121 2.121 0 01-3.001-3.001l4.754-4.754a1.243 1.243 0 011.758 1.758l-4.753 4.754a.364.364 0 01-.515-.515l3.374-3.374a.75.75 0 00-1.06-1.06L3.793 7.057a1.864 1.864 0 002.636 2.636l4.753-4.754A2.743 2.743 0 0011.986 3z" clip-rule="evenodd"/></svg>';
var ICON_INBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M1 11.27c0-.246.033-.492.099-.73l1.523-5.521A2.75 2.75 0 015.273 3h9.454a2.75 2.75 0 012.651 2.019l1.523 5.52c.066.239.099.485.099.732V15.25A2.75 2.75 0 0116.25 18H3.75A2.75 2.75 0 011 15.25V11.27zm3.057-5.064L2.813 10.5h3.17a1.25 1.25 0 011.114.683l.445.89a.25.25 0 00.224.14h4.468a.25.25 0 00.223-.14l.445-.89a1.25 1.25 0 011.114-.682h3.17l-1.244-4.294a1.25 1.25 0 00-1.205-.918H5.273c-.556 0-1.043.368-1.197.918l-.019.069z" clip-rule="evenodd"/></svg>';
var ICON_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="att-icon"><path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V8.25L14.25 1.5H5.625z"/><path fill="white" opacity=".6" d="M14.25 1.5v5.25c0 .621.504 1.125 1.125 1.125h5.25"/></svg>';
var ICON_PDF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="att-icon"><path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V8.25L14.25 1.5H5.625z" fill="#E53E3E"/><path d="M14.25 1.5v5.25c0 .621.504 1.125 1.125 1.125h5.25" fill="#FC8181"/><text x="12" y="17" text-anchor="middle" font-size="7" font-weight="700" fill="white" font-family="Arial,sans-serif">PDF</text></svg>';
var ICON_IMG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="att-icon"><path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V8.25L14.25 1.5H5.625z" fill="#38A169"/><path d="M14.25 1.5v5.25c0 .621.504 1.125 1.125 1.125h5.25" fill="#68D391"/><text x="12" y="17" text-anchor="middle" font-size="6" font-weight="700" fill="white" font-family="Arial,sans-serif">IMG</text></svg>';

function getFileIcon(filename) {
    var ext = (filename || "").split(".").pop().toLowerCase();
    if (ext === "pdf") return ICON_PDF;
    if (["png","jpg","jpeg","gif","bmp","webp","svg"].indexOf(ext) !== -1) return ICON_IMG;
    return ICON_FILE;
}
var ICON_SEARCH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style="width:14px;height:14px"><path fill-rule="evenodd" d="M9.965 11.026a5 5 0 111.06-1.06l2.755 2.754a.75.75 0 11-1.06 1.06l-2.755-2.754zM10.5 7a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" clip-rule="evenodd"/></svg>';

document.addEventListener("DOMContentLoaded", init);

async function init() {
    try {
        // Replace emoji search icon with SVG
        var searchIcon = document.querySelector(".search-icon");
        if (searchIcon) searchIcon.innerHTML = ICON_SEARCH;

        const resp = await fetch("/api/catalog");
        catalog = await resp.json();
        renderStats();
        renderSources(catalog.sources);
        setupSearch();
        setupUpload();
    } catch (err) {
        console.error("Failed to load catalog:", err);
    }
}

async function reloadCatalog() {
    try {
        const resp = await fetch("/api/catalog");
        catalog = await resp.json();
        renderStats();
        renderSources(catalog.sources);
    } catch (err) {
        console.error("Failed to reload catalog:", err);
    }
}

function renderStats() {
    var total = catalog.total_emails || 0;
    var numSources = catalog.total_sources || (catalog.sources ? catalog.sources.length : 0);
    document.getElementById("stats").textContent =
        total + " email in " + numSources + " file";
}

function renderSources(sources) {
    var container = document.getElementById("groups-list");
    container.innerHTML = "";

    if (!sources || sources.length === 0) {
        container.innerHTML = '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessuna sorgente disponibile.</div>';
        return;
    }

    sources.forEach(function(source) {
        // Source header
        var sourceHeader = document.createElement("div");
        sourceHeader.className = "source-header";

        var arrow = '<span class="source-arrow">&#9654;</span>';
        var icon = '<div class="source-icon">' + ICON_INBOX + '</div>';
        var info = '<div class="source-info">' +
            '<span class="source-name" title="' + escapeHtml(source.source_file) + '">' + escapeHtml(source.source_file) + '</span>' +
            '<div class="source-meta">' +
                '<span class="source-date">' + escapeHtml(source.uploaded_at || "") + '</span>' +
                '<span class="source-count">' + source.email_count + ' email</span>' +
            '</div>' +
        '</div>';
        var deleteBtn = '<button class="delete-source-btn" data-source-id="' +
            escapeHtml(source.source_id) + '" title="Elimina sorgente">' + ICON_TRASH + '</button>';

        sourceHeader.innerHTML = arrow + icon + info + deleteBtn;

        // Source content (groups inside)
        var sourceContent = document.createElement("div");
        sourceContent.className = "source-content";

        // Build summary map for this source
        var summaryMap = {};
        (source.emails_summary || []).forEach(function(s) { summaryMap[s.email_id] = s; });

        // Render groups inside this source
        (source.groups || []).forEach(function(group) {
            var header = document.createElement("div");
            header.className = "group-header";
            header.innerHTML =
                '<span class="arrow">&#9654;</span>' +
                '<span class="group-label" title="' + escapeHtml(group.label) + '">' +
                    escapeHtml(group.label) +
                '</span>' +
                '<span class="count">' + group.email_ids.length + '</span>';

            var emailsDiv = document.createElement("div");
            emailsDiv.className = "group-emails";

            group.email_ids.forEach(function(eid) {
                var s = summaryMap[eid];
                if (!s) return;
                var item = document.createElement("div");
                item.className = "email-item";
                item.dataset.emailId = eid;

                // Extract sender display name
                var senderName = s.sender;
                var atIdx = senderName.indexOf("@");
                if (atIdx > 0) senderName = senderName.substring(0, atIdx);
                // Capitalize first letter
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

                item.addEventListener("click", function() { loadEmail(eid); });
                emailsDiv.appendChild(item);
            });

            header.addEventListener("click", function() {
                header.classList.toggle("open");
                emailsDiv.classList.toggle("open");
            });

            sourceContent.appendChild(header);
            sourceContent.appendChild(emailsDiv);
        });

        // Toggle source expansion
        sourceHeader.addEventListener("click", function(e) {
            if (e.target.closest(".delete-source-btn")) return;
            sourceHeader.classList.toggle("open");
            sourceContent.classList.toggle("open");
        });

        // Delete button handler
        var delBtn = sourceHeader.querySelector(".delete-source-btn");
        delBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            handleDeleteSource(source.source_id, source.source_file);
        });

        container.appendChild(sourceHeader);
        container.appendChild(sourceContent);
    });
}

async function handleDeleteSource(sourceId, sourceFile) {
    if (!confirm('Eliminare la sorgente "' + sourceFile + '" e tutti i dati associati?')) {
        return;
    }
    try {
        var resp = await fetch("/api/sources/" + sourceId, { method: "DELETE" });
        var data = await resp.json();
        if (data.error) {
            alert("Errore: " + data.error);
        } else {
            reloadCatalog();
        }
    } catch (err) {
        console.error("Delete failed:", err);
        alert("Eliminazione fallita.");
    }
}

async function loadEmail(emailId) {
    // Highlight active
    document.querySelectorAll(".email-item.active").forEach(function(el) {
        el.classList.remove("active");
    });
    var activeEl = document.querySelector('[data-email-id="' + emailId + '"]');
    if (activeEl) activeEl.classList.add("active");

    try {
        var resp = await fetch("/api/email/" + emailId);
        var data = await resp.json();
        currentEmailId = emailId;
        renderDetail(data);
    } catch (err) {
        console.error("Failed to load email:", err);
    }
}

function getInitials(sender) {
    if (!sender) return "?";
    // Try to get initials from name part before @
    var name = sender.split("@")[0] || "";
    // Split by dots or underscores
    var parts = name.split(/[._-]/);
    if (parts.length >= 2) {
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function renderDetail(email) {
    document.getElementById("empty-state").style.display = "none";
    var detail = document.getElementById("email-detail");
    detail.style.display = "block";

    // Build header with avatar
    var avatarEl = document.getElementById("sender-avatar");
    avatarEl.textContent = getInitials(email.sender);

    document.getElementById("detail-subject").textContent = email.subject;

    var senderLine = document.getElementById("detail-sender-line");
    senderLine.innerHTML = '<strong>' + escapeHtml(email.sender.split("@")[0]) + '</strong> ' +
        escapeHtml(email.sender);

    document.getElementById("detail-recipients").textContent = (email.recipients || []).join(", ");
    document.getElementById("detail-date").textContent = email.date;
    document.getElementById("detail-provider").textContent = email.pec_provider || "-";
    document.getElementById("detail-source").textContent = email.source_file || "-";

    // Attachments
    var attSection = document.getElementById("attachments-section");
    var attList = document.getElementById("attachments-list");
    var realAtts = (email.attachments || []).filter(function(a) { return !a.is_inline; });

    if (realAtts.length > 0) {
        attSection.style.display = "block";
        attList.innerHTML = "";
        realAtts.forEach(function(att) {
            var a = document.createElement("a");
            a.className = "att-chip";
            a.href = "/attachment/" + currentEmailId + "/" + encodeURIComponent(att.filename);
            a.target = "_blank";
            a.innerHTML = getFileIcon(att.filename) + ' ' + escapeHtml(att.filename) +
                ' <span class="att-size">' + formatSize(att.size) + '</span>';
            attList.appendChild(a);
        });
    } else {
        attSection.style.display = "none";
    }

    // Body
    var bodyHtml = email.body_html;
    var bodyText = email.body_text;

    // Rewrite cid: URLs in HTML to /inline/ endpoint
    if (bodyHtml && email.attachments) {
        email.attachments.forEach(function(att) {
            if (att.content_id) {
                var cidUrl = "cid:" + att.content_id;
                var inlineUrl = "/inline/" + currentEmailId + "/" + encodeURIComponent(att.filename);
                bodyHtml = bodyHtml.split(cidUrl).join(inlineUrl);
            }
        });
    }

    // Render HTML body in iframe
    var iframe = document.getElementById("body-iframe");
    if (bodyHtml) {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif;font-size:14px;line-height:1.6;color:#333;padding:20px;margin:0;}img{max-width:100%;height:auto;}</style></head><body>' + bodyHtml + '</body></html>');
        doc.close();
        setTimeout(function() {
            try {
                var h = doc.documentElement.scrollHeight;
                iframe.style.height = Math.max(300, Math.min(h + 40, 800)) + "px";
            } catch(e) {}
        }, 100);
    } else {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write('<html><body><p style="color:#9ca3af;font-family:-apple-system,sans-serif;font-size:14px;">Nessun contenuto HTML disponibile.</p></body></html>');
        doc.close();
    }

    // Text tab
    document.getElementById("body-text").textContent = bodyText || "(Nessun testo disponibile)";

    // Reset to HTML tab
    switchTab("html");
}

function setupSearch() {
    var input = document.getElementById("search-input");
    var box = input.closest(".search-box");
    var clearBtn = document.getElementById("search-clear");
    var timer = null;

    function updateClearBtn() {
        box.classList.toggle("has-text", input.value.length > 0);
    }

    input.addEventListener("input", function() {
        clearTimeout(timer);
        updateClearBtn();
        var q = input.value.trim();
        timer = setTimeout(function() {
            if (q.length < 2) {
                renderSources(catalog.sources);
                document.getElementById("sidebar").classList.remove("search-active");
                return;
            }
            searchEmails(q);
        }, 300);
    });

    clearBtn.addEventListener("click", function() {
        input.value = "";
        updateClearBtn();
        input.focus();
        renderSources(catalog.sources);
        document.getElementById("sidebar").classList.remove("search-active");
    });
}

function setupUpload() {
    var btn = document.getElementById("upload-btn");
    var input = document.getElementById("upload-input");

    btn.addEventListener("click", function() {
        input.click();
    });

    input.addEventListener("change", function() {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        var formData = new FormData();
        formData.append("file", file);

        btn.disabled = true;
        btn.textContent = "Caricamento...";

        fetch("/api/upload", { method: "POST", body: formData })
            .then(function(resp) { return resp.json(); })
            .then(function(data) {
                if (data.error) {
                    alert("Errore: " + data.error);
                } else {
                    reloadCatalog();
                }
            })
            .catch(function(err) {
                console.error("Upload failed:", err);
                alert("Upload fallito.");
            })
            .finally(function() {
                btn.disabled = false;
                btn.textContent = "Carica .mbox";
                input.value = "";
            });
    });
}

async function searchEmails(query) {
    try {
        var resp = await fetch("/api/search?q=" + encodeURIComponent(query));
        var data = await resp.json();
        var results = data.results || [];

        if (results.length === 0) {
            document.getElementById("groups-list").innerHTML =
                '<div style="padding:32px 20px;color:#9ca3af;text-align:center;font-size:13px;">Nessun risultato per "' +
                escapeHtml(query) + '"</div>';
            return;
        }

        var fakeSource = {
            source_id: "search",
            source_file: results.length + ' risultati per "' + query + '"',
            uploaded_at: "",
            email_count: results.length,
            groups: [{
                group_id: "search",
                label: "Risultati",
                email_ids: results.map(function(r) { return r.email_id; })
            }],
            emails_summary: results
        };
        renderSources([fakeSource]);
        document.getElementById("sidebar").classList.add("search-active");

        document.querySelectorAll(".source-header").forEach(function(h) { h.classList.add("open"); });
        document.querySelectorAll(".source-content").forEach(function(c) { c.classList.add("open"); });
        document.querySelectorAll(".group-header").forEach(function(h) { h.classList.add("open"); });
        document.querySelectorAll(".group-emails").forEach(function(g) { g.classList.add("open"); });
    } catch (err) {
        console.error("Search failed:", err);
    }
}

/* Tab switching */
document.addEventListener("click", function(e) {
    if (e.target.classList.contains("tab-btn")) {
        switchTab(e.target.dataset.tab);
    }
});

function switchTab(tab) {
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.getElementById("tab-html").style.display = tab === "html" ? "block" : "none";
    document.getElementById("tab-text").style.display = tab === "text" ? "block" : "none";
}

/* Utilities */
function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
}
