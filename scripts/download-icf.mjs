import nextEnv from "@next/env";
import fs from "fs";
import path from "path";

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

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

const ICF_ROOT_ID = "619527855";

const OUTPUT_DIR =
  path.join(process.cwd(), "data");

const OUTPUT_FILE =
  path.join(OUTPUT_DIR, "icf-2026-01.json");

const REPORT_FILE =
  path.join(OUTPUT_DIR, "icf-2026-01-report.json");

const visited = new Set();
const entities = new Map();
const errors = [];

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
    throw new Error(
      "Erro ao obter token: " +
      JSON.stringify(data)
    );
  }

  return data.access_token;
}

function extractId(url) {
  if (!url) {
    return null;
  }

  const match = String(url).match(
    /\/icf\/(\d+)(?:\/.*)?$/
  );

  return match ? match[1] : null;
}

async function fetchEntity(token, id) {
  const url =
    ICF_BASE_URL +
    "/" +
    id;

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

  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      " ao consultar ID " +
      id +
      ". Resposta: " +
      rawText
    );
  }

  if (!data) {
    throw new Error(
      "Resposta invalida para ID " +
      id
    );
  }

  return data;
}

async function walk(token, url, parentId = null, depth = 0) {
  const id = extractId(url);

  if (!id) {
    errors.push({
      type: "invalid_child_url",
      url: url,
      parentId: parentId,
    });

    return;
  }

  if (visited.has(id)) {
    return;
  }

  visited.add(id);

  process.stdout.write(
    "\rEntidades visitadas: " +
    visited.size +
    " | Categorias: " +
    Array.from(entities.values()).filter(
      function (item) {
        return item.classKind === "category";
      }
    ).length +
    " | Erros: " +
    errors.length
  );

  let entity;

  try {
    entity = await fetchEntity(token, id);
  } catch (error) {
    errors.push({
      type: "fetch_error",
      id: id,
      url: url,
      parentId: parentId,
      error: error.message,
    });

    return;
  }

  const children =
    Array.isArray(entity.child)
      ? entity.child
      : [];

  const record = {
    id: id,
    code: entity.code || null,
    title: entity.title || null,
    definition: entity.definition || null,
    classKind: entity.classKind || null,
    parentId: parentId,
    depth: depth,
    browserUrl: entity.browserUrl || null,
    source: entity.source || null,
    child: children,
    postcoordinationScale:
      entity.postcoordinationScale || null,
    exclusions:
      entity.exclusions || [],
    rawEntity: entity,
  };

  entities.set(id, record);

  for (const childUrl of children) {
    await walk(
      token,
      childUrl,
      id,
      depth + 1
    );
  }
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log("DOWNLOAD COMPLETO CIF 2026-01");
  console.log("========================================");
  console.log("");

  const token = await getToken();

  console.log("Token da OMS obtido.");
  console.log("");

  console.log("Iniciando varredura da CIF...");
  console.log("");

  await walk(
    token,
    ICF_BASE_URL + "/" + ICF_ROOT_ID,
    null,
    0
  );

  console.log("");
  console.log("");

  const allEntities =
    Array.from(entities.values());

  const categories =
    allEntities.filter(function (item) {
      return item.classKind === "category";
    });

  const blocks =
    allEntities.filter(function (item) {
      return item.classKind === "block";
    });

  const chapters =
    allEntities.filter(function (item) {
      return item.classKind === "chapter";
    });

  const otherEntities =
    allEntities.filter(function (item) {
      return (
        item.classKind !== "category" &&
        item.classKind !== "block" &&
        item.classKind !== "chapter"
      );
    });

  const categoriesWithoutCode =
    categories.filter(function (item) {
      return !item.code;
    });

  const categoriesWithoutTitle =
    categories.filter(function (item) {
      return !item.title;
    });

  const categoriesWithoutDefinition =
    categories.filter(function (item) {
      return !item.definition;
    });

  const output = {
    release: "2026-01",
    language: "pt",
    source: "WHO ICF",
    downloadedAt:
      new Date().toISOString(),
    rootId: ICF_ROOT_ID,

    statistics: {
      totalEntities:
        allEntities.length,

      totalCategories:
        categories.length,

      totalBlocks:
        blocks.length,

      totalChapters:
        chapters.length,

      totalOther:
        otherEntities.length,

      categoriesWithoutCode:
        categoriesWithoutCode.length,

      categoriesWithoutTitle:
        categoriesWithoutTitle.length,

      categoriesWithoutDefinition:
        categoriesWithoutDefinition.length,

      totalErrors:
        errors.length,
    },

    entities: allEntities,
  };

  const report = {
    release: "2026-01",

    totalEntities:
      allEntities.length,

    totalCategories:
      categories.length,

    totalBlocks:
      blocks.length,

    totalChapters:
      chapters.length,

    totalOther:
      otherEntities.length,

    totalErrors:
      errors.length,

    categoriesWithoutCode:
      categoriesWithoutCode.map(
        function (item) {
          return item.id;
        }
      ),

    categoriesWithoutTitle:
      categoriesWithoutTitle.map(
        function (item) {
          return item.id;
        }
      ),

    categoriesWithoutDefinition:
      categoriesWithoutDefinition.map(
        function (item) {
          return item.id;
        }
      ),

    errors: errors,
  };

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log("========================================");
  console.log("VARREDURA CONCLUIDA");
  console.log("========================================");
  console.log("");

  console.log(
    "Entidades visitadas: " +
    allEntities.length
  );

  console.log(
    "Categorias: " +
    categories.length
  );

  console.log(
    "Blocos: " +
    blocks.length
  );

  console.log(
    "Capitulos: " +
    chapters.length
  );

  console.log(
    "Outras entidades: " +
    otherEntities.length
  );

  console.log(
    "Categorias sem codigo: " +
    categoriesWithoutCode.length
  );

  console.log(
    "Categorias sem titulo: " +
    categoriesWithoutTitle.length
  );

  console.log(
    "Categorias sem definicao: " +
    categoriesWithoutDefinition.length
  );

  console.log(
    "Erros: " +
    errors.length
  );

  console.log("");
  console.log("Arquivo principal:");
  console.log(OUTPUT_FILE);

  console.log("");
  console.log("Relatorio:");
  console.log(REPORT_FILE);

  console.log("");
}

main().catch(function (error) {
  console.error("");
  console.error("ERRO:");
  console.error(error);
  process.exit(1);
});