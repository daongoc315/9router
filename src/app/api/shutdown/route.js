import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { success: false, message: "Shutdown feature is disabled" },
    { status: 410 }
  );
}

