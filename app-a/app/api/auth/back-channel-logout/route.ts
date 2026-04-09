import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/back-channel-logout
 * 接收 SSO 中央的登出通知
 *
 * 因為本 App 不管理本地 session（每次都透過 SSO 中央驗證），
 * 所以 SSO 刪除中央 session 後，下次 /me 呼叫自然會失敗。
 * 此端點僅作為日誌記錄用途。
 */
export async function POST(request: NextRequest) {
  try {
    const { user_id } = await request.json();
    console.log(`[Back-channel Logout] User ${user_id} logged out from SSO`);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
