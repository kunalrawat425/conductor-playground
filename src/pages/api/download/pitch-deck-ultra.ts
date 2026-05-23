import { readFile } from "node:fs/promises";

export const prerender = false;

export async function GET() {
  const filePath = new URL("../../../../public/pitch-deck-ultra.html", import.meta.url);
  const html = await readFile(filePath, "utf8");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Relifish-Ultra-Pitch-Deck.html"',
      "Cache-Control": "no-store",
    },
  });
}
