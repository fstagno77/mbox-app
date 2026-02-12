/* Web Worker for mbox parsing — offloads heavy work from the main thread */
importScripts('mbox-parser.js');

self.onmessage = function (e) {
    var msg = e.data;
    if (msg.type !== 'parse') return;

    try {
        var result = MboxParser.parseMboxFile(msg.text, msg.sourceFile);

        // Collect all ArrayBuffers from attachment Uint8Arrays for Transferable
        var transferables = [];
        var ids = Object.keys(result.emailDataMap);
        for (var i = 0; i < ids.length; i++) {
            var email = result.emailDataMap[ids[i]];
            var atts = email.attachments || [];
            for (var j = 0; j < atts.length; j++) {
                if (atts[j].data && atts[j].data.buffer) {
                    transferables.push(atts[j].data.buffer);
                }
            }
        }

        self.postMessage(
            { type: 'result', source: result.source, emailDataMap: result.emailDataMap },
            transferables
        );
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message || String(err) });
    }
};
