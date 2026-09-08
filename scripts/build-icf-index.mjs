import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();

const INPUT_FILE = path.join(
  ROOT_DIR,
  "data",
  "icf-2026-01.json"
);

const OUTPUT_FILE = path.join(
  ROOT_DIR,
  "data",
  "icf-2026-01-index.json"
);

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`Arquivo não encontrado: ${INPUT_FILE}`);
  process.exit(1);
}

const data = JSON.parse(
  fs.readFileSync(INPUT_FILE, "utf8")
);

if (!Array.isArray(data.entities)) {
  console.error(
    "O arquivo icf-2026-01.json não possui um array 'entities'."
  );
  process.exit(1);
}

const entities = data.entities;

/*
 * Índice rápido por ID.
 */
const byId = new Map();

for (const entity of entities) {
  if (entity?.id !== undefined && entity?.id !== null) {
    byId.set(String(entity.id), entity);
  }
}

/*
 * A API da WHO pode retornar campos multilíngues
 * como:
 *
 * {
 *   "@language": "pt",
 *   "@value": "Andar"
 * }
 *
 * Esta função transforma esse objeto em texto.
 */
function getLocalizedText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    /*
     * Caso seja exatamente o formato
     * @language / @value.
     */
    if (value["@value"] !== undefined) {
      return String(value["@value"]);
    }

    /*
     * Caso a API retorne um objeto com
     * vários idiomas.
     */
    if (value.pt !== undefined) {
      return getLocalizedText(value.pt);
    }

    if (value.en !== undefined) {
      return getLocalizedText(value.en);
    }

    /*
     * Fallback para outros formatos possíveis.
     */
    if (value.value !== undefined) {
      return getLocalizedText(value.value);
    }
  }

  return String(value);
}

/*
 * Obtém o código de uma entidade.
 */
function getCode(entity) {
  if (!entity) {
    return null;
  }

  return getLocalizedText(entity.code);
}

/*
 * Obtém o título da entidade.
 */
function getTitle(entity) {
  if (!entity) {
    return null;
  }

  return getLocalizedText(entity.title);
}

/*
 * Obtém a definição da entidade.
 */
function getDefinition(entity) {
  if (!entity) {
    return null;
  }

  return getLocalizedText(entity.definition);
}

/*
 * Constrói a cadeia completa de pais.
 *
 * Exemplo:
 *
 * d4551
 *   -> d455
 *      -> ...
 *         -> capítulo
 *
 * O retorno é do mais antigo para o mais específico.
 */
function getHierarchy(entity) {
  const chain = [];
  const visited = new Set();

  let current = entity;

  while (current) {
    const currentId =
      current.id !== undefined &&
      current.id !== null
        ? String(current.id)
        : null;

    if (currentId && visited.has(currentId)) {
      console.warn(
        `Ciclo detectado na hierarquia envolvendo ${currentId}`
      );
      break;
    }

    if (currentId) {
      visited.add(currentId);
    }

    chain.push(current);

    if (
      current.parentId === undefined ||
      current.parentId === null ||
      current.parentId === ""
    ) {
      break;
    }

    const parent = byId.get(
      String(current.parentId)
    );

    if (!parent) {
      break;
    }

    current = parent;
  }

  return chain.reverse();
}

/*
 * Converte uma entidade da base original
 * para o formato simplificado do índice.
 */
function buildIndexEntity(entity) {
  const hierarchy = getHierarchy(entity);

  const hierarchyWithCode = hierarchy
    .filter(Boolean)
    .map((item) => ({
      id: item.id ?? null,
      code: getCode(item),
      title: getTitle(item),
      classKind: item.classKind ?? null
    }));

  const parent =
    entity.parentId !== undefined &&
    entity.parentId !== null
      ? byId.get(String(entity.parentId))
      : null;

  return {
    id: entity.id ?? null,

    code: getCode(entity),

    title: getTitle(entity),

    definition: getDefinition(entity),

    classKind: entity.classKind ?? null,

    parentId: entity.parentId ?? null,

    parentCode: parent
      ? getCode(parent)
      : null,

    parentTitle: parent
      ? getTitle(parent)
      : null,

    depth: Math.max(
      hierarchyWithCode.length - 1,
      0
    ),

    hierarchy: hierarchyWithCode,

    hierarchyPath: hierarchyWithCode
      .map((item) => {
        if (item.code && item.title) {
          return `${item.code} — ${item.title}`;
        }

        if (item.title) {
          return item.title;
        }

        if (item.code) {
          return item.code;
        }

        return null;
      })
      .filter(Boolean)
      .join(" > "),

    browserUrl:
      entity.browserUrl ?? null,

    source:
      entity.source ?? null,

    child:
      Array.isArray(entity.child)
        ? entity.child
        : [],

    postcoordinationScale:
      entity.postcoordinationScale ?? null,

    exclusions:
      Array.isArray(entity.exclusions)
        ? entity.exclusions
        : [],

    rawEntity:
      entity.rawEntity ?? null
  };
}

console.log(
  `Processando ${entities.length} entidades...`
);

const indexedEntities = entities.map(
  buildIndexEntity
);

/*
 * Estatísticas do índice.
 */
const categories = indexedEntities.filter(
  (entity) =>
    entity.classKind === "category"
);

const withParentCode = indexedEntities.filter(
  (entity) => entity.parentCode
);

const withHierarchy = indexedEntities.filter(
  (entity) =>
    Array.isArray(entity.hierarchy) &&
    entity.hierarchy.length > 0
);

const result = {
  release:
    data.release ?? "2026-01",

  language:
    data.language ?? "pt",

  source:
    data.source ??
    "WHO ICD-11 API",

  generatedAt:
    new Date().toISOString(),

  rootId:
    data.rootId ?? null,

  statistics: {
    totalEntities:
      indexedEntities.length,

    totalCategories:
      categories.length,

    entitiesWithParentCode:
      withParentCode.length,

    entitiesWithHierarchy:
      withHierarchy.length
  },

  entities: indexedEntities
};

fs.writeFileSync(
  OUTPUT_FILE,
  JSON.stringify(
    result,
    null,
    2
  ),
  "utf8"
);

console.log("");
console.log("Índice criado com sucesso.");
console.log("");
console.log(
  `Arquivo: ${OUTPUT_FILE}`
);
console.log("");
console.log(
  `Total de entidades: ${indexedEntities.length}`
);
console.log(
  `Categorias: ${categories.length}`
);
console.log(
  `Com parentCode: ${withParentCode.length}`
);
console.log(
  `Com hierarquia: ${withHierarchy.length}`
);
console.log("");