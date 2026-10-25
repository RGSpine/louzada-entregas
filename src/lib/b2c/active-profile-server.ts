import "server-only";

import { cookies } from "next/headers";
import { B2C_ACTIVE_PROFILE_COOKIE } from "@/lib/b2c/active-profile";

export async function readActiveHealthProfileCookie(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(B2C_ACTIVE_PROFILE_COOKIE)?.value?.trim();
  return value && value.length <= 64 ? value : null;
}

export async function writeActiveHealthProfileCookie(
  healthProfileId: string,
): Promise<void> {
  const jar = await cookies();
  jar.set(B2C_ACTIVE_PROFILE_COOKIE, healthProfileId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearActiveHealthProfileCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(B2C_ACTIVE_PROFILE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
}
