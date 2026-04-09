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

// 模擬資產資料
const MOCK_ASSETS = [
  { id: "A-001", name: "筆記型電腦 ThinkPad T14", category: "電腦設備", location: "台北總部 3F", status: "使用中", assignee: "王小明" },
  { id: "A-002", name: "27吋螢幕 Dell U2723QE", category: "電腦設備", location: "台北總部 3F", status: "使用中", assignee: "王小明" },
  { id: "A-003", name: "事務印表機 HP M404dn", category: "辦公設備", location: "台北總部 2F", status: "使用中", assignee: "公用" },
  { id: "A-004", name: "投影機 Epson EB-L200F", category: "會議設備", location: "台北總部 5F 會議室", status: "閒置", assignee: "-" },
  { id: "A-005", name: "iPad Pro 12.9吋", category: "行動裝置", location: "高雄分部", status: "維修中", assignee: "李大華" },
  { id: "A-006", name: "Cisco 交換器 C9200L", category: "網路設備", location: "機房 A", status: "使用中", assignee: "IT 部門" },
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

  const statusColor = (s: string) => {
    switch (s) {
      case "使用中": return "bg-green-100 text-green-700";
      case "閒置": return "bg-gray-100 text-gray-600";
      case "維修中": return "bg-yellow-100 text-yellow-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-600 text-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <h1 className="text-2xl font-bold">資產管理系統</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-base font-medium">{user.name}</p>
              <p className="text-sm text-emerald-100">{user.email}</p>
            </div>
            <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium">SSO 登入</span>
            <button onClick={handleLogout} className="rounded-lg border border-emerald-400 px-4 py-2 text-base font-medium hover:bg-emerald-700 transition-colors">
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="m-6">
        <div className="mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "總資產數", value: "156", color: "text-emerald-600" },
            { label: "使用中", value: "132", color: "text-blue-600" },
            { label: "閒置", value: "18", color: "text-gray-600" },
            { label: "維修中", value: "6", color: "text-yellow-600" },
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
            <h2 className="text-xl font-semibold text-gray-900">資產列表</h2>
            <button className="rounded-lg bg-emerald-600 px-4 py-2 text-base font-medium text-white hover:bg-emerald-700 transition-colors">新增資產</button>
          </div>
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">資產編號</th>
                <th className="px-5 py-3 font-medium">名稱</th>
                <th className="px-5 py-3 font-medium">類別</th>
                <th className="px-5 py-3 font-medium">位置</th>
                <th className="px-5 py-3 font-medium">使用者</th>
                <th className="px-5 py-3 font-medium">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_ASSETS.map((asset) => (
                <tr key={asset.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-sm text-emerald-700 font-medium">{asset.id}</td>
                  <td className="px-5 py-3 text-gray-900">{asset.name}</td>
                  <td className="px-5 py-3 text-gray-500">{asset.category}</td>
                  <td className="px-5 py-3 text-gray-500">{asset.location}</td>
                  <td className="px-5 py-3 text-gray-900">{asset.assignee}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${statusColor(asset.status)}`}>{asset.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
