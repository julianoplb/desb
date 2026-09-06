"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  getUser,
  handleAuthCallback,
  login,
} from "@netlify/identity";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function initializeAuth() {
      try {
        // Processa convites, confirmação de e-mail
        // e recuperação de senha.
        await handleAuthCallback();

        const user = await getUser();

        if (user) {
          window.location.href = "/";
          return;
        }
      } catch (error) {
        console.error("Erro ao inicializar autenticação:", error);
      } finally {
        setCheckingSession(false);
      }
    }

    initializeAuth();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">
              Entrar
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Entre com seu e-mail e senha para acessar o sistema.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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
                onChange={(event) => setEmail(event.target.value)}
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
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
        </div>
      </div>
    </main>
  );
}