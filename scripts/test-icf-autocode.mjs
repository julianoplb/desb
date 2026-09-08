import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const clientId = process.env.WHO_CLIENT_ID;
const clientSecret = process.env.WHO_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("WHO_CLIENT_ID ou WHO_CLIENT_SECRET nao encontrados.");
  process.exit(1);
}

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const AUTOCODE_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf/autocode";

const ICF_CATEGORIES_SUBTREE =
  "http://id.who.int/icd/release/11/2026-01/icf/619527855";

const TESTS = [
  "subir escadas",
  "caminhar longas distâncias",
  "caminhar 500 metros",
  "realizar banho",
  "tomar banho",
  "banhar-se",
];

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "icdapi_access",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body,
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Erro ao obter token:");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data.access_token;
}

async function testAutoCode(token, text, index) {
  console.log("");
  console.log("========================================");
  console.log("TESTE " + index);
  console.log("========================================");
  console.log("");

  console.log("Texto enviado:");
  console.log(text);
  console.log("");

  const params = new URLSearchParams();

  params.set("searchText", text);
  params.set("subtreesFilter", ICF_CATEGORIES_SUBTREE);
  params.set("matchThreshold", "0.3");

  const url =
    AUTOCODE_BASE_URL +
    "?" +
    params.toString();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      "API-Version": "v2",
      Accept: "application/json",
      "Accept-Language": "pt",
    },
  });

  const rawText = await response.text();

  console.log("HTTP " + response.status);
  console.log("");

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = rawText;
  }

  if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  console.log("");
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log("TESTE TERMOS DIRETOS - CIF 2026-01");
  console.log("========================================");
  console.log("");

  const token = await getToken();

  console.log("Token da OMS obtido.");

  for (let i = 0; i < TESTS.length; i++) {
    await testAutoCode(token, TESTS[i], i + 1);
  }

  console.log("");
  console.log("========================================");
  console.log("TESTES CONCLUIDOS");
  console.log("========================================");
  console.log("");
}

main().catch(function (error) {
  console.error("");
  console.error("Erro inesperado:");
  console.error(error);
  process.exit(1);
});