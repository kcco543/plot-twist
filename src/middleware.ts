import { NextResponse, type NextRequest } from "next/server";
import { BETA_COOKIE, betaRequired, verifyPass } from "@/lib/beta/token";

/**
 * Backstop for the public beta. Every paid AI route also checks the pass
 * itself (src/lib/ai/server/beta.ts); this catches any route that forgets.
 *   - /api/ai/* (except /api/ai/status) needs a valid beta pass when one is required
 *   - development tools (/dev/*, /api/dev/*) don't exist in production unless AI_USAGE_DASHBOARD=1
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/dev") || pathname.startsWith("/api/dev")) {
    if (process.env.NODE_ENV === "production" && process.env.AI_USAGE_DASHBOARD !== "1") return new NextResponse("Not found", { status: 404 });
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/ai/") && pathname !== "/api/ai/status" && betaRequired()) {
    const pass = await verifyPass(req.cookies.get(BETA_COOKIE)?.value);
    if (!pass) return NextResponse.json({ error: "beta_locked", message: "Enter a beta access code to use the AI features" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/ai/:path*", "/dev/:path*", "/api/dev/:path*"] };
