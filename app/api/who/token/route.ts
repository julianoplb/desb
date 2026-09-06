import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "Credenciais da OMS não configuradas.",
      },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://icdaccessmanagement.who.int/connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "icdapi_access",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "A OMS recusou a autenticação.",
          details: data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Autenticação com a OMS funcionando!",
      tokenReceived: Boolean(data.access_token),
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: "Erro ao conectar com a API da OMS.",
      },
      { status: 500 }
    );
  }
}