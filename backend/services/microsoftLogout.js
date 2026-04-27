import config from '../config/index.js';

/**
 * 建構 Microsoft Azure AD end_session_endpoint URL（OIDC RP-Initiated Logout）
 *
 * 為什麼需要：
 * - SSO 中央登出只清掉 Redis session + Client App cookie，但 AD 自己在
 *   login.microsoftonline.com 上的 SSO cookie 還活著。
 * - 不引導瀏覽器走 AD 登出，下次 /authorize 會被靜默重新登入（silent SSO），
 *   等於登出沒效果。
 *
 * 為什麼不直接把 Client App 的 URL 當 post_logout_redirect_uri：
 * - Microsoft 要求 post_logout_redirect_uri 必須是 Azure App Registration
 *   裡「Front-channel logout URL」清單中的一員。
 * - 統一用 SSO 自己的 /api/auth/sso/post-logout 當跳板，Azure 那邊只要登記
 *   一組 URL（每個環境一組）。實際的 Client App 目的地由 SSO 自己依
 *   sso_allowed_list 驗證後再 redirect。
 *
 * @param {string} idToken - Microsoft 登入時拿到的 id_token（建議帶；省略時 AD 會顯示帳號選單）
 * @param {string} finalRedirect - AD 登出後最終要落地的 URL（會被 SSO post-logout 端點驗證）
 * @returns {string} 完整的 Microsoft logout URL
 */
export function buildMicrosoftLogoutUrl(idToken, finalRedirect) {
  const postLogoutBase = `${config.azure.backendOrigin}/api/auth/sso/post-logout`;
  const postLogoutUri = `${postLogoutBase}?redirect=${encodeURIComponent(finalRedirect)}`;

  const params = new URLSearchParams({
    post_logout_redirect_uri: postLogoutUri,
  });
  if (idToken) {
    params.set('id_token_hint', idToken);
  }
  return `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/logout?${params.toString()}`;
}
