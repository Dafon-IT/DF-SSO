import { cookies } from "next/headers";

const SSO_TOKEN_COOKIE = "sso_token";
const COOKIE_MAX_AGE = 24 * 60 * 60; // 24 小時（跟 SSO JWT 同步）

/**
 * 儲存 SSO token 到 cookie
 */
export async function setToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SSO_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

/**
 * 讀取 SSO token
 */
export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SSO_TOKEN_COOKIE)?.value ?? null;
}

/**
 * 清除 SSO token
 */
export async function clearToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SSO_TOKEN_COOKIE);
}
