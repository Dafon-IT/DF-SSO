import { NextResponse } from "next/server";
import { getToken, clearToken } from "../../../../lib/sso";

const SSO_URL = process.env.SSO_URL || "http://localhost:3001";

/**
 * GET /api/auth/me
 * 透過 SSO 中央驗證 token，回傳用戶資料
 * Client App 不自行管理 session，每次都問 SSO 中央
 */
export async function GET() {
  const token = await getToken();

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const res = await fetch(`${SSO_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      // SSO 中央 session 已失效（可能被其他 App 登出），清除本地 token
      await clearToken();
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "SSO unreachable" }, { status: 502 });
  }
}
