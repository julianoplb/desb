import fs from "fs";
import path from "path";

const DATA_FILE = path.join(
  process.cwd(),
  "data",
  "icf-2026-01.json"
);

if (!fs.existsSync(DATA_FILE)) {
  console.error("");
  console.error("Arquivo nao encontrado:");
  console.error(DATA_FILE);
  console.error("");
  console.error(
    "Execute primeiro: node scripts\\download-icf.mjs"
  );
  process.exit(1);
}

const data = JSON.parse(
  fs.readFileSync(DATA_FILE, "utf8")
);

const entities = Array.isArray(data.entities)
  ? data.entities
  : [];

const categories = entities.filter(function (item) {
  return item.classKind === "category";
});

console.log("");
console.log("========================================");
console.log("AUDITORIA CIF 2026-01");
console.log("========================================");
console.log("");

console.log("Arquivo:");
console.log(DATA_FILE);
console.log("");

console.log("Total de entidades:", entities.length);
console.log("Total de categorias:", categories.length);
console.log("");

console.log("========================================");
console.log("CATEGORIAS IMPORTANTES");
console.log("========================================");
console.log("");

const codesToCheck = [
  "d450",
  "d4501",
  "d455",
  "d4551",
  "d510",
  "d5100",
  "d5101",
  "d5102",
  "d520",
  "d530",
];

for (const code of codesToCheck) {
  const category = categories.find(function (item) {
    return item.code === code;
  });

  if (!category) {
    console.log(code + " -> NAO ENCONTRADA");
    continue;
  }

  console.log(code + " -> ENCONTRADA");
  console.log(
    "  Titulo: " +
    extractText(category.title)
  );
  console.log(
    "  Pai: " +
    category.parentId
  );
  console.log(
    "  Definicao: " +
    (
      category.definition
        ? extractText(category.definition)
        : "SEM DEFINICAO"
    )
  );
  console.log("");
}

console.log("========================================");
console.log("DEFINICOES");
console.log("========================================");
console.log("");

const withoutDefinition =
  categories.filter(function (item) {
    return !item.definition;
  });

const withDefinition =
  categories.filter(function (item) {
    return !!item.definition;
  });

console.log(
  "Com definicao:",
  withDefinition.length
);

console.log(
  "Sem definicao:",
  withoutDefinition.length
);

console.log(
  "Percentual com definicao:",
  (
    (withDefinition.length / categories.length) *
    100
  ).toFixed(1) + "%"
);

console.log("");

console.log("========================================");
console.log("CATEGORIAS SEM DEFINICAO");
console.log("========================================");
console.log("");

for (const category of withoutDefinition) {
  console.log(
    (category.code || "(sem codigo)") +
    " | " +
    extractText(category.title) +
    " | ID " +
    category.id
  );
}

console.log("");

console.log("========================================");
console.log("ESTRUTURA DA HIERARQUIA");
console.log("========================================");
console.log("");

const parentCount = new Map();

for (const category of categories) {
  const parentId = category.parentId || "SEM_PAI";

  parentCount.set(
    parentId,
    (parentCount.get(parentId) || 0) + 1
  );
}

console.log(
  "Pais diferentes encontrados:",
  parentCount.size
);

const rootCategories = categories.filter(
  function (item) {
    return (
      !item.parentId ||
      item.parentId === "619527855"
    );
  }
);

console.log(
  "Categorias diretamente abaixo da raiz:",
  rootCategories.length
);

console.log("");

console.log("========================================");
console.log("CATEGORIAS POR PRIMEIRA LETRA");
console.log("========================================");
console.log("");

const byPrefix = {};

for (const category of categories) {
  const code = category.code;

  if (!code) {
    continue;
  }

  const prefix = code.charAt(0);

  if (!byPrefix[prefix]) {
    byPrefix[prefix] = 0;
  }

  byPrefix[prefix]++;
}

for (const prefix of Object.keys(byPrefix).sort()) {
  console.log(
    prefix + ": " + byPrefix[prefix]
  );
}

console.log("");

console.log("========================================");
console.log("DUPLICIDADES DE CODIGO");
console.log("========================================");
console.log("");

const codeMap = new Map();

for (const category of categories) {
  if (!category.code) {
    continue;
  }

  if (!codeMap.has(category.code)) {
    codeMap.set(category.code, []);
  }

  codeMap.get(category.code).push(category);
}

let duplicateCodes = 0;

for (const [code, items] of codeMap.entries()) {
  if (items.length > 1) {
    duplicateCodes++;

    console.log(
      code +
      " -> " +
      items.length +
      " ocorrencias"
    );

    for (const item of items) {
      console.log(
        "  ID: " +
        item.id +
        " | " +
        extractText(item.title)
      );
    }

    console.log("");
  }
}

if (duplicateCodes === 0) {
  console.log("Nenhum codigo duplicado.");
}

console.log("");

console.log("========================================");
console.log("RESULTADO FINAL");
console.log("========================================");
console.log("");

console.log(
  "Entidades:",
  entities.length
);

console.log(
  "Categorias:",
  categories.length
);

console.log(
  "Com definicao:",
  withDefinition.length
);

console.log(
  "Sem definicao:",
  withoutDefinition.length
);

console.log(
  "Codigos unicos:",
  codeMap.size
);

console.log(
  "Codigos duplicados:",
  duplicateCodes
);

console.log("");

function extractText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (
      typeof value["@value"] === "string"
    ) {
      return value["@value"];
    }

    if (
      typeof value.value === "string"
    ) {
      return value.value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value);
}