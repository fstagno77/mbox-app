# Prompt 06 — Ottimizzazione e pulizia del codice

## Contesto

Dopo l'implementazione dei Prompt 01-05, il codebase avra' subito modifiche significative. Questo prompt ha l'obiettivo di fare una revisione completa per:
- Rimuovere codice morto e funzioni non piu' utilizzate
- Eliminare ridondanze e duplicazioni
- Migliorare la struttura e leggibilita'
- Verificare che non ci siano regressioni

## Obiettivo

Pulizia profonda del codebase senza cambiare funzionalita'. Zero nuove feature, solo rimozione, semplificazione e riorganizzazione.

## Aree di intervento

### 1. Codice morto da rimuovere

Dopo i prompt precedenti, verificare e rimuovere:

- **Vecchio path sincrono del parser** in `processFile()`: se il Web Worker (Prompt 01) e' implementato con fallback, il codice di fallback potrebbe non servire. Valutare se tenerlo o rimuoverlo.
- **`api.getAllEmails()`**: con la paginazione (Prompt 05), il download di tutte le email non serve piu'. Rimuovere il metodo dall'oggetto `api` e l'endpoint `?all=true` da `emails.mjs` (o deprecarlo).
- **Vecchio `searchEmails()` body search**: con Lunr.js (Prompt 04), il codice che scansiona `emailStore[id].body_text` e `body_html` non serve piu'.
- **Rendering DOM diretto in `renderSources()`**: con il virtual scrolling (Prompt 02), la vecchia funzione che crea tutti i nodi DOM puo' essere rimossa.
- **Python backend**: i file in `/pec_parser/`, `/storage/`, `/templates/`, `/static/`, `app.py`, `config.py` e `requirements.txt` sono per un vecchio backend Flask che non viene piu' usato (tutto e' client-side + Netlify Functions). **Valutare con l'utente** se rimuoverli o archiviarli.

### 2. Ridondanze da eliminare

- **Duplicazione metadati**: `emailStore` e `catalog.sources[].emails_summary[]` contengono informazioni sovrapposte. Dopo il lazy loading (Prompt 03), `emailStore` dovrebbe contenere solo riferimenti leggeri, e `emails_summary` e' la fonte unica per i metadati. Valutare se unificare.
- **Doppio salvataggio del catalogo**: in `handleDeleteSource()`, il codice chiama sia `api.deleteSource(sourceId)` che `api.saveCatalog(catalog)`. Con la paginazione (Prompt 05), basta `DELETE /api/catalog?sourceId=...` + aggiornamento meta.
- **`saveToDB()` e `loadFromDB()`**: verificare che non facciano operazioni ridondanti dopo i cambiamenti del Prompt 03.

### 3. Pulizia strutturale

- **Organizzazione di `app.js`**: il file e' un unico script di ~800 righe. Dopo le modifiche, potrebbe essere cresciuto. Valutare se spezzarlo in sezioni ben commentate o in moduli separati (senza introdurre un bundler).
- **Costanti magic numbers**: estrarre valori come `50` (setTimeout delay), `20` (batch size), `3` (auto-open threshold), `0.85` (similarity threshold) in costanti con nome.
- **Console.log di debug**: rimuovere o ridurre i `console.log` e `console.error` che non servono in produzione. Lasciare solo quelli critici per debugging API.
- **Gestione errori**: verificare che tutti i path di errore (file non valido, API down, IDB non disponibile) siano gestiti correttamente e non lascino la UI in uno stato inconsistente.

### 4. CSS cleanup

- Rimuovere stili non piu' usati dopo il virtual scrolling (se ci sono)
- Verificare che non ci siano classi CSS orfane (definite ma mai usate nel JS/HTML)
- Consolidare media query duplicate

### 5. HTML cleanup

- Verificare che tutti gli `id` usati nel JS esistano nell'HTML e viceversa
- Rimuovere elementi HTML non piu' necessari

### 6. Netlify Functions cleanup

- Rimuovere endpoint deprecati (se `?all=true` e' stato rimosso)
- Verificare che la retrocompatibilita' col vecchio formato catalogo sia gestita o rimossa se non serve
- Rimuovere `netlify/functions/sources.mjs` se la sua logica e' stata assorbita da `catalog.mjs`

## File coinvolti

| File | Azione |
|------|--------|
| `js/app.js` | Pulizia codice morto, costanti, commenti |
| `js/mbox-parser.js` | Verifica: nessuna funzione non usata |
| `js/virtual-list.js` | Verifica: codice pulito |
| `js/parse-worker.js` | Verifica: codice pulito |
| `js/lunr.min.js` | Nessuna modifica (libreria esterna) |
| `css/style.css` | Rimuovere stili orfani |
| `index.html` | Rimuovere elementi orfani |
| `netlify/functions/*.mjs` | Pulizia endpoint |
| `pec_parser/`, `storage/`, `templates/`, `static/`, `app.py`, `config.py` | **Chiedere all'utente**: rimuovere o spostare in cartella `legacy/`? |
| `tests/` | Verificare che i test Python siano ancora rilevanti |

## Specifiche di testing

### Verifica codice morto

1. **Grep per funzioni non chiamate**: per ogni funzione definita in `app.js`, verificare che sia chiamata almeno una volta (nel JS o nell'HTML come handler).

2. **Grep per classi CSS orfane**: per ogni classe definita in `style.css`, verificare che sia usata in HTML o JS.

3. **Grep per ID orfani**: per ogni `getElementById` o `querySelector('#...')` nel JS, verificare che l'ID esista nell'HTML.

### Test di regressione completi

Eseguire **tutti** i test creati nei prompt precedenti:

```bash
node tests/test_parser.js
node tests/test_worker.js
node tests/test_virtual_list.js
node tests/test_lazy_loading.js
node tests/test_search_index.js
node tests/test_catalog_pagination.js
```

**Tutti devono passare al 100%.**

### Test manuali end-to-end

- [ ] Pagina iniziale vuota → welcome box visibile
- [ ] Upload file mbox → parsing via worker, email nella sidebar
- [ ] Click su email → dettaglio caricato (lazy)
- [ ] Ricerca → risultati Lunr.js corretti
- [ ] Scroll lungo nella sidebar → virtual scrolling fluido
- [ ] Eliminare una sorgente → rimozione corretta
- [ ] Ricaricare → dati caricati dal remoto con paginazione
- [ ] Offline → dati da IDB cache
- [ ] Mobile → navigazione full-screen funzionante
- [ ] Nessun errore nella console del browser

### Criteri di successo

- **Tutti i test esistenti passano al 100%**
- **Zero errori/warning nella console** durante l'uso normale
- **Riduzione LOC**: almeno 10% di riduzione delle righe di codice totali (contando rimozione codice morto)
- **Nessuna regressione funzionale**
- Il codice e' leggibile e ogni sezione ha un commento che ne spiega lo scopo
