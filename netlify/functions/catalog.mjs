import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "catalog", consistency: "strong" });
  const url = new URL(req.url);
  const sourceId = url.searchParams.get("sourceId");

  if (req.method === "GET") {
    if (sourceId) {
      // Single source
      const source = await store.get("source/" + sourceId, { type: "json" });
      return Response.json(source || null);
    }

    // Meta (default)
    const meta = await store.get("meta", { type: "json" });
    if (meta) return Response.json(meta);

    // Retrocompatibility: try old "main" format and migrate
    const old = await store.get("main", { type: "json" });
    if (old && old.sources) {
      // Migrate: split into meta + individual sources
      const sourceIds = old.sources.map((s) => s.source_id);
      const newMeta = {
        total_emails: old.total_emails || 0,
        total_sources: old.total_sources || 0,
        source_ids: sourceIds,
      };
      await store.setJSON("meta", newMeta);
      for (const s of old.sources) {
        await store.setJSON("source/" + s.source_id, s);
      }
      await store.delete("main");
      return Response.json(newMeta);
    }

    return Response.json({ total_emails: 0, total_sources: 0, source_ids: [] });
  }

  if (req.method === "PUT") {
    if (sourceId) {
      // Save a single source
      const source = await req.json();
      await store.setJSON("source/" + sourceId, source);
      return Response.json({ status: "ok" });
    }

    // Save meta or full catalog (retrocompatibility)
    const data = await req.json();
    if (data.source_ids) {
      // New format: meta only
      await store.setJSON("meta", data);
    } else {
      // Old format: full catalog — store as main for compat
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
