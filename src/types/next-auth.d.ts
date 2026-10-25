import "next-auth";
import "next-auth/jwt";
import "@auth/core/jwt";

// Tipo Role centralizado (mesmo do Prisma)
type Role = "USER" | "ADMIN";

declare module "next-auth" {
  interface User {
    id: string;
    role?: Role | null;
    profession?: string | null;
    councilType?: string | null;
    councilNumber?: string | null;
  }

  interface Session {
    accessToken?: string;
    user: {
      id: string;
      role?: Role | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      profession?: string | null;
      councilType?: string | null;
      councilNumber?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
    accessToken?: string;
    role?: Role | null;
    profession?: string | null;
    councilType?: string | null;
    councilNumber?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    sub?: string;
    accessToken?: string;
    role?: Role | null;
    profession?: string | null;
    councilType?: string | null;
    councilNumber?: string | null;
  }
}
