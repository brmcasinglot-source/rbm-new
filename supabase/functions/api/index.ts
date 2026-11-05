import handler from "../_shared/api.js";

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return Response.json({ error: "This application origin is not allowed." }, { status: 403 });
  }

  const corsHeaders = new Headers();
  if (origin) {
    corsHeaders.set("Access-Control-Allow-Origin", origin);
    corsHeaders.set("Vary", "Origin");
  }
  corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  corsHeaders.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
  corsHeaders.set("Access-Control-Max-Age", "86400");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    corsHeaders.set("Allow", "POST, OPTIONS");
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 3_000_000) {
    return Response.json({ error: "Request is too large." }, { status: 413, headers: corsHeaders });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 3_000_000) {
      return Response.json({ error: "Request is too large." }, { status: 413, headers: corsHeaders });
    }
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: corsHeaders });
  }

  const responseHeaders = new Headers(corsHeaders);
  let responseBody = "";
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      responseHeaders.set(name, value);
    },
    end(value = "") {
      responseBody = value;
    },
  };
  const apiRequest = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    socket: { remoteAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() },
  };

  await handler(apiRequest, response);
  return new Response(responseBody, {
    status: response.statusCode,
    headers: responseHeaders,
  });
});
