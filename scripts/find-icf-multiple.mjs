import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const TOKEN_URL =
  "https://icdaccessmanagement.who.int/connect/token";

const ICF_BASE_URL =
  "https://id.who.int/icd/release/11/2026-01/icf";

async function getToken() {
  const clientId = process.env.WHO_CLIENT_ID;
  const clientSecret = process.env.WHO_CLIENT_SECRET;

  if (!clientId) {
    throw new Error("WHO_CLIENT_ID não foi encontrado.");
  }

  if (!clientSecret) {
    throw new Error("WHO_CLIENT_SECRET não foi encontrado.");
  }

  console.log(
    `Client ID encontrado: ${clientId.substring(0, 6)}...`
  );

  console.log(
    `Client Secret encontrado: sim (${clientSecret.length} caracteres)`
  );

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
    body,
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Erro ao obter token: ${response.status} ${text}`
    );
  }

  const data = await response.json();

  return data.access_token;
}

async function whoGet(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "API-Version": "v2",
      Accept: "application/json",
      "Accept-Language": "pt",
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Erro WHO ${response.status}: ${text}`
    );
  }

  return response.json();
}

function extractId(url) {
  const match = url.match(/\/icf\/(\d+)(?:\/.*)?$/);

  return match ? match[1] : null;
}

async function main() {
  console.log("Obtendo token da OMS...");

  const token = await getToken();

  console.log("Token obtido com sucesso.");
  console.log("");
  console.log("Lendo árvore da CIF 2026-01...");
  console.log("");

  const root = await whoGet(ICF_BASE_URL, token);

  const queue = [];

  for (const childUrl of root.child ?? []) {
    const id = extractId(childUrl);

    if (id) {
      queue.push(id);
    }
  }

  const visited = new Set();

  let checked = 0;
  let totalAxes = 0;

  const counts = {
    AllowAlways: 0,
    NotAllowed: 0,
    AllowedExceptFromSameBlock: 0,
    Other: 0,
  };

  const examples = {
    AllowAlways: [],
    AllowedExceptFromSameBlock: [],
    NotAllowed: [],
    Other: [],
  };

  while (queue.length > 0) {
    const id = queue.shift();

    if (visited.has(id)) {
      continue;
    }

    visited.add(id);
    checked++;

    if (checked % 20 === 0) {
      console.log(
        `Consultadas: ${checked} | Na fila: ${queue.length}`
      );
    }

    let entity;

    try {
      entity = await whoGet(
        `${ICF_BASE_URL}/${id}`,
        token
      );
    } catch {
      console.log(
        `Erro ao consultar ${id}. Continuando...`
      );

      continue;
    }

    const axes = entity.postcoordinationScale ?? [];

    totalAxes += axes.length;

    for (const axis of axes) {
      const multiple = axis.allowMultipleValues;

      if (multiple === "AllowAlways") {
        counts.AllowAlways++;

        if (examples.AllowAlways.length < 10) {
          examples.AllowAlways.push({
            id,
            code: entity.code ?? "sem código",
            title:
              typeof entity.title === "string"
                ? entity.title
                : entity.title?.["@value"] ?? "sem título",
            axis: axis.axisName ?? "sem nome",
          });
        }
      } else if (
        multiple === "AllowedExceptFromSameBlock"
      ) {
        counts.AllowedExceptFromSameBlock++;

        if (
          examples.AllowedExceptFromSameBlock.length < 10
        ) {
          examples.AllowedExceptFromSameBlock.push({
            id,
            code: entity.code ?? "sem código",
            title:
              typeof entity.title === "string"
                ? entity.title
                : entity.title?.["@value"] ?? "sem título",
            axis: axis.axisName ?? "sem nome",
          });
        }
      } else if (multiple === "NotAllowed") {
        counts.NotAllowed++;

        if (examples.NotAllowed.length < 10) {
          examples.NotAllowed.push({
            id,
            code: entity.code ?? "sem código",
            title:
              typeof entity.title === "string"
                ? entity.title
                : entity.title?.["@value"] ?? "sem título",
            axis: axis.axisName ?? "sem nome",
          });
        }
      } else {
        counts.Other++;

        if (examples.Other.length < 10) {
          examples.Other.push({
            id,
            code: entity.code ?? "sem código",
            title:
              typeof entity.title === "string"
                ? entity.title
                : entity.title?.["@value"] ?? "sem título",
            axis: axis.axisName ?? "sem nome",
            value: multiple ?? "undefined",
          });
        }
      }
    }

    for (const childUrl of entity.child ?? []) {
      const childId = extractId(childUrl);

      if (childId && !visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  console.log("");
  console.log("========================================");
  console.log("RESULTADO DA VERIFICAÇÃO");
  console.log("========================================");
  console.log("");
  console.log(`Categorias consultadas: ${checked}`);
  console.log(`Eixos encontrados: ${totalAxes}`);
  console.log("");
  console.log(
    `NotAllowed: ${counts.NotAllowed}`
  );
  console.log(
    `AllowAlways: ${counts.AllowAlways}`
  );
  console.log(
    `AllowedExceptFromSameBlock: ${counts.AllowedExceptFromSameBlock}`
  );
  console.log(
    `Outros/indefinidos: ${counts.Other}`
  );
  console.log("");

  if (examples.AllowAlways.length > 0) {
    console.log("----------------------------------------");
    console.log("EXEMPLOS — AllowAlways");
    console.log("----------------------------------------");

    for (const item of examples.AllowAlways) {
      console.log(
        `${item.code} — ${item.title} | Eixo: ${item.axis}`
      );
      console.log(
        `https://icd.who.int/browse/2026-01/icf/pt#${item.id}`
      );
      console.log("");
    }
  }

  if (
    examples.AllowedExceptFromSameBlock.length > 0
  ) {
    console.log("----------------------------------------");
    console.log(
      "EXEMPLOS — AllowedExceptFromSameBlock"
    );
    console.log("----------------------------------------");

    for (const item of examples.AllowedExceptFromSameBlock) {
      console.log(
        `${item.code} — ${item.title} | Eixo: ${item.axis}`
      );
      console.log(
        `https://icd.who.int/browse/2026-01/icf/pt#${item.id}`
      );
      console.log("");
    }
  }

  if (examples.NotAllowed.length > 0) {
    console.log("----------------------------------------");
    console.log("EXEMPLOS — NotAllowed");
    console.log("----------------------------------------");

    for (const item of examples.NotAllowed) {
      console.log(
        `${item.code} — ${item.title} | Eixo: ${item.axis}`
      );
    }

    console.log("");
  }

  if (examples.Other.length > 0) {
    console.log("----------------------------------------");
    console.log("EXEMPLOS — OUTROS");
    console.log("----------------------------------------");

    for (const item of examples.Other) {
      console.log(
        `${item.code} — ${item.title} | Eixo: ${item.axis} | Valor: ${item.value}`
      );
    }

    console.log("");
  }

  console.log("========================================");
  console.log("FIM");
  console.log("========================================");
}

main().catch((error) => {
  console.error("");
  console.error("ERRO:");
  console.error(error.message);
  process.exit(1);
});