/** A conta do laboratório entra com nome. Profissão, conselho e logo não bloqueiam o acesso. */
export function isProfessionalProfileComplete(user: {
  name?: string | null;
  profession?: string | null;
  councilType?: string | null;
  councilNumber?: string | null;
}): boolean {
  return Boolean(user.name?.trim());
}

export function googleDisplayName(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  for (const key of ["full_name", "name", "display_name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function googleAvatarUrl(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  for (const key of ["avatar_url", "picture"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
