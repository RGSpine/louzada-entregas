"use server";

import { redirect } from "next/navigation";
import {
  createSupabaseAnonClient,
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import {
  enforceRateLimit,
  LOGIN_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
  FORGOT_PASSWORD_RATE_LIMIT,
} from "@/lib/rate-limit";
import { isPlatformOwnerEmail } from "@/lib/plan-limits";
import { isProfessionalProfileComplete } from "@/lib/auth/google-profile";
import { syncGoogleAuthUser } from "@/lib/auth/sync-google-auth-user";
import { getPasswordResetRedirectUrl, getPasswordRecoveryLandingUrl } from "@/lib/app-url";
import { cookies } from "next/headers";
import {
  PAID_ACCESS_COOKIE,
  PAID_ACCESS_COOKIE_MAX_AGE_SEC,
} from "@/lib/subscription-access";
import { INTRA_USER_COOKIE } from "@/lib/intra-user/constants";
import { getIntraUserContext } from "@/lib/intra-user/context";

async function setPaidAccessCookie(_value: "0" | "1"): Promise<void> {
  const jar = await cookies();
  jar.set(PAID_ACCESS_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PAID_ACCESS_COOKIE_MAX_AGE_SEC,
  });
}

/** Após login/logout: remove perfil Intra User para forçar seleção em contas de equipe. */
async function clearIntraUserCookie(): Promise<void> {
  try {
    const jar = await cookies();
    jar.delete(INTRA_USER_COOKIE);
  } catch {
    // cookie opcional
  }
}

export interface GoogleSignInActionResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface SignupActionResult {
  success: boolean;
  error?: string;
  /** Fallback se o redirect do Server Action não for seguido pelo cliente. */
  redirectTo?: string;
}

export interface LoginActionResult {
  success: boolean;
  error?: string;
  /** Conta sem plano pago — cliente deve ir a /dashboard/planos (sem claim de produto). */
  needsCheckout?: boolean;
  redirectTo?: string;
}

export interface ForgotPasswordResult {
  success: boolean;
  error?: string;
}

export interface ConfirmPasswordRecoveryResult {
  success: boolean;
  error?: string;
}

export interface ResendConfirmationResult {
  success: boolean;
  error?: string;
}

// Ação para recuperação de senha (e-mail branded + token_hash no domínio da app)
export async function forgotPasswordAction(email: string): Promise<ForgotPasswordResult> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { success: false, error: "Informe um e-mail válido." };
    }

    const rl = await enforceRateLimit(
      `forgot-password:${normalizedEmail}`,
      FORGOT_PASSWORD_RATE_LIMIT,
    );
    if (!rl.allowed) {
      return {
        success: false,
        error: `Aguarde ${rl.resetIn}s antes de solicitar outro e-mail de recuperação.`,
      };
    }

    const redirectTo = getPasswordResetRedirectUrl();
    const emailConfigured = Boolean(
      process.env.EMAIL_USER?.trim() && process.env.EMAIL_PASS?.trim(),
    );

    // Caminho preferido: generateLink + Nodemailer (evita /auth/v1/verify e scanner no link Supabase)
    if (emailConfigured) {
      let supabaseAdmin;
      try {
        supabaseAdmin = createSupabaseAdminClient();
      } catch (error) {
        console.error("[forgotPassword] admin client:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Supabase não configurado no ambiente.",
        };
      }

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
        options: { redirectTo },
      });

      if (linkError) {
        const msg = linkError.message?.toLowerCase() ?? "";
        if (msg.includes("security purposes") || msg.includes("only request")) {
          return {
            success: false,
            error: "Aguarde cerca de 1 minuto antes de solicitar outro e-mail de recuperação.",
          };
        }
        // Não revelar se o e-mail existe
        if (
          msg.includes("not found") ||
          msg.includes("user not found") ||
          msg.includes("não encontrado")
        ) {
          return { success: true };
        }
        console.error("[forgotPassword] generateLink:", linkError);
        return { success: true };
      }

      const hashedToken = linkData?.properties?.hashed_token;
      if (!hashedToken) {
        console.error("[forgotPassword] hashed_token ausente");
        return {
          success: false,
          error: "Não foi possível gerar o link de recuperação. Tente novamente.",
        };
      }

      const recoveryUrl = getPasswordRecoveryLandingUrl(hashedToken);
      const metaName = linkData?.user?.user_metadata?.full_name ?? linkData?.user?.user_metadata?.name;
      const userName =
        typeof metaName === "string" && metaName.trim()
          ? metaName.trim()
          : normalizedEmail.split("@")[0];

      const { sendPasswordRecoveryEmail } = await import("@/lib/email");
      const emailResult = await sendPasswordRecoveryEmail(
        normalizedEmail,
        recoveryUrl,
        userName,
      );

      if (!emailResult.success) {
        console.error("[forgotPassword] envio branded:", emailResult.error);
        return {
          success: false,
          error: "Não foi possível enviar o e-mail. Tente novamente em instantes.",
        };
      }

      return { success: true };
    }

    // Fallback: mailer nativo do Supabase (dev sem EMAIL_* )
    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch (error) {
      console.error("[forgotPassword] client:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Supabase não configurado no ambiente.",
      };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("security purposes") || msg.includes("only request")) {
        return {
          success: false,
          error: "Aguarde cerca de 1 minuto antes de solicitar outro e-mail de recuperação.",
        };
      }
      console.error("[forgotPassword] resetPasswordForEmail:", error);
      return { success: true };
    }

    return { success: true };
  } catch (error) {
    console.error("Erro no forgotPasswordAction:", error);
    return {
      success: false,
      error: "Erro ao processar solicitação. Tente novamente.",
    };
  }
}

