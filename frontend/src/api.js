import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  timeout: 30000,
});

export async function fetchSummary(months) {
  const { data } = await api.get("/api/summary", { params: { months } });
  return data;
}

export async function fetchOptions(months, riskFreeRate) {
  const { data } = await api.get("/api/options", {
    params: { months, risk_free_rate: riskFreeRate },
  });
  return data;
}

export async function fetchPortfolio(months, riskFreeRate) {
  const { data } = await api.get("/api/portfolio", {
    params: { months, risk_free_rate: riskFreeRate },
  });
  return data;
}

export async function fetchRisk(months) {
  const { data } = await api.get("/api/risk", { params: { months } });
  return data;
}

export async function fetchScreener(months = 6) {
  const { data } = await api.get("/api/screener", { params: { months } });
  return data;
}

export async function refreshCache(months) {
  const { data } = await api.post("/api/cache/refresh", null, {
    params: typeof months === "number" ? { months } : {},
  });
  return data;
}

export function buildDownloadUrl(kind, months, riskFreeRate) {
  const params = new URLSearchParams({ months: String(months) });
  if (typeof riskFreeRate === "number") {
    params.set("risk_free_rate", String(riskFreeRate));
  }
  return `${api.defaults.baseURL}/api/download/${kind}?${params.toString()}`;
}
