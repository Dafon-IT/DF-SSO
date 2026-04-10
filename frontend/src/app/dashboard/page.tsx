"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

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

// ============================================
// Main Dashboard
// ============================================
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"allowed" | "logs" | "admins">("allowed");

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
    await fetch(`${API}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">載入中...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex items-center justify-between px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900">DF-SSO Dashboard</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-base font-medium text-gray-900">{user.name}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mx-6 pt-6">
        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setActiveTab("allowed")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors ${
              activeTab === "allowed"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            白名單管理
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors ${
              activeTab === "logs"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            登入紀錄
          </button>
          <button
            onClick={() => setActiveTab("admins")}
            className={`px-4 py-2.5 text-base font-medium border-b-2 transition-colors ${
              activeTab === "admins"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            管理員
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="m-6">
        {activeTab === "allowed" && <AllowedListPanel />}
        {activeTab === "logs" && <LoginLogPanel />}
        {activeTab === "admins" && <AdminManagerPanel />}
      </main>
    </div>
  );
}

// ============================================
// Allowed List CRUD Panel
// ============================================
function AllowedListPanel() {
  const [items, setItems] = useState<AllowedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<AllowedItem | null>(null);
  const [form, setForm] = useState({ domain: "", name: "", description: "", redirect_uris: "" });
  const [credentialsMap, setCredentialsMap] = useState<Record<string, { app_id: string; app_secret: string }>>({});

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
      setForm({ domain: "", name: "", description: "", redirect_uris: "" });
      fetchList();
    } else {
      alert(data.error || "操作失敗");
    }
  };

  const handleEdit = (item: AllowedItem) => {
    setEditItem(item);
    setForm({
      domain: item.domain,
      name: item.name || "",
      description: item.description || "",
      redirect_uris: (item.redirect_uris || []).join("\n"),
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
    if (!confirm(`確定要刪除「${item.name || item.domain}」嗎？`)) return;
    await fetch(`${API}/api/allowed-list/${item.uid}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchList();
  };

  const handleAdd = () => {
    setEditItem(null);
    setForm({ domain: "", name: "", description: "", redirect_uris: "" });
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
        alert(data.error || "取得 credentials 失敗");
      }
    } catch {
      alert("無法取得 credentials");
    }
  };

  const handleRegenerateSecret = async (item: AllowedItem) => {
    if (!confirm(`確定要重新產生「${item.name || item.domain}」的 app_secret 嗎？\n現有的 secret 將立即失效！`)) return;
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
        alert("app_secret 已重新產生，請立即複製！");
      } else {
        alert(data.error || "操作失敗");
      }
    } catch {
      alert("操作失敗");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">應用程式管理</h2>
          <p className="text-sm text-gray-500 mt-0.5">管理 SSO 串接的 Client App 與 OAuth2 Credentials</p>
        </div>
        <button
          onClick={handleAdd}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
        >
          + 新增應用
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 mb-4">
            {editItem ? "編輯應用" : "新增應用"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">網域 *</label>
                <input
                  type="text"
                  required
                  value={form.domain}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })}
                  placeholder="https://crm.df-recycle.com.tw"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">系統名稱</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="CRM 系統"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">說明</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="系統說明"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URIs</label>
              <textarea
                rows={3}
                value={form.redirect_uris}
                onChange={(e) => setForm({ ...form, redirect_uris: e.target.value })}
                placeholder={"http://localhost:3100\nhttps://app.apps.zerozero.tw"}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">每行一個 origin（dev / test / prod），最多 10 筆</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
                {editItem ? "儲存變更" : "建立應用"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditItem(null); }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <p className="py-12 text-center text-sm text-gray-400">載入中...</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">尚無應用程式</p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const creds = credentialsMap[item.uid];
            return (
              <div key={item.uid} className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
                {/* Card Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${item.is_active ? "bg-green-500" : "bg-gray-300"}`} />
                    <h3 className="font-semibold text-gray-900">{item.name || "未命名應用"}</h3>
                    {item.description && <span className="text-sm text-gray-400">- {item.description}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        item.is_active
                          ? "bg-green-50 text-green-700 hover:bg-green-100"
                          : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                      }`}
                    >
                      {item.is_active ? "啟用中" : "已停用"}
                    </button>
                    <button onClick={() => handleEdit(item)} className="rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors">
                      編輯
                    </button>
                    <button onClick={() => handleDelete(item)} className="rounded-md px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                      刪除
                    </button>
                  </div>
                </div>

                {/* Card Body */}
                <div className="px-5 py-4 space-y-3">
                  {/* Domain */}
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0 text-xs font-medium text-gray-400 pt-0.5">Domain</span>
                    <code className="text-sm text-gray-700 font-mono">{item.domain}</code>
                  </div>

                  {/* Redirect URIs */}
                  {item.redirect_uris && item.redirect_uris.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="w-24 shrink-0 text-xs font-medium text-gray-400 pt-1">Redirect URIs</span>
                      <div className="flex flex-wrap gap-1.5">
                        {item.redirect_uris.map((uri, i) => (
                          <span key={i} className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                            {uri}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* App ID */}
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0 text-xs font-medium text-gray-400 pt-0.5">App ID</span>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-mono select-all">{item.app_id}</code>
                      <button onClick={() => copyToClipboard(item.app_id)} className="text-gray-300 hover:text-gray-500 transition-colors" title="複製">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                      </button>
                    </div>
                  </div>

                  {/* App Secret (masked) */}
                  <div className="flex items-start gap-2">
                    <span className="w-24 shrink-0 text-xs font-medium text-gray-400 pt-0.5">App Secret</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono">{item.app_secret_last4 || "••••••••"}</span>
                      <button
                        onClick={() => handleShowCredentials(item)}
                        className={`text-xs font-medium transition-colors ${creds ? "text-amber-600 hover:text-amber-700" : "text-indigo-600 hover:text-indigo-700"}`}
                      >
                        {creds ? "隱藏" : "顯示完整金鑰"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Credentials Panel (revealed) */}
                {creds && (
                  <div className="mx-5 mb-4 rounded-lg bg-amber-50 border border-amber-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-amber-100/50 border-b border-amber-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-800">Client Credentials</span>
                      <button
                        onClick={() => handleRegenerateSecret(item)}
                        className="rounded-md bg-white border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                      >
                        重新產生 Secret
                      </button>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-20 text-xs font-medium text-amber-700">App ID</span>
                        <code className="flex-1 rounded bg-white border border-amber-200 px-2.5 py-1 text-xs font-mono text-gray-800 select-all">{creds.app_id}</code>
                        <button onClick={() => copyToClipboard(creds.app_id)} className="text-amber-400 hover:text-amber-600 transition-colors" title="複製">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-20 text-xs font-medium text-amber-700">Secret</span>
                        <code className="flex-1 rounded bg-white border border-amber-200 px-2.5 py-1 text-xs font-mono text-gray-800 select-all break-all">{creds.app_secret}</code>
                        <button onClick={() => copyToClipboard(creds.app_secret)} className="text-amber-400 hover:text-amber-600 transition-colors" title="複製">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
      <h2 className="text-xl font-semibold text-gray-900">登入紀錄搜尋</h2>

      {/* Filters */}
      <form
        onSubmit={handleSearch}
        className="rounded-xl bg-white p-4 shadow-sm flex flex-wrap gap-3 items-end"
      >
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            Email
          </label>
          <input
            type="text"
            value={filters.email}
            onChange={(e) => setFilters({ ...filters, email: e.target.value })}
            placeholder="搜尋 Email"
            className="rounded-lg border border-gray-300 px-3 py-2 text-base w-52 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            狀態
          </label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-lg border border-gray-300 px-3 py-2 text-base w-40 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">全部</option>
            <option value="success">成功</option>
            <option value="failed">失敗</option>
            <option value="erp_not_found">ERP 未找到</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            開始日期
          </label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) =>
              setFilters({ ...filters, startDate: e.target.value })
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            結束日期
          </label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) =>
              setFilters({ ...filters, endDate: e.target.value })
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700"
        >
          搜尋
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50"
        >
          重置
        </button>
      </form>

      {/* Results */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm text-gray-500">
          共 {total} 筆紀錄
        </div>
        {loading ? (
          <p className="p-6 text-base text-gray-500">載入中...</p>
        ) : logs.length === 0 ? (
          <p className="p-6 text-base text-gray-500">無符合條件的紀錄</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">時間</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">姓名</th>
                  <th className="px-4 py-3 font-medium">員工編號</th>
                  <th className="px-4 py-3 font-medium">部門</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.uid}>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{log.email || "-"}</td>
                    <td className="px-4 py-3 text-gray-900">{log.name || "-"}</td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-900">
                      {log.erp_gen01 || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {log.erp_gem02 || "-"}
                    </td>
                    <td className="px-4 py-3">{statusLabel(log.status)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一頁
            </button>
            <span className="text-sm text-gray-500">
              第 {filters.page} / {totalPages} 頁
            </span>
            <button
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
      alert(data.error || "操作失敗");
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
    if (!confirm(`確定要刪除管理員「${item.name || item.email}」嗎？`)) return;
    const res = await fetch(`${API}/api/admin-manager/${item.uid}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || "刪除失敗");
    }
    fetchAdmins();
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">管理員名單</h2>
        <button
          onClick={() => {
            setForm({ email: "" });
            setShowForm(true);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700 transition-colors"
        >
          新增管理員
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 mb-4">
            新增管理員
          </h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                Email *
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ email: e.target.value })}
                placeholder="new-admin@df-recycle.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-sm text-gray-400">
                新管理員首次登入 SSO 後會自動填入姓名與 Azure AD 資訊
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700"
              >
                新增
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-base text-gray-500">載入中...</p>
        ) : admins.length === 0 ? (
          <p className="p-6 text-base text-gray-500">尚無資料</p>
        ) : (
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">登入狀態</th>
                <th className="px-4 py-3 font-medium">建立時間</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {admins.map((item) => (
                <tr key={item.uid}>
                  <td className="px-4 py-3 text-gray-900">{item.email}</td>
                  <td className="px-4 py-3 text-gray-900">
                    {item.name || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${
                        item.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {item.is_active ? "啟用" : "停用"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
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
        )}
      </div>
    </div>
  );
}
