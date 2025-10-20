// @ts-nocheck
import { describe, expect, it } from "bun:test";
import type { Session, User } from "@supabase/supabase-js";
import type { AuthContextType } from "./AuthContext";

declare global {
  // eslint-disable-next-line no-var
  var localStorage: Storage;
}

if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    clear: () => {
      storage.clear();
    },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  } as Storage;
}

const { ensureAuthContext } = await import("./AuthContext");

const mockUser: User = {
  id: "user-123",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2023-01-01T00:00:00.000Z",
  email: "test@example.com",
  phone: "",
  role: "authenticated",
  identities: [],
  factors: [],
  last_sign_in_at: "2023-01-01T00:00:00.000Z",
  updated_at: "2023-01-01T00:00:00.000Z",
  is_anonymous: false,
} as unknown as User;

const mockSession: Session = {
  access_token: "access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1_676_000_000,
  refresh_token: "refresh-token",
  user: mockUser,
} as Session;

describe("ensureAuthContext", () => {
  it("throws when context is undefined", () => {
    expect(() => ensureAuthContext(undefined)).toThrowError(
      /useAuth must be used within AuthProvider/
    );
  });

  it("returns provided context", () => {
    const context: AuthContextType = {
      user: mockUser,
      session: mockSession,
      loading: false,
      signOut: async () => {},
    };

    expect(ensureAuthContext(context)).toBe(context);
  });
});
