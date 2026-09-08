import { NextRequest, NextResponse } from "next/server";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_MODEL = "gemini-3.5-flash-lite";

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

type AISuggestion = {
  code: string;
  reason: string;
  evidence: "explicita" | "forte" | "fraca";
};

type WHOCategory = {
  code: string;
  title: string | null;
  definition: string | null;
  browserUrl: string | null;
};

type ValidatedSuggestion = {
  code: string;
  title: string | null;
  definition: string | null;
  browserUrl: string | null;
  reason: string;
  confidence: "Alta" | "Média" | "Baixa";
  validatedByWHO: boolean;
};

/**
 * ============================================================
 * OMS — TOKEN
 * ============================================================
 */

async function getWHOAccessToken(): Promise<string> {
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
    throw new Error(
      `Erro ao autenticar na OMS: ${response.status} ${await response.text()}`
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

/**
 * ============================================================
 * OMS — VALIDAÇÃO E OBTENÇÃO DOS DADOS OFICIAIS
 * ============================================================
 */

async function validateICFCode(
  token: string,
  code: string
): Promise<WHOCategory | null> {
  try {
    const normalizedCode = code
      .trim()
      .toLowerCase();

    /**
     * Aceitamos somente categorias CIF:
     *
     * b = funções do corpo
     * s = estruturas do corpo
     * d = atividades e participação
     * e = fatores ambientais
     */
    if (!/^[bsde]\d/i.test(normalizedCode)) {
      return null;
    }

    const codeInfoResponse = await fetch(
      `${ICF_BASE_URL}/codeinfo/${encodeURIComponent(
        normalizedCode
      )}`,
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
      return null;
    }

    const codeInfo =
      await codeInfoResponse.json();

    if (!codeInfo.stemId) {
      return null;
    }

    /**
     * O stemId possui o ID numérico da entidade.
     */
    const match =
      codeInfo.stemId.match(
        /\/icf\/(\d+)(?:\/.*)?$/
      );

    if (!match) {
      return null;
    }

    const entityId = match[1];

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

    const entity =
      await entityResponse.json();

    if (
      typeof entity.code !== "string" ||
      !/^[bsde]\d/i.test(entity.code)
    ) {
      return null;
    }

    return {
      code: entity.code,
      title:
        entity.title?.["@value"] || null,
      definition:
        entity.definition?.["@value"] || null,
      browserUrl:
        entity.browserUrl || null,
    };
  } catch (error) {
    console.error(
      `Erro validando código ${code}:`,
      error
    );

    return null;
  }
}

/**
 * ============================================================
 * GEMINI — EXTRAÇÃO DO TEXTO
 * ============================================================
 */

type GeminiJson = Record<string, unknown>;

function isGeminiJson(value: unknown): value is GeminiJson {
  return typeof value === "object" && value !== null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGeminiText(
  data: unknown
): string | null {
  if (!isGeminiJson(data)) {
    return null;
  }

  if (
    typeof data.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (!isGeminiJson(step)) {
        continue;
      }

      if (
        step.type !== "model_output" ||
        !Array.isArray(step.content)
      ) {
        continue;
      }

      for (const content of step.content) {
        if (!isGeminiJson(content)) {
          continue;
        }

        if (
          content.type === "text" &&
          typeof content.text === "string" &&
          content.text.trim()
        ) {
          return content.text.trim();
        }
      }
    }
  }

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!isGeminiJson(item)) {
        continue;
      }

      if (!Array.isArray(item.content)) {
        continue;
      }

      for (const content of item.content) {
        if (!isGeminiJson(content)) {
          continue;
        }

        if (
          content.type === "text" &&
          typeof content.text === "string" &&
          content.text.trim()
        ) {
          return content.text.trim();
        }
      }
    }
  }

  return null;
}

