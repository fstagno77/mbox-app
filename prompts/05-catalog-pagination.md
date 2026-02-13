# Prompt 05 — Paginazione del catalogo remoto

## Contesto

Il sync remoto attuale funziona cosi':

- **Catalogo**: un singolo blob JSON (`catalog` store, chiave `"main"`) in Netlify Blobs che contiene **tutto**: `total_emails`, `total_sources`, e l'array `sources[]` dove ogni source ha `emails_summary[]` con i metadati di ogni email. Con 10.000 email, questo JSON puo' pesare 5-10 MB.
- **Email**: uno blob per email (`emails` store), scaricati tutti con `?all=true` che lista e scarica ogni blob sequenzialmente in chunk di 20.
- **Attachments**: uno blob per attachment per email.

I problemi:
1. Il catalogo monolitico diventa enorme → lento da scaricare e uploadare
2. `GET /api/emails?all=true` scarica TUTTE le email → lento e inutile con lazy loading
3. Nessuna paginazione → l'init blocca l'app finche' tutto e' scaricato

## Obiettivo

Implementare **paginazione** per il catalogo e le email remote, cosi' che:
- L'init carica solo le informazioni essenziali velocemente
- I dettagli vengono scaricati on-demand o in background
- Upload/download incrementali quando possibile

## Specifiche di implementazione

### 1. Spezzare il catalogo in chunk

Invece di un singolo blob `"main"` per tutto il catalogo, usare:

- **`catalog/meta`**: metadati globali `{ total_emails, total_sources, source_ids: ['src_abc', 'src_def', ...] }`
- **`catalog/source/<source_id>`**: un blob per ogni sorgente con i suoi `groups`, `emails_summary`, `uploaded_at`, etc.

**Modificare `netlify/functions/catalog.mjs`**:

```javascript
// GET /api/catalog → ritorna solo il meta
// GET /api/catalog?sourceId=src_abc → ritorna una singola sorgente
// PUT /api/catalog → salva meta + tutte le sorgenti (per retrocompatibilita')
// PUT /api/catalog?sourceId=src_abc → salva solo una sorgente
```

### 2. Init progressivo in `app.js`

```javascript
async function init() {
    // 1. Scarica solo il meta (velocissimo, pochi bytes)
    var meta = await api.getCatalogMeta();

    // 2. Se non c'e' nulla, fallback IDB
    if (!meta || !meta.source_ids || meta.source_ids.length === 0) {
        await loadFromDB();
        // ... render
        return;
    }

    // 3. Scarica le sorgenti in parallelo (batch di 5)
    catalog.total_emails = meta.total_emails;
    catalog.total_sources = meta.total_sources;
    catalog.sources = [];
    renderStats();  // mostra subito i conteggi

    for (var i = 0; i < meta.source_ids.length; i += 5) {
        var batch = meta.source_ids.slice(i, i + 5);
        var sources = await Promise.all(batch.map(api.getCatalogSource));
        sources.forEach(function(s) {
            if (s) {
                catalog.sources.push(s);
                // Popola emailStore con metadati
                (s.emails_summary || []).forEach(function(e) {
                    emailStore[e.email_id] = e;
                });
            }
        });
        // Rendering progressivo: mostra le sorgenti man mano che arrivano
        renderSources(catalog.sources);
    }

    // 4. Salva in IDB per offline
    saveToDB();
}
```

### 3. Upload incrementale

Quando l'utente aggiunge un nuovo file mbox:
- Salvare solo la nuova sorgente: `PUT /api/catalog?sourceId=src_new`
- Aggiornare il meta: `PUT /api/catalog` (solo il meta, pochi bytes)
- Le email del nuovo file: `POST /api/emails` (come ora, solo le nuove)

Quando l'utente elimina una sorgente:
- `DELETE /api/catalog?sourceId=src_old`
- Aggiornare il meta
- Cascade delete email e attachment (come ora)

### 4. Rimuovere `?all=true` per le email

Con il lazy loading (Prompt 03), non serve piu' scaricare tutte le email all'init. L'endpoint `GET /api/emails?all=true` puo' essere deprecato o mantenuto per casi speciali. L'init non lo chiama piu'.

