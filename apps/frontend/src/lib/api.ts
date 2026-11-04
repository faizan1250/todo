import { API_BASE_URL } from "./auth-client";

export interface InviteValidationResponse {
  valid: boolean;
  remainingUses: number;
  expiresAt?: string;
  reason?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  twoFactorEnabled: boolean;
  role: string;
  timezone: string;
  locale: string;
  weekStartsOn: number;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  name?: string;
  timezone?: string;
  locale?: string;
  weekStartsOn?: number;
  preferences?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Validate an invite code preflight before sign-up.
 */
export async function validateInviteCode(
  code: string
): Promise<InviteValidationResponse> {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: "Invite code is required",
      remainingUses: 0,
    };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/invite/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: trimmed }),
    });

    const data = (await res.json()) as InviteValidationResponse;
    return data;
  } catch (err) {
    return {
      valid: false,
      reason:
        err instanceof Error ? err.message : "Failed to validate invite code",
      remainingUses: 0,
    };
  }
}

/**
 * Fetch the authenticated user's profile from GET /me
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/me`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new ApiError(
        `Failed to fetch profile: ${res.statusText}`,
        res.status,
        errorText
      );
    }

    const data = (await res.json()) as UserProfile;
    return data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

/**
 * Update authenticated user's profile via PATCH /me
 */
export async function updateCurrentProfile(
  data: UpdateProfileInput
): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/me`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    let errorMessage = `Failed to update profile (${res.status})`;
    try {
      const errorJson = (await res.json()) as { error?: string; message?: string };
      errorMessage = errorJson.error || errorJson.message || errorMessage;
    } catch {
      // ignore json parse error
    }
    throw new ApiError(errorMessage, res.status);
  }

  return (await res.json()) as UserProfile;
}
