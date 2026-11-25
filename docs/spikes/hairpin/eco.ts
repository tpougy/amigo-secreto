// Servidor de eco descartável do spike de hairpin: registra a origem das entregas do webhook do Instant.
Bun.serve({
  port: Number(process.env.PORT ?? 5000),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
    if (req.method === "POST" && url.pathname === "/ic/hook") {
      const corpo = await req.text();
      console.log(
        JSON.stringify({
          eco: true,
          "x-forwarded-for": req.headers.get("x-forwarded-for"),
          "x-real-ip": req.headers.get("x-real-ip"),
          "instant-signature": req.headers.has("instant-signature") ? "presente" : "ausente",
          corpo: corpo.slice(0, 300),
        }),
      );
      return new Response("ok");
    }
    return new Response("nao encontrado", { status: 404 });
  },
});
