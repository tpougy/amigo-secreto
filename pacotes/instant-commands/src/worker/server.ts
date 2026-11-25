// Embedded HTTP server of webhook mode: the webhook route and a health check.
export function startServer(options: {
  port: number;
  path: string;
  healthPath: string;
  maxBodyBytes: number;
  handler: (req: Request) => Promise<Response>;
}): { port: number; stop(): Promise<void> } {
  const server = Bun.serve({
    port: options.port,
    maxRequestBodySize: options.maxBodyBytes,
    routes: {
      [options.path]: { POST: options.handler },
      [options.healthPath]: { GET: () => new Response("ok") },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  return {
    port: server.port as number,
    async stop() {
      await server.stop(true);
    },
  };
}
