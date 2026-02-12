import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "attachments", consistency: "strong" });
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Paths: /api/attachments/:emailId/:filename (GET)
  //        /api/attachments/:emailId (POST, DELETE)

  if (req.method === "GET" && pathParts.length >= 4) {
    const emailId = pathParts[2];
    const filename = decodeURIComponent(pathParts.slice(3).join("/"));
    const key = emailId + "/" + filename;
    const blob = await store.get(key, { type: "arrayBuffer" });
    if (!blob) {
      return new Response("Attachment not found", { status: 404 });
    }
    const meta = await store.getMetadata(key);
    const contentType =
      meta?.metadata?.contentType || "application/octet-stream";
    return new Response(blob, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition":
          'attachment; filename="' + filename + '"',
      },
    });
  }

  if (req.method === "POST" && pathParts.length >= 3) {
    const emailId = pathParts[2];
    const { attachments } = await req.json();
    let saved = 0;
    for (const att of attachments || []) {
      if (!att.data) continue;
      const key = emailId + "/" + att.filename;
      // Decode base64 to binary
      const binaryStr = atob(att.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      await store.set(key, bytes, {
        metadata: {
          contentType: att.content_type || "application/octet-stream",
        },
      });
      saved++;
    }
    return Response.json({ status: "ok", saved });
  }

  if (req.method === "DELETE" && pathParts.length >= 3) {
    const emailId = pathParts[2];
    const { blobs } = await store.list({ prefix: emailId + "/" });
    for (const blob of blobs) {
      await store.delete(blob.key);
    }
    return Response.json({ status: "ok", deleted: blobs.length });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
};

export const config = {
  path: "/api/attachments/*",
};
