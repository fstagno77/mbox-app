import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "emails", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const emailId = url.searchParams.get("id");
    const all = url.searchParams.get("all");

    if (emailId) {
      const email = await store.get(emailId, { type: "json" });
      if (!email) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json(email);
    }

    if (all === "true") {
      const { blobs } = await store.list();
      const emails = {};
      const keys = blobs.map((b) => b.key);
      for (let i = 0; i < keys.length; i += 20) {
        const chunk = keys.slice(i, i + 20);
        const results = await Promise.all(
          chunk.map((key) => store.get(key, { type: "json" }))
        );
        chunk.forEach((key, idx) => {
          if (results[idx]) emails[key] = results[idx];
        });
      }
      return Response.json(emails);
    }

    return Response.json({ error: "Missing id or all param" }, { status: 400 });
  }

  if (req.method === "POST") {
    const { emails } = await req.json();
    const keys = Object.keys(emails || {});
    for (let i = 0; i < keys.length; i += 20) {
      const chunk = keys.slice(i, i + 20);
      await Promise.all(chunk.map((key) => store.setJSON(key, emails[key])));
    }
    return Response.json({ status: "ok", saved: keys.length });
  }

  if (req.method === "DELETE") {
    const { ids } = await req.json();
    if (ids && ids.length > 0) {
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        await Promise.all(chunk.map((id) => store.delete(id)));
      }
    }
    return Response.json({ status: "ok", deleted: (ids || []).length });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};
