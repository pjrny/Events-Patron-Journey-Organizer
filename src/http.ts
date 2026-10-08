export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * Sites allowed to embed the organizer pages in an <iframe>.
 * - pjrny.com (any subdomain, incl. www) is the public embed target (www.pjrny.com/organizers).
 * - patronjourney.odoo.com / patronjourney.com are included because the Odoo website editor previews
 *   pjrny pages inside a backend iframe, and frame-ancestors is checked against EVERY ancestor.
 * Everything else (including X-Frame-Options-style clickjacking from other sites) stays blocked.
 */
export const FRAME_ANCESTORS = [
  "'self'",
  "https://pjrny.com",
  "https://*.pjrny.com",
  "https://patronjourney.com",
  "https://*.patronjourney.com",
  "https://patronjourney.odoo.com",
];

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // X-Frame-Options cannot express an allow-list, so it is intentionally NOT sent; CSP frame-ancestors replaces it.
      "content-security-policy": `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(self)",
    },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ ok: false, error: err.code, message: err.message }, err.status);
  console.error("unhandled", err instanceof Error ? err.message : String(err));
  return json({ ok: false, error: "internal_error" }, 500);
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip");
}
