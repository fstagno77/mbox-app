import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const sourceId = url.searchParams.get("id");
  if (!sourceId) {
    return Response.json({ error: "Missing source id" }, { status: 400 });
  }

  const catalogStore = getStore({ name: "catalog", consistency: "strong" });
  const emailStore = getStore({ name: "emails", consistency: "strong" });
  const attStore = getStore({ name: "attachments", consistency: "strong" });

  // Load the source to find email IDs to delete
  const source = await catalogStore.get("source/" + sourceId, { type: "json" });

  // Also load meta to find other sources (for exclusive ID check)
  const meta = await catalogStore.get("meta", { type: "json" });

  if (!source && !meta) {
    // Fallback: try old "main" format
    const catalog = await catalogStore.get("main", { type: "json" });
    if (!catalog) {
      return Response.json({ error: "No catalog" }, { status: 404 });
    }

    let target = null;
    const remaining = [];
    for (const s of catalog.sources) {
      if (s.source_id === sourceId) target = s;
      else remaining.push(s);
    }
    if (!target) {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }

    const removedIds = new Set(
      (target.emails_summary || []).map((e) => e.email_id)
    );
    const keptIds = new Set();
    for (const s of remaining) {
      for (const e of s.emails_summary || []) keptIds.add(e.email_id);
    }
    const exclusiveIds = [...removedIds].filter((id) => !keptIds.has(id));

    for (const eid of exclusiveIds) {
      await emailStore.delete(eid);
      const { blobs } = await attStore.list({ prefix: eid + "/" });
      for (const blob of blobs) {
        await attStore.delete(blob.key);
      }
    }

    catalog.sources = remaining;
    catalog.total_sources = remaining.length;
    catalog.total_emails = remaining.reduce((s, src) => s + src.email_count, 0);
    await catalogStore.setJSON("main", catalog);

    return Response.json({ status: "ok", deleted_emails: exclusiveIds.length });
  }

  // New format: use meta + individual source blobs
  if (!source) {
    return Response.json({ error: "Source not found" }, { status: 404 });
  }

  const removedIds = new Set(
    (source.emails_summary || []).map((e) => e.email_id)
  );

  // Check which IDs are exclusive to this source
  const keptIds = new Set();
  const otherSourceIds = (meta.source_ids || []).filter((id) => id !== sourceId);
  for (const otherId of otherSourceIds) {
    const other = await catalogStore.get("source/" + otherId, { type: "json" });
    if (other) {
      for (const e of other.emails_summary || []) keptIds.add(e.email_id);
    }
  }

  const exclusiveIds = [...removedIds].filter((id) => !keptIds.has(id));

  for (const eid of exclusiveIds) {
    await emailStore.delete(eid);
    const { blobs } = await attStore.list({ prefix: eid + "/" });
    for (const blob of blobs) {
      await attStore.delete(blob.key);
    }
  }

  // Delete the source blob and update meta
  await catalogStore.delete("source/" + sourceId);
  meta.source_ids = otherSourceIds;
  meta.total_sources = otherSourceIds.length;
  meta.total_emails = (meta.total_emails || 0) - (source.email_count || 0);
  if (meta.total_emails < 0) meta.total_emails = 0;
  await catalogStore.setJSON("meta", meta);

  return Response.json({ status: "ok", deleted_emails: exclusiveIds.length });
};
