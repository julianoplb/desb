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

  postcoordinationScale?: {
    "@id"?: string;
    axisName?: string;
    requiredPostcoordination?: string;
    allowMultipleValues?: string;
    scaleEntity?: string[];
  }[];

  exclusion?: {
    label?: {
      "@language"?: string;
      "@value"?: string;
    };

    foundationReference?: string;
    linearizationReference?: string;
  }[];
};

async function getAccessToken(): Promise<string> {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais da OMS não configuradas."
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",

    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded",
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

function createTreeReference(
  url: string
) {
  const normalizedUrl =
    normalizeUrl(url);

  return {
    id: extractIdFromUrl(
      normalizedUrl
    ),
    url: normalizedUrl,
  };
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    /*
     * =====================================================
     * AUTENTICAÇÃO
     * =====================================================
     */

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

    /*
     * =====================================================
     * ID
     * =====================================================
     */

    const { id } =
      await context.params;

    const normalizedId =
      decodeURIComponent(id).trim();

    if (!normalizedId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ID da categoria não informado.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * TOKEN OMS
     * =====================================================
     */

    const token =
      await getAccessToken();

    /*
     * =====================================================
     * CONSULTA DA ENTIDADE
     * =====================================================
     */

    const entityUrl =
      `${ICF_BASE_URL}/${normalizedId}`;

    const response =
      await fetch(
        entityUrl,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,

            "API-Version":
              "v2",

            Accept:
              "application/json",

            "Accept-Language":
              "pt",
          },

          cache: "no-store",
        }
      );

    const responseText =
      await response.text();

    let data: WHOEntity;

    try {
      data =
        JSON.parse(
          responseText
        );
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "A OMS retornou uma resposta inválida.",
          status:
            response.status,
        },
        {
          status:
            response.status,
        }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Não foi possível obter a categoria.",
          status:
            response.status,
          details:
            data,
        },
        {
          status:
            response.status,
        }
      );
    }

    /*
     * =====================================================
     * FILHOS
     * =====================================================
     */

    const children =
      Array.isArray(data.child)
        ? data.child.map(
            createTreeReference
          )
        : [];

    /*
     * =====================================================
     * PAIS
     * =====================================================
     */

    const parents =
      Array.isArray(data.parent)
        ? data.parent.map(
            createTreeReference
          )
        : [];

    /*
     * =====================================================
     * EXCLUSÕES
     * =====================================================
     */

    const exclusions =
      Array.isArray(
        data.exclusion
      )
        ? data.exclusion.map(
            (item) => ({
              label:
                item.label?.[
                  "@value"
                ] || null,

              foundationReference:
                item.foundationReference
                  ? normalizeUrl(
                      item.foundationReference
                    )
                  : null,

              linearizationReference:
                item.linearizationReference
                  ? normalizeUrl(
                      item.linearizationReference
                    )
                  : null,
            })
          )
        : [];

    /*
     * =====================================================
     * QUALIFICADORES
     *
     * Temporariamente não fazemos consultas adicionais
     * aqui.
     *
     * Primeiro validamos que a seleção da categoria
     * funciona corretamente.
     *
     * A OMS utiliza postcoordinationScale para informar
     * os eixos de qualificação e seus conjuntos de valores.
     * Vamos implementar essa parte separadamente depois.
     * =====================================================
     */

    const qualifiers = {
      performance: [],
      capacity: [],
    };

    /*
     * =====================================================
     * RESPOSTA
     * =====================================================
     */

    return NextResponse.json({
      success: true,

      entity: {
        id:
          normalizedId,

        code:
          data.code ||
          null,

        title:
          data.title?.[
            "@value"
          ] ||
          null,

        definition:
          data.definition?.[
            "@value"
          ] ||
          null,

        classKind:
          data.classKind ||
          null,

        browserUrl:
          data.browserUrl ||
          null,
      },

      parents,

      children,

      qualifiers,

      exclusions,
    });
  } catch (error) {
    console.error(
      "Erro ao consultar entidade CIF:",
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