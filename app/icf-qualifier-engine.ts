/**
 * Motor de regras de qualificação da CIF.
 *
 * PRINCÍPIO:
 * - A OMS continua sendo a fonte dos eixos oficiais e das opções de cada eixo.
 * - Este arquivo apenas transforma esses dados em uma estrutura compreensível
 *   para a interface e acrescenta as possibilidades opcionais previstas pela CIF.
 * - Não são inventados códigos de qualificadores.
 *
 * Componentes:
 *   b = Funções do corpo
 *   s = Estruturas do corpo
 *   d = Atividades e Participação
 *   e = Fatores ambientais
 */

export type ICFComponent = "b" | "s" | "d" | "e" | "unknown";

export type Qualifier = {
  id: string | null;
  code: string | null;
  title: string | null;
  definition?: string | null;
  classKind?: string | null;
  url?: string | null;
  browserUrl?: string | null;
};

export type QualifierAxis = {
  axis: string | null;
  axisName: string | null;
  required: boolean;
  multiple:
    | "AllowAlways"
    | "NotAllowed"
    | "AllowedExceptFromSameBlock"
    | null;
  scaleEntities: string[];
  options: Qualifier[];
};

export type QualifierRuleSource = "oms" | "icf-optional";

export type QualifierUiKind = "numeric" | "choice" | "signedNumeric";

export type QualifierRule = {
  /** Chave estável usada pela aplicação. Não é necessariamente o axis URI da OMS. */
  key: string;

  /** Nome amigável mostrado ao profissional. */
  label: string;

  /** Explicação curta para a interface. */
  description: string;

  /** Eixo oficial da OMS quando existir. */
  axisKey: string | null;

  /** De onde veio a regra. */
  source: QualifierRuleSource;

  /** Se o profissional precisa preencher este qualificador para concluir. */
  required: boolean;

  /** Se o eixo permite múltiplos valores segundo a OMS. */
  multiple: QualifierAxis["multiple"];

  /** Como a interface deve apresentar o valor. */
  uiKind: QualifierUiKind;

  /** Opções oficiais da OMS que podem ser usadas neste qualificador. */
  options: Qualifier[];

  /**
   * Indica que esta regra é uma qualificação adicional/opcional da CIF,
   * fora dos eixos oficiais expostos diretamente pela API da OMS.
   */
  optional: boolean;
};

export type QualifierPlan = {
  component: ICFComponent;
  rules: QualifierRule[];
  notes: string[];
};

function normalizeAxisValue(value: string | null | undefined): string {
  return (value || "")
    .split("/")
    .pop()!
    .trim()
    .toLowerCase();
}

function axisMatches(axis: QualifierAxis, term: string): boolean {
  const values = [axis.axis, axis.axisName].map(normalizeAxisValue);
  return values.some((value) => value.includes(term));
}

function findAxis(
  axes: QualifierAxis[],
  terms: string[]
): QualifierAxis | null {
  return (
    axes.find((axis) =>
      terms.some((term) => axisMatches(axis, term))
    ) || null
  );
}

function componentFromCode(code: string | null | undefined): ICFComponent {
  const prefix = (code || "").trim().toLowerCase().charAt(0);

  if (prefix === "b" || prefix === "s" || prefix === "d" || prefix === "e") {
    return prefix;
  }

  return "unknown";
}

function getNumericOptions(axis: QualifierAxis | null): Qualifier[] {
  if (!axis) return [];

  const values = new Map<number, Qualifier>();

  for (const option of axis.options) {
    const match = (option.code || "").match(/([0-4])$/);
    if (!match) continue;

    values.set(Number(match[1]), option);
  }

  if ([0, 1, 2, 3, 4].some((value) => !values.has(value))) {
    return [];
  }

  return [0, 1, 2, 3, 4].map((value) => values.get(value)!);
}

function isNumericAxis(axis: QualifierAxis | null): boolean {
  return getNumericOptions(axis).length === 5;
}

function makeOfficialRule(
  key: string,
  label: string,
  description: string,
  axis: QualifierAxis | null,
  uiKind: QualifierUiKind,
  optional = false
): QualifierRule | null {
  if (!axis) return null;

  return {
    key,
    label,
    description,
    axisKey: axis.axis || axis.axisName || null,
    source: "oms",
    required: axis.required,
    multiple: axis.multiple,
    uiKind,
    options: axis.options,
    optional,
  };
}

/**
 * Cria o plano de qualificação para uma categoria CIF.
 *
 * A função não substitui os dados da OMS. Ela organiza os eixos que a OMS
 * devolveu e aplica apenas regras de apresentação/interpretação conhecidas.
 */
