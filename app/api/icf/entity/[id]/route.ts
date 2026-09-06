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

type QualifierEntity = {
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

  browserUrl?: string;
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

function extractAxisName(
  axisName?: string
): string | null {
  if (!axisName) {
    return null;
  }

  const parts = axisName.split("/");

  return parts[parts.length - 1] || null;
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

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Erro ao consultar ${normalizedUrl}: ${response.status} ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      `A OMS retornou uma resposta inválida para ${normalizedUrl}.`
    );
  }
}

async function getQualifierEntity(
  token: string,
  url: string
): Promise<QualifierEntity | null> {
  try {
    const entity =
      await getEntity(
        token,
        url
      );

    return {
      "@id": entity["@id"],

      code:
        entity.code || undefined,

      classKind:
        entity.classKind || undefined,

      title:
        entity.title || undefined,

      definition:
        entity.definition || undefined,

      browserUrl:
        entity.browserUrl || undefined,
    };
  } catch (error) {
    console.error(
      "Erro ao consultar qualificador:",
      url,
      error
    );

    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
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

    const token =
      await getAccessToken();

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
          response:
            responseText,
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
     * QUALIFICADORES
     * =====================================================
     */

    const qualifiers =
      Array.isArray(
        data.postcoordinationScale
      )
        ? await Promise.all(
            data.postcoordinationScale.map(
              async (scale) => {
                const qualifierUrls =
                  Array.isArray(
                    scale.scaleEntity
                  )
                    ? scale.scaleEntity
                    : [];

                const qualifierEntities =
                  await Promise.all(
                    qualifierUrls.map(
                      (url) =>
                        getQualifierEntity(
                          token,
                          url
                        )
                    )
                  );

                return {
                  axis:
                    extractAxisName(
                      scale.axisName
                    ),

                  required:
                    scale.requiredPostcoordination ===
                    "true",

                  multiple:
                    scale.allowMultipleValues ===
                    "Allowed",

                  entities:
                    qualifierEntities
                      .filter(
                        (
                          item
                        ): item is QualifierEntity =>
                          item !== null
                      )
                      .map(
                        (
                          item,
                          index
                        ) => ({
                          id:
                            extractIdFromUrl(
                              item[
                                "@id"
                              ] ||
                                qualifierUrls[
                                  index
                                ]
                            ),

                          code:
                            item.code ||
                            null,

                          title:
                            item.title?.[
                              "@value"
                            ] ||
                            null,

                          definition:
                            item
                              .definition?.[
                              "@value"
                            ] ||
                            null,

                          classKind:
                            item.classKind ||
                            null,

                          url:
                            normalizeUrl(
                              item[
                                "@id"
                              ] ||
                                qualifierUrls[
                                  index
                                ]
                            ),

                          browserUrl:
                            item.browserUrl ||
                            null,
                        })
                      ),
                };
              }
            )
          )
        : [];

    /*
     * =====================================================
     * FILHOS
     * =====================================================
     */

    const children =
      Array.isArray(data.child)
        ? data.child.map(
            (url) => ({
              id:
                extractIdFromUrl(
                  url
                ),

              url:
                normalizeUrl(
                  url
                ),
            })
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
            (url) => ({
              id:
                extractIdFromUrl(
                  url
                ),

              url:
                normalizeUrl(
                  url
                ),
            })
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