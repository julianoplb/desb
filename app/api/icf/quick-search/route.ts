import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_AUTOCODE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf/autocode";

export const dynamic = "force-dynamic";

type WHOAutoCodeResult = {
  searchText?: string;
  matchingText?: string;
  theCode?: string;
  foundationURI?: string;
  linearizationURI?: string;
  matchLevel?: number;
  matchScore?: number;
  matchType?: string;
  isTitle?: boolean;
};

async function getAccessToken(): Promise<string> {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais da OMS não configuradas.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "icdapi_access",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Não foi possível autenticar na OMS (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("A OMS não retornou um token de acesso.");
  }

  return data.access_token;
}

function extractEntityId(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = uri.match(/\/(\d+)$/);
  return match?.[1] || null;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";

  if (!query) {
    return NextResponse.json(
      { success: false, error: "Digite um código ou nome para buscar." },
      { status: 400 }
    );
  }

  if (query.length > 120) {
    return NextResponse.json(
      { success: false, error: "A busca é muito longa." },
      { status: 400 }
    );
  }

  try {
    const token = await getAccessToken();

    const url = new URL(ICF_AUTOCODE_URL);
    url.searchParams.set("searchText", query);
    url.searchParams.set("matchThreshold", "0.25");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "API-Version": "v2",
        "Accept-Language": "pt",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("WHO quick-search error:", response.status, text);
      return NextResponse.json(
        { success: false, error: `A busca na OMS falhou (HTTP ${response.status}).` },
        { status: response.status }
      );
    }

    const result = (await response.json()) as WHOAutoCodeResult;
    const id = extractEntityId(result.linearizationURI) || extractEntityId(result.foundationURI);

    if (!result.theCode || !/^[bsde]\d/i.test(result.theCode) || !id) {
      return NextResponse.json(
        { success: false, result: null, error: "Nenhuma categoria encontrada para essa busca." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      result: {
        id,
        code: result.theCode,
        title: result.matchingText || result.theCode,
        definition: null,
        classKind: "category",
        blockId: null,
        codeRange: null,
        hasChildren: true,
        childCount: 0,
        url: result.linearizationURI || result.foundationURI || "",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao realizar a busca.",
      },
      { status: 500 }
    );
  }
}