/**
 * Consome o token_hash de recovery (server-side) e grava a sessão nos cookies.
 * Só deve ser chamado após clique explícito do usuário (anti-scanner).
 */
export async function confirmPasswordRecoveryAction(
  tokenHash: string,
): Promise<ConfirmPasswordRecoveryResult> {
  const trimmed = tokenHash.trim();
  if (!trimmed) {
    return { success: false, error: "Link inválido. Solicite um novo e-mail de recuperação." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: trimmed,
      type: "recovery",
    });

    if (error || !data.session || !data.user) {
      console.error("[confirmPasswordRecovery]", error?.message ?? "sem sessão");
      return {
        success: false,
        error:
          "Link inválido ou já utilizado. Solicite um novo e-mail de recuperação e abra-o uma única vez.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[confirmPasswordRecovery]", err);
    return { success: false, error: "Não foi possível validar o link. Tente novamente." };
  }
}

// Ação para reenviar e-mail de confirmação
export async function resendConfirmationAction(email: string): Promise<ResendConfirmationResult> {
  try {
    // Usar o admin client para ter mais controle
    const supabaseAdmin = createSupabaseAdminClient();
    
    console.log(`[resendConfirmation] Tentando reenviar para: ${email}`);

    const normalizedEmail = email.trim().toLowerCase();

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard`,
      },
    });

    if (linkError) {
      const msg = linkError.message?.toLowerCase() ?? "";
      const userNotFound =
        msg.includes("not found") ||
        msg.includes("não encontrado") ||
        msg.includes("user not found");
      if (userNotFound) {
        return { success: true };
      }
      console.error("[resendConfirmation] Erro ao gerar link:", linkError);
      return { success: false, error: "Erro ao gerar link de confirmação." };
    }

    const user = linkData?.user;
    if (user?.email_confirmed_at) {
      return {
        success: false,
        error: "Este e-mail já foi confirmado. Tente fazer login.",
      };
    }

    if (!linkData?.properties?.action_link) {
      console.error("[resendConfirmation] Link não gerado");
      return { success: false, error: "Erro ao gerar link de confirmação." };
    }

    console.log(`[resendConfirmation] Link gerado com sucesso para ${email}`);

    // Enviar email manualmente usando nosso sistema de email
    const { sendConfirmationEmail } = await import("@/lib/email");
    const emailResult = await sendConfirmationEmail(
      email,
      linkData.properties.action_link,
      user?.user_metadata?.name || email.split("@")[0]
    );

    if (!emailResult.success) {
      console.error("[resendConfirmation] Erro ao enviar email:", emailResult.error);
      return { success: false, error: "Erro ao enviar e-mail. Tente novamente." };
    }

    console.log(`[resendConfirmation] Email enviado com sucesso para ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Erro no resendConfirmationAction:", error);
    return {
      success: false,
      error: "Erro ao processar solicitação. Tente novamente.",
    };
  }
}

