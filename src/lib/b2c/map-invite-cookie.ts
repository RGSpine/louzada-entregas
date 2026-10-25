import { cookies } from "next/headers";
import { isMapInviteToken } from "@/lib/b2c/professional-link";

export const MAP_INVITE_COOKIE = "aievolui_map_invite";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

export async function readMapInviteToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(MAP_INVITE_COOKIE)?.value ?? "";
  return isMapInviteToken(value) ? value : null;
}

export async function writeMapInviteCookie(token: string) {
  if (!isMapInviteToken(token)) return;
  const jar = await cookies();
  jar.set(MAP_INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearMapInviteCookie() {
  const jar = await cookies();
  jar.delete(MAP_INVITE_COOKIE);
}