/**
 * ============================================================
 * GEMINI — CHAMADA GENÉRICA
 * ============================================================
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callGemini(
  apiKey: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await fetch(
    GEMINI_URL,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: prompt,
        response_format: {
          type: "text",
          mime_type:
            "application/json",
          schema,
        },
      }),
      cache: "no-store",
    }
  );

  const rawText =
    await response.text();

  if (!response.ok) {
    console.error(
      "Erro retornado pelo Gemini:",
      rawText
    );

    throw new Error(
      `Erro ao consultar o Gemini: ${response.status}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      "O Gemini retornou uma resposta inválida."
    );
  }

  const outputText =
    extractGeminiText(data);

  if (!outputText) {
    throw new Error(
      "O Gemini não retornou conteúdo para análise."
    );
  }

  try {
    return JSON.parse(outputText);
  } catch {
    console.error(
      "Resposta textual do Gemini:",
      outputText
    );

    throw new Error(
      "O Gemini retornou JSON inválido."
    );
  }
}

/**
 * ============================================================
 * CONFIDÊNCIA
 * ============================================================
 */

function mapEvidenceToConfidence(
  evidence: AISuggestion["evidence"]
): "Alta" | "Média" | "Baixa" {
  if (evidence === "explicita") {
    return "Alta";
  }

  if (evidence === "forte") {
    return "Média";
  }

  return "Baixa";
}

/**
 * ============================================================
 * POST
 * ============================================================
 */

