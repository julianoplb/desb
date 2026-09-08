import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_PATH = path.join(
  __dirname,
  "..",
  "data",
  "icf-2026-01-index.json"
);

const MAX_RESULTS = 30;

// ============================================================
// NORMALIZAÇÃO
// ============================================================

function normalize(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text = "") {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean);
}

// ============================================================
// STOP WORDS
// ============================================================

const STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "por",
  "para",
  "com",
  "sem",
  "e",
  "ou",
  "que",
  "se",
  "ao",
  "aos",
  "à",
  "às",
  "como",
  "mais",
  "menos",
  "muito",
  "muita",
  "muitos",
  "muitas",
  "pouco",
  "pouca",
  "poucos",
  "poucas",
  "uma",
  "paciente",
  "pacientes",
  "apresenta",
  "apresentando",
  "apresentar",
  "refere",
  "relata",
  "relatando",
  "tem",
  "possui",
  "devido",
  "devido a",
]);

function meaningfulTokens(text) {
  return tokenize(text).filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word)
  );
}

// ============================================================
// SINGULAR / PLURAL
// ============================================================

function variants(word) {
  const result = new Set([word]);

  if (word.endsWith("ões")) {
    result.add(word.slice(0, -3) + "ao");
  }

  if (word.endsWith("ães")) {
    result.add(word.slice(0, -3) + "ao");
  }

  if (word.endsWith("ais")) {
    result.add(word.slice(0, -3) + "al");
  }

  if (word.endsWith("eis")) {
    result.add(word.slice(0, -3) + "el");
  }

  if (word.endsWith("is")) {
    result.add(word.slice(0, -2) + "il");
  }

  if (word.endsWith("s") && word.length > 4) {
    result.add(word.slice(0, -1));
  }

  if (word.endsWith("es") && word.length > 5) {
    result.add(word.slice(0, -2));
  }

  return [...result];
}

// ============================================================
// EXPANSÕES SEMÂNTICAS
//
// Não tentamos transformar isso em um dicionário completo.
// O objetivo é aumentar a cobertura do retriever.
// ============================================================

const CONCEPT_EXPANSIONS = {
  caminhar: [
    "andar",
    "caminhar",
    "locomover",
    "locomover-se",
    "deslocar",
    "deslocar-se",
    "mover-se",
  ],

  andar: [
    "andar",
    "caminhar",
    "locomover",
    "locomover-se",
    "deslocar",
    "deslocar-se",
    "mover-se",
  ],

  locomover: [
    "locomover",
    "locomover-se",
    "deslocar",
    "deslocar-se",
    "andar",
    "caminhar",
    "mover-se",
  ],

  deslocar: [
    "deslocar",
    "deslocar-se",
    "locomover",
    "locomover-se",
    "andar",
    "caminhar",
    "mover-se",
  ],

  mover: [
    "mover",
    "mover-se",
    "deslocar",
    "deslocar-se",
    "andar",
    "caminhar",
  ],

  escada: [
    "escada",
    "escadas",
    "subir",
    "descer",
  ],

  subir: [
    "subir",
    "ascender",
    "escada",
    "escadas",
  ],

  descer: [
    "descer",
    "escada",
    "escadas",
  ],

  banho: [
    "banho",
    "banhar",
    "lavar",
    "lavar-se",
    "higiene",
    "higienizar",
  ],

  lavar: [
    "lavar",
    "lavar-se",
    "banho",
    "higiene",
    "higienizar",
  ],

  higiene: [
    "higiene",
    "lavar",
    "lavar-se",
    "banho",
    "higienizar",
  ],

  dor: [
    "dor",
    "doloroso",
    "dolorosa",
  ],

  joelho: [
    "joelho",
    "articulacao",
    "articulações",
    "membro inferior",
    "perna",
  ],

  perna: [
    "perna",
    "membro inferior",
    "joelho",
  ],

  articulacao: [
    "articulacao",
    "articulacoes",
    "joelho",
  ],

  distancia: [
    "distancia",
    "distancias",
    "longo",
    "longa",
    "longas",
    "curto",
    "curta",
    "curtas",
    "percorrer",
  ],

  longa: [
    "longa",
    "longo",
    "longas",
    "longos",
    "distancia",
    "distancias",
  ],

  longas: [
    "longa",
    "longo",
    "longas",
    "longos",
    "distancia",
    "distancias",
  ],

  correr: [
    "correr",
    "corrida",
    "caminhar",
    "andar",
    "deslocar",
  ],

  correr: [
    "correr",
    "corrida",
    "andar",
    "caminhar",
    "deslocar",
  ],

  vestir: [
    "vestir",
    "vestir-se",
    "roupa",
    "vestuario",
  ],

  alimentar: [
    "alimentar",
    "alimentacao",
    "comer",
    "beber",
    "refeicao",
  ],

  comer: [
    "comer",
    "alimentar",
    "alimentacao",
    "refeicao",
  ],

  beber: [
    "beber",
    "alimentar",
    "alimentacao",
  ],

  falar: [
    "falar",
    "fala",
    "comunicacao",
    "comunicar",
  ],

  comunicar: [
    "comunicar",
    "comunicacao",
    "falar",
    "linguagem",
  ],

  enxergar: [
    "enxergar",
    "ver",
    "visao",
    "visual",
  ],

  ver: [
    "ver",
    "enxergar",
    "visao",
    "visual",
  ],

  ouvir: [
    "ouvir",
    "audicao",
    "auditivo",
  ],

  respirar: [
    "respirar",
    "respiracao",
  ],

  respirar: [
    "respirar",
    "respiracao",
    "respiratorio",
  ],
};

