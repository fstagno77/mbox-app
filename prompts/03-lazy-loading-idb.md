# Prompt 03 — Lazy loading dei body email da IndexedDB

## Contesto

Attualmente l'app carica **tutte** le email in memoria nell'oggetto globale `emailStore` (`app.js:4`). Ogni email contiene `body_text`, `body_html` e l'array `attachments` (con `data` binari per le email parsate localmente). Con 10.000 email, questo puo' occupare 50-100+ MB di RAM.

Il flusso attuale:
1. `init()` → scarica tutto da API remota (`api.getAllEmails()`) oppure da IndexedDB (`loadFromDB()`) → tutto finisce in `emailStore`
2. `loadEmail(emailId)` → legge `emailStore[emailId]` → renderizza il dettaglio
3. `searchEmails(query)` → itera su `emailStore` per cercare nei body
4. `saveToDB()` → salva tutto in IndexedDB (ma strippando `data` dagli attachment)

## Obiettivo

Implementare un sistema di **lazy loading** dove:
- Il catalogo e i **metadati** delle email (subject, sender, date, attachment_count) restano in memoria
- I **body** (`body_text`, `body_html`) e gli **attachment metadata** vengono caricati da IndexedDB **on-demand** quando l'utente clicca su un'email
- Una **LRU cache** in memoria tiene le ultime N email complete per evitare latenza su navigazione avanti/indietro

## Specifiche di implementazione

### 1. Separare i dati in due livelli

**In memoria** (`emailStore`): solo i metadati leggeri per ogni email:
```javascript
emailStore[emailId] = {
    email_id, subject, sender, recipients, date,
    clean_subject, source_file, pec_provider, pec_type, pec_date,
    attachment_count  // numero, non l'array completo
};
```

**In IndexedDB** (store `emails`): l'email completa (body_text, body_html, attachments senza data binari) — come gia' oggi.

### 2. Nuovo store IndexedDB per i body

Aggiornare lo schema IndexedDB (incrementare `DB_VERSION` a 2):
- Store `emails` → resta come ora (email complete senza binary data)
- Nuova opzione: durante `saveToDB`, continuare a salvare l'email completa nello store `emails`

### 3. LRU Cache

Creare una semplice LRU cache in `app.js`:
```javascript
var EMAIL_CACHE_SIZE = 50;  // ultime 50 email complete in RAM
var emailCache = {};        // email_id → full email object
var emailCacheOrder = [];   // array di email_id, piu' recente in fondo
```

Funzioni:
- `cacheGet(emailId)` → ritorna l'email dalla cache o null
- `cachePut(emailId, email)` → inserisce/aggiorna nella cache, evict se > SIZE

### 4. Modificare `loadEmail(emailId)`

```javascript
async function loadEmail(emailId) {
    // 1. Cerca nella LRU cache
    var email = cacheGet(emailId);
    if (email) { renderDetail(email); return; }

    // 2. Carica da IndexedDB
    email = await loadEmailFromDB(emailId);
    if (email) { cachePut(emailId, email); renderDetail(email); return; }

    // 3. Fallback: API remota (singola email)
    email = await api.getEmail(emailId);
    if (email) { cachePut(emailId, email); renderDetail(email); return; }

    // 4. Fallback: emailStore ha ancora i metadati
    renderDetail(emailStore[emailId] || null);
}
```

Aggiungere `loadEmailFromDB(emailId)`:
```javascript
function loadEmailFromDB(emailId) {
    if (!db) return Promise.resolve(null);
    return new Promise(function(resolve) {
        var tx = db.transaction(['emails'], 'readonly');
        var req = tx.objectStore('emails').get(emailId);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { resolve(null); };
    });
}
```

### 5. Modificare `init()` per non caricare tutti i body

- Da API remota: scaricare solo il catalogo (`api.getCatalog()`), **non** tutte le email (`api.getAllEmails()`). Popolare `emailStore` solo con i metadati estratti da `catalog.sources[].emails_summary[]`.
- Da IndexedDB: caricare solo il catalogo. Non fare `getAll()` sullo store emails.
- I body verranno caricati on-demand.

**Attenzione**: bisogna comunque salvare tutte le email in IDB dopo il primo download remoto. Quindi la prima init fara':
1. `getCatalog()` → popola metadati in `emailStore`
2. In background (non bloccante): `api.getAllEmails()` → salva in IDB senza metterle in RAM

### 6. Modificare `processFile()` (upload locale)

Dopo il parsing locale:
- Mettere in `emailStore` solo i metadati
- Salvare le email complete in IndexedDB
- Mettere nella LRU cache le email appena parsate (l'utente probabilmente le guardera' subito)

### 7. Adattare la ricerca

La ricerca in `searchEmails()` attualmente cerca nei body. Con il lazy loading i body non sono in RAM. Due opzioni:

**Opzione A (consigliata per ora)**: cercare solo nei metadati (subject, sender, clean_subject). Rimuovere la ricerca nei body. Questa limitazione verra' risolta dal Prompt 04 (indice di ricerca).

**Opzione B**: caricare i body da IDB durante la ricerca. Troppo lento con migliaia di email.

→ Scegliere **Opzione A** e aggiungere un commento `// TODO: full-text search via search index (prompt 04)`.

## File coinvolti

| File | Modifica |
|------|----------|
| `js/app.js` | Refactoring di `init()`, `loadEmail()`, `processFile()`, `saveToDB()`, `loadFromDB()`, `searchEmails()`. Aggiunta LRU cache. |
| Nessun nuovo file necessario | |

## Specifiche di testing

### Test unitari (`tests/test_lazy_loading.js`)

1. **LRU cache basic**: inserire 5 email nella cache con SIZE=3. Verificare che solo le ultime 3 siano presenti. Verificare che accedere a un'email la promuova (non venga evicted).

2. **emailStore contiene solo metadati**: dopo un `processFile` simulato, verificare che `emailStore[id]` NON contenga `body_text`, `body_html`, ne' `attachments` (ma contenga `attachment_count`).

3. **loadEmail recupera da IDB**: salvare un'email completa in IDB, poi chiamare `loadEmail(id)`. Verificare che il dettaglio contenga il body.

4. **Fallback chain**: testare che se la cache e' vuota e IDB non ha l'email, si tenti l'API remota (mock).

5. **init non carica tutti i body**: dopo `init()`, verificare che `emailStore` abbia solo metadati e che la RAM usata sia proporzionale al numero di email, non alla dimensione dei body.

6. **Search solo su metadati**: verificare che `searchEmails` cerchi solo in subject/sender/clean_subject e non nei body.

### Test manuali da verificare

- [ ] Caricare `test.mbox` → le email appaiono nella sidebar come prima
- [ ] Click su un'email → il dettaglio si carica (potrebbe esserci un brevissimo flash)
- [ ] Navigare avanti e indietro tra email → le email in cache si caricano istantaneamente
- [ ] Ricaricare la pagina → le email appaiono dalla cache IDB, click su un'email carica il body
- [ ] Ricerca per subject → funziona. Ricerca per testo nel body → non trova (atteso)
- [ ] Memory profiling: con 1000+ email, la RAM iniziale e' significativamente ridotta

### Criteri di successo

- `node tests/test_lazy_loading.js` → 0 fallimenti
- `node tests/test_parser.js` → nessuna regressione
- RAM iniziale con 5.000 email: < 20 MB (vs attuale ~50-100 MB)
- Tempo di apertura email dalla cache: < 5ms
- Tempo di apertura email da IDB: < 50ms
