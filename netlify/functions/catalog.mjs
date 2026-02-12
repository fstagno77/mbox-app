import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "catalog", consistency: "strong" });

  if (req.method === "GET") {
    const catalog = await store.get("main", { type: "json" });
    if (!catalog) {
      return Response.json({ total_emails: 0, total_sources: 0, sources: [] });
    }
    return Response.json(catalog);
  }

  if (req.method === "PUT") {
    const catalog = await req.json();
    await store.setJSON("main", catalog);
    return Response.json({ status: "ok" });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config = {
  path: "/api/catalog",
  method: ["GET", "PUT"],
};