export function buildQualifierPlan(
  code: string | null | undefined,
  axes: QualifierAxis[],
  includeOptionalDQualifiers = true
): QualifierPlan {
  const component = componentFromCode(code);
  const rules: QualifierRule[] = [];
  const notes: string[] = [];

  const extentAxis = findAxis(axes, ["extentormagnitudeofimpairment"]);
  const performanceAxis = findAxis(axes, ["performance"]);
  const capacityAxis = findAxis(axes, ["capacity"]);
  const barrierAxis = findAxis(axes, ["barrierorfacilitator"]);
  const natureAxis = findAxis(axes, [
    "natureofchangeinbodystructure",
    "changeinbodystructure",
  ]);

  switch (component) {
    case "b": {
      const rule = makeOfficialRule(
        "extentOrMagnitudeOfImpairment",
        "Extensão da dificuldade",
        "Indique quanto a dificuldade ou a alteração está presente.",
        extentAxis,
        "numeric"
      );

      if (rule) rules.push(rule);
      break;
    }

    case "s": {
      const extentRule = makeOfficialRule(
        "extentOrMagnitudeOfImpairment",
        "Extensão da dificuldade",
        "Indique quanto a alteração da estrutura está presente.",
        extentAxis,
        "numeric"
      );

      const natureRule = makeOfficialRule(
        "natureOfChangeInBodyStructure",
        "Natureza da alteração",
        "Indique o tipo de alteração observada na estrutura do corpo.",
        natureAxis,
        "choice"
      );

      if (extentRule) rules.push(extentRule);
      if (natureRule) rules.push(natureRule);

      // A CIF descreve um terceiro qualificador opcional para estruturas do
      // corpo: localização. Ele não aparece como eixo independente na API
      // atual da OMS, portanto é mantido como camada metodológica local.
      //
      // A escala sugerida pela CIF é:
      // 0 = mais de uma região
      // 1 = direita
      // 2 = esquerda
      // 3 = ambos os lados
      // 4 = frente
      // 5 = atrás
      // 6 = proximal
      // 7 = distal
      // 8 = não especificada
      // 9 = não aplicável
      if (extentAxis && natureAxis) {
        rules.push({
          key: "locationOfImpairment",
          label: "Localização — opcional",
          description:
            "Indique a localização da alteração estrutural quando essa informação for relevante e puder ser determinada.",
          axisKey: null,
          source: "icf-optional",
          required: false,
          multiple: "NotAllowed",
          uiKind: "choice",
          options: [
            {
              id: null,
              code: "0",
              title: "Mais de uma região",
            },
            {
              id: null,
              code: "1",
              title: "Direita",
            },
            {
              id: null,
              code: "2",
              title: "Esquerda",
            },
            {
              id: null,
              code: "3",
              title: "Ambos os lados",
            },
            {
              id: null,
              code: "4",
              title: "Frente",
            },
            {
              id: null,
              code: "5",
              title: "Atrás",
            },
            {
              id: null,
              code: "6",
              title: "Proximal",
            },
            {
              id: null,
              code: "7",
              title: "Distal",
            },
            {
              id: null,
              code: "8",
              title: "Não especificada",
            },
            {
              id: null,
              code: "9",
              title: "Não aplicável",
            },
          ],
          optional: true,
        });

        notes.push(
          "Estruturas do corpo podem usar um terceiro qualificador opcional de localização. Esta escala é uma camada metodológica da CIF e não um eixo separado da API da OMS."
        );
      }
      break;
    }

    case "d": {
      const performanceRule = makeOfficialRule(
        "performance",
        "Desempenho — ambiente habitual",
        "Como a pessoa realiza a atividade no ambiente em que vive.",
        performanceAxis,
        "numeric"
      );

      const capacityRule = makeOfficialRule(
        "capacity",
        "Capacidade — sem assistência",
        "O que a pessoa consegue fazer sem ajuda ou assistência.",
        capacityAxis,
        "numeric"
      );

      if (performanceRule) rules.push(performanceRule);
      if (capacityRule) rules.push(capacityRule);

      if (includeOptionalDQualifiers) {
        if (capacityAxis) {
          rules.push({
            key: "capacityWithAssistance",
            label: "Capacidade — com assistência",
            description:
              "O que a pessoa consegue fazer quando recebe assistência.",
            axisKey: capacityAxis.axis || capacityAxis.axisName || null,
            source: "icf-optional",
            required: false,
            multiple: capacityAxis.multiple,
            uiKind: isNumericAxis(capacityAxis) ? "numeric" : "choice",
            options: capacityAxis.options,
            optional: true,
          });
        }

        if (performanceAxis) {
          rules.push({
            key: "performanceWithoutAssistance",
            label: "Desempenho — sem assistência",
            description:
              "Como a pessoa realiza a atividade quando o efeito da assistência é retirado.",
            axisKey: performanceAxis.axis || performanceAxis.axisName || null,
            source: "icf-optional",
            required: false,
            multiple: performanceAxis.multiple,
            uiKind: isNumericAxis(performanceAxis)
              ? "numeric"
              : "choice",
            options: performanceAxis.options,
            optional: true,
          });
        }

        if (capacityAxis || performanceAxis) {
          notes.push(
            "Os qualificadores opcionais de Atividades e Participação são uma camada metodológica da CIF. Eles reutilizam as escalas oficiais de capacidade/desempenho; não são apresentados como novos eixos independentes da API da OMS."
          );
        }
      }

      break;
    }

    case "e": {
      const rule = makeOfficialRule(
        "barrierOrFacilitator",
        "Barreira ou facilitador",
        "Indique se este fator dificulta ou facilita a vida da pessoa e em que intensidade.",
        barrierAxis,
        "signedNumeric"
      );

      if (rule) rules.push(rule);
      break;
    }

    default: {
      // Componentes desconhecidos continuam usando todos os eixos recebidos da OMS.
    }
  }

  // VARREDURA DE SEGURANÇA:
  // nenhuma escala devolvida pela OMS pode desaparecer apenas porque o nome do
  // eixo não foi previsto explicitamente no switch acima. Isso é importante para
  // categorias menos comuns da CIF e também protege contra novos eixos da API.
  //
  // Eixos já representados pelas regras oficiais/ opcionais são identificados pelo
  // mesmo axisKey. Qualquer eixo restante recebe um classificador genérico moderno,
  // usando a própria escala e opções oficiais da OMS.
  const representedAxisKeys = new Set(
    rules
      .map((rule) => rule.axisKey)
      .filter((value): value is string => Boolean(value))
      .map(normalizeAxisValue)
  );

  for (const [index, axis] of axes.entries()) {
    const axisKey = axis.axis || axis.axisName || `axis-${index}`;
    const normalizedKey = normalizeAxisValue(axisKey);

    if (representedAxisKeys.has(normalizedKey)) {
      continue;
    }

    rules.push({
      key: `oms-${normalizedKey || index}`,
      label: getFallbackAxisLabel(axis, index),
      description: "Selecione a opção que melhor representa a situação.",
      axisKey,
      source: "oms",
      required: axis.required,
      multiple: axis.multiple,
      uiKind: isNumericAxis(axis) ? "numeric" : "choice",
      options: axis.options,
      optional: false,
    });

    representedAxisKeys.add(normalizedKey);
  }

  return {
    component,
    rules,
    notes,
  };
}