export interface AuthPrefillResult {
  email?: string;
  name?: string;
}

export async function getAuthPrefillAction(): Promise<AuthPrefillResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};
    const metaName = user.user_metadata?.full_name ?? user.user_metadata?.name;
    return {
      email: user.email ?? undefined,
      name: typeof metaName === "string" && metaName.trim() ? metaName.trim() : undefined,
    };
  } catch {
    return {};
  }
}

/** Inicia OAuth Google via Supabase (login ou cadastro parcial). */
export async function signInWithGoogleAction(options?: {
  intent?: "login" | "signup";
  next?: string;
}): Promise<GoogleSignInActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
    const intent = options?.intent === "signup" ? "signup" : "login";
    const next =
      options?.next?.startsWith("/") && !options.next.startsWith("//")
        ? options.next
        : "/dashboard";

    const callbackUrl = new URL("/auth/callback", appUrl);
    callbackUrl.searchParams.set("next", next);
    callbackUrl.searchParams.set("intent", intent);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.toString(),
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });

    if (error || !data.url) {
      return {
        success: false,
        error: error?.message ?? "Não foi possível iniciar autenticação com Google.",
      };
    }

    return { success: true, url: data.url };
  } catch (err) {
    console.error("[signInWithGoogleAction]", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erro ao conectar com Google.",
    };
  }
}

/** Completa o nome quando a conta Google ainda não tem registro no laboratório. */
export async function completeGoogleSignupAction(
  formData: FormData,
): Promise<SignupActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser?.email) {
      return { success: false, error: "Sessão inválida. Faça login com Google novamente." };
    }

    await syncGoogleAuthUser(authUser);

    const fullName = String(formData.get("fullName") ?? "").trim();

    const email = authUser.email.trim().toLowerCase();
    const name =
      fullName ||
      (typeof authUser.user_metadata?.full_name === "string"
        ? authUser.user_metadata.full_name
        : typeof authUser.user_metadata?.name === "string"
          ? authUser.user_metadata.name
          : email.split("@")[0]);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ authUserId: authUser.id }, { email }] },
      select: { id: true, basicoCheckoutRequired: true },
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          authUserId: authUser.id,
          name,
        },
      });
    } else {
      const created = await prisma.user.create({
        data: {
          id: authUser.id,
          authUserId: authUser.id,
          email,
          name,
          plan: "CLINICA",
          accountStatus: "ACTIVE",
          basicoCheckoutRequired: false,
        },
      });
      const { ensureCrmProfile } = await import("@/lib/crm/sync-account");
      await ensureCrmProfile(created.id);
    }

    if (isPlatformOwnerEmail(email)) {
      await prisma.user.updateMany({
        where: { email: { equals: email, mode: "insensitive" } },
        data: { role: "ADMIN" },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[completeGoogleSignupAction]", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao completar cadastro.",
    };
  }
}

export interface AuthProfileStatusResult {
  authenticated: boolean;
  profileComplete: boolean;
}

export async function getAuthProfileStatusAction(): Promise<AuthProfileStatusResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return { authenticated: false, profileComplete: false };

    const dbUser = await prisma.user.findFirst({
      where: { OR: [{ authUserId: user.id }, { email: user.email }] },
      select: { name: true, profession: true, councilType: true, councilNumber: true },
    });

    return {
      authenticated: true,
      profileComplete: dbUser ? isProfessionalProfileComplete(dbUser) : false,
    };
  } catch {
    return { authenticated: false, profileComplete: false };
  }
}

