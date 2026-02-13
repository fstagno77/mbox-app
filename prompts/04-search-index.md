# Prompt 04 — Indice di ricerca con Lunr.js

## Contesto

La ricerca attuale in `searchEmails()` (`app.js:713`) fa una scansione **lineare** O(n) su tutte le email: prima cerca in subject/sender/clean_subject, poi nei body (body_text, body_html). Con il lazy loading (Prompt 03), i body non sono piu' in memoria, quindi la ricerca full-text nel body non funziona. Anche senza lazy loading, la scansione lineare di 10.000+ email e' lenta.

## Obiettivo

Sostituire la ricerca lineare con un **indice full-text** basato su [Lunr.js](https://lunrjs.com/) — una libreria JavaScript leggera (~8KB gzip) che funziona interamente client-side, senza server. L'indice viene costruito al caricamento delle email e aggiornato quando si aggiungono/rimuovono sorgenti.

## Specifiche di implementazione

### 1. Aggiungere Lunr.js

- Scaricare `lunr.min.js` da https://unpkg.com/lunr/lunr.min.js e salvarlo in `js/lunr.min.js`
- Aggiungere `<script src="js/lunr.min.js"></script>` in `index.html` prima di `app.js`
- **Non usare npm** — l'app e' vanilla JS senza bundler frontend

### 2. Costruire l'indice

In `app.js`, aggiungere:

```javascript
var searchIndex = null;

function buildSearchIndex() {
    var docs = [];
    catalog.sources.forEach(function(source) {
        (source.emails_summary || []).forEach(function(summary) {
            docs.push({
                id: summary.email_id,
                subject: summary.subject || '',
                sender: summary.sender || '',
                clean_subject: summary.clean_subject || ''
            });
        });
    });

    searchIndex = lunr(function() {
        this.ref('id');
        this.field('subject', { boost: 10 });
        this.field('clean_subject', { boost: 5 });
        this.field('sender', { boost: 3 });

        // Lunr supporta la lingua italiana con un plugin, ma per ora
        // usiamo lo stemmer di default (inglese) che funziona decentemente
        // anche per l'italiano per ricerche substring-like.

        docs.forEach(function(doc) {
            this.add(doc);
        }, this);
    });
}
```

### 3. Indice con body text (opzionale, per il futuro)

Per includere i body nella ricerca senza tenerli in RAM:
- Durante il parsing (`processFile`) o l'init, estrarre i primi ~200 caratteri del body_text di ogni email e includerli come campo `preview` nell'indice Lunr.
- Salvare questo preview anche in `emailStore` (metadato leggero).
- Aggiungere il campo `preview` all'indice Lunr con boost basso.

### 4. Modificare `searchEmails()`

```javascript
function searchEmails(query) {
    if (!searchIndex) {
        buildSearchIndex();
    }

    var results;
    try {
        // Lunr supporta query con wildcard: query + '*'
        results = searchIndex.search(query + '*');
    } catch (e) {
        // Se la query ha caratteri speciali, prova escaped
        try {
            results = searchIndex.search(query.replace(/[:\*\~\^]/g, ''));
        } catch (e2) {
            results = [];
        }
    }

    if (results.length === 0) {
        document.getElementById('groups-list').innerHTML =
            '<div style="...">Nessun risultato per "' + escapeHtml(query) + '"</div>';
        return;
    }

    // Mappa risultati Lunr a summary objects
    var resultIds = new Set(results.map(function(r) { return r.ref; }));
    var summaries = [];
    catalog.sources.forEach(function(s) {
        (s.emails_summary || []).forEach(function(e) {
            if (resultIds.has(e.email_id)) summaries.push(e);
        });
    });

    // Renderizza come fakeSource (stesso approccio attuale)
    var fakeSource = { ... };  // come nell'attuale searchEmails
    renderSources([fakeSource]);
    // ... apertura gruppi etc.
}
```

### 5. Aggiornare l'indice quando cambia il catalogo

- Dopo `processFile()` (nuova sorgente aggiunta): ricostruire l'indice (`searchIndex = null` per invalidazione lazy, verra' ricostruito alla prossima ricerca).
- Dopo `handleDeleteSource()`: idem, invalidare l'indice.

### 6. Chiamare `buildSearchIndex()` durante `init()`

Costruire l'indice subito dopo il caricamento del catalogo, cosi' la prima ricerca e' istantanea. Per cataloghi grandi (> 5000 email) costruire in modo asincrono con `setTimeout`.

## File coinvolti

| File | Modifica |
|------|----------|
| `js/lunr.min.js` | **NUOVO** — libreria Lunr.js |
| `js/app.js` | Aggiungere `buildSearchIndex()`, riscrivere `searchEmails()`, invalidazione indice |
| `index.html` | Aggiungere `<script src="js/lunr.min.js">` |

## Specifiche di testing

### Test unitari (`tests/test_search_index.js`)

1. **Index construction**: creare un catalogo mock con 100 email, costruire l'indice, verificare che non lanci errori e che `searchIndex` non sia null.

2. **Search by subject**: aggiungere email con subject "Fattura elettronica n. 12345". Cercare "fattura" → deve tornare l'email. Cercare "12345" → deve tornare l'email.

3. **Search by sender**: aggiungere email con sender "mario.rossi@pec.it". Cercare "mario" → deve tornare l'email.

4. **Partial match (wildcard)**: cercare "fatt" → deve tornare email con "Fattura" (grazie al wildcard `query + '*'`).

5. **No results**: cercare "xyznonexistent" → deve tornare array vuoto.

6. **Special characters**: cercare "R&D" o "oggetto: test" → non deve crashare (escape dei caratteri speciali Lunr).

7. **Index rebuild after add**: costruire l'indice, aggiungere una nuova sorgente al catalogo, invalidare e ricostruire. La nuova email deve essere trovabile.

8. **Index rebuild after delete**: costruire l'indice, rimuovere una sorgente, invalidare e ricostruire. Le email rimosse non devono essere trovabili.

9. **Performance**: con 10.000 email mock, il tempo di costruzione dell'indice deve essere < 2 secondi. Il tempo di una query deve essere < 50ms.

### Test manuali da verificare

- [ ] Caricare `test.mbox` → cercare un subject noto → trovato
- [ ] Cercare un sender → trovato
- [ ] Cercare una parola parziale → trovato (wildcard)
- [ ] Cercare qualcosa che non esiste → "Nessun risultato"
- [ ] Aggiungere un altro file mbox → cercare un'email del nuovo file → trovata
- [ ] Eliminare una sorgente → le sue email non appaiono piu' nei risultati
- [ ] Cancellare la ricerca → torna la vista normale con tutte le sorgenti

### Criteri di successo

- `node tests/test_search_index.js` → 0 fallimenti
- `node tests/test_parser.js` → nessuna regressione
- Tempo di ricerca con 10.000 email: < 50ms (vs attuale O(n) ~200-500ms)
- Tempo di costruzione indice con 10.000 email: < 2s
- Zero regressioni sulla UX di ricerca esistente
