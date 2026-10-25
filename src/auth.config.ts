import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  pages: {
    signIn: "/", // Página de login está na raiz
    // newUser removido: não forçamos mais onboarding, usuário vai direto para dashboard
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnApiAuth = nextUrl.pathname.startsWith("/api/auth");

      // CRÍTICO: SEMPRE permitir rotas de API do NextAuth
      // Isso é essencial para o fluxo de autenticação funcionar
      if (isOnApiAuth) {
        return true;
      }

      // Para todas as outras rotas, deixar o proxy lidar
      // O callback authorized é usado principalmente pelo proxy
      // Não vamos bloquear nada aqui para evitar interferir no fluxo de autenticação
      return true;
    },
  },
  providers: [], // Providers são configurados no auth.ts
} satisfies NextAuthConfig;