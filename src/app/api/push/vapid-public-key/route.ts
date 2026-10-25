import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/web-push/config";

export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "Web Push não configurado." }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
