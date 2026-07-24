// URLs relativas — o Next.js proxy (next.config.js rewrites) encaminha para o backend
const API_URL = '';

const getAuthHeaders = () => {
  if (typeof window !== 'undefined') {
    let token =
      localStorage.getItem('token') ||
      localStorage.getItem('auth-token') ||
      '';

    if (!token && document.cookie) {
      const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split('=');
        acc[key] = value;
        return acc;
      }, {});
      token = cookies['auth-token'] || cookies['token'] || '';
    }

    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  return { 'Content-Type': 'application/json' };
};

export const apiRequest = async (endpoint, options = {}) => {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // raw: devolve a Response (ex.: download de CSV/arquivo autenticado via .blob()).
  if (options.raw) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  const text = await res.text();

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errorData = JSON.parse(text);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      errorMessage = text || errorMessage;
    }
    throw new Error(errorMessage);
  }

  if (!text) return { success: true, data: null };

  return JSON.parse(text);
};