export interface UpdatePasswordResult {
  success: boolean;
  error?: string;
}

export async function updatePasswordAction(password: string): Promise<UpdatePasswordResult> {
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    return { success: false, error: "A senha deve ter no mínimo 6 caracteres." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sessão inválida. Solicite um novo link de recuperação." };
    }

    const { error } = await supabase.auth.updateUser({ password: trimmed });
    if (error) {
      if (error.message.includes("same as the old password")) {
        return { success: false, error: "A nova senha deve ser diferente da senha atual." };
      }
      return { success: false, error: error.message || "Erro ao atualizar senha." };
    }
    return { success: true };
  } catch (err) {
    console.error("[updatePasswordAction]", err);
    return { success: false, error: "Erro inesperado. Tente novamente." };
  }
}

/** Troca a senha da conta. Só o administrador principal, já autenticado, pode fazer isso. */
export async function changeAccountPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<UpdatePasswordResult> {
  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword.trim();
  const confirmPassword = input.confirmPassword.trim();

  if (newPassword.length < 6) {
    return { success: false, error: "A nova senha deve ter no mínimo 6 caracteres." };
  }
  if (newPassword !== confirmPassword) {
    return { success: false, error: "As senhas não coincidem." };
  }
  if (currentPassword && newPassword === currentPassword) {
    return { success: false, error: "A nova senha deve ser diferente da senha atual." };
  }

  try {
    const ctx = await getIntraUserContext();
    if (!ctx?.activeIntraUser?.isOwner) {
      return { success: false, error: "Só o administrador principal altera a senha da conta." };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return { success: false, error: "Sessão inválida. Entre novamente para alterar a senha." };
    }

    const rate = await enforceRateLimit(
      `change-password:${user.email.toLowerCase()}`,
      LOGIN_RATE_LIMIT,
    );
    if (!rate.allowed) {
      return { success: false, error: `Muitas tentativas. Aguarde ${rate.resetIn}s.` };
    }

    if (currentPassword) {
      const probe = createSupabaseAnonClient();
      const { error: signInError } = await probe.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) {
        return { success: false, error: "A senha atual está incorreta." };
      }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      if (error.message.includes("same as the old password")) {
        return { success: false, error: "A nova senha deve ser diferente da senha atual." };
      }
      return { success: false, error: error.message || "Erro ao atualizar senha." };
    }
    return { success: true };
  } catch (err) {
    console.error("[changeAccountPasswordAction]", err);
    return { success: false, error: "Erro inesperado. Tente novamente." };
  }
}

