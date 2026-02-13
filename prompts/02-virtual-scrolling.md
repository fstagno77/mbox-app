# Prompt 02 — Virtual scrolling per la lista email

## Contesto

La sidebar dell'app (`#groups-list` in `index.html`) renderizza **tutti** gli elementi DOM per ogni email di ogni sorgente. La funzione `renderSources()` in `app.js:462` crea un `div.email-item` per ogni email, con event listener annesso. Con 10.000+ email questo produce decine di migliaia di nodi DOM, rallentando il rendering iniziale e consumando memoria.

La struttura attuale e' gerarchica:
```
source-header (collapsible)
  source-content
    group-header (collapsible)
      group-emails
        email-item (uno per email)
        email-item
        ...
```

I gruppi e le sorgenti sono gia' collassabili (classe `.open`), quindi molti email-item sono nascosti con `display: none`. Ma i nodi DOM esistono comunque tutti.

## Obiettivo

Implementare **virtual scrolling** sulla lista delle email nella sidebar, in modo che vengano renderizzati solo gli elementi visibili nel viewport + un buffer sopra/sotto. La struttura ad albero (sorgente → gruppo → email) deve essere mantenuta visivamente.

## Specifiche di implementazione

### Approccio: Virtual scrolling flat con header sticky

Dato che i gruppi sono collassabili, l'approccio piu' pratico e':

1. **Creare `js/virtual-list.js`** — un modulo leggero di virtual scrolling (no dipendenze esterne).

   API suggerita:
   ```javascript
   var VirtualList = function(container, options) {
       // container: l'elemento DOM scrollabile (#groups-list o il sidebar)
       // options.itemHeight: altezza fissa di un email-item (es. 72px)
       // options.headerHeight: altezza di un group-header (es. 40px)
       // options.sourceHeaderHeight: altezza di un source-header (es. 60px)
       // options.bufferSize: numero di righe extra da renderizzare (es. 10)
       // options.renderItem(item, index): callback che ritorna un DOM element
       // options.renderGroupHeader(group): callback
       // options.renderSourceHeader(source): callback
   };
   VirtualList.prototype.setData = function(flatItems) { ... };
   VirtualList.prototype.scrollToItem = function(index) { ... };
   VirtualList.prototype.refresh = function() { ... };
   VirtualList.prototype.destroy = function() { ... };
   ```

2. **Flattening dei dati**: prima del rendering, trasformare la struttura gerarchica in un array flat di "righe", dove ogni riga ha un `type` (`source-header`, `group-header`, `email-item`) e i dati associati. Quando un gruppo/sorgente e' chiuso, le righe figlie vengono escluse dall'array flat.

3. **Modificare `renderSources()` in `app.js`** per usare `VirtualList` invece di creare tutti i DOM elements. La funzione deve:
   - Costruire l'array flat delle righe
   - Passarlo a `VirtualList.setData()`
   - Gestire toggle apertura/chiusura di sorgenti/gruppi ricostruendo l'array flat e chiamando `refresh()`

4. **Altezze fisse**: per semplicita', usare altezze fisse:
   - `email-item`: 72px (attuale con padding: ~65-75px)
   - `group-header`: 40px
   - `source-header`: 60px

   L'alternativa (altezze variabili) e' molto piu' complessa e non necessaria qui.

5. **Il container scrollabile** e' `.sidebar` (gia' `overflow-y: auto`). Il `#groups-list` diventa un div con `position: relative` e altezza totale calcolata. Gli item renderizzati usano `position: absolute; top: <offset>px`.

6. **Gestire la ricerca**: `searchEmails()` deve anch'essa usare il VirtualList per i risultati.

7. **Click handler**: delegare gli eventi click tramite event delegation sul container, non listener individuali su ogni email-item.

## File coinvolti

| File | Modifica |
|------|----------|
| `js/virtual-list.js` | **NUOVO** — modulo virtual scrolling |
| `js/app.js` | Riscrivere `renderSources()` e `searchEmails()` rendering |
| `css/style.css` | Aggiungere stili per il container virtualizzato |
| `index.html` | Aggiungere `<script src="js/virtual-list.js">` prima di `app.js` |

## Specifiche di testing

### Test unitari (`tests/test_virtual_list.js`)

1. **Flat data generation**: dato un catalogo con 3 sorgenti, 5 gruppi ciascuno e 20 email per gruppo, verificare che l'array flat abbia il numero corretto di righe (3 source-headers + 15 group-headers + 300 email-items = 318 quando tutto e' aperto).

2. **Collapse/expand**: simulare la chiusura di un gruppo e verificare che le righe email vengano escluse dall'array flat. Simulare la chiusura di una sorgente e verificare che tutte le righe figlie spariscano.

3. **Visible range calculation**: dato un viewport di 600px di altezza, con scroll offset 0, e item height 72px, verificare che vengano renderizzati solo ~8-10 items (600/72 + buffer).

4. **Scroll simulation**: cambiare lo scroll offset a 1000px e verificare che gli item renderizzati cambino correttamente.

5. **Event delegation**: verificare che un click su un email-item con `data-email-id` chiami `loadEmail` con l'id corretto.

6. **Search integration**: dopo `searchEmails('test')`, verificare che il VirtualList mostri solo i risultati filtrati.

### Test manuali da verificare

- [ ] Con `test.mbox` caricato, la sidebar mostra correttamente le sorgenti/gruppi/email
- [ ] Scrollare velocemente → nessun blank/flicker visibile
- [ ] Click su email-item → si apre il dettaglio come prima
- [ ] Collassare/espandere un gruppo → animazione fluida, altezza ricalcolata
- [ ] Collassare/espandere una sorgente → idem
- [ ] Ricerca → risultati mostrati correttamente con scrolling virtuale
- [ ] Su mobile (< 768px) → layout full-screen mantenuto, scroll fluido
- [ ] Delete di una sorgente → lista aggiornata correttamente

### Criteri di successo

- `node tests/test_virtual_list.js` → 0 fallimenti
- `node tests/test_parser.js` → nessuna regressione
- Con 5.000 email: tempo di rendering iniziale < 100ms (vs attuale ~2-5s)
- DOM nodes nella sidebar: < 100 in qualsiasi momento (vs attuale = totale email)
- Memory footprint ridotto: verificabile con Chrome DevTools Memory snapshot
