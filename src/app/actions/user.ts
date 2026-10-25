"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface UpdateUserProfileInput {
  profession?: string;
  councilType?: string;
  councilNumber?: string;
}

export interface UpdateUserProfileResult {
  success: boolean;
  error?: string;
}

export async function updateUserProfile(
  data: UpdateUserProfileInput
): Promise<UpdateUserProfileResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser?.email) {
      return {
        success: false,
        error: "Usuário não autenticado",
      };
    }

    // Buscar usuário no banco
    const dbUser = await prisma.user.findUnique({
      where: { email: authUser.email },
      select: { id: true },
    });

    if (!dbUser) {
      return {
        success: false,
        error: "Usuário não encontrado",
      };
    }

    // Atualizar perfil do usuário
    // Aceita campos vazios/null - salva apenas os campos preenchidos
    const updateData: {
      profession?: string | null;
      councilType?: string | null;
      councilNumber?: string | null;
    } = {};

    // Só atualizar campos que foram fornecidos e não estão vazios
    if (data.profession !== undefined && data.profession.trim() !== "") {
      updateData.profession = data.profession.trim();
    } else if (data.profession === "") {
      updateData.profession = null;
    }

    if (data.councilType !== undefined && data.councilType.trim() !== "") {
      updateData.councilType = data.councilType.trim();
    } else if (data.councilType === "") {
      updateData.councilType = null;
    }

    if (data.councilNumber !== undefined && data.councilNumber.trim() !== "") {
      updateData.councilNumber = data.councilNumber.trim();
    } else if (data.councilNumber === "") {
      updateData.councilNumber = null;
    }

    // Só fazer update se houver algo para atualizar
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: updateData,
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/profile");

    return {
      success: true,
    };
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao atualizar perfil",
    };
  }
}