// ============================================================
// CARREGAMENTO DO ÍNDICE
// ============================================================

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(
      `Índice CIF não encontrado em: ${INDEX_PATH}`
    );
  }

  const raw = fs.readFileSync(INDEX_PATH, "utf8");
  const data = JSON.parse(raw);

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.entities)) {
    return data.entities;
  }

  if (Array.isArray(data.categories)) {
    return data.categories;
  }

  throw new Error(
    "Formato do índice CIF não reconhecido. Esperado array, entities ou categories."
  );
}

// ============================================================
// EXTRAÇÃO DOS CAMPOS
// ============================================================

function getCode(entity) {
  return entity.code || "";
}

function getTitle(entity) {
  return entity.title || "";
}

function getDefinition(entity) {
  return entity.definition || "";
}

function getParentCode(entity) {
  return entity.parentCode || "";
}

function getParentTitle(entity) {
  return entity.parentTitle || "";
}

function getDepth(entity) {
  return Number(entity.depth || 0);
}

function getKind(entity) {
  return (
    entity.classKind ||
    entity.kind ||
    "category"
  );
}

// ============================================================
// TEXTO PESQUISÁVEL
// ============================================================

function buildSearchText(entity) {
  const parts = [
    getTitle(entity),
    getDefinition(entity),
    getParentTitle(entity),
  ];

  return normalize(parts.filter(Boolean).join(" "));
}

// ============================================================
// EXPANSÃO DOS CONCEITOS
// ============================================================

function expandConcepts(concepts) {
  const expanded = new Set();

  for (const concept of concepts) {
    const normalized = normalize(concept);

    if (!normalized) continue;

    expanded.add(normalized);

    const words = meaningfulTokens(normalized);

    for (const word of words) {
      for (const variant of variants(word)) {
        expanded.add(variant);

        const expansions =
          CONCEPT_EXPANSIONS[variant] || [];

        for (const expansion of expansions) {
          expanded.add(normalize(expansion));
        }
      }
    }

    const directExpansions =
      CONCEPT_EXPANSIONS[normalized] || [];

    for (const expansion of directExpansions) {
      expanded.add(normalize(expansion));
    }
  }

  return [...expanded].filter(Boolean);
}

// ============================================================
// MATCH DE FRASE
// ============================================================

function phraseMatch(text, phrase) {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);

  if (!normalizedPhrase) return false;

  return normalizedText.includes(normalizedPhrase);
}

