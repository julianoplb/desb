import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();

const INPUT_FILE = path.join(
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
    "O índice não possui um array 'entities'."
  );
  process.exit(1);
}

const byCode = new Map();

for (const entity of data.entities) {
  if (entity.code) {
    byCode.set(entity.code, entity);
  }
}

function printCategory(code) {
  const entity = byCode.get(code);

  if (!entity) {
    console.log(`\n${code} -> NÃO ENCONTRADO`);
    return;
  }

  console.log(`\n${code} -> ENCONTRADO`);
  console.log(`  Título: ${entity.title || "-"}`);
  console.log(
    `  Pai: ${entity.parentCode || "(sem código)"}`
  );
  console.log(
    `  Título do pai: ${entity.parentTitle || "-"}`
  );
  console.log(
    `  Profundidade: ${entity.depth}`
  );

  console.log("  Hierarquia:");

  if (
    Array.isArray(entity.hierarchy) &&
    entity.hierarchy.length > 0
  ) {
    for (const item of entity.hierarchy) {
      const prefix =
        item.code && item.title
          ? `${item.code} — ${item.title}`
          : item.title || item.code || "(sem identificação)";

      console.log(`    ${prefix}`);
    }
  } else {
    console.log("    (sem hierarquia)");
  }

  const children = data.entities.filter(
    (child) =>
      child.parentCode === entity.code
  );

  if (children.length > 0) {
    console.log("  Filhos:");

    for (const child of children) {
      console.log(
        `    ${child.code} — ${child.title}`
      );
    }
  }
}

console.log("======================================");
console.log(" AUDITORIA DO ÍNDICE CIF 2026-01");
console.log("======================================");

const testCodes = [
  "d450",
  "d4501",
  "d455",
  "d4551",
  "d510",
  "d5100",
  "d5101",
  "d5102",
  "b110",
  "b28015",
  "e110",
  "s750"
];

for (const code of testCodes) {
  printCategory(code);
}

console.log("");
console.log("======================================");
console.log(" ESTATÍSTICAS");
console.log("======================================");

console.log(
  `Total de entidades: ${data.statistics.totalEntities}`
);

console.log(
  `Total de categorias: ${data.statistics.totalCategories}`
);

console.log(
  `Entidades com parentCode: ${data.statistics.entitiesWithParentCode}`
);

console.log(
  `Entidades com hierarquia: ${data.statistics.entitiesWithHierarchy}`
);

console.log("");