Le singole email vengono scaricate on-demand: `GET /api/emails?id=email_abc` (gia' supportato).

### 5. Aggiornare le Netlify Functions

**`netlify/functions/catalog.mjs`** — Modificare per supportare i nuovi percorsi:

```javascript
export default async (req) => {
    const store = getStore({ name: "catalog", consistency: "strong" });
    const url = new URL(req.url);
    const sourceId = url.searchParams.get("sourceId");

    if (req.method === "GET") {
        if (sourceId) {
            // Singola sorgente
            const source = await store.get("source/" + sourceId, { type: "json" });
            return Response.json(source || null);
        }
        // Meta (default)
        const meta = await store.get("meta", { type: "json" });
        if (!meta) {
            // Retrocompatibilita': prova il vecchio formato "main"
            const old = await store.get("main", { type: "json" });
            if (old) return Response.json(old);
            return Response.json({ total_emails: 0, total_sources: 0, source_ids: [] });
        }
        return Response.json(meta);
    }

    if (req.method === "PUT") {
        if (sourceId) {
            const source = await req.json();
            await store.setJSON("source/" + sourceId, source);
            return Response.json({ status: "ok" });
        }
        // Salva meta (o fallback: salva tutto come prima)
        const data = await req.json();
        if (data.source_ids) {
            // Nuovo formato: solo meta
            await store.setJSON("meta", data);
        } else {
            // Vecchio formato: catalogo completo (retrocompatibilita')
            await store.setJSON("main", data);
        }
        return Response.json({ status: "ok" });
    }

    if (req.method === "DELETE" && sourceId) {
        await store.delete("source/" + sourceId);
        return Response.json({ status: "ok" });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
};
```

### 6. Migrazione dal vecchio formato

La prima volta che l'init trova il vecchio formato (blob `"main"` con tutto dentro):
1. Leggerlo
2. Creare i nuovi blob separati (meta + una per sorgente)
3. Eliminare il vecchio blob `"main"`
4. Questo avviene trasparentemente lato server

## File coinvolti

| File | Modifica |
|------|----------|
| `netlify/functions/catalog.mjs` | Refactoring per supportare meta + sorgenti separate |
| `js/app.js` | Refactoring di `init()`, `processFile()`, `handleDeleteSource()`, oggetto `api` |
| `netlify/functions/sources.mjs` | Aggiornare cascade delete |

## Specifiche di testing

### Test unitari (`tests/test_catalog_pagination.js`)

1. **Meta endpoint**: GET senza sourceId → ritorna `{ total_emails, total_sources, source_ids }`.

2. **Source endpoint**: PUT una sorgente con sourceId, poi GET con lo stesso sourceId → ritorna la sorgente salvata.

3. **Retrocompatibilita'**: se esiste solo il blob `"main"` vecchio formato, GET senza sourceId lo ritorna correttamente.

4. **Init progressivo mock**: simulare un catalogo con 5 sorgenti. Verificare che `init()` chiami `getCatalogMeta()` una volta, poi `getCatalogSource()` 5 volte (o in batch), e che alla fine `catalog.sources` abbia 5 elementi.

5. **Upload incrementale**: simulare `processFile()`, verificare che chiami solo `PUT /api/catalog?sourceId=...` e `PUT /api/catalog` (meta), non un PUT dell'intero catalogo.

6. **Delete incrementale**: simulare `handleDeleteSource()`, verificare che chiami `DELETE /api/catalog?sourceId=...` e aggiorni il meta.

7. **No `?all=true`**: verificare che `init()` non chiami `api.getAllEmails()`.

### Test manuali da verificare

- [ ] Prima visita (catalogo vuoto) → mostra welcome box
- [ ] Caricare `test.mbox` → le email appaiono, sync remoto funziona
- [ ] Ricaricare la pagina → le email si caricano dal remoto progressivamente
- [ ] Eliminare una sorgente → sparisce dalla lista e dal remoto
- [ ] Offline mode: disabilitare la rete → l'app funziona da cache IDB
- [ ] Migrazione: se c'era un catalogo vecchio formato, viene migrato automaticamente

### Criteri di successo

- `node tests/test_catalog_pagination.js` → 0 fallimenti
- Tutti i test precedenti → nessuna regressione
- Tempo di init con 20 sorgenti: < 2s (vs attuale che scarica tutto in un colpo)
- Dimensione download init: < 100KB (solo meta) vs attuale (intero catalogo + tutte le email)
- Upload di una nuova sorgente: salva solo la nuova sorgente, non riscrive tutto
