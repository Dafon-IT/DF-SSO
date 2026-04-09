"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

const MOCK_TICKETS = [
  { id: "R-2026-001", title: "3F 會議室投影機無法開機", category: "設備維修", location: "台北總部 3F", priority: "高", status: "處理中", reporter: "張小華", date: "2026-04-08" },
  { id: "R-2026-002", title: "2F 茶水間水龍頭漏水", category: "水電維修", location: "台北總部 2F", priority: "中", status: "待派工", reporter: "李美玲", date: "2026-04-08" },
  { id: "R-2026-003", title: "5F 空調溫度異常偏高", category: "空調維修", location: "台北總部 5F", priority: "中", status: "處理中", reporter: "陳志明", date: "2026-04-07" },
  { id: "R-2026-004", title: "1F 大門門禁感應失靈", category: "門禁維修", location: "台北總部 1F", priority: "高", status: "已完成", reporter: "王大同", date: "2026-04-06" },
  { id: "R-2026-005", title: "4F 印表機卡紙頻繁", category: "設備維修", location: "台北總部 4F", priority: "低", status: "待派工", reporter: "林雅婷", date: "2026-04-05" },
  { id: "R-2026-006", title: "高雄分部網路不穩定", category: "網路維修", location: "高雄分部", priority: "高", status: "處理中", reporter: "黃建國", date: "2026-04-05" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 呼叫本地 API 驗證 session
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then((data) => setUser(data.user))
      .catch(() => router.push("/"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = () => {
    // 導到本地登出 API（會清除本地 session 再重導到 SSO 中央登出）
    window.location.href = "/api/auth/logout";
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-base text-gray-500">載入中...</p>
      </div>
    );
  }

  if (!user) return null;

  const priorityColor = (p: string) => {
    switch (p) {
      case "高": return "bg-red-100 text-red-700";
      case "中": return "bg-yellow-100 text-yellow-700";
      case "低": return "bg-blue-100 text-blue-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "處理中": return "bg-blue-100 text-blue-700";
      case "待派工": return "bg-yellow-100 text-yellow-700";
      case "已完成": return "bg-green-100 text-green-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-orange-600 text-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
            <h1 className="text-2xl font-bold">報修系統</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-base font-medium">{user.name}</p>
              <p className="text-sm text-orange-100">{user.email}</p>
            </div>
            <span className="rounded-full bg-orange-500 px-3 py-1 text-xs font-medium">SSO 登入</span>
            <button onClick={handleLogout} className="rounded-lg border border-orange-400 px-4 py-2 text-base font-medium hover:bg-orange-700 transition-colors">
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="m-6">
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "本月報修", value: "23", color: "text-orange-600" },
            { label: "處理中", value: "8", color: "text-blue-600" },
            { label: "待派工", value: "5", color: "text-yellow-600" },
            { label: "已完成", value: "10", color: "text-green-600" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {user.erpData && (
          <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">ERP 員工資訊</h2>
            <div className="grid grid-cols-5 gap-4 text-base">
              <div><span className="text-gray-500">員工編號：</span>{user.erpData.gen01}</div>
              <div><span className="text-gray-500">姓名：</span>{user.erpData.gen02}</div>
              <div><span className="text-gray-500">英文名：</span>{user.erpData.gen03}</div>
              <div><span className="text-gray-500">部門：</span>{user.erpData.gem02}</div>
              <div><span className="text-gray-500">職稱：</span>{user.erpData.gen06}</div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">報修單列表</h2>
            <button className="rounded-lg bg-orange-600 px-4 py-2 text-base font-medium text-white hover:bg-orange-700 transition-colors">新增報修</button>
          </div>
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">單號</th>
                <th className="px-5 py-3 font-medium">標題</th>
                <th className="px-5 py-3 font-medium">類別</th>
                <th className="px-5 py-3 font-medium">位置</th>
                <th className="px-5 py-3 font-medium">優先級</th>
                <th className="px-5 py-3 font-medium">狀態</th>
                <th className="px-5 py-3 font-medium">報修人</th>
                <th className="px-5 py-3 font-medium">日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_TICKETS.map((ticket) => (
                <tr key={ticket.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-sm text-orange-700 font-medium">{ticket.id}</td>
                  <td className="px-5 py-3 text-gray-900">{ticket.title}</td>
                  <td className="px-5 py-3 text-gray-500">{ticket.category}</td>
                  <td className="px-5 py-3 text-gray-500">{ticket.location}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${priorityColor(ticket.priority)}`}>{ticket.priority}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${statusColor(ticket.status)}`}>{ticket.status}</span>
                  </td>
                  <td className="px-5 py-3 text-gray-900">{ticket.reporter}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">{ticket.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