function getFallbackAxisLabel(axis: QualifierAxis, index: number): string {
  const raw = normalizeAxisValue(axis.axis || axis.axisName);

  if (raw.includes("extentormagnitudeofimpairment")) {
    return "Extensão da dificuldade";
  }

  if (raw.includes("performance")) {
    return "Desempenho";
  }

  if (raw.includes("capacity")) {
    return "Capacidade";
  }

  if (raw.includes("barrierorfacilitator")) {
    return "Barreira ou facilitador";
  }

  if (
    raw.includes("natureofchangeinbodystructure") ||
    raw.includes("changeinbodystructure")
  ) {
    return "Natureza da alteração";
  }

  return `Qualificador ${index + 1}`;
}

export function getICFComponent(code: string | null | undefined): ICFComponent {
  return componentFromCode(code);
}

export function isOptionalDQualifier(rule: QualifierRule): boolean {
  return (
    rule.source === "icf-optional" &&
    (rule.key === "capacityWithAssistance" ||
      rule.key === "performanceWithoutAssistance")
  );
}

export function getQualifierNumericValue(
  qualifier: Qualifier | null | undefined
): number | null {
  const code = (qualifier?.code || "").trim().toLowerCase();

  // Fatores ambientais usam duas famílias de qualificadores:
  // qb = barreira (0 a 4) e qf = facilitador (1 a 4).
  // Retornamos a barreira como valor negativo e o facilitador como positivo
  // para permitir que a interface use uma única barra de -100% a +100%.
  const signedMatch = code.match(/^q([bf])([0-4])$/);
  if (signedMatch) {
    const value = Number(signedMatch[2]);
    if (signedMatch[1] === "f") return value;
    return -value;
  }

  const match = code.match(/([0-4])$/);
  if (!match) return null;
  return Number(match[1]);
}

export function percentageToICFValue(percentage: number): number {
  if (percentage <= 4) return 0;
  if (percentage <= 24) return 1;
  if (percentage <= 49) return 2;
  if (percentage <= 95) return 3;
  return 4;
}

export function icfValueToPercentage(value: number): number {
  switch (value) {
    case 0:
      return 2;
    case 1:
      return 14;
    case 2:
      return 37;
    case 3:
      return 72;
    case 4:
      return 98;
    default:
      return 0;
  }
}

export function getICFValueRange(value: number): string {
  switch (value) {
    case 0:
      return "0–4%";
    case 1:
      return "5–24%";
    case 2:
      return "25–49%";
    case 3:
      return "50–95%";
    case 4:
      return "96–100%";
    default:
      return "";
  }
}

export function getICFValueDescription(value: number): string {
  switch (value) {
    case 0:
      return "Nenhuma dificuldade";
    case 1:
      return "Dificuldade leve";
    case 2:
      return "Dificuldade moderada";
    case 3:
      return "Dificuldade grave";
    case 4:
      return "Dificuldade completa";
    default:
      return "";
  }
}
