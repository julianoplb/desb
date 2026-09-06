import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

async function getAccessToken(): Promise<string> {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da OMS não configuradas.");
  }

  const response = await fetch(TOKEN_URL, {
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
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Erro ao autenticar na OMS: ${response.status} ${errorText}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("A OMS não retornou um access_token.");
  }

  return data.access_token;
}

export async function POST(request: NextRequest) {
  try {
    /*
     * Recebe o texto enviado pelo nosso frontend.
     */
    const rawBody = await request.text();

    if (!rawBody) {
      return NextResponse.json(
        {
          success: false,
          error: "O corpo da requisição chegou vazio.",
        },
        { status: 400 }
      );
    }

    let body: {
      text?: string;
    };

    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "O corpo recebido não é um JSON válido.",
          rawBody,
          parseError:
            error instanceof Error
              ? error.message
              : "Erro desconhecido.",
        },
        { status: 400 }
      );
    }

    const text = body.text?.trim();

    if (!text) {
      return NextResponse.json(
        {
          success: false,
          error: "Informe um texto para análise.",
        },
        { status: 400 }
      );
    }

    /*
     * Autenticação na OMS.
     */
    const token = await getAccessToken();

    /*
     * Endpoint de Auto-coding.
     */
    const autocodeUrl = `${ICF_BASE_URL}/autocode`;

    const response = await fetch(autocodeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "API-Version": "v2",
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "pt",
      },
      body: JSON.stringify({
        text,
      }),
      cache: "no-store",
    });

    const responseText = await response.text();

    /*
     * A OMS pode retornar JSON ou texto.
     * Por isso não usamos response.json() diretamente.
     */
    let data: unknown;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      endpoint: autocodeUrl,
      input: text,
      data,
    });
  } catch (error) {
    console.error("Erro no Auto-coding CIF:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      { status: 500 }
    );
  }
}