export async function POST(
  request: NextRequest
) {
  try {
    const geminiApiKey =
      process.env.GEMINI_API_KEY;

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

    const body =
      await request.json();

    const description =
      typeof body?.description ===
      "string"
        ? body.description.trim()
        : "";

    if (!description) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Informe uma descrição para análise.",
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

    const candidatePrompt = `
Você é um especialista na Classificação Internacional de Funcionalidade, Incapacidade e Saúde (CIF/ICF) da Organização Mundial da Saúde.

Sua tarefa nesta primeira etapa é fazer uma busca ABERTA por categorias CIF potencialmente relevantes para a descrição funcional abaixo.

O objetivo é MAXIMIZAR O RECALL.

Não limite artificialmente a quantidade de categorias.

Considere:

- b... Funções do corpo;
- s... Estruturas do corpo;
- d... Atividades e participação;
- e... Fatores ambientais;
- categorias-pai;
- categorias-filhas;
- relações diretas;
- relações fortes;
- hipóteses plausíveis.

IMPORTANTE:

Esta é somente a etapa de descoberta de candidatos.

Não precisa tomar a decisão final sobre a validade semântica.

Porém, NÃO invente códigos.

Use somente códigos CIF reais que você conheça.

============================================================
DESCRIÇÃO
============================================================

${description}

============================================================
REGRAS
============================================================

1. Priorize recall.

2. Não imponha limite artificial de quantidade.

3. Não atribua qualificadores.

4. Não invente diagnósticos.

5. Procure todos os conceitos funcionais presentes.

6. Considere separadamente:
   - funções;
   - estruturas;
   - atividades;
   - participação;
   - fatores ambientais.

7. Categorias-pai podem ser consideradas.

8. Categorias-filhas podem ser consideradas quando houver
   evidência suficiente.

9. Uma categoria pode ser candidata mesmo que sua confiança
   final seja Média ou Baixa.

10. Não use apenas palavras isoladas como justificativa.

11. Pense no significado funcional completo.

12. NÃO faça efeito dominó.
    Cada candidato deve ter alguma relação com a descrição original.

Retorne SOMENTE JSON.

Formato:

{
  "suggestions": [
    {
      "code": "d540",
      "reason": "A descrição relata dificuldade para se vestir.",
      "evidence": "explicita"
    }
  ]
}
`;

    const candidateResult =
      await callGemini(
        geminiApiKey,
        candidatePrompt,
        {
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
                  evidence: {
                    type: "string",
                    enum: [
                      "explicita",
                      "forte",
                      "fraca",
                    ],
                  },
                },
                required: [
                  "code",
                  "reason",
                  "evidence",
                ],
                additionalProperties:
                  false,
              },
            },
          },
          required: [
            "suggestions",
          ],
          additionalProperties:
            false,
        }
      );

    const rawCandidates =
      Array.isArray(
        candidateResult?.suggestions
      )
        ? candidateResult.suggestions
        : [];

    const whoToken =
      await getWHOAccessToken();

    const whoCandidates: Array<{
      code: string;
      title: string | null;
      definition: string | null;
      browserUrl: string | null;
      reason: string;
      evidence:
        | "explicita"
        | "forte"
        | "fraca";
    }> = [];

    const usedCodes =
      new Set<string>();

    for (const candidate of rawCandidates) {
      if (
        !candidate ||
        typeof candidate.code !==
          "string"
      ) {
        continue;
      }

      if (
        typeof candidate.reason !==
        "string"
      ) {
        continue;
      }

      if (
        ![
          "explicita",
          "forte",
          "fraca",
        ].includes(
          candidate.evidence
        )
      ) {
        continue;
      }

      const normalizedCode =
        candidate.code
          .trim()
          .toLowerCase();

      if (
        usedCodes.has(
          normalizedCode
        )
      ) {
        continue;
      }

      const validated =
        await validateICFCode(
          whoToken,
          normalizedCode
        );

      if (!validated) {
        continue;
      }

      usedCodes.add(
        normalizedCode
      );

      whoCandidates.push({
        code: validated.code,
        title:
          validated.title,
        definition:
          validated.definition,
        browserUrl:
          validated.browserUrl,
        reason:
          candidate.reason,
        evidence:
          candidate.evidence,
      });
    }

    if (whoCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        description,
        suggestions: [],
      });
    }

    const candidatesForReview =
      whoCandidates.map(
        (candidate) => ({
          code: candidate.code,
          title: candidate.title,
          definition:
            candidate.definition,
          initialReason:
            candidate.reason,
          initialEvidence:
            candidate.evidence,
        })
      );

    const reviewPrompt = `
Você é o segundo nível de validação de um sistema de apoio à classificação pela CIF/ICF.

Sua tarefa é revisar candidatos CIF encontrados por outra IA.

Você receberá:

1. A descrição funcional ORIGINAL.
2. O código CIF candidato.
3. O título OFICIAL da categoria segundo a OMS.
4. A definição OFICIAL da categoria segundo a OMS.

Sua função NÃO é descobrir novos códigos.

Sua função é decidir, para CADA candidato, se ele é semanticamente defensável diante da descrição original.

============================================================
REGRA FUNDAMENTAL
============================================================

A categoria somente deve ser ACEITA se o significado COMPLETO da categoria for compatível com o significado COMPLETO da descrição.

Não aceite uma categoria apenas porque:

- uma palavra aparece nos dois textos;
- uma ação aparece na definição;
- o conceito é próximo;
- pertence ao mesmo domínio;
- pertence ao mesmo capítulo;
- é uma atividade de autocuidado;
- é anatomicamente próxima;
- costuma ocorrer junto;
- pode ser uma consequência;
- pode ser uma causa;
- é clinicamente comum.

PALAVRA EM COMUM NÃO É EVIDÊNCIA.

A definição oficial deve ser usada para entender o que a categoria realmente representa.

NÃO use a definição para inventar informações ausentes da descrição.

============================================================
REGRA DE DECISÃO
============================================================

Para cada candidato:

PERGUNTA 1:

"O conceito completo representado pela categoria está presente ou é diretamente sustentado pela descrição?"

Se NÃO:

→ discard = true.

PERGUNTA 2:

"Existe alguma incompatibilidade entre o significado da categoria e o texto?"

Se SIM:

→ discard = true.

PERGUNTA 3:

"Estou aceitando essa categoria apenas porque existe uma palavra parecida?"

Se SIM:

→ discard = true.

PERGUNTA 4:

"Estou adicionando uma informação que não foi fornecida?"

Se SIM:

→ discard = true.

============================================================
CONFIDÊNCIA
============================================================

Se a categoria for aceita:

explicita:

O conceito específico está diretamente descrito.

→ Alta.

forte:

A relação é forte e defensável, mas falta alguma especificidade.

→ Média.

fraca:

Existe uma relação real e defensável, mas a evidência é limitada.

→ Baixa.

IMPORTANTE:

Baixa NÃO significa:

"categoria remotamente relacionada".

Se não houver relação defensável:

→ DESCARTAR.

============================================================
ATIVIDADES d...
============================================================

Para d..., compare a atividade ESPECÍFICA do código com a atividade descrita.

Não aceite apenas porque as duas são atividades de vida diária.

Exemplos:

vestir-se ≠ despir-se

vestir-se ≠ calçar

vestir-se ≠ comer

vestir-se ≠ excreção

vestir-se ≠ lavar-se

vestir-se ≠ mudar posição corporal

caminhar ≠ correr

caminhar ≠ subir escadas

segurar ≠ necessariamente pegar

segurar ≠ necessariamente levantar

Se a atividade específica não corresponde:

→ DESCARTAR.

============================================================
ESTRUTURAS s...
============================================================

Para s..., faça uma validação anatômica rigorosa.

A região anatômica representada pela categoria precisa corresponder à região descrita.

Não use:

- proximidade;
- biomecânica;
- cadeia muscular;
- relação articular;
- localização próxima;
- associação clínica

como substituto da evidência anatômica.

============================================================
EXEMPLO ANATÔMICO CRÍTICO
============================================================

Descrição:

"limitação de movimento dos ombros."

Categoria:

s7102 — Ossos da região do pescoço.

Essa categoria representa PESCOÇO.

A descrição representa OMBROS.

Mesmo que ombro e pescoço tenham relação anatômica ou funcional:

→ DESCARTAR.

Não retornar como Alta.

Não retornar como Média.

Não retornar como Baixa.

O problema não é somente confiança.

É COMPATIBILIDADE.

============================================================
CATEGORIAS b...
============================================================

Para b..., verifique se a função corporal está realmente descrita.

Não transforme automaticamente uma atividade em uma função.

Não infira funções diferentes somente porque podem estar relacionadas.

============================================================
CATEGORIAS e...
============================================================

Para e..., deve existir influência ambiental real.

Exemplo:

"necessita de ajuda da esposa"

pode sustentar:

e310 — Família nuclear.

A simples existência de um familiar não é suficiente.

============================================================
CATEGORIAS-PAI
============================================================

Uma categoria-pai pode ser aceita quando realmente engloba o conceito descrito.

Nesse caso, normalmente a confiança será menor que a categoria específica.

Não aceite categorias-pai apenas porque estão próximas na hierarquia.

============================================================
EFEITO DOMINÓ
============================================================

Cada candidato deve ser comparado diretamente com a descrição original.

Não use:

candidato A → candidato B → candidato C

como cadeia de evidência.

Faça:

descrição → candidato A

descrição → candidato B

descrição → candidato C

Cada decisão é independente.

============================================================
TESTE DE SUBSTITUIÇÃO
============================================================

Para cada candidato, substitua mentalmente o conceito do código na frase original.

Se o significado mudar de maneira relevante:

→ DESCARTAR.

Exemplo:

Descrição:

"dificuldade para colocar a camisa."

Substituição:

"dificuldade para calçar."

Não é equivalente.

→ DESCARTAR.

Descrição:

"limitação de movimento dos ombros."

Substituição:

"limitação de movimento do pescoço."

Não é equivalente.

→ DESCARTAR.

============================================================
TESTE DE EVIDÊNCIA
============================================================

Para cada categoria aceita, deve ser possível apontar:

- o trecho da descrição que sustenta a categoria;
- ou uma relação funcional direta e claramente defensável.

Não use a definição da categoria como evidência.

A definição explica a categoria.

A descrição fornece a evidência.

============================================================
OBJETIVO
============================================================

Queremos alto recall.

Portanto:

NÃO seja excessivamente conservador.

Aceite categorias Média e Baixa quando elas forem realmente defensáveis.

Mas NÃO aceite categorias incompatíveis apenas para aumentar recall.

É preferível perder uma hipótese muito distante do que afirmar que uma categoria representa um conceito que o texto não descreve.

============================================================
DESCRIÇÃO ORIGINAL
============================================================

${description}

============================================================
CANDIDATOS VALIDADOS PELA OMS
============================================================

${JSON.stringify(
  candidatesForReview,
  null,
  2
)}

============================================================
FORMATO
============================================================

Retorne SOMENTE JSON.

Formato:

{
  "suggestions": [
    {
      "code": "d540",
      "keep": true,
      "reason": "A descrição informa explicitamente dificuldade para se vestir.",
      "evidence": "explicita"
    }
  ]
}

Para categorias incompatíveis:

{
  "code": "s7102",
  "keep": false,
  "reason": "A categoria representa estruturas do pescoço, enquanto a descrição localiza a limitação nos ombros.",
  "evidence": "explicita"
}

REGRAS:

- NÃO crie novos códigos.
- Avalie somente os candidatos fornecidos.
- Não altere os códigos.
- Não altere os títulos.
- Não invente evidências.
- Retorne todos os candidatos que forem defensáveis.
- Descarte candidatos incompatíveis.
`;

    const reviewResult =
      await callGemini(
        geminiApiKey,
        reviewPrompt,
        {
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
                  keep: {
                    type: "boolean",
                  },
                  reason: {
                    type: "string",
                  },
                  evidence: {
                    type: "string",
                    enum: [
                      "explicita",
                      "forte",
                      "fraca",
                    ],
                  },
                },
                required: [
                  "code",
                  "keep",
                  "reason",
                  "evidence",
                ],
                additionalProperties:
                  false,
              },
            },
          },
          required: [
            "suggestions",
          ],
          additionalProperties:
            false,
        }
      );

    const reviewedSuggestions =
      Array.isArray(
        reviewResult?.suggestions
      )
        ? reviewResult.suggestions
        : [];

    const whoMap =
      new Map<string, WHOCategory>();

    for (const candidate of whoCandidates) {
      whoMap.set(
        candidate.code.toLowerCase(),
        candidate
      );
    }

    const validatedSuggestions: ValidatedSuggestion[] =
      [];

    const finalUsedCodes =
      new Set<string>();

    for (const reviewed of reviewedSuggestions) {
      if (
        !reviewed ||
        typeof reviewed.code !==
          "string"
      ) {
        continue;
      }

      if (reviewed.keep !== true) {
        continue;
      }

      if (
        typeof reviewed.reason !==
        "string"
      ) {
        continue;
      }

      if (
        ![
          "explicita",
          "forte",
          "fraca",
        ].includes(
          reviewed.evidence
        )
      ) {
        continue;
      }

      const normalizedCode =
        reviewed.code
          .trim()
          .toLowerCase();

      if (
        finalUsedCodes.has(
          normalizedCode
        )
      ) {
        continue;
      }

      const whoCategory =
        whoMap.get(
          normalizedCode
        );

      if (!whoCategory) {
        continue;
      }

      finalUsedCodes.add(
        normalizedCode
      );

      validatedSuggestions.push({
        code:
          whoCategory.code,
        title:
          whoCategory.title,
        definition:
          whoCategory.definition,
        browserUrl:
          whoCategory.browserUrl,
        reason:
          reviewed.reason,
        confidence:
          mapEvidenceToConfidence(
            reviewed.evidence
          ),
        validatedByWHO: true,
      });
    }

    const priority = {
      Alta: 3,
      Média: 2,
      Baixa: 1,
    } as const;

    validatedSuggestions.sort(
      (a, b) =>
        priority[b.confidence] -
        priority[a.confidence]
    );

    return NextResponse.json({
      success: true,
      description,
      suggestions:
        validatedSuggestions,
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