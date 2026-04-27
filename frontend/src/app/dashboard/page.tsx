"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/Dialog";
import { ThemePicker } from "@/components/ThemePicker";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ============================================
// Types
// ============================================
interface SessionUser {
  userId: string;
  email: string;
  name: string;
  erpData: {
    gen01: string;
    gen02: string;
    gen03: string;
    gem02: string;
    gen06: string;
  } | null;
}

interface AllowedItem {
  ppid: number;
  uid: string;
  domain: string;
  name: string;
  description: string;
  app_id: string;
  app_secret_last4: string | null;
  redirect_uris: string[];
  frontend_url: string | null;
  backend_docs_url: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
}

interface AdminItem {
  ppid: number;
  uid: string;
  azure_oid: string | null;
  email: string;
  name: string | null;
  is_active: boolean;
  is_newer: boolean;
  created_at: string;
}

interface LoginLog {
  ppid: number;
  uid: string;
  email: string;
  name: string;
  azure_oid: string;
  erp_gen01: string;
  erp_gem02: string;
  status: string;
  ip_address: string;
  created_at: string;
}

interface SettingItem {
  ppid: number;
  key: string;
  value: Record<string, unknown>;
  category: string;
  label: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Main Dashboard
// ============================================
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"allowed" | "logs" | "admins" | "settings">("allowed");

  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => router.push("/"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    // 兩層 Session 模型：中央回傳驗證後的 redirect URL，瀏覽器導過去即可（AD session 不動）
    // 登入頁本身不會自動 redirect 到 /authorize，所以 silent re-login 自然被擋下
    try {
      const res = await fetch(`${API}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect: `${window.location.origin}/?logged_out=1` }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string };
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }
    } catch {
      // SSO 不可達也至少清掉前端狀態並回首頁
    }
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-foreground-muted">載入中...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-surface border-b border-border shadow-sm">
        <div className="mx-auto flex items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold text-foreground">DF-SSO Dashboard</h1>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-base font-medium text-foreground">{user.name}</p>
              <p className="text-sm text-foreground-muted">{user.email}</p>
            </div>
            <ThemePicker />
            <button
              onClick={handleLogout}
              className="rounded-xl border border-border bg-surface px-4 py-2 text-base font-medium text-foreground transition-colors hover:cursor-pointer hover:bg-surface-muted"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mx-6 pt-6">
        <div className="flex gap-1 border-b border-border">
          <button
            onClick={() => setActiveTab("allowed")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors hover:cursor-pointer ${
              activeTab === "allowed"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            白名單管理
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors hover:cursor-pointer ${
              activeTab === "logs"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            登入紀錄
          </button>
          <button
            onClick={() => setActiveTab("admins")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors hover:cursor-pointer ${
              activeTab === "admins"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            管理員
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors hover:cursor-pointer ${
              activeTab === "settings"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            設定
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="m-6">
        {activeTab === "allowed" && <AllowedListPanel />}
        {activeTab === "logs" && <LoginLogPanel />}
        {activeTab === "admins" && <AdminManagerPanel />}
        {activeTab === "settings" && <SettingsPanel />}
      </main>
    </div>
  );
}

// ============================================
// Allowed List CRUD Panel
// ============================================
function AllowedListPanel() {
  const dialog = useDialog();
  const [items, setItems] = useState<AllowedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<AllowedItem | null>(null);
  const [form, setForm] = useState({ domain: "", name: "", description: "", redirect_uris: "", frontend_url: "", backend_docs_url: "" });
  const [credentialsMap, setCredentialsMap] = useState<Record<string, { app_id: string; app_secret: string }>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const comboboxRef = useRef<HTMLDivElement>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/allowed-list`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setItems(data.data);
    } catch (e) {
      console.error("Fetch allowed list error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const matched: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      for (const val of [item.name, item.domain, item.app_id]) {
        if (val && val.toLowerCase().includes(q) && !seen.has(val)) {
          seen.add(val);
          matched.push(val);
        }
      }
    }
    return matched.slice(0, 8);
  }, [items, searchQuery]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (statusFilter === "active" && !item.is_active) return false;
      if (statusFilter === "inactive" && item.is_active) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          (item.name || "").toLowerCase().includes(q) ||
          item.domain.toLowerCase().includes(q) ||
          item.app_id.toLowerCase().includes(q) ||
          (item.description || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [items, searchQuery, statusFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editItem ? "PUT" : "POST";
    const url = editItem
      ? `${API}/api/allowed-list/${editItem.uid}`
      : `${API}/api/allowed-list`;

    const payload: Record<string, unknown> = {
      domain: form.domain,
      name: form.name,
      description: form.description,
      frontend_url: form.frontend_url.trim() || null,
      backend_docs_url: form.backend_docs_url.trim() || null,
    };
    const uris = form.redirect_uris
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (uris.length > 0) payload.redirect_uris = uris;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      setShowForm(false);
      setEditItem(null);
      setForm({ domain: "", name: "", description: "", redirect_uris: "", frontend_url: "", backend_docs_url: "" });
      fetchList();
    } else {
      await dialog.alert({ type: "error", title: "操作失敗", message: data.error });
    }
  };

  const handleEdit = (item: AllowedItem) => {
    setEditItem(item);
    setForm({
      domain: item.domain,
      name: item.name || "",
      description: item.description || "",
      redirect_uris: (item.redirect_uris || []).join("\n"),
      frontend_url: item.frontend_url || "",
      backend_docs_url: item.backend_docs_url || "",
    });
    setShowForm(true);
  };

  const handleToggleActive = async (item: AllowedItem) => {
    await fetch(`${API}/api/allowed-list/${item.uid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    fetchList();
  };

  const handleDelete = async (item: AllowedItem) => {
    const ok = await dialog.confirm({
      type: "warning",
      title: "確認刪除",
      message: `確定要刪除「${item.name || item.domain}」嗎？`,
      confirmText: "刪除",
    });
    if (!ok) return;
    await fetch(`${API}/api/allowed-list/${item.uid}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchList();
  };

  const handleAdd = () => {
    setEditItem(null);
    setForm({ domain: "", name: "", description: "", redirect_uris: "", frontend_url: "", backend_docs_url: "" });
    setShowForm(true);
  };

  const handleShowCredentials = async (item: AllowedItem) => {
    if (credentialsMap[item.uid]) {
      // toggle off
      setCredentialsMap((prev) => {
        const next = { ...prev };
        delete next[item.uid];
        return next;
      });
      return;
    }
    try {
      const res = await fetch(`${API}/api/allowed-list/${item.uid}/credentials`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setCredentialsMap((prev) => ({ ...prev, [item.uid]: data.data }));
      } else {
        await dialog.alert({ type: "error", title: "取得 credentials 失敗", message: data.error });
      }
    } catch {
      await dialog.alert({ type: "error", title: "無法取得 credentials", message: "請稍後再試" });
    }
  };

  const handleRegenerateSecret = async (item: AllowedItem) => {
    const ok = await dialog.confirm({
      type: "warning",
      title: "重新產生 App Secret",
      message: `確定要重新產生「${item.name || item.domain}」的 app_secret 嗎？\n現有的 secret 將立即失效！`,
      confirmText: "重新產生",
    });
    if (!ok) return;
    try {
      const res = await fetch(`${API}/api/allowed-list/${item.uid}/regenerate-secret`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setCredentialsMap((prev) => ({
          ...prev,
          [item.uid]: { app_id: data.data.app_id, app_secret: data.data.app_secret },
        }));
        await dialog.alert({
          type: "info",
          title: "已重新產生",
          message: "app_secret 已重新產生，請立即複製！",
        });
      } else {
        await dialog.alert({ type: "error", title: "操作失敗", message: data.error });
      }
    } catch {
      await dialog.alert({ type: "error", title: "操作失敗", message: "請稍後再試" });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">應用程式管理</h2>
          <p className="text-sm text-foreground-muted mt-0.5">管理 SSO 串接的 Client App 與 OAuth2 Credentials</p>
        </div>
        <button
          onClick={handleAdd}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
        >
          + 新增應用
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="rounded-xl bg-surface p-4 shadow-sm border border-border flex flex-wrap gap-3 items-end">
        <div ref={comboboxRef} className="relative flex-1 min-w-[240px]">
          <label className="block text-sm font-medium text-foreground-muted mb-1">搜尋</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => { if (searchQuery.trim()) setShowSuggestions(true); }}
              placeholder="搜尋名稱、網域、App ID..."
              className="w-full rounded-xl border border-border pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-surface border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li
                  key={i}
                  onClick={() => { setSearchQuery(s); setShowSuggestions(false); }}
                  className="px-3 py-2 text-sm text-foreground cursor-pointer hover:bg-blue-50 hover:text-blue-700"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted mb-1">狀態</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
            className="rounded-xl border border-border px-3 py-2 text-sm w-32 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">全部</option>
            <option value="active">啟用中</option>
            <option value="inactive">已停用</option>
          </select>
        </div>
        {(searchQuery || statusFilter !== "all") && (
          <button
            onClick={() => { setSearchQuery(""); setStatusFilter("all"); setShowSuggestions(false); }}
            className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-gray-600 hover:bg-surface-muted"
          >
            清除篩選
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl bg-surface p-6 shadow-sm border border-border">
          <h3 className="text-base font-semibold text-foreground mb-4">
            {editItem ? "編輯應用" : "新增應用"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">網域 *</label>
                <input
                  type="text"
                  required
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  placeholder="https://crm.df-recycle.com.tw"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">系統名稱</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="CRM 系統"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">說明</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="系統說明"
                className="w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Redirect URIs</label>
              <textarea
                rows={3}
                value={form.redirect_uris}
                onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })}
                placeholder={"http://localhost:3100\nhttps://app.apps.zerozero.tw"}
                className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-foreground-muted">每行一個 origin（dev / test / prod），最多 10 筆</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Frontend URL（首頁）</label>
                <input
                  type="text"
                  value={form.frontend_url}
                  onChange={(e) => setForm({ ...form, frontend_url: e.target.value })}
                  placeholder="https://crm.df-recycle.com.tw"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-sm text-foreground-muted">DevOps 快速測試用，可空白</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Backend Docs URL（API 文件）</label>
                <input
                  type="text"
                  value={form.backend_docs_url}
                  onChange={(e) => setForm({ ...form, backend_docs_url: e.target.value })}
                  placeholder="https://api.df-recycle.com.tw/swagger"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-sm text-foreground-muted">Swagger / OpenAPI 文件，可空白</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
                {editItem ? "儲存變更" : "建立應用"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditItem(null); }}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-surface-muted"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl bg-surface shadow-sm border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm text-foreground-muted">
          共 {filteredItems.length}{filteredItems.length !== items.length ? ` / ${items.length}` : ""} 筆應用
        </div>
        {loading ? (
          <p className="py-12 text-center text-sm text-foreground-muted">載入中...</p>
        ) : filteredItems.length === 0 ? (
          <p className="py-12 text-center text-sm text-foreground-muted">
            {items.length === 0 ? "尚無應用程式" : "無符合條件的應用"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base min-w-[1280px]">
              <thead className="bg-surface-muted text-left text-base text-foreground-muted whitespace-nowrap">
                <tr>
                  <th className="px-5 py-3 font-medium min-w-[110px]">狀態</th>
                  <th className="px-5 py-3 font-medium min-w-[220px]">名稱</th>
                  <th className="px-5 py-3 font-medium min-w-[320px]">網域</th>
                  <th className="px-5 py-3 font-medium min-w-[460px]">Credentials</th>
                  <th className="px-5 py-3 font-medium min-w-[240px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((item) => {
                  const creds = credentialsMap[item.uid];
                  return (
                    <Fragment key={item.uid}>
                      <tr className="hover:bg-surface-muted/50 align-top">
                        <td className="px-5 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleActive(item)}
                            title={item.is_active ? "點擊停用" : "點擊啟用"}
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-base font-medium transition-colors hover:cursor-pointer ${
                              item.is_active
                                ? "bg-green-50 text-green-700 hover:bg-green-100"
                                : "bg-gray-100 text-foreground-muted hover:bg-gray-200"
                            }`}
                          >
                            <span className={`h-2 w-2 rounded-full ${item.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                            {item.is_active ? "啟用" : "停用"}
                          </button>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="font-medium text-foreground">{item.name || "未命名"}</div>
                          {item.description && <div className="text-sm text-foreground-muted mt-0.5">{item.description}</div>}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <a
                            href={item.domain}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="開啟新分頁"
                            className="inline-flex items-center gap-1.5 font-mono text-blue-600 hover:text-blue-800 hover:underline hover:cursor-pointer transition-colors"
                          >
                            {item.domain}
                            <svg className="h-3.5 w-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                          {(item.frontend_url || item.backend_docs_url) && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {item.frontend_url && (
                                <a
                                  href={item.frontend_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={item.frontend_url}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-base font-medium text-foreground-muted transition-colors hover:cursor-pointer hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8M12 3a14.5 14.5 0 010 18M12 3a14.5 14.5 0 000 18" />
                                  </svg>
                                  首頁
                                </a>
                              )}
                              {item.backend_docs_url && (
                                <a
                                  href={item.backend_docs_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={item.backend_docs_url}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-base font-medium text-foreground-muted transition-colors hover:cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                  </svg>
                                  API Docs
                                </a>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                            {/* App ID */}
                            <dt className="font-medium text-foreground-muted whitespace-nowrap">App ID</dt>
                            <dd className="flex items-center gap-2 min-w-0">
                              <code className="rounded bg-blue-50 px-2 py-0.5 font-mono text-blue-700 select-all break-all">{item.app_id}</code>
                              <button onClick={() => copyToClipboard(item.app_id)} className="shrink-0 text-foreground-muted hover:text-gray-600 hover:cursor-pointer transition-colors" title="複製">
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                              </button>
                            </dd>

                            {/* App Secret */}
                            <dt className="font-medium text-foreground-muted whitespace-nowrap">App Secret</dt>
                            <dd className="flex items-center gap-2 min-w-0">
                              {creds ? (
                                <>
                                  <code className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 font-mono text-gray-800 select-all break-all">
                                    {creds.app_secret}
                                  </code>
                                  <button onClick={() => copyToClipboard(creds.app_secret)} className="shrink-0 text-amber-500 hover:text-amber-700 hover:cursor-pointer transition-colors" title="複製完整 Secret">
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                                  </button>
                                  <button onClick={() => handleShowCredentials(item)} className="shrink-0 text-amber-600 hover:text-amber-800 hover:cursor-pointer transition-colors" title="隱藏">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="font-mono text-foreground-muted">••••••••••••••••</span>
                                  <button onClick={() => handleShowCredentials(item)} className="shrink-0 text-indigo-600 hover:text-indigo-800 hover:cursor-pointer transition-colors" title="顯示">
                                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                  </button>
                                </>
                              )}
                            </dd>

                            {/* Redirect URIs */}
                            <dt className="font-medium text-foreground-muted whitespace-nowrap">Redirect URI</dt>
                            <dd className="min-w-0">
                              {item.redirect_uris?.length > 0 ? (
                                <ul className="flex flex-col gap-1">
                                  {item.redirect_uris.map((uri, i) => (
                                    <li key={i} className="flex items-center gap-2 min-w-0">
                                      <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700 select-all break-all">{uri}</code>
                                      <button onClick={() => copyToClipboard(uri)} className="shrink-0 text-foreground-muted hover:text-gray-600 hover:cursor-pointer transition-colors" title="複製">
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-foreground-muted">-</span>
                              )}
                            </dd>
                          </dl>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {creds && (
                              <button
                                onClick={() => handleRegenerateSecret(item)}
                                className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-base font-medium text-amber-700 hover:bg-amber-100 hover:cursor-pointer transition-colors"
                              >
                                重新產生
                              </button>
                            )}
                            <button onClick={() => handleEdit(item)} className="rounded-xl px-3 py-1.5 text-base font-medium text-blue-600 hover:bg-blue-50 hover:cursor-pointer transition-colors">
                              編輯
                            </button>
                            <button onClick={() => handleDelete(item)} className="rounded-xl px-3 py-1.5 text-base font-medium text-red-500 hover:bg-red-50 hover:cursor-pointer transition-colors">
                              刪除
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Login Log Search Panel
// ============================================
function LoginLogPanel() {
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [filters, setFilters] = useState({
    email: "",
    status: "",
    startDate: "",
    endDate: "",
    page: 1,
  });

  const fetchLogs = useCallback(async (params: typeof filters) => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (params.email) query.set("email", params.email);
      if (params.status) query.set("status", params.status);
      if (params.startDate) query.set("startDate", params.startDate);
      if (params.endDate) query.set("endDate", params.endDate);
      query.set("page", String(params.page));
      query.set("pageSize", "20");

      const res = await fetch(`${API}/api/login-log?${query.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.data);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (e) {
      console.error("Fetch login log error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(filters);
  }, [filters, fetchLogs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters({ ...filters, page: 1 });
  };

  const handleReset = () => {
    setFilters({ email: "", status: "", startDate: "", endDate: "", page: 1 });
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "success":
        return (
          <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-700">
            成功
          </span>
        );
      case "failed":
        return (
          <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-700">
            失敗
          </span>
        );
      case "erp_not_found":
        return (
          <span className="inline-block rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-medium text-yellow-700">
            ERP 未找到
          </span>
        );
      default:
        return (
          <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-medium text-gray-600">
            {s}
          </span>
        );
    }
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">登入紀錄搜尋</h2>

      {/* Filters */}
      <form
        onSubmit={handleSearch}
        className="rounded-xl bg-surface p-4 shadow-sm flex flex-wrap gap-3 items-end"
      >
        <div>
          <label className="block text-sm font-medium text-foreground-muted mb-1">
            Email
          </label>
          <input
            type="text"
            value={filters.email}
            onChange={(e) => setFilters({ ...filters, email: e.target.value })}
            placeholder="搜尋 Email"
            className="rounded-xl border border-border px-3 py-2 text-base w-52 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted mb-1">
            狀態
          </label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-xl border border-border px-3 py-2 text-base w-40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">全部</option>
            <option value="success">成功</option>
            <option value="failed">失敗</option>
            <option value="erp_not_found">ERP 未找到</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted mb-1">
            開始日期
          </label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) =>
              setFilters({ ...filters, startDate: e.target.value })
            }
            className="rounded-xl border border-border px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-muted mb-1">
            結束日期
          </label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) =>
              setFilters({ ...filters, endDate: e.target.value })
            }
            className="rounded-xl border border-border px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700"
        >
          搜尋
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-xl border border-border px-4 py-2 text-base font-medium text-foreground hover:bg-surface-muted"
        >
          重置
        </button>
      </form>

      {/* Results */}
      <div className="rounded-xl bg-surface shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm text-foreground-muted">
          共 {total} 筆紀錄
        </div>
        {loading ? (
          <p className="p-6 text-base text-foreground-muted">載入中...</p>
        ) : logs.length === 0 ? (
          <p className="p-6 text-base text-foreground-muted">無符合條件的紀錄</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base min-w-[1100px]">
              <thead className="bg-surface-muted text-left text-foreground-muted whitespace-nowrap">
                <tr>
                  <th className="px-4 py-3 font-medium min-w-[200px]">時間</th>
                  <th className="px-4 py-3 font-medium min-w-[240px]">Email</th>
                  <th className="px-4 py-3 font-medium min-w-[140px]">姓名</th>
                  <th className="px-4 py-3 font-medium min-w-[130px]">員工編號</th>
                  <th className="px-4 py-3 font-medium min-w-[140px]">部門</th>
                  <th className="px-4 py-3 font-medium min-w-[120px]">狀態</th>
                  <th className="px-4 py-3 font-medium min-w-[140px]">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.uid}>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{log.email || "-"}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{log.name || "-"}</td>
                    <td className="px-4 py-3 font-mono text-sm text-foreground whitespace-nowrap">
                      {log.erp_gen01 || "-"}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {log.erp_gem02 || "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{statusLabel(log.status)}</td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {log.ip_address || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一頁
            </button>
            <span className="text-sm text-foreground-muted">
              第 {filters.page} / {totalPages} 頁
            </span>
            <button
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一頁
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Admin Manager Panel
// ============================================
function AdminManagerPanel() {
  const dialog = useDialog();
  const [admins, setAdmins] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "" });

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin-manager`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setAdmins(data.data);
    } catch (e) {
      console.error("Fetch admin list error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${API}/api/admin-manager`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: form.email }),
    });
    const data = await res.json();
    if (data.success) {
      setShowForm(false);
      setForm({ email: "" });
      fetchAdmins();
    } else {
      await dialog.alert({ type: "error", title: "操作失敗", message: data.error });
    }
  };

  const handleToggleActive = async (item: AdminItem) => {
    await fetch(`${API}/api/admin-manager/${item.uid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    fetchAdmins();
  };

  const handleDelete = async (item: AdminItem) => {
    const ok = await dialog.confirm({
      type: "warning",
      title: "確認刪除管理員",
      message: `確定要刪除管理員「${item.name || item.email}」嗎？`,
      confirmText: "刪除",
    });
    if (!ok) return;
    const res = await fetch(`${API}/api/admin-manager/${item.uid}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json();
    if (!data.success) {
      await dialog.alert({ type: "error", title: "刪除失敗", message: data.error });
    }
    fetchAdmins();
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">管理員名單</h2>
        <button
          onClick={() => {
            setForm({ email: "" });
            setShowForm(true);
          }}
          className="rounded-xl bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700 transition-colors"
        >
          新增管理員
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl bg-surface p-6 shadow-sm border border-border">
          <h3 className="text-base font-semibold text-foreground mb-4">
            新增管理員
          </h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-base font-medium text-foreground mb-1">
                Email *
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ email: e.target.value })}
                placeholder="new-admin@df-recycle.com"
                className="w-full rounded-xl border border-border px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-foreground-muted">
                新管理員首次登入 SSO 後會自動填入姓名與 Azure AD 資訊
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700"
              >
                新增
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-border px-4 py-2 text-base font-medium text-foreground hover:bg-surface-muted"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl bg-surface shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-base text-foreground-muted">載入中...</p>
        ) : admins.length === 0 ? (
          <p className="p-6 text-base text-foreground-muted">尚無資料</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base min-w-[960px]">
              <thead className="bg-surface-muted text-left text-foreground-muted whitespace-nowrap">
                <tr>
                  <th className="px-4 py-3 font-medium min-w-[260px]">Email</th>
                  <th className="px-4 py-3 font-medium min-w-[160px]">姓名</th>
                  <th className="px-4 py-3 font-medium min-w-[110px]">狀態</th>
                  <th className="px-4 py-3 font-medium min-w-[130px]">登入狀態</th>
                  <th className="px-4 py-3 font-medium min-w-[200px]">建立時間</th>
                  <th className="px-4 py-3 font-medium min-w-[100px]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {admins.map((item) => (
                  <tr key={item.uid}>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{item.email}</td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {item.name || "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleActive(item)}
                        className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${
                          item.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-foreground-muted"
                        }`}
                      >
                        {item.is_active ? "啟用" : "停用"}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.is_newer ? (
                        <span className="inline-block rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-medium text-yellow-700">
                          未登入
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-700">
                          已啟用
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted whitespace-nowrap">
                      {formatDate(item.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(item)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Settings Panel — 動態編輯 sso_setting 表
// ============================================
const CATEGORY_LABELS: Record<string, string> = {
  rate_limit: "速率限制（Rate Limit）",
  general: "一般設定",
};

function SettingsPanel() {
  const dialog = useDialog();
  const [items, setItems] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/sso-setting`, { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        const initialDrafts: Record<string, Record<string, unknown>> = {};
        for (const item of data.data as SettingItem[]) {
          initialDrafts[item.key] = { ...item.value };
        }
        setDrafts(initialDrafts);
      }
    } catch (e) {
      console.error("Fetch sso-setting error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const setField = (key: string, field: string, value: unknown) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }));
  };

  const isDirty = (item: SettingItem) => {
    const draft = drafts[item.key] || {};
    return JSON.stringify(draft) !== JSON.stringify(item.value);
  };

  const handleSave = async (item: SettingItem) => {
    const draft = drafts[item.key];
    if (!draft) return;
    setSavingKey(item.key);
    try {
      const res = await fetch(`${API}/api/sso-setting/${encodeURIComponent(item.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value: draft }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchSettings();
      } else {
        await dialog.alert({ type: "error", title: "儲存失敗", message: data.error });
      }
    } catch {
      await dialog.alert({ type: "error", title: "儲存失敗", message: "請稍後再試" });
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = (item: SettingItem) => {
    setDrafts((prev) => ({ ...prev, [item.key]: { ...item.value } }));
  };

  const grouped = items.reduce<Record<string, SettingItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  const renderRateLimitEditor = (item: SettingItem) => {
    const draft = drafts[item.key] || {};
    const windowMs = Number(draft.windowMs ?? 0);
    const max = Number(draft.max ?? 0);
    const windowMinutes = windowMs / 60000;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            視窗長度 windowMs（毫秒）
          </label>
          <input
            type="number"
            min={1000}
            step={1000}
            value={windowMs}
            onChange={(e) => setField(item.key, "windowMs", Number(e.target.value))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-sm text-foreground-muted">
            約 {windowMinutes >= 1 ? `${windowMinutes} 分鐘` : `${windowMs / 1000} 秒`}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            最大請求數 max（每 IP / 每視窗）
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={max}
            onChange={(e) => setField(item.key, "max", Number(e.target.value))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    );
  };

  const renderJsonEditor = (item: SettingItem) => {
    const draft = drafts[item.key] || {};
    const text = JSON.stringify(draft, null, 2);
    return (
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">JSON value</label>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                setDrafts((prev) => ({ ...prev, [item.key]: parsed }));
              }
            } catch {
              // 無效 JSON 時先不更新 draft
            }
          }}
          className="w-full rounded-xl border border-border px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">系統設定</h2>
        <p className="text-sm text-foreground-muted mt-0.5">
          儲存於 sso_setting 表，rate_limit 類型修改後立即生效（視窗計數會重置）
        </p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-foreground-muted">載入中...</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-foreground-muted">尚無設定</p>
      ) : (
        Object.entries(grouped).map(([category, group]) => (
          <section key={category} className="space-y-3">
            <h3 className="text-base font-semibold text-gray-800">
              {CATEGORY_LABELS[category] || category}
            </h3>
            <div className="grid gap-4">
              {group.map((item) => {
                const dirty = isDirty(item);
                const saving = savingKey === item.key;
                return (
                  <div key={item.key} className="rounded-xl bg-surface shadow-sm border border-border overflow-hidden">
                    <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-foreground">{item.label || item.key}</h4>
                        <code className="text-sm text-foreground-muted font-mono">{item.key}</code>
                      </div>
                      {dirty && (
                        <span className="text-sm font-medium text-amber-600">未儲存</span>
                      )}
                    </div>
                    <div className="px-5 py-4 space-y-3">
                      {item.description && (
                        <p className="text-sm text-foreground-muted">{item.description}</p>
                      )}
                      {category === "rate_limit"
                        ? renderRateLimitEditor(item)
                        : renderJsonEditor(item)}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          disabled={!dirty || saving}
                          onClick={() => handleSave(item)}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {saving ? "儲存中..." : "儲存"}
                        </button>
                        <button
                          type="button"
                          disabled={!dirty || saving}
                          onClick={() => handleReset(item)}
                          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          重設
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
