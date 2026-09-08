import fs from "fs";
import path from "path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const ROOT_DIR = process.cwd();

loadEnvConfig(ROOT_DIR);

const INPUT_FILE = path.join(
  ROOT_DIR,
  "data",
  "icf-2026-01-index.json"
);

if (!fs.existsSync(INPUT_FILE)) {
  console.error(
    `Arquivo não encontrado: ${INPUT_FILE}`
  );
  process.exit(1);
}

const data = JSON.parse(
  fs.readFileSync(INPUT_FILE, "utf8")
);

if (!Array.isArray(data.entities)) {
  console.error(
    "O índice não possui um array 'entities'."
  );
  process.exit(1);
}

const entitiesByCode = new Map();

for (const entity of data.entities) {
  if (entity.code) {
    entitiesByCode.set(
      entity.code,
      entity
    );
  }
}

const CLIENT_ID =
  process.env.WHO_CLIENT_ID;

const CLIENT_SECRET =
  process.env.WHO_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "WHO_CLIENT_ID ou WHO_CLIENT_SECRET não encontrados no .env.local"
  );
  process.exit(1);
}

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const API_BASE =
  "https://id.who.int/icd/release/11/2026-01/icf";

async function getToken() {
  const body =
    new URLSearchParams({
      grant_type:
        "client_credentials",

      scope:
        "icdapi_access",

      client_id:
        CLIENT_ID,

      client_secret:
        CLIENT_SECRET
    });

  const response =
    await fetch(TOKEN_URL, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body
    });

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Erro ao obter token WHO (${response.status}): ${text}`
    );
  }

  const json =
    await response.json();

  return json.access_token;
}

async function autoCode(
  token,
  searchText
) {
  const url =
    new URL(
      `${API_BASE}/autocode`
    );

  url.searchParams.set(
    "searchText",
    searchText
  );

  url.searchParams.set(
    "subtreesFilter",
    "http://id.who.int/icd/release/11/2026-01/icf/619527855"
  );

  url.searchParams.set(
    "matchThreshold",
    "0.3"
  );

  const response =
    await fetch(url, {
      headers: {
        "API-Version": "v2",
        "Accept-Language": "pt",
        "Authorization":
          `Bearer ${token}`
      }
    });

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      `Erro no Auto-coding (${response.status}): ${text}`
    );
  }

  return response.json();
}

function printResult(
  description,
  result
) {
  console.log("");
  console.log(
    "======================================"
  );

  console.log(
    `DESCRIÇÃO: "${description}"`
  );

  console.log(
    "======================================"
  );

  /*
   * A WHO retorna um objeto único,
   * não um array.
   */
  if (
    !result ||
    typeof result !== "object"
  ) {
    console.log(
      "Resposta inválida da WHO."
    );
    return;
  }

  const code =
    result.theCode || null;

  const matchingText =
    result.matchingText || null;

  if (!code) {
    console.log(
      "Nenhum código encontrado pela WHO."
    );

    console.log(
      `Texto processado: ${
        result.searchText || description
      }`
    );

    return;
  }

  const local =
    entitiesByCode.get(code);

  console.log("");

  console.log(
    `Código WHO: ${code}`
  );

  console.log(
    `Matching text: ${
      matchingText || "-"
    }`
  );

  console.log(
    `Score WHO: ${
      result.matchScore ?? "-"
    }`
  );

  console.log(
    `Match level: ${
      result.matchLevel ?? "-"
    }`
  );

  console.log(
    `Match type: ${
      result.matchType ?? "-"
    }`
  );

  console.log(
    `É título: ${
      result.isTitle ?? "-"
    }`
  );

  console.log("");

  if (local) {
    console.log(
      `Título: ${
        local.title || "-"
      }`
    );

    console.log(
      `Pai: ${
        local.parentCode || "-"
      } — ${
        local.parentTitle || "-"
      }`
    );

    console.log(
      `Profundidade: ${
        local.depth
      }`
    );

    console.log(
      `Hierarquia: ${
        local.hierarchyPath || "-"
      }`
    );

    console.log(
      `Definição: ${
        local.definition || "-"
      }`
    );

    console.log(
      `Browser: ${
        local.browserUrl || "-"
      }`
    );
  } else {
    console.log(
      "⚠ Código encontrado pela WHO, mas não foi encontrado no índice local."
    );
  }
}

async function main() {
  console.log(
    "Obtendo token da WHO..."
  );

  const token =
    await getToken();

  console.log(
    "Token obtido com sucesso."
  );

  const descriptions = [
    "subir escadas",
    "tomar banho",
    "dor no joelho",
    "caminhar longas distâncias",
    "Paciente apresenta dificuldade para subir escadas.",
    "Paciente apresenta dificuldade para tomar banho sozinho.",
    "Paciente apresenta dor no joelho ao caminhar."
  ];

  for (
    const description of descriptions
  ) {
    try {
      const result =
        await autoCode(
          token,
          description
        );

      printResult(
        description,
        result
      );
    } catch (error) {
      console.error("");

      console.error(
        `Erro ao processar "${description}":`
      );

      console.error(
        error.message
      );
    }
  }
}

main().catch(
  (error) => {
    console.error("");

    console.error(
      "Erro inesperado:"
    );

    console.error(
      error.message
    );

    process.exit(1);
  }
);