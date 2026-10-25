import { z } from "zod";

export const AuthExchangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("code"),
    code: z.string().min(1),
  }),
  z.object({
    kind: z.literal("otp"),
    tokenHash: z.string().min(1),
    type: z.enum(["email", "magiclink", "recovery", "signup", "invite"]),
  }),
  z.object({
    kind: z.literal("tokens"),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
  }),
]);

export type AuthExchangeInput = z.infer<typeof AuthExchangeSchema>;