// ============================================================
// MATCH DE PALAVRAS
// ============================================================

function wordMatch(text, word) {
  const normalizedText = normalize(text);

  const textWords = new Set(tokenize(normalizedText));

  for (const variant of variants(word)) {
    if (textWords.has(variant)) {
      return true;
    }
  }

  return false;
}

// ============================================================
// CÁLCULO DE SCORE
// ============================================================

function scoreEntity(entity, originalConcepts, expandedConcepts) {
  const title = normalize(getTitle(entity));
  const definition = normalize(getDefinition(entity));
  const parentTitle = normalize(getParentTitle(entity));

  const searchable = [
    title,
    definition,
    parentTitle,
  ]
    .filter(Boolean)
    .join(" ");

  if (!searchable) {
    return {
      score: 0,
      matches: [],
    };
  }

  let score = 0;
  const matches = [];

  // ----------------------------------------------------------
  // 1. FRASE EXATA NO TÍTULO
  // ----------------------------------------------------------

  for (const concept of originalConcepts) {
    const normalizedConcept = normalize(concept);

    if (!normalizedConcept) continue;

    if (phraseMatch(title, normalizedConcept)) {
      score += 80;
      matches.push(`frase no título: ${concept}`);
    }

    if (phraseMatch(definition, normalizedConcept)) {
      score += 35;
      matches.push(`frase na definição: ${concept}`);
    }
  }

  // ----------------------------------------------------------
  // 2. FRASE EXPANDIDA NO TÍTULO
  // ----------------------------------------------------------

  for (const concept of expandedConcepts) {
    if (!concept || concept.length < 3) continue;

    if (phraseMatch(title, concept)) {
      score += 30;
      matches.push(`conceito no título: ${concept}`);
    }

    if (phraseMatch(definition, concept)) {
      score += 12;
      matches.push(`conceito na definição: ${concept}`);
    }
  }

  // ----------------------------------------------------------
  // 3. PALAVRAS DOS CONCEITOS ORIGINAIS
  // ----------------------------------------------------------

  for (const concept of originalConcepts) {
    const words = meaningfulTokens(concept);

    for (const word of words) {
      if (wordMatch(title, word)) {
        score += 18;
        matches.push(`palavra no título: ${word}`);
      } else if (wordMatch(definition, word)) {
        score += 7;
        matches.push(`palavra na definição: ${word}`);
      }
    }
  }

  // ----------------------------------------------------------
  // 4. PALAVRAS EXPANDIDAS
  // ----------------------------------------------------------

  for (const concept of expandedConcepts) {
    const words = meaningfulTokens(concept);

    for (const word of words) {
      if (wordMatch(title, word)) {
        score += 8;
      } else if (wordMatch(definition, word)) {
        score += 3;
      }
    }
  }

  // ----------------------------------------------------------
  // 5. COMBINAÇÃO DE VÁRIOS TERMOS
  //
  // Quanto mais elementos do conceito aparecem,
  // mais confiável tende a ser a recuperação.
  // ----------------------------------------------------------

  for (const concept of originalConcepts) {
    const words = meaningfulTokens(concept);

    if (words.length < 2) continue;

    const matched = words.filter(
      (word) =>
        wordMatch(title, word) ||
        wordMatch(definition, word)
    );

    if (matched.length >= 2) {
      score += matched.length * 12;
      matches.push(
        `combinação: ${matched.join(", ")}`
      );
    }
  }

  // ----------------------------------------------------------
  // 6. ESPECIFICIDADE
  //
  // Categorias mais específicas ganham um pequeno bônus.
  // Não usamos isso para decidir a categoria final.
  // Apenas ajuda o retriever a não devolver somente
  // categorias muito genéricas.
  // ----------------------------------------------------------

  const code = getCode(entity);

  if (code) {
    const depth = getDepth(entity);

    if (depth >= 5) {
      score += 8;
    } else if (depth >= 4) {
      score += 5;
    } else if (depth >= 3) {
      score += 2;
    }
  }

  // ----------------------------------------------------------
  // 7. PENALIDADE PARA CATEGORIAS GENÉRICAS
  //
  // Só é aplicada quando a categoria não possui
  // correspondência forte no próprio título.
  // ----------------------------------------------------------

  const strongTitleMatch =
    originalConcepts.some((concept) =>
      phraseMatch(title, concept)
    );

  if (!strongTitleMatch) {
    if (getDepth(entity) <= 2) {
      score -= 8;
    }
  }

  return {
    score: Math.max(0, score),
    matches: [...new Set(matches)],
  };
}

