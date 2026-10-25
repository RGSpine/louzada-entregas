import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthSessionMutationPath } from "./session-mutation-paths";

describe("isAuthSessionMutationPath", () => {
  it("isola login, refresh e exchange do getUser do proxy", () => {
    assert.equal(isAuthSessionMutationPath("/api/auth/login"), true);
    assert.equal(isAuthSessionMutationPath("/api/auth/refresh"), true);
    assert.equal(isAuthSessionMutationPath("/api/auth/exchange"), true);
  });

  it("não isola páginas nem NextAuth", () => {
    assert.equal(isAuthSessionMutationPath("/login"), false);
    assert.equal(isAuthSessionMutationPath("/api/auth/callback/google"), false);
    assert.equal(isAuthSessionMutationPath("/dashboard"), false);
  });
});
