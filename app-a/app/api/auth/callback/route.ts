import { NextRequest, NextResponse } from "next/server";
import { setToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:3001";
const APP_URL = process.env.APP_URL || "http://localhost:3100";

/**
 * GET /api/auth/callback?code=xxx
 * SSO 授權碼回調：用 code 換取 token，存入 cookie，導到 dashboard
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", APP_URL));
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/sso/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/?error=exchange_failed", APP_URL));
    }

    const { token } = await res.json();
    await setToken(token);

    return NextResponse.redirect(new URL("/dashboard", APP_URL));
  } catch {
    return NextResponse.redirect(new URL("/?error=callback_failed", APP_URL));
  }
}