// ============================================================
// BUSCA
// ============================================================

function search(concepts, options = {}) {
  const entities = loadIndex();

  const originalConcepts = concepts
    .map(normalize)
    .filter(Boolean);

  const expandedConcepts =
    expandConcepts(originalConcepts);

  const minScore =
    options.minScore ?? 8;

  const limit =
    options.limit ?? MAX_RESULTS;

  const results = [];

  for (const entity of entities) {
    const code = getCode(entity);

    // Não queremos qualificadores nesta etapa.
    if (!code) continue;

    if (
      code.startsWith("qp") ||
      code.startsWith("qc") ||
      code.startsWith("qm") ||
      code.startsWith("qf") ||
      code.startsWith("qa")
    ) {
      continue;
    }

    const result = scoreEntity(
      entity,
      originalConcepts,
      expandedConcepts
    );

    if (result.score < minScore) {
      continue;
    }

    results.push({
      entity,
      score: result.score,
      matches: result.matches,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const depthA = getDepth(a.entity);
    const depthB = getDepth(b.entity);

    if (depthB !== depthA) {
      return depthB - depthA;
    }

    return getCode(a.entity).localeCompare(
      getCode(b.entity)
    );
  });

  // ----------------------------------------------------------
  // Remove duplicidades por código
  // ----------------------------------------------------------

  const unique = [];
  const seen = new Set();

  for (const result of results) {
    const code = getCode(result.entity);

    if (seen.has(code)) continue;

    seen.add(code);
    unique.push(result);

    if (unique.length >= limit) {
      break;
    }
  }

  return {
    originalConcepts,
    expandedConcepts,
    results: unique,
  };
}

// ============================================================
// IMPRESSÃO
// ============================================================

function printResults(query, data) {
  console.log("");
  console.log("======================================");
  console.log(`BUSCA: "${query}"`);
  console.log("======================================");
  console.log("");

  console.log(
    `Conceitos expandidos: ${data.expandedConcepts.join(
      ", "
    )}`
  );

  console.log("");

  if (data.results.length === 0) {
    console.log("Nenhum candidato encontrado.");
    return;
  }

  data.results.forEach((result, index) => {
    const entity = result.entity;

    console.log(
      `${index + 1}. ${getCode(entity)} — ${getTitle(entity)}`
    );

    console.log(`   Score: ${result.score}`);

    const parent =
      getParentTitle(entity);

    if (parent) {
      console.log(
        `   Hierarquia: ${parent} > ${getTitle(entity)}`
      );
    }

    const definition =
      getDefinition(entity);

    if (definition) {
      console.log(
        `   Definição: ${definition}`
      );
    }

    if (result.matches.length > 0) {
      console.log(
        `   Matches: ${result.matches
          .slice(0, 5)
          .join(" | ")}`
      );
    }

    console.log("");
  });
}

// ============================================================
// CLI
// ============================================================

const args = process.argv
  .slice(2)
  .map((value) => value.trim())
  .filter(Boolean);

if (args.length === 0) {
  console.log("");
  console.log(
    'Uso: node scripts/search-icf.mjs "termo" "outro termo"'
  );
  console.log("");
  process.exit(1);
}

try {
  const data = search(args, {
    limit: 30,
    minScore: 8,
  });

  printResults(args.join(" "), data);
} catch (error) {
  console.error("");
  console.error("Erro na busca CIF:");
  console.error(
    error instanceof Error
      ? error.message
      : error
  );
  console.error("");

  process.exit(1);
}