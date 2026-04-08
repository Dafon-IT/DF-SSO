'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import styles from './login.module.css';

function MicrosoftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="21"
      height="21"
      viewBox="0 0 21 21"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const ERROR_MAP: Record<string, string> = {
  microsoft_login_failed: 'Microsoft 登入失敗，請稍後再試',
  invalid_state: '驗證失敗（state 無效），請重新登入',
  token_exchange_failed: 'Token 交換失敗，請稍後再試',
  access_denied: '使用者拒絕授權',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>DF-SSO</h1>
        <p className={styles.subtitle}>大豐 SSO 登入驗證</p>

        {error && (
          <div className={styles.error}>
            {ERROR_MAP[error] || `登入錯誤：${error}`}
          </div>
        )}

        <div className={styles.divider}>
          <span>登入方式</span>
        </div>

        <a href="/api/auth/microsoft/login" className={styles.microsoftBtn}>
          <MicrosoftIcon />
          使用 Microsoft 帳號登入
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
