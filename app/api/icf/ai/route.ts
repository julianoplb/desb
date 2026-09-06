import { NextRequest, NextResponse } from "next/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_MODEL = "gemini-3.7-flash";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

type AISuggestion = {
  code: string;
  reason: string;
  confidence: "Alta" | "Média" | "Baixa";
};

async function getWHOAccessToken(): Promise<string> {
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

async function validateICFCode(
  token: string,
  code: string
): Promise<{
  code: string;
  title: string | null;
  definition: string | null;
  browserUrl: string | null;
} | null> {
  try {
    const normalizedCode = code.trim().toLowerCase();

    const codeInfoResponse = await fetch(
      `${ICF_BASE_URL}/codeinfo/${encodeURIComponent(normalizedCode)}`,
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
      console.log(
        `Código CIF não encontrado: ${normalizedCode}`
      );

      return null;
    }

    const codeInfo = await codeInfoResponse.json();

    const stemId = codeInfo.stemId;

    if (!stemId) {
      return null;
    }

    const entityIdMatch = stemId.match(
      /\/icf\/(\d+)(?:\/.*)?$/
    );

    if (!entityIdMatch) {
      return null;
    }

    const entityId = entityIdMatch[1];

    const entityResponse = await fetch(
      `${ICF_BASE_URL}/${entityId}`,
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

    if (!entityResponse.ok) {
      return null;
    }

    const entity = await entityResponse.json();

    return {
      code: entity.code || codeInfo.code || normalizedCode,
      title: entity.title?.["@value"] || null,
      definition:
        entity.definition?.["@value"] || null,
      browserUrl: entity.browserUrl || null,
    };
  } catch (error) {
    console.error(
      `Erro validando código ${code}:`,
      error
    );

    return null;
  }
}

/*
 * A Interactions API atualmente retorna a resposta
 * dentro de:
 *
 * steps[]
 *   -> type: "model_output"
 *   -> content[]
 *      -> type: "text"
 *
 * Algumas respostas também podem disponibilizar
 * output_text diretamente.
 */
function extractGeminiText(data: any): string | null {
  /*
   * Formato simplificado, quando disponível.
   */
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  /*
   * Formato atual da Interactions API.
   */
  if (Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      if (step?.type !== "model_output") {
        continue;
      }

      if (!Array.isArray(step?.content)) {
        continue;
      }

      for (const content of step.content) {
        if (
          content?.type === "text" &&
          typeof content?.text === "string" &&
          content.text.trim()
        ) {
          return content.text.trim();
        }
      }
    }
  }

  /*
   * Compatibilidade com outros formatos.
   */
  if (Array.isArray(data?.output)) {
    for (const outputItem of data.output) {
      if (!Array.isArray(outputItem?.content)) {
        continue;
      }

      for (const contentItem of outputItem.content) {
        if (
          contentItem?.type === "text" &&
          typeof contentItem?.text === "string" &&
          contentItem.text.trim()
        ) {
          return contentItem.text.trim();
        }
      }
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GEMINI_API_KEY não configurada no .env.local.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const description =
      typeof body?.description === "string"
        ? body.description.trim()
        : "";

    if (!description) {
      return NextResponse.json(
        {
          success: false,
          error: "Informe uma descrição para análise.",
        },
        { status: 400 }
      );
    }

    if (description.length > 5000) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A descrição deve ter no máximo 5.000 caracteres.",
        },
        { status: 400 }
      );
    }

    /*
     * PROMPT DA IA
     */
    const prompt = `
Você é um assistente especializado na Classificação Internacional de Funcionalidade, Incapacidade e Saúde (CIF/ICF) da Organização Mundial da Saúde.

Sua tarefa é analisar uma descrição funcional fornecida por um profissional e sugerir possíveis categorias da CIF.

IMPORTANTE:

- Não faça diagnóstico médico.
- Não invente códigos.
- Não invente nomes de categorias.
- Não invente definições.
- Não atribua qualificadores.
- Sugira no máximo 5 códigos.
- Sugira apenas categorias CIF que possam estar relacionadas à descrição.
- Priorize categorias específicas quando houver evidência suficiente.
- Se houver pouca informação, reduza a confiança.
- Explique brevemente por que cada código foi sugerido.
- A resposta será posteriormente validada contra a API oficial da OMS.
- A confiança deve ser exatamente uma destas opções: Alta, Média ou Baixa.

Descrição funcional:

${description}

Retorne somente o JSON solicitado pelo schema.
`;

    /*
     * CHAMADA AO GEMINI
     *
     * Usamos x-goog-api-key, conforme a documentação
     * atual da API.
     */
    const geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: prompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: {
                      type: "string",
                    },
                    reason: {
                      type: "string",
                    },
                    confidence: {
                      type: "string",
                      enum: [
                        "Alta",
                        "Média",
                        "Baixa",
                      ],
                    },
                  },
                  required: [
                    "code",
                    "reason",
                    "confidence",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["suggestions"],
            additionalProperties: false,
          },
        },
      }),
      cache: "no-store",
    });

    const geminiText = await geminiResponse.text();

    /*
     * Se o Gemini retornar erro, mostramos o erro real.
     */
    if (!geminiResponse.ok) {
      console.error(
        "Erro retornado pelo Gemini:",
        geminiText
      );

      return NextResponse.json(
        {
          success: false,
          error: "Erro ao consultar o Gemini.",
          details: geminiText,
        },
        {
          status: geminiResponse.status,
        }
      );
    }

    let geminiData: any;

    try {
      geminiData = JSON.parse(geminiText);
    } catch {
      console.error(
        "Resposta bruta do Gemini não é JSON:",
        geminiText
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "O Gemini retornou uma resposta inválida.",
          raw: geminiText,
        },
        { status: 500 }
      );
    }

    console.log(
      "Status da interação Gemini:",
      geminiData?.status
    );

    /*
     * Extrai o texto da resposta.
     */
    const outputText =
      extractGeminiText(geminiData);

    if (!outputText) {
      console.error(
        "Gemini não retornou texto. Resposta completa:",
        JSON.stringify(geminiData, null, 2)
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "O Gemini não retornou conteúdo para análise.",
          geminiStatus: geminiData?.status || null,
          geminiResponse: geminiData,
        },
        { status: 500 }
      );
    }

    console.log(
      "Resposta textual do Gemini:",
      outputText
    );

    /*
     * INTERPRETA O JSON GERADO PELA IA
     */
    let aiResult: {
      suggestions: AISuggestion[];
    };

    try {
      aiResult = JSON.parse(outputText);
    } catch {
      console.error(
        "Resposta do Gemini não pôde ser convertida em JSON:",
        outputText
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "O Gemini retornou uma resposta que não pôde ser interpretada.",
          raw: outputText,
        },
        { status: 500 }
      );
    }

    const suggestions = Array.isArray(
      aiResult?.suggestions
    )
      ? aiResult.suggestions
      : [];

    /*
     * AGORA ENTRA A OMS
     *
     * O Gemini apenas sugere.
     * A OMS é a fonte oficial para validar
     * os códigos.
     */
    const whoToken = await getWHOAccessToken();

    const validatedSuggestions = [];

    for (const suggestion of suggestions.slice(
      0,
      5
    )) {
      if (
        !suggestion ||
        typeof suggestion.code !== "string"
      ) {
        continue;
      }

      const validated = await validateICFCode(
        whoToken,
        suggestion.code
      );

      if (!validated) {
        continue;
      }

      validatedSuggestions.push({
        code: validated.code,
        title: validated.title,
        definition: validated.definition,
        browserUrl: validated.browserUrl,
        reason:
          typeof suggestion.reason === "string"
            ? suggestion.reason
            : "Código sugerido com base na descrição fornecida.",
        confidence:
          suggestion.confidence === "Alta" ||
          suggestion.confidence === "Média" ||
          suggestion.confidence === "Baixa"
            ? suggestion.confidence
            : "Baixa",
        validatedByWHO: true,
      });
    }

    return NextResponse.json({
      success: true,
      description,
      suggestions: validatedSuggestions,
    });
  } catch (error) {
    console.error(
      "Erro na análise CIF com IA:",
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
      { status: 500 }
    );
  }
}