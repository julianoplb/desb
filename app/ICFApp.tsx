"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function Home() {
  const [mode, setMode] = useState<Mode>("ai");

  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<
    Record<string, boolean>
  >({});
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

  const [selectedQualifiers, setSelectedQualifiers] =
    useState<Record<string, Qualifier | null>>({});

  const [classifications, setClassifications] = useState<
    Classification[]
  >([]);

  const [aiText, setAiText] = useState("");
  const [aiSuggestions, setAiSuggestions] = useState<
    AISuggestion[]
  >([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [confirmingAI, setConfirmingAI] = useState<string | null>(
    null
  );

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

        setRootNodes(data.children || []);
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
  async function loadChildren(node: TreeNode) {
    if (!node.hasChildren) {
      return;
    }

    if (childrenByNode[node.id]) {
      setExpandedNodes((previous) => ({
        ...previous,
        [node.id]: !previous[node.id],
      }));

      return;
    }

    try {
      setLoadingChildren((previous) => ({
        ...previous,
        [node.id]: true,
      }));

      const response = await fetch(
        `/api/icf/tree?id=${encodeURIComponent(node.id)}`
      );

      const data: TreeChildrenResponse =
        await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          "Não foi possível carregar os itens deste nível."
        );
      }

      setChildrenByNode((previous) => ({
        ...previous,
        [node.id]: data.children || [],
      }));

      setExpandedNodes((previous) => ({
        ...previous,
        [node.id]: true,
      }));
    } catch (error) {
      console.error(error);

      setTreeError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar a árvore."
      );
    } finally {
      setLoadingChildren((previous) => ({
        ...previous,
        [node.id]: false,
      }));
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

    const alreadyAdded = classifications.some(
      (item) => item.code === entity.code
    );

    if (alreadyAdded) {
      return;
    }

    const selectedQualifierEntries =
      Object.entries(selectedQualifiers).filter(
        ([, qualifier]) => qualifier !== null
      );

    const classification: Classification = {
      id: `${entity.id}-${Date.now()}`,
      code: entity.code,
      title: entity.title,
      definition: entity.definition,
      source: "manual",
      qualifiers: Object.fromEntries(
        selectedQualifierEntries
      ) as Record<string, Qualifier>,
    };

    setClassifications((previous) => [
      ...previous,
      classification,
    ]);
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

    const classification: Classification = {
      id: `ai-${suggestion.code}-${Date.now()}`,
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
    };

    setClassifications((previous) => [
      ...previous,
      classification,
    ]);

    setConfirmingAI(null);
  }

  /*
   * Árvore recursiva.
   *
   * O Set evita ciclos inesperados da API.
   */
  function TreeItem({
    node,
    level,
    visited,
  }: {
    node: TreeNode;
    level: number;
    visited: Set<string>;
  }) {
    if (visited.has(node.id)) {
      return null;
    }

    const nextVisited =
      new Set(visited);

    nextVisited.add(node.id);

    const expanded =
      Boolean(
        expandedNodes[node.id]
      );

    const children =
      childrenByNode[node.id] || [];

    const loading =
      Boolean(
        loadingChildren[node.id]
      );

    const selected =
      selectedId === node.id;

    return (
      <div>
        <div
          className={`flex items-center gap-2 rounded-lg px-2 py-2 transition ${
            selected
              ? "bg-purple-100 text-purple-900"
              : "hover:bg-gray-100"
          }`}
          style={{
            marginLeft:
              `${level * 18}px`,
          }}
        >
          {node.hasChildren ? (
            <button
              type="button"
              onClick={() =>
                loadChildren(node)
              }
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
              title={
                expanded
                  ? "Recolher"
                  : "Expandir"
              }
            >
              {loading
                ? "..."
                : expanded
                  ? "−"
                  : "+"}
            </button>
          ) : (
            <span className="block h-6 w-6 shrink-0" />
          )}

          <button
            type="button"
            onClick={() =>
              selectNode(node)
            }
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              {node.code && (
                <span className="font-semibold text-purple-700">
                  {node.code}
                </span>
              )}

              <span className="font-medium text-gray-900">
                {node.title ||
                  "Sem título"}
              </span>
            </div>

            {node.codeRange && (
              <div className="mt-0.5 text-xs text-gray-500">
                {node.codeRange}
              </div>
            )}
          </button>
        </div>

        {expanded &&
          children.length > 0 && (
            <div>
              {children.map(
                (child) => (
                  <TreeItem
                    key={child.id}
                    node={child}
                    level={
                      level + 1
                    }
                    visited={
                      nextVisited
                    }
                  />
                )
              )}
            </div>
          )}
      </div>
    );
  }

  const hasManualSelection =
    Boolean(
      selectedEntity?.entity?.code
    );

  const hasRequiredQualifierMissing =
    useMemo(() => {
      if (
        !selectedEntity ||
        selectedEntity.qualifierAxes.length === 0
      ) {
        return false;
      }

      return selectedEntity.qualifierAxes.some(
        (axis, index) => {
          if (!axis.required) {
            return false;
          }

          const axisKey =
            axis.axis ||
            axis.axisName ||
            `axis-${index}`;

          return !selectedQualifiers[
            axisKey
          ];
        }
      );
    }, [
      selectedEntity,
      selectedQualifiers,
    ]);

  const canAddManual =
    useMemo(() => {
      if (
        !selectedEntity?.entity?.code
      ) {
        return false;
      }

      return !classifications.some(
        (item) =>
          item.code ===
          selectedEntity.entity.code
      );
    }, [
      selectedEntity,
      classifications,
    ]);

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

            <textarea
              value={aiText}
              onChange={(event) =>
                setAiText(
                  event.target.value
                )
              }
              placeholder="Ex.: Paciente apresenta dificuldade para caminhar longas distâncias, necessitando realizar pausas frequentes devido à limitação funcional."
              className="min-h-[170px] w-full resize-y rounded-xl border border-gray-300 p-4 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
              maxLength={5000}
            />

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
                ? "Analisando..."
                : "✨ Analisar com IA"}
            </button>

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
                                        : "bg-gray-200 text-gray-700"
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
              <div className="mb-5">
                <h2 className="text-xl font-bold text-gray-900">
                  🌳 Árvore CIF
                </h2>

                <p className="mt-1 text-sm text-gray-600">
                  Navegue pela estrutura
                  oficial e selecione uma
                  categoria.
                </p>
              </div>

              {treeError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {treeError}
                </div>
              )}

              {rootNodes.length === 0 &&
                !treeError && (
                  <div className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500">
                    Carregando árvore CIF...
                  </div>
                )}

              <div className="space-y-1">
                {rootNodes.map(
                  (node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      level={0}
                      visited={
                        new Set<string>()
                      }
                    />
                  )
                )}
              </div>
            </div>

            {/* DETALHES */}

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
                    {/* INFORMAÇÕES DA CATEGORIA */}

                    <div className="border-b border-gray-200 pb-5">
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedEntity.entity
                          .code && (
                          <span className="rounded-md bg-purple-100 px-3 py-1 font-bold text-purple-800">
                            {
                              selectedEntity
                                .entity.code
                            }
                          </span>
                        )}

                        <h2 className="text-xl font-bold text-gray-900">
                          {
                            selectedEntity
                              .entity.title
                          }
                        </h2>
                      </div>

                      {selectedEntity.entity
                        .definition && (
                        <p className="mt-4 text-sm leading-6 text-gray-600">
                          {
                            selectedEntity
                              .entity
                              .definition
                          }
                        </p>
                      )}

                      {selectedEntity.entity
                        .browserUrl && (
                        <a
                          href={
                            selectedEntity
                              .entity
                              .browserUrl
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-block text-sm font-semibold text-purple-700 hover:underline"
                        >
                          Ver na CIF da OMS →
                        </a>
                      )}
                    </div>

                    {/* QUALIFICADORES OFICIAIS */}

                    {selectedEntity
                      .qualifierAxes
                      .length > 0 && (
                      <div className="mt-6 space-y-6">
                        <div>
                          <h3 className="font-bold text-gray-900">
                            Qualificadores
                          </h3>

                          <p className="mt-1 text-xs text-gray-500">
                            Os eixos abaixo são
                            definidos pela OMS
                            para esta categoria
                            da CIF.
                          </p>
                        </div>

                        {selectedEntity.qualifierAxes.map(
                          (
                            axis,
                            axisIndex
                          ) => {
                            const axisKey =
                              axis.axis ||
                              axis.axisName ||
                              `axis-${axisIndex}`;

                            const selectedQualifier =
                              selectedQualifiers[
                                axisKey
                              ] || null;

                            return (
                              <div
                                key={`${axisKey}-${axisIndex}`}
                                className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-bold text-gray-900">
                                      {axis.axis ||
                                        axis.axisName ||
                                        "Qualificador"}
                                    </h4>

                                    {axis.required && (
                                      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                                        Obrigatório
                                      </span>
                                    )}

                                    {axis.multiple ===
                                      "AllowAlways" && (
                                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                        Múltiplos valores
                                      </span>
                                    )}

                                    {axis.multiple ===
                                      "AllowedExceptFromSameBlock" && (
                                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                        Múltiplos valores permitidos
                                      </span>
                                    )}
                                  </div>

                                  {axis.axisName &&
                                    axis.axisName !==
                                      axis.axis && (
                                      <div className="text-xs text-gray-500">
                                        {
                                          axis.axisName
                                        }
                                      </div>
                                    )}
                                </div>

                                {axis.options
                                  .length ===
                                0 ? (
                                  <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-3 text-sm text-gray-500">
                                    Nenhuma opção
                                    de
                                    qualificador
                                    foi
                                    encontrada
                                    para este
                                    eixo.
                                  </div>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {axis.options.map(
                                      (
                                        qualifier
                                      ) => {
                                        const selected =
                                          selectedQualifier?.id ===
                                          qualifier.id;

                                        return (
                                          <button
                                            key={
                                              qualifier.id ||
                                              qualifier.code ||
                                              qualifier.url
                                            }
                                            type="button"
                                            onClick={() =>
                                              setSelectedQualifiers(
                                                (
                                                  previous
                                                ) => ({
                                                  ...previous,
                                                  [axisKey]:
                                                    selected
                                                      ? null
                                                      : qualifier,
                                                })
                                              )
                                            }
                                            className={`w-full rounded-lg border p-3 text-left transition ${
                                              selected
                                                ? "border-purple-500 bg-purple-50"
                                                : "border-gray-200 bg-white hover:border-purple-300"
                                            }`}
                                          >
                                            <div className="flex items-start gap-3">
                                              <div
                                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                                  selected
                                                    ? "border-purple-600 bg-purple-600 text-white"
                                                    : "border-gray-300 bg-white"
                                                }`}
                                              >
                                                {selected
                                                  ? "✓"
                                                  : ""}
                                              </div>

                                              <div className="min-w-0">
                                                <div className="font-semibold text-gray-900">
                                                  {
                                                    qualifier.code
                                                  }
                                                </div>

                                                <div className="mt-1 text-sm text-gray-600">
                                                  {
                                                    qualifier.title
                                                  }
                                                </div>

                                                {qualifier.definition && (
                                                  <div className="mt-1 text-xs leading-5 text-gray-500">
                                                    {
                                                      qualifier.definition
                                                    }
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </button>
                                        );
                                      }
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}

                    {/* EXCLUSÕES */}

                    {selectedEntity.exclusions
                      .length > 0 && (
                      <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                        <h3 className="font-bold text-gray-900">
                          Exclusões
                        </h3>

                        <div className="mt-2 space-y-1">
                          {selectedEntity.exclusions.map(
                            (
                              exclusion,
                              index
                            ) => (
                              <div
                                key={
                                  `${exclusion.label}-${index}`
                                }
                                className="text-sm text-gray-700"
                              >
                                {exclusion.label}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={
                        addManualClassification
                      }
                      disabled={
                        !canAddManual ||
                        hasRequiredQualifierMissing
                      }
                      className="mt-6 w-full rounded-xl bg-purple-600 px-5 py-4 font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {!hasManualSelection
                        ? "Selecione uma categoria"
                        : !canAddManual
                          ? "Classificação já adicionada"
                          : hasRequiredQualifierMissing
                            ? "Preencha os qualificadores obrigatórios"
                            : "Adicionar classificação"}
                    </button>
                  </div>
                )}
            </div>
          </section>
        )}

        {/* CLASSIFICAÇÕES */}

        <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
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
                    className="rounded-xl border border-gray-200 p-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-purple-100 px-2 py-1 font-bold text-purple-800">
                            {
                              classification.code
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
                                      {axis}:
                                    </span>{" "}
                                    {
                                      qualifier.code
                                    }{" "}
                                    —{" "}
                                    {
                                      qualifier.title
                                    }
                                  </div>
                                )
                              )}
                            </div>
                          )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          removeClassification(
                            classification.id
                          )
                        }
                        className="shrink-0 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}