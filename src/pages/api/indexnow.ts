import type { APIRoute } from "astro";

const INDEXNOW_KEY = import.meta.env.INDEXNOW_KEY || "a1b2c3d4e5f6g7h8i9j0";
const HOST = "https://www.relifish.store";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const urls: string[] = body.urls || [];

    if (!urls.length) {
      return new Response(JSON.stringify({ error: "No URLs provided" }), { status: 400 });
    }

    // Submit to Bing IndexNow
    const resp = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: "www.relifish.store",
        key: INDEXNOW_KEY,
        keyLocation: `${HOST}/${INDEXNOW_KEY}.txt`,
        urlList: urls.map(u => u.startsWith("http") ? u : `${HOST}${u}`),
      }),
    });

    return new Response(JSON.stringify({
      success: true,
      status: resp.status,
      submitted: urls.length,
    }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
