"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildQualifierPlan,
  getICFValueDescription,
  getICFValueRange,
  getQualifierNumericValue,
  icfValueToPercentage,
  percentageToICFValue,
  type QualifierPlan,
} from "./icf-qualifier-engine";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionResultEventLike = {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
};

type SpeechRecognitionErrorEventLike = {
  error: string;
};

type Mode = "manual" | "ai";

type TreeNode = {
  id: string;
  code: string | null;
  title: string | null;
  definition: string | null;
  classKind: string | null;
  blockId: string | null;
  codeRange: string | null;
  hasChildren: boolean;
  childCount: number;
  url: string;
};

type Qualifier = {
  id: string | null;
  code: string | null;
  title: string | null;
  definition?: string | null;
  classKind?: string | null;
  url?: string | null;
  browserUrl?: string | null;
};

type QualifierAxis = {
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

type EntityData = {
  id: string;
  code: string | null;
  title: string | null;
  definition: string | null;
  classKind: string | null;
  browserUrl: string | null;
};

type EntityResponse = {
  success: boolean;
  error?: string;
  entity: EntityData;
  parents: TreeNode[];
  children: TreeNode[];
  qualifierAxes: QualifierAxis[];
  exclusions: {
    label: string | null;
    foundationReference?: string | null;
    linearizationReference?: string | null;
  }[];
};

type Classification = {
  id: string;
  code: string;
  title: string;
  definition: string | null;
  source: "manual" | "ai";
  reason?: string;
  confidence?: "Alta" | "Média" | "Baixa";
  qualifiers?: Record<string, Qualifier>;
  qualifierLabels?: Record<string, string>;
  icfCode?: string;
  entityId?: string;
  qualifierPercentages?: Record<string, number>;
};

type AISuggestion = {
  code: string;
  title: string | null;
  definition: string | null;
  browserUrl: string | null;
  reason: string;
  confidence: "Alta" | "Média" | "Baixa";
  validatedByWHO: boolean;
};

type TreeChildrenResponse = {
  success: boolean;
  entity: {
    id: string;
    code: string | null;
    title: string | null;
    definition: string | null;
    classKind: string | null;
    blockId: string | null;
    codeRange: string | null;
    browserUrl?: string | null;
    hasChildren: boolean;
    childCount: number;
  };
  children: TreeNode[];
};

function getQualifierCodeSuffix(qualifier: Qualifier | null | undefined): string | null {
  const code = (qualifier?.code || "").trim();

  if (!code) return null;

  const match = code.match(/([+-]?(?:[0-4]|8|9))$/);
  return match ? match[1] : null;
}

function getEntityIdFromBrowserUrl(browserUrl: string | null | undefined): string | null {
  if (!browserUrl) return null;

  try {
    const hash = new URL(browserUrl).hash.replace(/^#/, "").trim();
    return /^\d+$/.test(hash) ? hash : null;
  } catch {
    const match = browserUrl.match(/#(\d+)$/);
    return match?.[1] || null;
  }
}

function buildICFCode(
  baseCode: string,
  qualifiers: Record<string, Qualifier>,
  plan: QualifierPlan | null
): string {
  if (!plan || plan.rules.length === 0) {
    return baseCode;
  }

  const values: string[] = [];

  for (const rule of plan.rules) {
    const qualifier = qualifiers[rule.key];

    if (!qualifier) {
      if (rule.optional) {
        break;
      }
      return baseCode;
    }

    const suffix = getQualifierCodeSuffix(qualifier);

    if (suffix === null) {
      return baseCode;
    }

    values.push(suffix);
  }

  return values.length > 0 ? `${baseCode}.${values.join("")}` : baseCode;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("ai");

  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [childrenByNode, setChildrenByNode] = useState<
    Record<string, TreeNode[]>
  >({});
  const [loadingChildren, setLoadingChildren] = useState<
    Record<string, boolean>
  >({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] =
    useState<EntityResponse | null>(null);

  const [loadingEntity, setLoadingEntity] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treePath, setTreePath] = useState<TreeNode[]>([]);

  const [selectedQualifiers, setSelectedQualifiers] =
    useState<Record<string, Qualifier | null>>({});

  const [selectedQualifierPercentages, setSelectedQualifierPercentages] =
    useState<Record<string, number>>({});

  // Controla quais qualificadores numéricos estão no modo de avaliação.
  // Por padrão, a barra fica fechada e o profissional pode clicar em
  // “Avaliar” para abri-la.
  const [evaluatingQualifierRules, setEvaluatingQualifierRules] =
    useState<Record<string, boolean>>({});

  const [classifications, setClassifications] = useState<
    Classification[]
  >([]);

  const [editingClassificationId, setEditingClassificationId] =
    useState<string | null>(null);

  const [expandedCategoryInfo, setExpandedCategoryInfo] =
    useState(false);
  const [expandedQualifierRules, setExpandedQualifierRules] =
    useState<Record<string, boolean>>({});
  const [highlightedClassificationId, setHighlightedClassificationId] =
    useState<string | null>(null);
  const classificationsRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportView, setReportView] = useState<"hybrid" | "technical">("hybrid");
  const [patientName, setPatientName] = useState("");
  const [patientBirthDate, setPatientBirthDate] = useState("");
  const [reportDate, setReportDate] = useState("");

  const [aiText, setAiText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<
    AISuggestion[]
  >([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiProgressMessage, setAiProgressMessage] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  const [confirmingAI, setConfirmingAI] = useState<string | null>(
    null
  );

  function toggleSpeechRecognition() {
    if (typeof window === "undefined") return;

    if (isListening) {
      speechRecognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }).SpeechRecognition ||
      (window as Window & {
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setAiError(
        "Seu navegador não oferece reconhecimento de voz. Use o Google Chrome ou outro navegador compatível."
      );
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, index) => event.results[index])
        .filter((result) => result?.isFinal)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();

      if (!transcript) return;

      setAiText((current) => {
        const separator = current.trim() ? " " : "";
        return `${current}${separator}${transcript}`.slice(0, 5000);
      });
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      speechRecognitionRef.current = null;

      if (event.error !== "aborted") {
        const message =
          event.error === "not-allowed"
            ? "Permissão para usar o microfone foi negada. Autorize o microfone no navegador e tente novamente."
            : "Não foi possível reconhecer a fala. Tente novamente.";
        setAiError(message);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };

    speechRecognitionRef.current = recognition;
    setAiError(null);
    setIsListening(true);
    recognition.start();
  }

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    };
  }, []);

  /*
   * Carrega os primeiros níveis da árvore CIF.
   */
  useEffect(() => {
    async function loadRoot() {
      try {
        setTreeError(null);

        const response = await fetch("/api/icf/tree");

        const data: TreeChildrenResponse =
          await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            "Não foi possível carregar a árvore CIF."
          );
        }

        const categoryRoot = (data.children || []).find((node) =>
          (node.title || "").trim().toLowerCase() === "categoria da cif"
        );

        if (categoryRoot) {
          const categoryResponse = await fetch(
            `/api/icf/tree?id=${encodeURIComponent(categoryRoot.id)}`
          );

          const categoryData: TreeChildrenResponse =
            await categoryResponse.json();

          if (!categoryResponse.ok || !categoryData.success) {
            throw new Error(
              "Não foi possível carregar os quatro grupos principais da CIF."
            );
          }

          setRootNodes(categoryData.children || []);
        } else {
          setRootNodes(
            (data.children || []).filter(
              (node) =>
                (node.title || "").trim().toLowerCase() !==
                "qualificador da cif"
            )
          );
        }
      } catch (error) {
        console.error(error);

        setTreeError(
          error instanceof Error
            ? error.message
            : "Erro ao carregar a árvore CIF."
        );
      }
    }

    loadRoot();
  }, []);

  /*
   * Carrega filhos de um nó somente quando
   * o usuário abre o nó.
   */
  async function openTreeNode(node: TreeNode) {
    try {
      setTreeError(null);

      // Categorias finais não abrem um novo nível.
      // Para elas, a única ação disponível na árvore é "Adicionar".
      if (!node.hasChildren) {
        return;
      }

      if (!childrenByNode[node.id]) {
        setLoadingChildren((previous) => ({
          ...previous,
          [node.id]: true,
        }));

        const response = await fetch(
          `/api/icf/tree?id=${encodeURIComponent(node.id)}`
        );

        const data: TreeChildrenResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            "Não foi possível carregar os itens deste nível."
          );
        }

        setChildrenByNode((previous) => ({
          ...previous,
          [node.id]: data.children || [],
        }));
      }

      setTreePath((previous) => {
        const existingIndex = previous.findIndex((item) => item.id === node.id);
        if (existingIndex >= 0) {
          return previous.slice(0, existingIndex + 1);
        }
        return [...previous, node];
      });

      await selectNode(node);
    } catch (error) {
      console.error(error);
      setTreeError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar a categoria."
      );
    } finally {
      setLoadingChildren((previous) => ({
        ...previous,
        [node.id]: false,
      }));
    }
  }

  function goToTreeLevel(index: number) {
    setTreeError(null);
    setTreePath((previous) => previous.slice(0, index));

    if (index === 0) {
      setSelectedId(null);
      setSelectedEntity(null);
      setSelectedQualifiers({});
      setSelectedQualifierPercentages({});
      setEvaluatingQualifierRules({});
      setEditingClassificationId(null);
      return;
    }

    const node = treePath[index - 1];
    if (node) {
      void selectNode(node);
    }
  }

  /*
   * Consulta os detalhes completos de uma categoria.
   */
  async function selectNode(node: TreeNode) {
    try {
      setSelectedId(node.id);
      setLoadingEntity(true);
      setTreeError(null);
      setSelectedQualifiers({});
      setSelectedQualifierPercentages({});
      setEvaluatingQualifierRules({});
      setEditingClassificationId(null);

      const response = await fetch(
        `/api/icf/entity/${encodeURIComponent(node.id)}`
      );

      const data: EntityResponse =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          "Não foi possível carregar os detalhes da categoria."
        );
      }

      setSelectedEntity(data);
    } catch (error) {
      console.error(error);

      setTreeError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar a categoria."
      );
    } finally {
      setLoadingEntity(false);
    }
  }

  /*
   * Adiciona uma classificação escolhida manualmente.
   */
  function addManualClassification() {
    if (!selectedEntity?.entity) {
      return;
    }

    const entity = selectedEntity.entity;

    if (!entity.code || !entity.title) {
      return;
    }

    const selectedQualifierEntries =
      Object.entries(selectedQualifiers).filter(
        ([, qualifier]) => qualifier !== null
      );

    const existingIndex = classifications.findIndex(
      (item) => item.code === entity.code
    );

    const classificationId =
      existingIndex === -1
        ? entity.id
        : classifications[existingIndex].id;

    const classification: Classification = {
      id: classificationId,
      code: entity.code,
      title: entity.title,
      definition: entity.definition,
      source: "manual",
      entityId: entity.id,
      qualifiers: Object.fromEntries(
        selectedQualifierEntries
      ) as Record<string, Qualifier>,
      qualifierLabels: Object.fromEntries(
        selectedQualifierEntries.map(([key]) => {
          const rule = qualifierPlan?.rules.find(
            (item) => item.key === key
          );
          return [key, rule?.label || key];
        })
      ),
      qualifierPercentages: Object.fromEntries(
        qualifierPlan?.rules
          .filter((rule) => {
            const qualifier = selectedQualifiers[rule.key];
            return (
              qualifier != null &&
              (rule.uiKind === "numeric" || rule.uiKind === "signedNumeric") &&
              getQualifierNumericValue(qualifier) !== null
            );
          })
          .map((rule) => {
            const qualifier = selectedQualifiers[rule.key]!;
            const savedPercentage = selectedQualifierPercentages[rule.key];
            const numericValue = getQualifierNumericValue(qualifier)!;
            const percentage =
              savedPercentage !== undefined
                ? savedPercentage
                : rule.uiKind === "signedNumeric"
                  ? signedICFValueToPercentage(numericValue)
                  : icfValueToPercentage(numericValue);

            return [rule.key, percentage];
          }) || []
      ),
    };

    classification.icfCode = buildICFCode(
      classification.code,
      classification.qualifiers || {},
      qualifierPlan
    );

    setClassifications((previous) => {
      if (existingIndex === -1) return [...previous, classification];

      const updated = [...previous];
      updated[existingIndex] = {
        ...updated[existingIndex],
        qualifiers: classification.qualifiers,
        qualifierLabels: classification.qualifierLabels,
        qualifierPercentages: classification.qualifierPercentages,
        icfCode: classification.icfCode,
        entityId: classification.entityId,
      };
      return updated;
    });

    setHighlightedClassificationId(classificationId);
    setEditingClassificationId(null);
    setSelectedEntity(null);
    setSelectedId(null);
    setSelectedQualifiers({});
    setSelectedQualifierPercentages({});
    setEvaluatingQualifierRules({});
    setExpandedCategoryInfo(false);
    setExpandedQualifierRules({});

    window.setTimeout(() => {
      classificationsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);

    window.setTimeout(() => {
      setHighlightedClassificationId(null);
    }, 1800);
  }

  /*
   * Remove uma classificação.
   */
  function removeClassification(id: string) {
    setClassifications((previous) =>
      previous.filter(
        (item) => item.id !== id
      )
    );
  }

  /*
   * Abre uma classificação já adicionada para edição.
   */
  async function editClassification(classification: Classification) {
    try {
      setMode("manual");
      setLoadingEntity(true);
      setTreeError(null);
      setEditingClassificationId(classification.id);

      // Primeiro usamos o entityId salvo. Para classificações antigas ou
      // classificações da IA que não tenham esse ID, usamos o próprio código
      // CIF. A rota da entidade resolve o código diretamente na OMS.
      const lookupId = classification.entityId || classification.code;
      setSelectedId(lookupId);

      setLoadingEntity(true);
      setTreeError(null);
      setEditingClassificationId(classification.id);

      const response = await fetch(
        `/api/icf/entity/${encodeURIComponent(lookupId)}`
      );

      const data: EntityResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data?.error ||
            `Não foi possível carregar a categoria para edição (HTTP ${response.status}).`
        );
      }

      setSelectedEntity(data);
      setSelectedId(data.entity.id);

      // Corrige automaticamente classificações antigas que ainda não tinham
      // o entityId salvo, para que as próximas edições sejam diretas.
      if (classification.entityId !== data.entity.id) {
        setClassifications((previous) =>
          previous.map((item) =>
            item.id === classification.id
              ? { ...item, entityId: data.entity.id }
              : item
          )
        );
      }

      // IMPORTANTE: os dois qualificadores opcionais de Atividade/Participação
      // reutilizam os eixos oficiais de desempenho/capacidade da OMS, mas têm
      // chaves próprias na interface (capacityWithAssistance e
      // performanceWithoutAssistance). Por isso, na edição precisamos montar
      // o estado a partir do plano de regras, e não diretamente dos
      // qualifierAxes da API. Caso contrário, os dois opcionais ficam sem
      // seleção mesmo tendo sido salvos corretamente.
      const editPlan = buildQualifierPlan(
        data.entity.code,
        data.qualifierAxes,
        true
      );

      const restoredQualifiers: Record<string, Qualifier | null> = {};

      for (const rule of editPlan.rules) {
        restoredQualifiers[rule.key] =
          classification.qualifiers?.[rule.key] || null;
      }

      setSelectedQualifiers(restoredQualifiers);

      // Recupera os percentuais exatos salvos. Para classificações antigas
      // que ainda não tenham qualifierPercentages, reconstrói um percentual
      // aproximado a partir do grau CIF salvo. Isso vale também para os dois
      // qualificadores opcionais de Atividade/Participação.
      const restoredPercentages: Record<string, number> = {};

      for (const rule of editPlan.rules) {
        const qualifier = classification.qualifiers?.[rule.key];
        if (
          !qualifier ||
          (rule.uiKind !== "numeric" && rule.uiKind !== "signedNumeric")
        ) continue;

        const savedPercentage =
          classification.qualifierPercentages?.[rule.key];
        const numericValue = getQualifierNumericValue(qualifier);

        if (savedPercentage !== undefined) {
          restoredPercentages[rule.key] = savedPercentage;
        } else if (numericValue !== null) {
          restoredPercentages[rule.key] =
            rule.uiKind === "signedNumeric"
              ? signedICFValueToPercentage(numericValue)
              : icfValueToPercentage(numericValue);
        }
      }

      setSelectedQualifierPercentages(restoredPercentages);

      // Na edição, abre a barra automaticamente quando o qualificador
      // salvo é numérico. Para 8/9, a barra permanece escondida, mas
      // “Avaliar” continua disponível para trocar a escolha.
      setEvaluatingQualifierRules(
        Object.fromEntries(
          editPlan.rules.map((rule) => {
            const qualifier = classification.qualifiers?.[rule.key];
            const isSpecial = /(?:8|9)$/.test(qualifier?.code || "");
            const hasNumericValue =
              qualifier != null &&
              getQualifierNumericValue(qualifier) !== null;

            return [rule.key, hasNumericValue && !isSpecial];
          })
        )
      );
    } catch (error) {
      console.error(error);
      setEditingClassificationId(null);
      setTreeError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar a categoria para edição."
      );
    } finally {
      setLoadingEntity(false);
    }
  }

  useEffect(() => {
    if (!editingClassificationId || !selectedEntity || loadingEntity) {
      return;
    }

    const timeout = window.setTimeout(() => {
      editorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);

    return () => window.clearTimeout(timeout);
  }, [editingClassificationId, selectedEntity, loadingEntity]);

  useEffect(() => {
    if (!aiLoading) {
      return;
    }

    const stages = [
      { after: 0, progress: 8, message: "Preparando a análise..." },
      { after: 1500, progress: 22, message: "Interpretando a descrição funcional..." },
      { after: 4000, progress: 42, message: "Identificando possíveis categorias CIF..." },
      { after: 7500, progress: 62, message: "Consultando e validando as categorias na OMS..." },
      { after: 11000, progress: 78, message: "Comparando as categorias com a descrição..." },
      { after: 16000, progress: 88, message: "Finalizando a análise..." },
    ];

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      let current = stages[0];

      for (const stage of stages) {
        if (elapsed >= stage.after) {
          current = stage;
        }
      }

      // O progresso é uma estimativa visual enquanto a API trabalha.
      // Ele nunca chega a 100% antes da resposta real.
      const extra = Math.min(4, Math.floor(Math.max(0, elapsed - 16000) / 4000));
      setAiProgress(Math.min(92, current.progress + extra));
      setAiProgressMessage(current.message);
    }, 250);

    return () => window.clearInterval(interval);
  }, [aiLoading]);

  /*
   * Envia a descrição para nossa API.
   *
   * A API conversa com o Gemini e depois valida
   * os códigos encontrados diretamente na OMS.
   */
  async function analyzeWithAI() {
    const description = aiText.trim();

    if (!description) {
      setAiError(
        "Digite uma descrição funcional antes de analisar."
      );
      return;
    }

    try {
      setAiLoading(true);
      setAiProgress(8);
      setAiProgressMessage("Preparando a análise...");
      setAiError(null);
      setAiSuggestions([]);

      const response = await fetch(
        "/api/icf/ai",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            description,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível realizar a análise com IA."
        );
      }

      setAiProgress(100);
      setAiProgressMessage("Análise concluída.");
      setAiSuggestions(
        data.suggestions || []
      );
    } catch (error) {
      console.error(error);

      setAiError(
        error instanceof Error
          ? error.message
          : "Erro ao analisar a descrição."
      );
    } finally {
      setAiLoading(false);
    }
  }

  /*
   * Confirma uma sugestão feita pela IA.
   *
   * O código só chegou aqui porque já foi validado
   * pela API oficial da OMS.
   */
  function confirmAISuggestion(
    suggestion: AISuggestion
  ) {
    const alreadyAdded =
      classifications.some(
        (item) =>
          item.code === suggestion.code
      );

    if (alreadyAdded) {
      return;
    }

    const entityId = getEntityIdFromBrowserUrl(
      suggestion.browserUrl
    );

    const classification: Classification = {
      id: `ai-${suggestion.code}`,
      code: suggestion.code,
      title:
        suggestion.title ||
        suggestion.code,
      definition:
        suggestion.definition,
      source: "ai",
      reason:
        suggestion.reason,
      confidence:
        suggestion.confidence,
      qualifiers: {},
      entityId: entityId || undefined,
    };

    setClassifications((previous) => [
      ...previous,
      classification,
    ]);

    setConfirmingAI(null);
  }

  /*
   * Adiciona uma categoria a partir da própria árvore.
   *
   * Se a categoria possuir qualificadores obrigatórios,
   * carregamos seus detalhes para que o profissional os
   * preencha antes da inclusão definitiva.
   */
  async function addFromTree(node: TreeNode) {
    if (!node.code) {
      return;
    }

    try {
      setTreeError(null);
      setSelectedId(node.id);
      setLoadingEntity(true);
      setSelectedQualifiers({});
      setSelectedQualifierPercentages({});
      setEvaluatingQualifierRules({});

      const response = await fetch(
        `/api/icf/entity/${encodeURIComponent(node.id)}`
      );

      const data: EntityResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          "Não foi possível carregar a categoria para adicioná-la."
        );
      }

      setSelectedEntity(data);

      const alreadyAdded = classifications.some(
        (item) => item.code === data.entity.code
      );

      if (alreadyAdded) {
        return;
      }

      const hasRequiredQualifiers = data.qualifierAxes.some(
        (axis) => axis.required
      );

      if (!hasRequiredQualifiers && data.entity.code && data.entity.title) {
        const classification: Classification = {
          id: `${data.entity.id}-${Date.now()}`,
          code: data.entity.code,
          title: data.entity.title,
          definition: data.entity.definition,
          source: "manual",
          entityId: data.entity.id,
          qualifiers: {},
        };

        setClassifications((previous) => [
          ...previous,
          classification,
        ]);
      }
    } catch (error) {
      console.error(error);

      setTreeError(
        error instanceof Error
          ? error.message
          : "Erro ao adicionar a categoria."
      );
    } finally {
      setLoadingEntity(false);
    }
  }

  /*
   * Navegação hierárquica da árvore.
   * Apenas um nível fica visível por vez, reduzindo a poluição visual
   * e mantendo o profissional sempre orientado dentro da hierarquia.
   */
  function TreeLevel({ nodes }: { nodes: TreeNode[] }) {
    return (
      <div className="space-y-2">
        {nodes.map((node) => {
          const loading = Boolean(loadingChildren[node.id]);
          const alreadyAdded = node.code
            ? classifications.some((item) => item.code === node.code)
            : false;

          return (
            <div
              key={node.id}
              className={`group rounded-xl border p-3 transition ${
                selectedId === node.id
                  ? "border-purple-200 bg-purple-50"
                  : "border-gray-200 bg-white hover:border-purple-200 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void openTreeNode(node)}
                  disabled={loading}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition group-hover:bg-purple-100 group-hover:text-purple-700">
                    {loading ? (
                      <span className="text-xs">...</span>
                    ) : (
                      <span className="text-base font-bold">{node.hasChildren ? "›" : "•"}</span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {node.code && (
                        <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-[11px] font-semibold text-gray-600">
                          {node.code}
                        </span>
                      )}
                      <span className="font-semibold leading-5 text-gray-900">
                        {node.title || "Sem título"}
                      </span>
                    </span>

                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      {node.codeRange && <span>{node.codeRange}</span>}
                      {node.hasChildren && (
                        <span className="font-semibold text-purple-600">
                          {node.childCount} {node.childCount === 1 ? "item" : "itens"} · abrir
                        </span>
                      )}
                    </span>
                  </span>

                  {node.hasChildren && (
                    <span className="shrink-0 text-xl leading-none text-gray-400">›</span>
                  )}
                </button>

                {node.code && (
                  alreadyAdded ? (
                    <span className="hidden shrink-0 rounded-md bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 sm:inline-flex">
                      ✓ Adicionado
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void addFromTree(node);
                      }}
                      className="shrink-0 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 transition hover:border-purple-300 hover:bg-purple-100"
                    >
                      + Adicionar
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const hasManualSelection =
    Boolean(
      selectedEntity?.entity?.code
    );

  const qualifierPlan: QualifierPlan | null =
    selectedEntity?.entity?.code
      ? buildQualifierPlan(
          selectedEntity.entity.code,
          selectedEntity.qualifierAxes,
          true
        )
      : null;

  const hasRequiredQualifierMissing =
  qualifierPlan
    ? qualifierPlan.rules.some(
        (rule) =>
          rule.required &&
          selectedQualifiers[rule.key] == null
      )
    : false;

  const canAddManual =
    useMemo(() => {
      return Boolean(
        selectedEntity?.entity?.code
      );
    }, [selectedEntity]);

  /*
   * Identifica se um eixo possui a escala numérica CIF
   * de 0 a 4. A interface usa uma barra de 0 a 100%,
   * mas o valor realmente salvo continua sendo o
   * qualificador oficial retornado pela OMS.
   */
  /*
   * Converte os nomes técnicos dos eixos retornados pela OMS
   * em rótulos compreensíveis para o profissional.
   *
   * A API pode retornar tanto o nome técnico quanto uma URI
   * de schema. Esses valores nunca devem aparecer diretamente
   * na interface.
   */
  function getFriendlyAxisInfo(axis: QualifierAxis) {
    const rawValues = [axis.axis, axis.axisName].filter(
      (value): value is string => Boolean(value)
    );

    const normalizedValues = rawValues.map((value) =>
      value
        .split("/")
        .pop()!
        .trim()
        .toLowerCase()
    );

    const has = (term: string) =>
      normalizedValues.some((value) =>
        value.includes(term.toLowerCase())
      );

    if (has("extentormagnitudeofimpairment")) {
      return {
        label: "Extensão da dificuldade",
        description:
          "Indique quanto a dificuldade ou a alteração está presente.",
      };
    }

    if (has("performance")) {
      return {
        label: "Desempenho",
        description:
          "Como a pessoa realiza a atividade no ambiente em que vive.",
      };
    }

    if (has("capacity")) {
      return {
        label: "Capacidade",
        description:
          "O que a pessoa consegue fazer sem ajuda ou assistência.",
      };
    }

    if (has("barrierorfacilitator")) {
      return {
        label: "Barreira ou facilitador",
        description:
          "Indique se este fator dificulta ou facilita a vida da pessoa.",
      };
    }

    if (has("natureofchangeinbodystructure")) {
      return {
        label: "Natureza da alteração",
        description:
          "Indique o tipo de alteração observada na estrutura do corpo.",
      };
    }

    if (has("changeinbodystructure")) {
      return {
        label: "Natureza da alteração",
        description:
          "Indique o tipo de alteração observada na estrutura do corpo.",
      };
    }

    if (has("qualifier")) {
      return {
        label: "Qualificador",
        description:
          "Selecione a opção que melhor representa a situação.",
      };
    }

    return {
      label: "Qualificador",
      description:
        "Selecione a opção que melhor representa a situação.",
    };
  }

  function getNumericScaleOptions(axis: QualifierAxis) {
    const options = axis.options.filter((qualifier) => {
      const code = qualifier.code || "";
      return /[0-4]$/.test(code);
    });

    const byValue = new Map<number, Qualifier>();

    for (const option of options) {
      const code = option.code || "";
      const match = code.match(/([0-4])$/);

      if (!match) {
        continue;
      }

      byValue.set(Number(match[1]), option);
    }

    if (byValue.size !== 5) {
      return null;
    }

    return [0, 1, 2, 3, 4].map((value) => ({
      value,
      qualifier: byValue.get(value)!,
    }));
  }

  function percentageToQualifierValue(percentage: number) {
    if (percentage <= 4) return 0;
    if (percentage <= 24) return 1;
    if (percentage <= 49) return 2;
    if (percentage <= 95) return 3;
    return 4;
  }

  function getQualifierDescription(value: number) {
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

  function signedICFValueToPercentage(value: number) {
    if (value === 0) return 0;
    const absolute = icfValueToPercentage(Math.abs(value));
    return value < 0 ? -absolute : absolute;
  }

  function signedPercentageToICFValue(percentage: number) {
    if (percentage === 0) return 0;
    return percentage < 0
      ? -percentageToICFValue(Math.abs(percentage))
      : percentageToICFValue(Math.abs(percentage));
  }

  function getSignedQualifierDescription(value: number) {
    if (value < 0) {
      return `Barreira ${getQualifierDescription(Math.abs(value)).toLowerCase()}`;
    }
    if (value > 0) {
      return `Facilitador ${getQualifierDescription(value).toLowerCase()}`;
    }
    return "Nenhuma barreira ou facilitador";
  }

  function getQualifierRange(value: number) {
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

  function getSpecialQualifierInfo(qualifier: Qualifier) {
    const code = (qualifier.code || "").trim();
    const lastDigit = code.match(/([89])$/)?.[1];

    if (lastDigit === "8") {
      return {
        label: "Não especificado",
        description: "O grau da dificuldade não foi especificado.",
      };
    }

    if (lastDigit === "9") {
      return {
        label: "Não aplicável",
        description: "Esta classificação não se aplica ao caso.",
      };
    }

    return {
      label: qualifier.title || "Opção especial",
      description: "Selecione esta opção quando ela representar melhor a situação.",
    };
  }

  function getSelectedPercentage(axisKey: string, qualifier: Qualifier | null) {
    if (selectedQualifierPercentages[axisKey] !== undefined) {
      return selectedQualifierPercentages[axisKey];
    }

    const code = qualifier?.code || "";
    const match = code.match(/([0-4])$/);

    if (!match) {
      return 0;
    }

    const value = Number(match[1]);

    if (value === 0) return 2;
    if (value === 1) return 14;
    if (value === 2) return 37;
    if (value === 3) return 72;
    return 98;
  }

  function formatReportDate(date = new Date()) {
    return new Intl.DateTimeFormat("pt-BR").format(date);
  }

  function getPatientAge() {
    if (!patientBirthDate) return "";

    const birth = new Date(`${patientBirthDate}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return "";

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }

    return age >= 0 ? `${age} anos` : "";
  }

  function getReportQualifierText(classification: Classification) {
    if (!classification.qualifiers) return [];

    return Object.entries(classification.qualifiers).map(([axis, qualifier]) => {
      const label = classification.qualifierLabels?.[axis] || axis;
      const code = qualifier.code || "";
      const special = code.match(/([89])$/)?.[1];

      if (special === "8") {
        return `${label}: Não especificado`;
      }

      if (special === "9") {
        return `${label}: Não aplicável`;
      }

      const percentage = classification.qualifierPercentages?.[axis];
      const numericValue = getQualifierNumericValue(qualifier);
      const value =
        percentage !== undefined
          ? percentage
          : numericValue !== null
            ? icfValueToPercentage(numericValue)
            : null;

      if (value !== null) {
        const grade = numericValue !== null ? `Grau ${numericValue}` : "";
        return `${label}: ${value}%${grade ? ` (${grade})` : ""}`;
      }

      return `${label}: ${qualifier.title || qualifier.code || "Selecionado"}`;
    });
  }

  function openReport() {
    setReportDate(formatReportDate());
    setReportOpen(true);
  }

  function printReport() {
    window.setTimeout(() => window.print(), 50);
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        {/* CABEÇALHO */}

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Classificação CIF
          </h1>

          <p className="mt-2 max-w-3xl text-gray-600">
            Selecione categorias
            manualmente pela árvore
            oficial da CIF ou descreva
            o caso e receba sugestões
            assistidas por IA.
          </p>
        </div>

        {/* SELETOR DE MODO */}

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              setMode("ai")
            }
            className={`rounded-xl border p-5 text-left transition ${
              mode === "ai"
                ? "border-purple-500 bg-purple-50 shadow-sm"
                : "border-gray-200 bg-white hover:border-purple-300"
            }`}
          >
            <div className="text-lg font-bold text-gray-900">
              ✨ Descrever com IA
            </div>

            <p className="mt-1 text-sm text-gray-600">
              Descreva o funcionamento
              observado e receba
              possíveis categorias CIF.
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              setMode("manual")
            }
            className={`rounded-xl border p-5 text-left transition ${
              mode === "manual"
                ? "border-purple-500 bg-purple-50 shadow-sm"
                : "border-gray-200 bg-white hover:border-purple-300"
            }`}
          >
            <div className="text-lg font-bold text-gray-900">
              🌳 Selecionar manualmente
            </div>

            <p className="mt-1 text-sm text-gray-600">
              Navegue pela estrutura
              hierárquica oficial da CIF.
            </p>
          </button>
        </div>

        {/* MODO IA */}

        {mode === "ai" && (
          <section className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-gray-900">
                Descrição funcional
              </h2>

              <p className="mt-1 text-sm text-gray-600">
                Descreva de forma objetiva
                o funcionamento observado.
                A IA fará sugestões de
                categorias, não um
                diagnóstico.
              </p>
            </div>

            <div className="relative">
              <textarea
                value={aiText}
                onChange={(event) =>
                  setAiText(
                    event.target.value
                  )
                }
                placeholder="Ex.: Paciente apresenta dificuldade para caminhar longas distâncias, necessitando realizar pausas frequentes devido à limitação funcional."
                className="min-h-[170px] w-full resize-y rounded-xl border border-gray-300 p-4 pb-14 pr-16 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                maxLength={5000}
              />

              <button
                type="button"
                onClick={toggleSpeechRecognition}
                aria-label={
                  isListening
                    ? "Parar gravação de voz"
                    : "Gravar descrição por voz"
                }
                title={
                  isListening
                    ? "Parar gravação"
                    : "Gravar por voz"
                }
                className={`absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border text-lg transition ${
                  isListening
                    ? "border-red-300 bg-red-50 text-red-600 shadow-sm"
                    : "border-gray-300 bg-white text-gray-600 hover:border-purple-400 hover:bg-purple-50 hover:text-purple-600"
                }`}
              >
                {isListening ? "⏹" : "🎙️"}
              </button>

              {isListening && (
                <span className="absolute bottom-4 right-16 text-xs font-semibold text-red-600">
                  Gravando...
                </span>
              )}
            </div>

            <div className="mt-2 text-sm text-gray-500">
              Quanto mais objetiva e
              funcional for a descrição,
              melhor será a qualidade das
              sugestões.
            </div>

            <button
              type="button"
              onClick={analyzeWithAI}
              disabled={aiLoading}
              className="mt-5 flex w-full items-center justify-center rounded-xl bg-purple-600 px-5 py-4 font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {aiLoading
                ? `Analisando... ${aiProgress}%`
                : "✨ Analisar com IA"}
            </button>

            {aiLoading && (
              <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-purple-900">
                  <span>{aiProgressMessage}</span>
                  <span>{aiProgress}%</span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-purple-100"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={aiProgress}
                  aria-label="Progresso estimado da análise com IA"
                >
                  <div
                    className="h-full rounded-full bg-purple-600 transition-all duration-300 ease-out"
                    style={{ width: `${aiProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-purple-700">
                  Progresso estimado enquanto a análise é processada. A conclusão aparece quando a resposta da IA chegar.
                </p>
              </div>
            )}

            {aiError && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <strong>Erro:</strong>{" "}
                {aiError}
              </div>
            )}

            {/* RESULTADOS DA IA */}

            {aiSuggestions.length >
              0 && (
              <div className="mt-8">
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-gray-900">
                    Sugestões encontradas
                  </h3>

                  <p className="mt-1 text-sm text-gray-600">
                    As categorias abaixo
                    foram sugeridas pela
                    IA e validadas na base
                    oficial da OMS.
                  </p>
                </div>

                <div className="space-y-4">
                  {aiSuggestions.map(
                    (suggestion) => {
                      const alreadyAdded =
                        classifications.some(
                          (item) =>
                            item.code ===
                            suggestion.code
                        );

                      return (
                        <div
                          key={
                            suggestion.code
                          }
                          className="rounded-xl border border-gray-200 bg-gray-50 p-5"
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-purple-100 px-2 py-1 font-bold text-purple-800">
                                  {
                                    suggestion.code
                                  }
                                </span>

                                <span className="font-bold text-gray-900">
                                  {
                                    suggestion.title
                                  }
                                </span>

                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    suggestion.confidence ===
                                    "Alta"
                                      ? "bg-green-100 text-green-700"
                                      : suggestion.confidence ===
                                          "Média"
                                        ? "bg-yellow-100 text-yellow-700"
                                        : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  Confiança{" "}
                                  {
                                    suggestion.confidence
                                  }
                                </span>
                              </div>

                              {suggestion.definition && (
                                <p className="mt-3 text-sm leading-6 text-gray-600">
                                  {
                                    suggestion.definition
                                  }
                                </p>
                              )}

                              <div className="mt-3 rounded-lg border border-purple-100 bg-white p-3">
                                <div className="text-xs font-bold uppercase tracking-wide text-purple-700">
                                  Por que a IA sugeriu
                                </div>

                                <p className="mt-1 text-sm text-gray-700">
                                  {
                                    suggestion.reason
                                  }
                                </p>
                              </div>

                              <div className="mt-3 text-xs font-semibold text-green-700">
                                ✓ Código validado pela OMS
                              </div>
                            </div>

                            <div className="shrink-0">
                              {alreadyAdded ? (
                                <span className="inline-flex rounded-lg bg-green-100 px-4 py-3 text-sm font-semibold text-green-700">
                                  ✓ Adicionado
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    confirmAISuggestion(
                                      suggestion
                                    )
                                  }
                                  disabled={
                                    confirmingAI ===
                                    suggestion.code
                                  }
                                  className="rounded-lg bg-purple-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-700 disabled:opacity-60"
                                >
                                  Confirmar classificação
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}

            {/* EXPLICAÇÃO */}

            <div className="mt-8 rounded-xl border border-purple-200 bg-purple-50 p-5">
              <h3 className="font-bold text-gray-900">
                Como a análise funciona
              </h3>

              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    1
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Descrição profissional
                    </div>

                    <div className="text-sm text-gray-600">
                      Você descreve o
                      funcionamento observado.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    2
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Interpretação pela IA
                    </div>

                    <div className="text-sm text-gray-600">
                      A IA identifica possíveis
                      conceitos funcionais
                      presentes no texto.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    3
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Sugestões de códigos CIF
                    </div>

                    <div className="text-sm text-gray-600">
                      São apresentados códigos
                      candidatos, e não uma
                      classificação definitiva.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    4
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Validação pela OMS
                    </div>

                    <div className="text-sm text-gray-600">
                      Os códigos sugeridos são
                      consultados na base oficial
                      da CIF.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    5
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Confirmação profissional
                    </div>

                    <div className="text-sm text-gray-600">
                      O profissional decide quais
                      sugestões realmente
                      representam o caso.
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700">
                    6
                  </span>

                  <div>
                    <div className="font-semibold text-gray-900">
                      Qualificadores
                    </div>

                    <div className="text-sm text-gray-600">
                      Depois da confirmação,
                      os qualificadores podem
                      ser definidos.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* MODO MANUAL */}

        {mode === "manual" && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            {/* ÁRVORE */}

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">🌳 Árvore CIF</h2>
                    <p className="mt-1 text-xs text-gray-500">Explore a hierarquia por níveis e mantenha o contexto da navegação.</p>
                  </div>
                  <span className="hidden rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-500 sm:inline-flex">
                    Navegação hierárquica
                  </span>
                </div>

                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => goToTreeLevel(0)}
                      className={`font-semibold transition hover:text-purple-700 ${treePath.length === 0 ? "text-gray-900" : "text-gray-500"}`}
                    >
                      CIF
                    </button>
                    {treePath.map((node, index) => (
                      <span key={node.id} className="flex items-center gap-1">
                        <span className="text-gray-400">›</span>
                        <button
                          type="button"
                          onClick={() => goToTreeLevel(index + 1)}
                          className={`max-w-[180px] truncate font-semibold transition hover:text-purple-700 ${index === treePath.length - 1 ? "text-gray-900" : "text-gray-500"}`}
                          title={node.title || node.code || "Categoria"}
                        >
                          {node.code ? `${node.code} · ` : ""}{node.title || "Categoria"}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {treeError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {treeError}
                </div>
              )}

              {rootNodes.length === 0 && !treeError && (
                <div className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500">
                  Carregando árvore CIF...
                </div>
              )}

              {treePath.length > 0 && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => goToTreeLevel(treePath.length - 1)}
                    className="min-w-0 text-left text-xs font-bold text-purple-700 transition hover:text-purple-900"
                  >
                    ← Voltar para {treePath.length === 1 ? "início" : (treePath[treePath.length - 2]?.title || "nível anterior")}
                  </button>
                  <span className="shrink-0 text-[11px] font-semibold text-purple-500">
                    Nível {treePath.length}
                  </span>
                </div>
              )}

              <div className="max-h-[680px] overflow-y-auto pr-1 overscroll-contain scrollbar-thin">
                {(() => {
                  const currentNodes =
                    treePath.length === 0
                      ? rootNodes
                      : childrenByNode[treePath[treePath.length - 1].id] || [];

                  if (treePath.length > 0 && currentNodes.length === 0 && !loadingChildren[treePath[treePath.length - 1].id]) {
                    return (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center">
                        <div className="text-2xl">✓</div>
                        <div className="mt-2 text-sm font-semibold text-gray-700">Categoria final</div>
                        <div className="mt-1 text-xs text-gray-500">Use “Adicionar” na categoria selecionada para incluí-la na classificação.</div>
                      </div>
                    );
                  }

                  return <TreeLevel nodes={currentNodes} />;
                })()}
              </div>
            </div>

            {/* DETALHES */}

            <div ref={editorRef} className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              {!selectedEntity &&
                !loadingEntity && (
                  <div className="flex min-h-[400px] items-center justify-center text-center">
                    <div>
                      <div className="text-4xl">
                        📋
                      </div>

                      <h2 className="mt-3 font-bold text-gray-900">
                        Selecione uma categoria
                      </h2>

                      <p className="mt-1 max-w-sm text-sm text-gray-500">
                        Escolha uma categoria
                        na árvore para ver
                        sua definição e seus
                        qualificadores.
                      </p>
                    </div>
                  </div>
                )}

              {loadingEntity && (
                <div className="flex min-h-[400px] items-center justify-center text-gray-500">
                  Carregando categoria...
                </div>
              )}

              {selectedEntity &&
                !loadingEntity && (
                  <div>
                    {/* CABEÇALHO COMPACTO */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {selectedEntity.entity.code && (
                              <span className="rounded-md bg-purple-100 px-3 py-1 font-bold text-purple-800">
                                {selectedEntity.entity.code}
                              </span>
                            )}
                            <h2 className="text-lg font-bold text-gray-900">
                              {selectedEntity.entity.title}
                            </h2>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">
                            Selecione os qualificadores abaixo e salve a classificação.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setExpandedCategoryInfo((previous) => !previous)}
                          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-purple-300 hover:text-purple-700"
                        >
                          {expandedCategoryInfo ? "Ocultar detalhes" : "Ver detalhes"}
                        </button>
                      </div>

                      {expandedCategoryInfo && (
                        <div className="mt-4 border-t border-gray-200 pt-4">
                          {selectedEntity.entity.definition && (
                            <p className="text-sm leading-6 text-gray-600">
                              {selectedEntity.entity.definition}
                            </p>
                          )}

                          {selectedEntity.entity.browserUrl && (
                            <a
                              href={selectedEntity.entity.browserUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-block text-sm font-semibold text-purple-700 hover:underline"
                            >
                              Ver na CIF da OMS →
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* QUALIFICADORES */}
                    {qualifierPlan && qualifierPlan.rules.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <h3 className="text-sm font-bold text-gray-900">Qualificadores</h3>
                          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
                            {qualifierPlan.rules.filter((rule) => rule.required).length} obrigatórios
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          {qualifierPlan.rules.map((rule) => {
                            const selectedQualifier = selectedQualifiers[rule.key] || null;
                            const numericOptions = rule.options.filter(
                              (option) => getQualifierNumericValue(option) !== null
                            );
                            const hasFullNumericScale = [0, 1, 2, 3, 4].every(
                              (value) =>
                                numericOptions.some(
                                  (option) => getQualifierNumericValue(option) === value
                                )
                            );
                            const selectedNumericValue = getQualifierNumericValue(selectedQualifier);
                            const specialOptions = Array.from(
                              new Map(
                                rule.options
                                  .filter((option) => /(?:8|9)$/.test(option.code || ""))
                                  .map((option) => [
                                    (option.code || "").match(/([89])$/)?.[1] || option.id || option.code,
                                    option,
                                  ])
                              ).values()
                            );
                            const isSpecialSelected =
                              selectedQualifier !== null &&
                              specialOptions.some(
                                (option) =>
                                  (option.id != null && option.id === selectedQualifier.id) ||
                                  (option.id == null && option.code === selectedQualifier.code)
                              );
                            const isEvaluating =
                              evaluatingQualifierRules[rule.key] === true;
                            const selectedPercentage =
                              selectedQualifierPercentages[rule.key] ??
                              (selectedNumericValue !== null
                                ? rule.uiKind === "signedNumeric"
                                  ? signedICFValueToPercentage(selectedNumericValue)
                                  : icfValueToPercentage(selectedNumericValue)
                                : 0);
                            const isExpanded = expandedQualifierRules[rule.key] !== false;
                            const isOptional = rule.optional && !rule.required;

                            const selectNumeric = (percentage: number) => {
                              const value =
                                rule.uiKind === "signedNumeric"
                                  ? signedPercentageToICFValue(percentage)
                                  : percentageToQualifierValue(percentage);
                              const qualifier = numericOptions.find(
                                (option) => getQualifierNumericValue(option) === value
                              );
                              if (!qualifier) return;

                              setSelectedQualifierPercentages((previous) => ({
                                ...previous,
                                [rule.key]: percentage,
                              }));
                              setSelectedQualifiers((previous) => ({
                                ...previous,
                                [rule.key]: qualifier,
                              }));
                            };

                            return (
                              <div
                                key={rule.key}
                                className={`rounded-lg border transition ${
                                  rule.optional
                                    ? "border-blue-200 bg-blue-50/30"
                                    : "border-gray-200 bg-gray-50"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedQualifierRules((previous) => ({
                                      ...previous,
                                      [rule.key]: !isExpanded,
                                    }))
                                  }
                                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                                >
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="text-sm font-bold text-gray-900">{rule.label}</h4>
                                      {rule.required && (
                                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                          Obrigatório
                                        </span>
                                      )}
                                      {isOptional && (
                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                                          Opcional
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-gray-500">
                                      {selectedQualifier
                                        ? `${selectedQualifier.code || ""} — ${selectedQualifier.title || "Selecionado"}`
                                        : "Não preenchido"}
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-base text-gray-400">
                                    {isExpanded ? "−" : "+"}
                                  </span>
                                </button>

                                {isExpanded && (
                                  <div className="border-t border-gray-200 px-3 pb-3 pt-2">
                                    {rule.description && (
                                      <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs leading-4 text-blue-800">
                                        {rule.description}
                                      </div>
                                    )}

                                    {hasFullNumericScale &&
                                    (rule.uiKind === "numeric" ||
                                      rule.uiKind === "signedNumeric") ? (
                                      <div>
                                        <div className="grid gap-2 md:grid-cols-3">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedQualifiers((previous) => ({
                                                ...previous,
                                                [rule.key]: null,
                                              }));
                                              setEvaluatingQualifierRules((previous) => ({
                                                ...previous,
                                                [rule.key]: true,
                                              }));

                                              if (selectedNumericValue === null) {
                                                setSelectedQualifierPercentages((previous) => ({
                                                  ...previous,
                                                  [rule.key]: 0,
                                                }));
                                              }
                                            }}
                                            className={`min-h-9 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                                              isEvaluating && !isSpecialSelected
                                                ? "border-purple-500 bg-purple-600 text-white"
                                                : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50"
                                            }`}
                                          >
                                            [ Avaliar ]
                                          </button>

                                          {specialOptions.map((qualifier) => {
                                            const selected =
                                            selectedQualifier?.id === qualifier.id &&
                                            (qualifier.id != null || selectedQualifier?.code === qualifier.code);
                                            const specialInfo = getSpecialQualifierInfo(qualifier);

                                            return (
                                              <button
                                                key={qualifier.id || qualifier.code || qualifier.url}
                                                type="button"
                                                onClick={() => {
                                                  setSelectedQualifiers((previous) => ({
                                                    ...previous,
                                                    [rule.key]: selected ? null : qualifier,
                                                  }));

                                                  setSelectedQualifierPercentages((previous) => {
                                                    const next = { ...previous };
                                                    delete next[rule.key];
                                                    return next;
                                                  });

                                                  setEvaluatingQualifierRules((previous) => ({
                                                    ...previous,
                                                    [rule.key]: false,
                                                  }));
                                                }}
                                                className={`min-h-9 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                                                  selected
                                                    ? "border-purple-500 bg-purple-50 text-purple-800"
                                                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50"
                                                }`}
                                              >
                                                [ {qualifier.code?.match(/9$/) ? "9 - " : "8 - "}{specialInfo.label} ]
                                              </button>
                                            );
                                          })}
                                        </div>

                                        {isEvaluating && !isSpecialSelected && (
                                          <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
                                            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-semibold text-gray-600">
                                              <span>Grau de dificuldade</span>
                                              <span className="text-gray-900">
                                                {selectedPercentage > 0 ? "+" : ""}
                                                {selectedPercentage}% (
                                                  {selectedNumericValue === null
                                                    ? "Não avaliado"
                                                    : rule.uiKind === "signedNumeric"
                                                      ? getSignedQualifierDescription(selectedNumericValue)
                                                      : getQualifierDescription(selectedNumericValue)}
                                                )
                                              </span>
                                            </div>
                                            <input
                                              type="range"
                                              min={rule.uiKind === "signedNumeric" ? -100 : 0}
                                              max={100}
                                              step={1}
                                              value={selectedPercentage}
                                              onChange={(event) => selectNumeric(Number(event.target.value))}
                                              className="w-full accent-purple-600"
                                            />
                                            <div className="mt-0.5 flex justify-between text-[9px] text-gray-400">
                                              <span>{rule.uiKind === "signedNumeric" ? "-100% Barreira" : "0%"}</span>
                                              <span>{rule.uiKind === "signedNumeric" ? "0%" : "100%"}</span>
                                              {rule.uiKind === "signedNumeric" && <span>+100% Facilitador</span>}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {rule.options.map((qualifier) => {
                                          const selected =
                                            selectedQualifier?.id === qualifier.id &&
                                            (qualifier.id != null || selectedQualifier?.code === qualifier.code);
                                          return (
                                            <button
                                              key={qualifier.id || qualifier.code || qualifier.url}
                                              type="button"
                                              onClick={() =>
                                                setSelectedQualifiers((previous) => ({
                                                  ...previous,
                                                  [rule.key]: selected ? null : qualifier,
                                                }))
                                              }
                                              className={`group min-h-[72px] rounded-lg border p-3 text-left transition ${
                                                selected
                                                  ? "border-purple-500 bg-purple-50 shadow-sm"
                                                  : "border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/40"
                                              }`}
                                            >
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                  <div
                                                    className={`text-sm font-bold ${
                                                      selected ? "text-purple-800" : "text-gray-900"
                                                    }`}
                                                  >
                                                    {qualifier.code || "Opção"}
                                                  </div>
                                                  <div className="mt-1 text-xs leading-4 text-gray-600">
                                                    {qualifier.title || "Sem descrição"}
                                                  </div>
                                                </div>
                                                <span
                                                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition ${
                                                    selected
                                                      ? "border-purple-600 bg-purple-600 text-white"
                                                      : "border-gray-300 bg-white text-transparent group-hover:border-purple-300"
                                                  }`}
                                                >
                                                  ✓
                                                </span>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* EXCLUSÕES */}
                    {selectedEntity.exclusions.length > 0 && (
                      <details className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                        <summary className="cursor-pointer text-sm font-bold text-gray-900">
                          Exclusões ({selectedEntity.exclusions.length})
                        </summary>
                        <div className="mt-3 space-y-1">
                          {selectedEntity.exclusions.map((exclusion, index) => (
                            <div
                              key={`${exclusion.label}-${index}`}
                              className="text-sm text-gray-700"
                            >
                              {exclusion.label}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <button
                      type="button"
                      onClick={addManualClassification}
                      disabled={!canAddManual || hasRequiredQualifierMissing}
                      className="mt-4 w-full rounded-xl bg-purple-600 px-5 py-3.5 font-bold text-white shadow-sm transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {!hasManualSelection
                        ? "Selecione uma categoria"
                        : hasRequiredQualifierMissing
                          ? "Preencha os qualificadores obrigatórios"
                          : classifications.some(
                                (item) => item.code === selectedEntity?.entity?.code
                              )
                            ? "Salvar alterações"
                            : "Salvar classificação"}
                    </button>
                  </div>
                )}
            </div>
          </section>
        )}

        {/* CLASSIFICAÇÕES */}

        <section
          ref={classificationsRef}
          className="mt-8 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Classificações da avaliação
              </h2>

              <p className="mt-1 text-sm text-gray-600">
                Todas as categorias
                confirmadas, sejam
                adicionadas pela IA ou
                manualmente.
              </p>
            </div>

            <div className="rounded-full bg-purple-100 px-4 py-2 text-sm font-bold text-purple-800">
              {classifications.length}{" "}
              {classifications.length ===
              1
                ? "classificação"
                : "classificações"}
            </div>
          </div>

          {classifications.length ===
          0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Nenhuma classificação
              adicionada ainda.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {classifications.map(
                (classification) => (
                  <div
                    key={
                      classification.id
                    }
                    className={`rounded-xl border p-4 transition-all duration-500 ${
                      highlightedClassificationId === classification.id
                        ? "border-purple-400 bg-purple-50/50 shadow-lg ring-2 ring-purple-200"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-purple-100 px-2 py-1 font-bold text-purple-800">
                            {
                              classification.icfCode || classification.code
                            }
                          </span>

                          <span className="font-bold text-gray-900">
                            {
                              classification.title
                            }
                          </span>

                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">
                            {classification.source ===
                            "ai"
                              ? "Adicionado pela IA"
                              : "Adicionado manualmente"}
                          </span>

                          {classification.confidence && (
                            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                              Confiança{" "}
                              {
                                classification.confidence
                              }
                            </span>
                          )}
                        </div>

                        {classification.definition && (
                          <p className="mt-2 text-sm text-gray-600">
                            {
                              classification.definition
                            }
                          </p>
                        )}

                        {classification.reason && (
                          <div className="mt-3 rounded-lg bg-purple-50 p-3 text-sm text-gray-700">
                            <span className="font-semibold">
                              Justificativa
                              da IA:
                            </span>{" "}
                            {
                              classification.reason
                            }
                          </div>
                        )}

                        {classification.qualifiers &&
                          Object.keys(
                            classification.qualifiers
                          ).length > 0 && (
                            <div className="mt-3 space-y-1">
                              <div className="text-sm font-semibold text-gray-900">
                                Qualificadores:
                              </div>

                              {Object.entries(
                                classification.qualifiers
                              ).map(
                                ([
                                  axis,
                                  qualifier,
                                ]) => (
                                  <div
                                    key={`${classification.id}-${axis}`}
                                    className="text-sm text-gray-600"
                                  >
                                    <span className="font-semibold text-gray-800">
                                      {classification.qualifierLabels?.[axis] || axis}:
                                    </span>{" "}
                                    {qualifier.code} — {qualifier.title}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                      </div>

                      <div className="flex shrink-0 flex-col gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            removeClassification(
                              classification.id
                            )
                          }
                          className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                        >
                          Remover
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            editClassification(classification)
                          }
                          className="w-full rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
                        >
                          Editar
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>

        {/* LAUDO */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Laudo de avaliação funcional
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Gere uma prévia do laudo com as classificações selecionadas e exporte em PDF.
              </p>
            </div>

            <button
              type="button"
              onClick={openReport}
              disabled={classifications.length === 0}
              className="w-full rounded-xl bg-purple-600 px-5 py-3 font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300 md:w-auto"
            >
              Visualizar e exportar laudo
            </button>
          </div>
        </section>
      </div>

      {reportOpen && (
        <>
          <style jsx global>{`
            @media print {
              body { background: white !important; }
              body > * { visibility: hidden !important; }
              .report-print-root,
              .report-print-root * { visibility: visible !important; }
              .report-print-root {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                min-height: 100vh !important;
                background: white !important;
                overflow: visible !important;
              }
              .report-no-print { display: none !important; }
              @page { margin: 12mm; size: A4; }
            }
          `}</style>

          <div className="report-print-root fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 md:p-6">
            <div className="mx-auto min-h-full max-w-5xl overflow-hidden rounded-xl border border-gray-300 bg-white shadow-2xl">
              <div className="report-no-print flex flex-col gap-3 bg-slate-800 px-4 py-3 text-white md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold">Visualização do Laudo Funcional</span>
                  <div className="flex rounded-lg border border-slate-600 bg-slate-900 p-0.5">
                    <button
                      type="button"
                      onClick={() => setReportView("hybrid")}
                      className={`rounded-md px-3 py-1 text-[11px] font-bold transition ${
                        reportView === "hybrid" ? "bg-purple-600 text-white" : "text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      Híbrido (Visão Fluida Integrada)
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportView("technical")}
                      className={`rounded-md px-3 py-1 text-[11px] font-bold transition ${
                        reportView === "technical" ? "bg-purple-600 text-white" : "text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      Técnico Puro
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={printReport}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700"
                  >
                    Imprimir / Exportar PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-600"
                  >
                    Fechar
                  </button>
                </div>
              </div>

              <div className="report-page mx-auto max-w-4xl px-6 py-8 md:px-10">
                <div className="border-b border-gray-800 pb-4">
                  <h1 className="font-serif text-2xl font-bold tracking-tight text-gray-900">
                    LAUDO DE AVALIAÇÃO FUNCIONAL (CIF)
                  </h1>
                  <div className="mt-1 flex flex-col justify-between gap-1 text-[10px] text-gray-600 md:flex-row">
                    <span>Classificação Internacional de Funcionalidade, Incapacidade e Saúde — OMS</span>
                    <span>Data: {reportDate}</span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-[1fr_220px]">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Nome do paciente / avaliado</span>
                    <input
                      value={patientName}
                      onChange={(event) => setPatientName(event.target.value)}
                      placeholder="Digite o nome completo..."
                      className="mt-1 w-full border-0 border-b border-gray-300 bg-transparent px-0 py-1 text-sm text-gray-900 outline-none focus:border-purple-500"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Data de nascimento</span>
                    <input
                      type="date"
                      value={patientBirthDate}
                      onChange={(event) => setPatientBirthDate(event.target.value)}
                      className="mt-1 w-full border-0 border-b border-gray-300 bg-transparent px-0 py-1 text-sm text-gray-900 outline-none focus:border-purple-500"
                    />
                    {getPatientAge() && (
                      <div className="mt-1 text-[10px] text-gray-500">Idade: {getPatientAge()}</div>
                    )}
                  </label>
                </div>

                {(["b", "s", "d", "e"] as const).map((prefix, index) => {
                  const domainNames = {
                    b: "FUNÇÕES DO CORPO",
                    s: "ESTRUTURAS DO CORPO",
                    d: "ATIVIDADES E PARTICIPAÇÃO",
                    e: "FATORES AMBIENTAIS",
                  };
                  const items = classifications.filter((item) => item.code.toLowerCase().startsWith(prefix));

                  return (
                    <section key={prefix} className="mt-6">
                      <h2 className="border-b border-gray-300 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                        {index + 1}. {domainNames[prefix]} ({prefix.toUpperCase()})
                      </h2>

                      {items.length === 0 ? (
                        <p className="mt-2 font-serif text-xs italic text-gray-500">
                          Nenhum domínio correspondente foi avaliado nesta sessão.
                        </p>
                      ) : (
                        <div className="space-y-5 pt-3">
                          {items.map((classification) => (
                            <article key={classification.id}>
                              <div className="text-xs font-bold text-gray-900">
                                {reportView === "technical" ? classification.icfCode || classification.code : `${classification.icfCode || classification.code} — ${classification.title}`}
                              </div>

                              {reportView === "hybrid" && classification.definition && (
                                <p className="mt-1 font-serif text-xs leading-5 text-gray-800">
                                  O avaliado apresenta alteração funcional relacionada a <strong>{classification.title.toLowerCase()}</strong>. {classification.definition}
                                </p>
                              )}

                              {reportView === "technical" && classification.definition && (
                                <p className="mt-1 text-[10px] leading-4 text-gray-700">
                                  {classification.definition}
                                </p>
                              )}

                              {getReportQualifierText(classification).length > 0 && (
                                <div className="mt-2 space-y-0.5 text-[10px] text-gray-700">
                                  {getReportQualifierText(classification).map((text, qualifierIndex) => (
                                    <div key={`${classification.id}-report-${qualifierIndex}`}>
                                      <span className="font-semibold">{text.split(":")[0]}:</span>{text.includes(":") ? text.slice(text.indexOf(":") + 1) : ""}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}

                <div className="mt-12 border-t border-gray-300 pt-5">
                  <div className="text-[10px] font-semibold text-gray-800">Avaliador Responsável</div>
                  <div className="mt-5 grid grid-cols-2 gap-10 text-[9px] text-gray-600">
                    <div className="border-t border-gray-400 pt-1">Registro Profissional: __________________</div>
                    <div className="border-t border-gray-400 pt-1 text-center">Assinatura e Carimbo</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}