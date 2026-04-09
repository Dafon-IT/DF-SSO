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
  env: "production" | "test" | "local";
  description: string;
  is_active: boolean;
  is_deleted: boolean;
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
  const [activeTab, setActiveTab] = useState<"allowed" | "logs">("allowed");

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
        </div>
      </div>

      {/* Content */}
      <main className="m-6">
        {activeTab === "allowed" ? <AllowedListPanel /> : <LoginLogPanel />}
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
  const [form, setForm] = useState({ domain: "", name: "", env: "local", description: "" });
  const [envFilter, setEnvFilter] = useState<string>("");

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

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (data.success) {
      setShowForm(false);
      setEditItem(null);
      setForm({ domain: "", name: "", env: "local", description: "" });
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
      env: item.env || "local",
      description: item.description || "",
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
    setForm({ domain: "", name: "", description: "" });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          白名單網域管理
        </h2>
        <button
          onClick={handleAdd}
          className="rounded-lg bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700 transition-colors"
        >
          新增網域
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <h3 className="text-base font-semibold text-gray-900 mb-4">
            {editItem ? "編輯網域" : "新增網域"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                網域 *
              </label>
              <input
                type="text"
                required
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="https://crm.df-recycle.com.tw"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                系統名稱
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="CRM 系統"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                環境
              </label>
              <select
                value={form.env}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="local">Local（本機開發）</option>
                <option value="test">Test（測試環境）</option>
                <option value="production">Production（正式環境）</option>
              </select>
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1">
                說明
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="系統說明"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-base font-medium text-white hover:bg-blue-700"
              >
                {editItem ? "儲存" : "新增"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditItem(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {["", "production", "test", "local"].map((v) => (
          <button
            key={v}
            onClick={() => setEnvFilter(v)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              envFilter === v
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {v === "" ? "全部" : v === "production" ? "Production" : v === "test" ? "Test" : "Local"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-base text-gray-500">載入中...</p>
        ) : items.filter((i) => !envFilter || i.env === envFilter).length === 0 ? (
          <p className="p-6 text-base text-gray-500">尚無資料</p>
        ) : (
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">網域</th>
                <th className="px-4 py-3 font-medium">名稱</th>
                <th className="px-4 py-3 font-medium">環境</th>
                <th className="px-4 py-3 font-medium">說明</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.filter((i) => !envFilter || i.env === envFilter).map((item) => (
                <tr key={item.uid}>
                  <td className="px-4 py-3 font-mono text-sm text-gray-900">
                    {item.domain}
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {item.name || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${
                      item.env === "production"
                        ? "bg-red-100 text-red-700"
                        : item.env === "test"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {item.env === "production" ? "Production" : item.env === "test" ? "Test" : "Local"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {item.description || "-"}
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(item)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium"
                      >
                        刪除
                      </button>
                    </div>
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
