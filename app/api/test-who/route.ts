import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  return NextResponse.json({
    success: Boolean(clientId && clientSecret),
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(clientSecret),
  });
}