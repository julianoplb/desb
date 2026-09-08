import { NextRequest, NextResponse } from "next/server";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

export const dynamic = "force-dynamic";

type WHOEntity = {
  "@id"?: string;
  code?: string;
  classKind?: string;
  blockId?: string;

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
  blockId?: string;

  title?: {
    "@language"?: string;
    "@value"?: string;
  };

  definition?: {
    "@language"?: string;
    "@value"?: string;
  };

  browserUrl?: string;
  child?: string[];
};

type QualifierOption = {
  id: string | null;
  code: string | null;
  title: string | null;
  definition: string | null;
  classKind: string | null;
  blockId: string | null;
  url: string;
  browserUrl: string | null;
};

type QualifierAxis = {
  axis: string | null;
  axisName: string | null;
  required: boolean;

  multiple:
    | "AllowAlways"
    | "NotAllowed"
    | "AllowedExceptFromSameBlock"
    | null;

  scaleEntities: string[];
  options: QualifierOption[];
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

  return (
    parts[parts.length - 1] || null
  );
}

function normalizeMultipleValues(
  value?: string
):
  | "AllowAlways"
  | "NotAllowed"
  | "AllowedExceptFromSameBlock"
  | null {
  if (value === "AllowAlways") {
    return "AllowAlways";
  }

  if (value === "NotAllowed") {
    return "NotAllowed";
  }

  if (
    value ===
    "AllowedExceptFromSameBlock"
  ) {
    return "AllowedExceptFromSameBlock";
  }

  return null;
}

async function getEntity(
  token: string,
  url: string
): Promise<WHOEntity> {
  const normalizedUrl =
    normalizeUrl(url);

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

      blockId:
        entity.blockId || undefined,

      title:
        entity.title || undefined,

      definition:
        entity.definition || undefined,

      browserUrl:
        entity.browserUrl || undefined,

      child:
        Array.isArray(entity.child)
          ? entity.child
          : [],
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

async function collectQualifierOptions(
  token: string,
  url: string,
  visited: Set<string>,
  currentBlockId: string | null = null
): Promise<QualifierOption[]> {
  const normalizedUrl =
    normalizeUrl(url);

  if (visited.has(normalizedUrl)) {
    return [];
  }

  visited.add(normalizedUrl);

  const entity =
    await getQualifierEntity(
      token,
      normalizedUrl
    );

  if (!entity) {
    return [];
  }

  /*
   * Se a entidade atual for um bloco e
   * possuir blockId, esse passa a ser o
   * bloco de origem dos descendentes.
   */
  const blockId =
    entity.classKind === "block" &&
    entity.blockId
      ? entity.blockId
      : currentBlockId;

  const children =
    Array.isArray(entity.child)
      ? entity.child
      : [];

  /*
   * Quando chegamos a uma entidade sem
   * filhos, consideramos que ela é uma
   * opção final de qualificador.
   */
  if (children.length === 0) {
    return [
      {
        id:
          extractIdFromUrl(
            entity["@id"] ||
              normalizedUrl
          ),

        code:
          entity.code || null,

        title:
          entity.title?.["@value"] ||
          null,

        definition:
          entity.definition?.[
            "@value"
          ] || null,

        classKind:
          entity.classKind || null,

        blockId,

        url:
          normalizeUrl(
            entity["@id"] ||
              normalizedUrl
          ),

        browserUrl:
          entity.browserUrl || null,
      },
    ];
  }

  /*
   * scaleEntity pode apontar para um
   * nível hierárquico e não necessariamente
   * para o qualificador final.
   *
   * Por isso percorremos os descendentes
   * até chegar às folhas.
   */
  const descendants =
    await Promise.all(
      children.map(
        (childUrl) =>
          collectQualifierOptions(
            token,
            childUrl,
            visited,
            blockId
          )
      )
    );

  return descendants.flat();
}

async function buildQualifierAxes(
  token: string,
  data: WHOEntity
): Promise<QualifierAxis[]> {
  if (
    !Array.isArray(
      data.postcoordinationScale
    )
  ) {
    return [];
  }

  const axes =
    await Promise.all(
      data.postcoordinationScale.map(
        async (scale) => {
          const scaleEntities =
            Array.isArray(
              scale.scaleEntity
            )
              ? scale.scaleEntity.map(
                  normalizeUrl
                )
              : [];

          const visited =
            new Set<string>();

          const options =
            await Promise.all(
              scaleEntities.map(
                (url) =>
                  collectQualifierOptions(
                    token,
                    url,
                    visited
                  )
              )
            );

          /*
           * Remove duplicidades caso
           * diferentes caminhos da hierarquia
           * levem ao mesmo qualificador.
           */
          const uniqueOptions =
            Array.from(
              new Map(
                options
                  .flat()
                  .map(
                    (option) => [
                      option.id ||
                        option.url,
                      option,
                    ]
                  )
              ).values()
            );

          return {
            axis:
              extractAxisName(
                scale.axisName
              ),

            axisName:
              scale.axisName ||
              null,

            required:
              scale.requiredPostcoordination ===
              "true",

            multiple:
              normalizeMultipleValues(
                scale.allowMultipleValues
              ),

            scaleEntities,

            options:
              uniqueOptions,
          };
        }
      )
    );

  return axes;
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
     * ID
     * =====================================================
     */

    const { id } =
      await context.params;

    let normalizedId =
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
     * TOKEN
     * =====================================================
     */

    const token =
      await getAccessToken();

    /*
     * =====================================================
     * RESOLUÇÃO DO IDENTIFICADOR
     * =====================================================
     *
     * A rota normalmente recebe o ID numérico da entidade OMS.
     * Para tornar a edição robusta, também aceitamos o código CIF
     * (por exemplo, d450 ou e510). Isso permite recuperar
     * classificações antigas que foram salvas antes de o entityId
     * passar a ser persistido.
     */
    if (/^[bsde]\d+$/i.test(normalizedId)) {
      const codeInfoResponse = await fetch(
        `${ICF_BASE_URL}/codeinfo/${encodeURIComponent(normalizedId.toLowerCase())}`,
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

      if (!codeInfoResponse.ok) {
        return NextResponse.json(
          {
            success: false,
            error: "Não foi possível localizar o código CIF na OMS.",
          },
          { status: 404 }
        );
      }

      const codeInfo = await codeInfoResponse.json();
      const stemId =
        typeof codeInfo?.stemId === "string"
          ? codeInfo.stemId
          : "";

      const match = stemId.match(/\/icf\/(\d+)(?:\/.*)?$/);

      if (!match) {
        return NextResponse.json(
          {
            success: false,
            error: "A OMS não retornou o ID da categoria CIF.",
          },
          { status: 404 }
        );
      }

      normalizedId = match[1];
    }

    /*
     * =====================================================
     * ENTIDADE PRINCIPAL
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
     * QUALIFICADORES / POSTCOORDENAÇÃO
     * =====================================================
     */

    const qualifierAxes =
      await buildQualifierAxes(
        token,
        data
      );

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

      qualifierAxes,

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