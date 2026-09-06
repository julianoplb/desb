"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
} from "@netlify/identity";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function initializeAuth() {
      try {
        // Processa convites, confirmação de e-mail
        // e outros callbacks do Netlify Identity.
        const callbackResult = await handleAuthCallback();

        // Quando o usuário chega através de um convite,
        // o Netlify fornece um token que precisa ser aceito
        // junto com a nova senha.
        if (callbackResult?.type === "invite" && callbackResult.token) {
          setInviteToken(callbackResult.token);

          if (callbackResult.user?.email) {
            setEmail(callbackResult.user.email);
          }

          return;
        }

        const user = await getUser();

        if (user) {
          window.location.href = "/";
          return;
        }
      } catch (error) {
        console.error("Erro ao inicializar autenticação:", error);

        setError(
          "Não foi possível processar o convite. Tente abrir novamente o link recebido por e-mail."
        );
      } finally {
        setCheckingSession(false);
      }
    }

    initializeAuth();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setError("Digite seu e-mail e sua senha.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await login(normalizedEmail, password);

      // Full page navigation para garantir que
      // a sessão seja reconhecida pelo servidor.
      window.location.href = "/";
    } catch (error) {
      console.error("Erro ao fazer login:", error);

      setError(
        "Não foi possível entrar. Verifique seu e-mail e sua senha."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!inviteToken) {
      setError(
        "O convite não foi encontrado. Abra novamente o link enviado por e-mail."
      );
      return;
    }

    if (!password || !confirmPassword) {
      setError("Digite e confirme sua senha.");
      return;
    }

    if (password !== confirmPassword) {
      setError("As senhas não são iguais.");
      return;
    }

    if (password.length < 8) {
      setError("Sua senha deve ter pelo menos 8 caracteres.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      await acceptInvite(inviteToken, password);

      // O acceptInvite autentica o usuário.
      // Fazemos uma navegação completa para que
      // o servidor reconheça a nova sessão.
      window.location.href = "/";
    } catch (error) {
      console.error("Erro ao aceitar convite:", error);

      setError(
        "Não foi possível criar sua senha. O convite pode ter expirado ou já ter sido utilizado. Solicite um novo convite."
      );
    } finally {
      setLoading(false);
    }
  }

  function backToLogin() {
    setInviteToken(null);
    setPassword("");
    setConfirmPassword("");
    setError("");
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl border border-gray-200 bg-white px-8 py-7 text-center shadow-sm">
          <div className="text-lg font-semibold text-gray-900">
            Carregando...
          </div>

          <div className="mt-2 text-sm text-gray-500">
            Verificando sua sessão.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">🧩</div>

          <h1 className="text-3xl font-bold text-gray-900">
            Desb
          </h1>

          <p className="mt-2 text-gray-600">
            Classificação Internacional de Funcionalidade
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {inviteToken ? (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Criar sua senha
                </h2>

                <p className="mt-2 text-sm leading-6 text-gray-500">
                  Você foi convidado para acessar o Desb. Crie uma senha
                  para concluir seu cadastro.
                </p>

                {email && (
                  <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      E-mail
                    </div>

                    <div className="mt-1 text-sm font-medium text-gray-900">
                      {email}
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleAcceptInvite}
                className="space-y-5"
              >
                <div>
                  <label
                    htmlFor="new-password"
                    className="mb-2 block text-sm font-semibold text-gray-700"
                  >
                    Nova senha
                  </label>

                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="Crie uma senha"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-2 block text-sm font-semibold text-gray-700"
                  >
                    Confirmar senha
                  </label>

                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    placeholder="Digite a senha novamente"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                    disabled={loading}
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-5 text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-purple-600 px-5 py-3.5 font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Criando senha..." : "Criar senha e acessar"}
                </button>
              </form>

              <button
                type="button"
                onClick={backToLogin}
                disabled={loading}
                className="mt-5 w-full text-sm font-medium text-gray-500 transition hover:text-gray-700 disabled:opacity-50"
              >
                Voltar para o login
              </button>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Entrar
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Entre com seu e-mail e senha para acessar o sistema.
                </p>
              </div>

              <form
                onSubmit={handleLogin}
                className="space-y-5"
              >
                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-semibold text-gray-700"
                  >
                    E-mail
                  </label>

                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    placeholder="seu@email.com"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-semibold text-gray-700"
                  >
                    Senha
                  </label>

                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="Digite sua senha"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                    disabled={loading}
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-5 text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-purple-600 px-5 py-3.5 font-bold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Entrando..." : "Entrar"}
                </button>
              </form>

              <div className="mt-6 border-t border-gray-100 pt-5 text-center text-xs text-gray-500">
                Acesso restrito a usuários convidados.
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}