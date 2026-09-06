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
    throw new Error(
      `Erro ao autenticar na OMS: ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("A OMS não retornou um token.");
  }

  return data.access_token;
}

function extractIdFromUrl(value: string): string | null {
  const match = value.match(/\/icf\/(\d+)$/);

  return match ? match[1] : null;
}

export async function GET(request: NextRequest) {
  try {
    const token = await getAccessToken();

    const params = request.nextUrl.searchParams;

    const id = params.get("id");

    if (!id) {
      return NextResponse.json({
        success: true,
        message:
          "Informe o ID interno da entidade CIF usando ?id=.",
        example:
          "/api/icf/search?id=1550548595",
      });
    }

    const url = `${ICF_BASE_URL}/${id}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "API-Version": "v2",
        Accept: "application/json",
        "Accept-Language": "pt",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();

      return NextResponse.json(
        {
          success: false,
          status: response.status,
          error: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    const children = Array.isArray(data.child)
      ? data.child.map((child: string) => ({
          id: extractIdFromUrl(child),
          url: child,
        }))
      : [];

    return NextResponse.json({
      success: true,

      entity: {
        id,
        code: data.code || null,
        title: data.title?.["@value"] || null,
        definition: data.definition?.["@value"] || null,
        classKind: data.classKind || null,
        source: data.source || null,
      },

      parent: Array.isArray(data.parent)
        ? data.parent
        : [],

      children,

      postcoordinationScale:
        data.postcoordinationScale || [],
    });
  } catch (error) {
    console.error("Erro CIF:", error);

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