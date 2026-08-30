const API_URL = '/api/v1';

export interface User {
    id: string;
    email: string;
    name: string;
    role: "admin" | "surgeon" | "patient";
    clinicId?: string | null;
    specialist_id?: string | null;
    specialistName?: string | null;
    mrn?: string | null;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
    user: User;
}

export const getAuthToken = (): string | null => {
    return localStorage.getItem("auth_token");
};

export const setAuthToken = (token: string) => {
    localStorage.setItem("auth_token", token);
};

export const clearAuthToken = () => {
    localStorage.removeItem("auth_token");
};

export const getCurrentUser = (): User | null => {
    const userStr = localStorage.getItem("current_user");
    return userStr ? JSON.parse(userStr) : null;
};

export const setCurrentUser = (user: User) => {
    localStorage.setItem("current_user", JSON.stringify(user));
};

export const authHeaders = () => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function login(email: string, password: string = "mock_password"): Promise<LoginResponse> {
    const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        throw new Error("Failed to login");
    }

    const data: LoginResponse = await response.json();
    setAuthToken(data.access_token);
    setCurrentUser(data.user);
    return data;
}

export async function fetchMe(): Promise<User> {
    const response = await fetch(`${API_URL}/auth/me`, {
        headers: { ...authHeaders() },
    });

    if (!response.ok) {
        throw new Error("Failed to fetch user");
    }

    const user: User = await response.json();
    setCurrentUser(user);
    return user;
}
