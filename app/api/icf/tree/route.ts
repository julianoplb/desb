import { getUser } from "@netlify/identity";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

type WHOEntity = {
  "@id"?: string;
  code?: string;
  classKind?: string;

  title?: {
    "@language"?: string;
    "@value"?: string;
  };

  definition?: {
    "@language"?: string;
    "@value"?: string;
  };

  child?: string[];
  parent?: string[];
  browserUrl?: string;
  blockId?: string;
  codeRange?: string;
};

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
    throw new Error(
      "A OMS não retornou um access_token."
    );
  }

  return data.access_token;
}

function normalizeUrl(url: string): string {
  if (url.startsWith("http://")) {
    return url.replace(
      "http://",
      "https://"
    );
  }

  return url;
}

function extractIdFromUrl(
  url: string
): string | null {
  const match = url.match(
    /\/icf\/(\d+)(?:\/.*)?$/
  );

  return match ? match[1] : null;
}

async function getEntity(
  token: string,
  url: string
): Promise<WHOEntity> {
  const normalizedUrl = normalizeUrl(url);

  const response = await fetch(
    normalizedUrl,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "API-Version": "v2",
        Accept: "application/json",
        "Accept-Language": "pt",
      },

      cache: "no-store",
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Erro ao consultar ${normalizedUrl}: ${response.status} ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      `A OMS retornou uma resposta inválida para ${normalizedUrl}: ${responseText}`
    );
  }
}

export async function GET(
  request: NextRequest
) {
  try {
    // Verifica se o usuário está autenticado
    const user = await getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Não autorizado. Faça login para acessar a CIF.",
        },
        {
          status: 401,
        }
      );
    }

    const token = await getAccessToken();

    const searchParams =
      request.nextUrl.searchParams;

    const requestedId =
      searchParams.get("id");

    /*
     * Sem ID:
     * consulta a raiz da CIF.
     *
     * Com ID:
     * consulta uma categoria específica.
     */

    const entityUrl = requestedId
      ? `${ICF_BASE_URL}/${requestedId}`
      : ICF_BASE_URL;

    const entity = await getEntity(
      token,
      entityUrl
    );

    const childUrls = Array.isArray(
      entity.child
    )
      ? entity.child
      : [];

    const children = await Promise.all(
      childUrls.map(async (childUrl) => {
        try {
          const child =
            await getEntity(
              token,
              childUrl
            );

          return {
            id:
              extractIdFromUrl(
                childUrl
              ),

            code:
              child.code || null,

            title:
              child.title?.[
                "@value"
              ] || null,

            definition:
              child.definition?.[
                "@value"
              ] || null,

            classKind:
              child.classKind || null,

            blockId:
              child.blockId || null,

            codeRange:
              child.codeRange || null,

            hasChildren:
              Array.isArray(
                child.child
              ) &&
              child.child.length > 0,

            childCount:
              Array.isArray(
                child.child
              )
                ? child.child.length
                : 0,

            url: normalizeUrl(
              childUrl
            ),
          };
        } catch (error) {
          console.error(
            "Erro ao carregar filho:",
            childUrl,
            error
          );

          return {
            id:
              extractIdFromUrl(
                childUrl
              ),

            code: null,
            title: null,
            definition: null,
            classKind: null,
            blockId: null,
            codeRange: null,

            hasChildren: false,
            childCount: 0,

            url: normalizeUrl(
              childUrl
            ),

            error:
              error instanceof Error
                ? error.message
                : "Erro desconhecido.",
          };
        }
      })
    );

    return NextResponse.json({
      success: true,

      entity: {
        id:
          requestedId ||
          extractIdFromUrl(
            entity["@id"] || ""
          ),

        code:
          entity.code || null,

        title:
          entity.title?.[
            "@value"
          ] || null,

        definition:
          entity.definition?.[
            "@value"
          ] || null,

        classKind:
          entity.classKind || null,

        blockId:
          entity.blockId || null,

        codeRange:
          entity.codeRange || null,

        browserUrl:
          entity.browserUrl || null,

        hasChildren:
          children.length > 0,

        childCount:
          children.length,
      },

      children,
    });
  } catch (error) {
    console.error(
      "Erro na árvore CIF:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      }
    );
  }
}