export async function logoutAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error("Erro ao fazer logout:", error);
      return { success: false, error: error.message };
    }

    try {
      await setPaidAccessCookie("0");
    } catch {
      // cookie opcional no logout
    }
    await clearIntraUserCookie();
    
    return { success: true };
  } catch (error) {
    console.error("Erro no logoutAction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

export async function loginAction(email: string, password: string): Promise<LoginActionResult> {
  try {
    const rateCheck = await enforceRateLimit(`login:${email.toLowerCase()}`, LOGIN_RATE_LIMIT);
    if (!rateCheck.allowed) {
      return {
        success: false,
        error: `Muitas tentativas de login. Tente novamente em ${rateCheck.resetIn} segundos.`,
      };
    }
    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch (error) {
      console.error("Erro ao criar cliente Supabase:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Supabase não configurado no ambiente.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let signInError: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;

    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      data = result.data;
      signInError = result.error;
    } catch (networkError) {
      const err = networkError as Error & { cause?: { code?: string } };
      const msg = err.message || "";
      const code = err.cause?.code;
      if (msg.includes("fetch failed") || code === "ENOTFOUND" || code === "ECONNREFUSED") {
        return {
          success: false,
          error:
            "Não foi possível conectar ao servidor. Verifique sua conexão com a internet, se está no WSL confira o DNS (/etc/resolv.conf) ou se o projeto Supabase está ativo no dashboard.",
        };
      }
      throw networkError;
    }

    if (signInError) {
      console.error("Erro no login Supabase:", signInError);

      const errMsg = signInError.message ?? "";
      const errCause = signInError as { cause?: { code?: string } };
      if (errMsg.includes("fetch failed") || errCause?.cause?.code === "ENOTFOUND" || errCause?.cause?.code === "ECONNREFUSED") {
        return {
          success: false,
          error: "Não foi possível conectar ao servidor. Verifique sua conexão com a internet. Se estiver no WSL, confira o DNS ou se o projeto Supabase está ativo.",
        };
      }
      if (errMsg.includes("Invalid login credentials")) {
        return { success: false, error: "E-mail ou senha incorretos." };
      }
      if (errMsg.includes("Email not confirmed")) {
        return { success: false, error: "Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada." };
      }

      return { success: false, error: errMsg || "Erro ao fazer login." };
    }

    if (!data.user) {
      return { success: false, error: "Não foi possível autenticar. Tente novamente." };
    }

    // Verifica se o usuário existe no banco de dados Prisma (busca por email para evitar dessincronização)
    let dbUser = await prisma.user.findUnique({
      where: { email: data.user.email ?? "" },
    });

    if (!dbUser) {
      // Tenta buscar pelo ID como fallback
      dbUser = await prisma.user.findUnique({
        where: { id: data.user.id },
      });
    }

    if (!dbUser) {
      // Se o usuário existe no Supabase Auth mas não no Prisma, 
      // cria o registro no Prisma para recuperar a sincronização
      console.warn("Usuário autenticado mas não encontrado no banco. Criando registro:", data.user.id);
      try {
        dbUser = await prisma.user.create({
          data: {
            id: data.user.id,
            authUserId: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || "Usuário",
            plan: "CLINICA",
            accountStatus: "ACTIVE",
            basicoCheckoutRequired: false,
          },
        });
        console.log("Registro de usuário criado com sucesso:", dbUser.id);
      } catch (createError) {
        console.error("Erro ao criar registro de recuperação:", createError);
        return { 
          success: false, 
          error: "Erro ao sincronizar conta. Entre em contato com o suporte." 
        };
      }
    }

    // Sincroniza o ID se necessário (caso o usuário foi encontrado por email mas com ID diferente)
    if (dbUser.id !== data.user.id) {
      console.warn("ID do banco diferente do Supabase Auth. Atualizando...");
      try {
        await prisma.user.update({
          where: { email: data.user.email ?? "" },
          data: { id: data.user.id, authUserId: data.user.id },
        });
      } catch (updateError) {
        console.warn("Não foi possível atualizar ID do usuário:", updateError);
        // Não falha o login por isso
      }
    }

    // Garante auth_user_id preenchido (para RLS/PostgREST quando habilitado)
    if (!dbUser.authUserId && data.user.id) {
      try {
        await prisma.user.update({
          where: { id: dbUser.id },
          data: { authUserId: data.user.id },
        });
      } catch {
        // Não falha o login
      }
    }

    // Dono da plataforma: sempre ADMIN no Prisma (painel /admin, APIs e consistência)
    if (data.user.email && isPlatformOwnerEmail(data.user.email)) {
      try {
        await prisma.user.updateMany({
          where: {
            OR: [
              { email: { equals: data.user.email, mode: "insensitive" } },
              { id: data.user.id },
            ],
          },
          data: { role: "ADMIN" },
        });
      } catch (e) {
        console.warn("[login] Não foi possível garantir role ADMIN para o dono:", e);
      }
    }

    await setPaidAccessCookie("1");
    await clearIntraUserCookie();

    return { success: true, redirectTo: "/dashboard" };
  } catch (error) {
    console.error("Erro no loginAction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

export async function signupAction(formData: FormData): Promise<SignupActionResult> {
  try {
    const signupEmailRaw = formData.get("email") as string;
    // Rate limit só mais abaixo — na criação Auth nova. Retomar cadastro incompleto
    // (e-mail já existe) não deve consumir a cota (ex.: após delete no admin).
    // Cria o cliente Supabase para operações de servidor
    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch (error) {
      console.error("Erro ao criar cliente Supabase:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Supabase não configurado no ambiente.",
      };
    }

    const email = String(formData.get("email") ?? signupEmailRaw ?? "").trim();
    const password = String(formData.get("password") ?? "").trim();
    const name = String(formData.get("fullName") ?? "").trim();

    if (!email || !password || !name) {
      return { success: false, error: "Preencha nome, e-mail e senha." };
    }

    if (password.length < 6) {
      return { success: false, error: "A senha deve ter no mínimo 6 caracteres." };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Preferir Admin API: cria usuário já confirmado SEM enviar e-mail de confirmação.
    // O signUp público dispara e-mail e estoura o rate limit do Supabase ("email rate limit exceeded")
    // após poucas tentativas no mesmo endereço — quebrando o fluxo Planos.
    let authUserId: string | null = null;
    try {
      const rateCheck = await enforceRateLimit(
        `signup:${email.toLowerCase()}`,
        SIGNUP_RATE_LIMIT,
      );
      if (!rateCheck.allowed) {
        const mins = Math.max(1, Math.ceil(rateCheck.resetIn / 60));
        return {
          success: false,
          error: `Muitas tentativas de cadastro. Aguarde cerca de ${mins} min e tente de novo (ou faça login se a conta já existir).`,
        };
      }

      const supabaseAdmin = createSupabaseAdminClient();
      const { data: createdAuth, error: createAuthError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        });

      if (createAuthError) {
        const msg = (createAuthError.message ?? "").toLowerCase();
        const alreadyExists =
          msg.includes("already") ||
          msg.includes("registered") ||
          msg.includes("exists") ||
          createAuthError.status === 422;

        if (alreadyExists) {
          // Auth já existe (tentativa anterior incompleta): tenta entrar e seguir o fluxo.
          const { data: signInData, error: signInErr } =
            await supabase.auth.signInWithPassword({ email, password });
          if (signInErr) {
            return {
              success: false,
              error:
                "Este e-mail já está cadastrado. Faça login ou use a recuperação de senha.",
            };
          }
          authUserId = signInData.user?.id ?? null;

          const existingDb = await prisma.user.findFirst({
            where: {
              OR: [
                ...(authUserId ? [{ authUserId }, { id: authUserId }] : []),
                { email },
              ],
            },
            select: { id: true },
          });

          if (existingDb) {
            return {
              success: false,
              error: "Este e-mail já está cadastrado. Tente fazer login.",
            };
          }
          // Auth existe, Prisma não — cai no create abaixo.
        } else if (
          msg.includes("rate limit") ||
          msg.includes("email rate") ||
          msg.includes("over_email_send_rate_limit")
        ) {
          return {
            success: false,
            error:
              "Limite temporário de e-mails do provedor de autenticação. Aguarde alguns minutos e tente novamente (ou use outro e-mail).",
          };
        } else {
          return {
            success: false,
            error: createAuthError.message || "Não foi possível criar a conta.",
          };
        }
      } else {
        authUserId = createdAuth.user?.id ?? null;
        const { data: signInData, error: signInErr } =
          await supabase.auth.signInWithPassword({ email, password });
        if (signInErr || !signInData.session) {
          console.error("[signup] Login após createUser falhou:", signInErr?.message);
          return {
            success: false,
            error:
              "Conta criada, mas não foi possível iniciar a sessão. Tente fazer login com o mesmo e-mail e senha.",
          };
        }
      }
    } catch (adminErr) {
      if (
        typeof adminErr === "object" &&
        adminErr !== null &&
        "digest" in adminErr &&
        typeof (adminErr as { digest?: unknown }).digest === "string" &&
        String((adminErr as { digest: string }).digest).startsWith("NEXT_REDIRECT")
      ) {
        throw adminErr;
      }
      console.warn("[signup] Admin createUser indisponível, fallback signUp:", adminErr);
      // Fallback (sem service role): signUp público.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${appUrl}/auth/confirm`,
        },
      });

      if (signUpError) {
        const msg = (signUpError.message ?? "").toLowerCase();
        if (msg.includes("rate limit") || msg.includes("email rate")) {
          return {
            success: false,
            error:
              "Limite temporário de e-mails do provedor de autenticação. Aguarde alguns minutos e tente novamente.",
          };
        }
        if (msg.includes("already") || msg.includes("registered")) {
          return {
            success: false,
            error: "Este e-mail já está cadastrado. Tente fazer login.",
          };
        }
        return { success: false, error: signUpError.message };
      }

      authUserId = signUpData.user?.id ?? null;
      if (!signUpData.session && authUserId) {
        try {
          const supabaseAdmin = createSupabaseAdminClient();
          await supabaseAdmin.auth.admin.updateUserById(authUserId, {
            email_confirm: true,
          });
          await supabase.auth.signInWithPassword({ email, password });
        } catch (autoConfirmErr) {
          console.warn("[signup] Erro ao confirmar usuário automaticamente:", autoConfirmErr);
        }
      }
    }

    const userData: {
      id?: string;
      email: string;
      name: string;
    } = {
      email,
      name,
    };

    if (authUserId) {
      userData.id = authUserId;
    }

    // Sem sessão cookie o proxy manda /dashboard/* → /login e o fluxo Planos some.
    const {
      data: { session: activeSession },
    } = await supabase.auth.getSession();
    if (!activeSession) {
      const { data: retrySignIn, error: retryErr } =
        await supabase.auth.signInWithPassword({ email, password });
      if (retryErr || !retrySignIn.session) {
        return {
          success: false,
          error:
            "Não foi possível autenticar após o cadastro. Tente fazer login com o mesmo e-mail e senha.",
        };
      }
    }

    try {
      const created = await prisma.user.create({
        data: {
          ...userData,
          plan: "CLINICA",
          accountStatus: "ACTIVE",
          basicoCheckoutRequired: false,
          ...(authUserId ? { authUserId } : {}),
        },
      });
      // CRM não bloqueia o funil de planos (signup ~5s vinha daqui + Auth).
      void import("@/lib/crm/sync-account")
        .then(({ ensureCrmProfile }) => ensureCrmProfile(created.id))
        .catch((err) => console.warn("[signup] ensureCrmProfile:", err));
    } catch (dbError) {
      console.error("Erro ao criar usuário no banco de dados:", dbError);
      
      const msg = dbError instanceof Error ? dbError.message : "";
      
      if (msg.includes("Can't reach database server") || msg.includes("can't reach database server")) {
        return {
          success: false,
          error: "Não foi possível conectar ao banco de dados. Verifique: (1) Supabase Dashboard se o projeto está ativo (sem pausa), (2) DATABASE_URL no .env está correta e copiada do Supabase (Settings > Database > Connection string), (3) Tente a porta 5432 (Session pooler) em vez da 6543. Veja docs/SUPABASE-DB-TROUBLESHOOTING.md",
        };
      }
      if (msg.includes("FATAL") || msg.includes("Tenant or user not found")) {
        return {
          success: false,
          error: "Erro de conexão. Atualize a DATABASE_URL no .env com a connection string do Supabase (Settings > Database). Use o pooler na porta 5432 (Session) e adicione ?pgbouncer=true se usar porta 6543 (Transaction).",
        };
      }
      if (msg.includes("server does not support TLS") || msg.includes("TLS handshake")) {
        return {
          success: false,
          error: "Não foi possível abrir a conexão segura com o banco. Tente de novo em instantes.",
        };
      }
      if (msg.includes("Unique constraint") || msg.includes("duplicate key")) {
        return {
          success: false,
          error: "Este e-mail já está cadastrado. Tente fazer login.",
        };
      }
      
      return {
        success: false,
        error: msg || "Erro ao salvar dados. Tente novamente.",
      };
    }

    await setPaidAccessCookie("1");
    return { success: true, redirectTo: "/dashboard" };
  } catch (error) {
    // Sem tratamento de NEXT_REDIRECT — esta action não chama mais redirect().
    console.error("Erro no signupAction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}
