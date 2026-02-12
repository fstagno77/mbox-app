import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "attachments", consistency: "strong" });
  const url = new URL(req.url);
  const emailId = url.searchParams.get("emailId");
  const filename = url.searchParams.get("filename");

  if (req.method === "GET" && emailId && filename) {
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
        "Content-Disposition": 'attachment; filename="' + filename + '"',
      },
    });
  }

  if (req.method === "POST" && emailId) {
    const { attachments } = await req.json();
    let saved = 0;
    for (const att of attachments || []) {
      if (!att.data) continue;
      const key = emailId + "/" + att.filename;
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

  if (req.method === "DELETE" && emailId) {
    const { blobs } = await store.list({ prefix: emailId + "/" });
    for (const blob of blobs) {
      await store.delete(blob.key);
    }
    return Response.json({ status: "ok", deleted: blobs.length });
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
};
