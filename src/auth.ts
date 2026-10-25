import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Google from "next-auth/providers/google"
import { prisma } from "@/lib/prisma"
import { authConfig } from "./auth.config"
import {
  consumeGoogleOAuthLinkCookie,
  linkGoogleAccountToPrismaUser,
} from "@/lib/google-oauth-link"
// Tipos estendidos em: src/types/next-auth.d.ts

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.events",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  events: {
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !account.providerAccountId || !user.id) {
        return;
      }

      const targetUserId = await consumeGoogleOAuthLinkCookie();
      if (!targetUserId) {
        return;
      }

      try {
        await linkGoogleAccountToPrismaUser({
          targetUserId,
          oauthUserId: user.id,
          providerAccountId: account.providerAccountId,
          tokens: {
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            expires_at: account.expires_at ?? undefined,
            scope: account.scope,
            token_type: account.token_type,
            id_token: account.id_token,
          },
        });
      } catch (err) {
        console.error("[auth] Falha ao vincular conta Google ao utilizador Supabase:", err);
      }
    },
  },
  callbacks: {
    // Callback para controlar redirecionamento após login
    async signIn({ user, account, profile }) {
      // Permitir login do Google
      if (account?.provider === "google") {
        return true;
      }
      return true;
    },
    // Callback para controlar redirecionamento após autenticação bem-sucedida
    async redirect({ url, baseUrl }) {
      // Se a URL for relativa, usar baseUrl
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      // Se a URL for do mesmo domínio, permitir (respeita callbackUrl do signIn)
      try {
        const urlObj = new URL(url);
        if (urlObj.origin === baseUrl) {
          return url;
        }
      } catch (e) {
        // Se não conseguir parsear, tratar como relativa
      }
      // Fallback: redirecionar para dashboard
      return `${baseUrl}/dashboard`;
    },
    // Busca dados no banco apenas no login inicial ou quando solicitado update
    async jwt({ token, trigger, session, user, account }) {
      // Na primeira vez (login), adicionar ID do usuário e access_token do Google
      if (user) {
        token.sub = user.id;
      }

      // Persistir access_token do Google no token JWT (Calendar API)
      if (account?.provider === "google" && account.access_token) {
        token.accessToken = account.access_token;
      }

      // Buscar dados do banco APENAS em situações específicas:
      // 1. Login inicial (user existe) - para pegar role e dados profissionais
      // 2. Trigger "update" - quando o cliente solicita atualização
      // Isso evita consultas desnecessárias ao banco em cada requisição
      const shouldFetchFromDb = user || trigger === "update";

      if (shouldFetchFromDb && token.sub) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.sub },
            select: {
              role: true,
              profession: true,
              councilType: true,
              councilNumber: true,
            },
          });

          if (dbUser) {
            // Atualizar token com dados do banco
            token.role = dbUser.role;
            token.profession = dbUser.profession;
            token.councilType = dbUser.councilType;
            token.councilNumber = dbUser.councilNumber;
            
            // Log em desenvolvimento para debug
            if (process.env.NODE_ENV === 'development') {
              console.log("🔄 JWT Callback - Dados carregados do banco:", {
                trigger: trigger || "signIn",
                role: dbUser.role,
                profession: dbUser.profession,
              });
            }
          } else if (process.env.NODE_ENV === 'development') {
            console.warn("⚠️ Usuário não encontrado no banco durante JWT callback:", token.sub);
          }
        } catch (error) {
          console.error("Erro ao buscar dados do usuário no JWT callback:", error);
          // Em caso de erro, manter dados existentes no token
        }
      }

      return token;
    },
    // ESTRATÉGIA OTIMIZADA: Usar dados do token (já buscados no jwt callback)
    // Evita consulta duplicada ao banco, prevenindo timeout
    async session({ session, token }) {
      // Passar accessToken do Google para a sessão (Calendar API)
      if (token.accessToken && typeof token.accessToken === 'string') {
        session.accessToken = token.accessToken;
      }

      if (session.user) {
        // Usar ID do token
        if (token.sub) {
          session.user.id = token.sub;
        }
        
        // Usar dados já buscados no JWT callback (sem nova consulta ao banco)
        // O JWT callback já garantiu que esses dados estão atualizados
        session.user.role = token.role ?? null;
        session.user.profession = token.profession ?? null;
        session.user.councilType = token.councilType ?? null;
        session.user.councilNumber = token.councilNumber ?? null;
        
        // Manter name, email, image do token se disponíveis
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
        if (token.picture) session.user.image = token.picture as string;
      }
      
      return session;
    },
  },
})
