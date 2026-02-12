import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const sourceId = pathParts[2];
  if (!sourceId) {
    return Response.json({ error: "Missing source_id" }, { status: 400 });
  }

  const catalogStore = getStore({ name: "catalog", consistency: "strong" });
  const emailStore = getStore({ name: "emails", consistency: "strong" });
  const attStore = getStore({ name: "attachments", consistency: "strong" });

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

  // Find exclusive email IDs
  const removedIds = new Set(
    (target.emails_summary || []).map((e) => e.email_id)
  );
  const keptIds = new Set();
  for (const s of remaining) {
    for (const e of s.emails_summary || []) keptIds.add(e.email_id);
  }
  const exclusiveIds = [...removedIds].filter((id) => !keptIds.has(id));

  // Delete exclusive emails and their attachments
  for (const eid of exclusiveIds) {
    await emailStore.delete(eid);
    const { blobs } = await attStore.list({ prefix: eid + "/" });
    for (const blob of blobs) {
      await attStore.delete(blob.key);
    }
  }

  // Update catalog
  catalog.sources = remaining;
  catalog.total_sources = remaining.length;
  catalog.total_emails = remaining.reduce((s, src) => s + src.email_count, 0);
  await catalogStore.setJSON("main", catalog);

  return Response.json({ status: "ok", deleted_emails: exclusiveIds.length });
};

export const config = {
  path: "/api/sources/*",
  method: ["DELETE"],
};
