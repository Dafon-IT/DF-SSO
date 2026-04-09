import { NextResponse } from "next/server";
import { clearToken } from "../../../../lib/sso";

const APP_URL = process.env.APP_URL || "http://localhost:3100";

/**
 * GET /api/auth/logout
 * 只清除本 App 的 token，不動 SSO 中央 session
 * 其他子專案維持登入狀態
 */
export async function GET() {
  await clearToken();
  return NextResponse.redirect(APP_URL);
}
