import { getUser } from "@netlify/identity";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

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

function extractIdFromUrl(
  url: string | undefined
): string | null {
  if (!url) {
    return null;
  }

  const match = url.match(
    /\/icf\/(\d+)(?:\/.*)?$/
  );

  return match ? match[1] : null;
}

function extractLastSegment(
  url: string
): string | null {
  const parts = url.split("/");

  return parts[parts.length - 1] || null;
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ code: string }>;
  }
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

    const { code } =
      await context.params;

    const normalizedCode =
      decodeURIComponent(code)
        .trim()
        .toLowerCase();

    if (!normalizedCode) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Código CIF não informado.",
        },
        {
          status: 400,
        }
      );
    }

    const token =
      await getAccessToken();

    /*
     * 1. Consulta o código diretamente pelo endpoint
     * oficial codeinfo da OMS.
     *
     * Exemplo:
     * /codeinfo/d450
     */

    const codeInfoUrl =
      `${ICF_BASE_URL}/codeinfo/${encodeURIComponent(
        normalizedCode
      )}`;

    const codeInfoResponse =
      await fetch(
        codeInfoUrl,
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

    const codeInfoData =
      await codeInfoResponse.json();

    if (!codeInfoResponse.ok) {
      return NextResponse.json(
        {
          success: false,

          code:
            normalizedCode,

          message:
            "Código não encontrado na CIF.",

          status:
            codeInfoResponse.status,

          codeInfoUrl,

          details:
            codeInfoData,
        },

        {
          status:
            codeInfoResponse.status,
        }
      );
    }

    /*
     * 2. O codeinfo normalmente retorna o stemId,
     * que aponta para a entidade da CIF.
     */

    const stemId =
      codeInfoData.stemId ||
      codeInfoData["@id"] ||
      null;

    const entityId =
      extractIdFromUrl(stemId);

    if (!entityId) {
      return NextResponse.json({
        success: false,

        code:
          normalizedCode,

        message:
          "O código foi encontrado, mas a OMS não retornou um ID de entidade reconhecível.",

        codeInfo:
          codeInfoData,
      });
    }

    /*
     * 3. Agora buscamos a entidade completa da CIF.
     */

    const entityUrl =
      `${ICF_BASE_URL}/${entityId}`;

    const entityResponse =
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

    const entityData =
      await entityResponse.json();

    if (!entityResponse.ok) {
      return NextResponse.json(
        {
          success: false,

          code:
            normalizedCode,

          message:
            "O código foi localizado, mas não foi possível obter os dados completos da categoria.",

          status:
            entityResponse.status,

          codeInfo:
            codeInfoData,

          details:
            entityData,
        },

        {
          status:
            entityResponse.status,
        }
      );
    }

    /*
     * 4. Organizamos os filhos da categoria.
     */

    const children =
      Array.isArray(entityData.child)
        ? entityData.child.map(
            (child: string) => ({
              id:
                extractIdFromUrl(
                  child
                ),

              type:
                extractLastSegment(
                  child
                ),

              url:
                child,
            })
          )
        : [];

    /*
     * 5. Organizamos os qualificadores da CIF.
     */

    /*
     * Os dados abaixo vêm diretamente da API externa da OMS
     * e possuem estrutura dinâmica.
     */
    const qualifiers =
      Array.isArray(
        entityData.postcoordinationScale
      )
       ? entityData.postcoordinationScale.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scale: any) => ({
              axis:
                scale.axisName
                  ?.split("/")
                  .pop() ||
                null,

              required:
                scale.requiredPostcoordination ===
                "true",

              multiple:
                scale.allowMultipleValues ===
                "Allowed",

              entities:
                Array.isArray(
                  scale.scaleEntity
                )
                  ? scale.scaleEntity.map(
                      (item: string) => ({
                        id:
                          extractIdFromUrl(
                            item
                          ),

                        url:
                          item,
                      })
                    )
                  : [],
            })
          )
        : [];

    /*
     * 6. Retorno simplificado para o nosso sistema.
     */

    return NextResponse.json({
      success: true,

      codeInfo: {
        code:
          codeInfoData.code ||
          normalizedCode,

        stemCode:
          codeInfoData.stemCode ||
          normalizedCode,

        stemId,
      },

      entity: {
        id:
          entityId,

        code:
          entityData.code ||
          normalizedCode,

        title:
          entityData.title?.[
            "@value"
          ] ||
          null,

        definition:
          entityData.definition?.[
            "@value"
          ] ||
          null,

        classKind:
          entityData.classKind ||
          null,

        source:
          entityData.source ||
          null,

        browserUrl:
          entityData.browserUrl ||
          null,
      },

      parent:
        Array.isArray(
          entityData.parent
        )
          ? entityData.parent
          : [],

      children,

      qualifiers,

      /*
       * A resposta de exclusões também vem de uma estrutura
       * dinâmica da API da OMS.
       */
      exclusions:
        Array.isArray(
          entityData.exclusion
        )
          ? entityData.exclusion.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (item: any) => ({
                label:
                  item.label?.[
                    "@value"
                  ] ||
                  null,

                foundationReference:
                  item.foundationReference ||
                  null,

                linearizationReference:
                  item.linearizationReference ||
                  null,
              })
            )
          : [],
    });
  } catch (error) {
    console.error(
      "Erro CIF:",
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