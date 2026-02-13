# Prompt 01 — Web Worker per il parsing mbox

## Contesto

L'app MBOX Archive (`/js/mbox-parser.js`, `/js/app.js`) esegue il parsing dei file `.mbox` interamente client-side. Il parser (`MboxParser.parseMboxFile`) gira sul thread principale del browser: quando un file ha migliaia di email, l'interfaccia si blocca per decine di secondi. L'unica mitigazione attuale e' un `setTimeout(..., 50)` in `processFile()` (`app.js:275`) che rilascia il thread una sola volta prima di avviare il parsing pesante.

## Obiettivo

Spostare il parsing mbox in un **Web Worker dedicato** cosi' che il thread principale resti libero e la UI rimanga reattiva durante l'analisi di file grandi.

## Architettura attuale

- **`js/mbox-parser.js`** — IIFE che espone `MboxParser.parseMboxFile(text, sourceFile)`. Ritorna `{ source, emailDataMap }`. Usa browser API: `DOMParser` (per PEC `daticert.xml`), `TextDecoder`, `atob`.
- **`js/app.js`** — funzione `processFile(file)` (linea 263): legge il file con `FileReader.readAsText(file, 'iso-8859-1')`, chiama `MboxParser.parseMboxFile`, poi salva i risultati in `emailStore`, aggiorna `catalog`, renderizza la UI, e lancia il sync remoto fire-and-forget.
- **`index.html`** — carica `<script src="js/mbox-parser.js">` e `<script src="js/app.js">` in sequenza.

## Specifiche di implementazione

1. **Creare `js/parse-worker.js`**
   - Importare il parser con `importScripts('mbox-parser.js')` (i Web Worker supportano `importScripts`).
   - Ascoltare messaggi `{ type: 'parse', text, sourceFile }`.
   - Eseguire `MboxParser.parseMboxFile(text, sourceFile)`.
   - **Importante**: gli attachment hanno `data` come `Uint8Array`. Usare `Transferable` per passare i buffer senza copiarli: raccogliere tutti i `ArrayBuffer` dal risultato e passarli come secondo argomento di `postMessage`.
   - Rispondere con `{ type: 'result', source, emailDataMap }` oppure `{ type: 'error', message }`.

2. **Modificare `app.js` — funzione `processFile`**
   - Sostituire la chiamata sincrona al parser con la creazione di un Worker:
     ```
     var worker = new Worker('js/parse-worker.js');
     worker.postMessage({ type: 'parse', text: e.target.result, sourceFile: file.name });
     worker.onmessage = function(msg) { ... gestisci risultato ... worker.terminate(); };
     worker.onerror = function(err) { ... gestisci errore ... worker.terminate(); };
     ```
   - Mantenere il `showLoading()` / `hideLoading()` attorno al ciclo di vita del worker.
   - Dopo aver ricevuto il risultato dal worker, eseguire lo stesso flusso attuale: salvare in `emailStore`, aggiornare `catalog`, renderizzare, sync remoto.

3. **Aggiornare il loading overlay**
   - Opzionale ma consigliato: far inviare dal Worker messaggi di progresso `{ type: 'progress', parsed, total }` durante `splitMbox` e il loop di parsing, cosi' la UI puo' mostrare "Analisi: 150/500 email...".
   - Per farlo, nel parser aggiungere un callback opzionale o fare in modo che il worker invii messaggi intermedi.

4. **Non rimuovere `<script src="js/mbox-parser.js">` da `index.html`** — il parser potrebbe servire anche altrove. Tuttavia il `processFile` non deve piu' chiamarlo direttamente.

5. **Fallback**: se `window.Worker` non e' disponibile (improbabile ma possibile in contesti embedded), mantenere il path sincrono attuale come fallback.

## File coinvolti

| File | Modifica |
|------|----------|
| `js/parse-worker.js` | **NUOVO** — Web Worker |
| `js/app.js` | Modificare `processFile()` per usare il Worker |
| `js/mbox-parser.js` | Eventuale modifica minima per supportare progress callback |
| `index.html` | Nessuna modifica necessaria |

## Specifiche di testing

### Test unitari (`tests/test_worker.js`)

Creare un file di test Node.js (come l'esistente `tests/test_parser.js`) che verifica:

1. **Worker output equivalence**: parsare `test.mbox` sia con il metodo diretto (`MboxParser.parseMboxFile`) sia simulando il flusso del worker. Verificare che `source.email_count`, `source.groups.length`, e le chiavi di `emailDataMap` siano identici.

2. **Transferable buffers**: dopo il passaggio via worker, verificare che gli attachment con `data` siano ancora `Uint8Array` validi (non svuotati o nulli).

3. **Error handling**: passare un testo malformato (non mbox) e verificare che il worker risponda con `{ type: 'error' }` senza crashare.

4. **Fallback sincrono**: simulare `window.Worker = undefined` e verificare che `processFile` usi il path sincrono senza errori.

### Test manuali da verificare

- [ ] Caricare `test.mbox` → l'overlay di loading appare e la UI resta reattiva (si puo' scrollare la pagina)
- [ ] Il risultato finale (email nella sidebar, dettaglio email) e' identico a prima
- [ ] Caricare un file non-.mbox → appare l'alert di errore
- [ ] Caricare piu' file in sequenza → ogni file viene processato correttamente
- [ ] Su Safari e Firefox: funzionamento identico

### Criteri di successo

- `node tests/test_worker.js` → 0 fallimenti
- `node tests/test_parser.js` → continua a passare (nessuna regressione)
- Il thread principale non si blocca durante il parsing (verificabile con Chrome DevTools Performance tab: no "Long Task" > 100ms durante il parsing)
