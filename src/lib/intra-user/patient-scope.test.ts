import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PATIENT_SCOPE,
  buildPatientScopeWhere,
  canIntraUserAccessPatient,
  canManagePatientServicesAccess,
  scopedPatientWhereOrEmpty,
} from "@/lib/intra-user/patient-scope";
import {
  maxIntraUsersForPlan,
  planSupportsIntraUsers,
} from "@/lib/intra-user/constants";

const tenantId = "tenant_1";
const member = {
  id: "iu_member",
  name: "Ana",
  color: "#000",
  role: "MEMBER" as const,
  isOwner: false,
  hasPin: false,
  canManagePatientServices: true,
};
const memberB = {
  id: "iu_member_b",
  name: "Bruno",
  color: "#111",
  role: "MEMBER" as const,
  isOwner: false,
  hasPin: false,
  canManagePatientServices: true,
};
const admin = {
  id: "iu_admin",
  name: "Admin",
  color: "#000",
  role: "ADMIN" as const,
  isOwner: true,
  hasPin: true,
  canManagePatientServices: true,
};

describe("buildPatientScopeWhere", () => {
  it("deny (default) com perfil null → escopo vazio (fail-closed)", () => {
    const where = buildPatientScopeWhere({ tenantId, activeIntraUser: null });
    assert.equal(where.userId, tenantId);
    assert.deepEqual(where.id, EMPTY_PATIENT_SCOPE.id);
  });

  it("whenNoProfile=tenant com perfil null → só filtra tenant", () => {
    const where = buildPatientScopeWhere({
      tenantId,
      activeIntraUser: null,
      whenNoProfile: "tenant",
    });
    assert.deepEqual(where, { userId: tenantId });
  });

  it("ADMIN vê o tenant inteiro", () => {
    const where = buildPatientScopeWhere({ tenantId, activeIntraUser: admin });
    assert.deepEqual(where, { userId: tenantId });
  });

  it("MEMBER vê o tenant inteiro", () => {
    const where = buildPatientScopeWhere({ tenantId, activeIntraUser: member });
    assert.deepEqual(where, { userId: tenantId });
  });
});

describe("canIntraUserAccessPatient (RBAC em memória)", () => {
  it("sem perfil → negado (fail-closed / perfil ausente)", () => {
    assert.equal(
      canIntraUserAccessPatient({ ownerId: member.id, isShared: false }, null),
      false,
    );
    assert.equal(
      canIntraUserAccessPatient({ ownerId: null, isShared: true }, null),
      false,
    );
  });

  it("ADMIN acessa qualquer paciente do tenant (próprio, alheio, shared, orphan)", () => {
    assert.equal(
      canIntraUserAccessPatient({ ownerId: member.id, isShared: false }, admin),
      true,
    );
    assert.equal(
      canIntraUserAccessPatient({ ownerId: null, isShared: false }, admin),
      true,
    );
    assert.equal(
      canIntraUserAccessPatient({ ownerId: memberB.id, isShared: true }, admin),
      true,
    );
  });

  it("MEMBER acessa próprio paciente", () => {
    assert.equal(
      canIntraUserAccessPatient({ ownerId: member.id, isShared: false }, member),
      true,
    );
  });

  it("MEMBER acessa paciente shared de outro", () => {
    assert.equal(
      canIntraUserAccessPatient(
        { ownerId: memberB.id, isShared: true },
        member,
      ),
      true,
    );
  });

  it("MEMBER acessa paciente de outro operador", () => {
    assert.equal(
      canIntraUserAccessPatient(
        { ownerId: memberB.id, isShared: false },
        member,
      ),
      true,
    );
  });

  it("MEMBER acessa paciente sem dono", () => {
    assert.equal(
      canIntraUserAccessPatient({ ownerId: null, isShared: false }, member),
      true,
    );
  });
});

describe("scopedPatientWhereOrEmpty (Bearer / scope null / denied)", () => {
  it("scope null (ex.: Bearer sem Intra User resolvido) → escopo vazio", () => {
    const where = scopedPatientWhereOrEmpty(tenantId, null);
    assert.equal(where.userId, tenantId);
    assert.deepEqual(where.id, EMPTY_PATIENT_SCOPE.id);
  });

  it("scope.denied=true (perfil pendente) → escopo vazio", () => {
    const where = scopedPatientWhereOrEmpty(tenantId, {
      activeIntraUser: null,
      denied: true,
    });
    assert.equal(where.userId, tenantId);
    assert.deepEqual(where.id, EMPTY_PATIENT_SCOPE.id);
  });

  it("ADMIN com denied=false → tenant inteiro", () => {
    const where = scopedPatientWhereOrEmpty(tenantId, {
      activeIntraUser: admin,
      denied: false,
    });
    assert.deepEqual(where, { userId: tenantId });
  });

  it("MEMBER com denied=false → tenant inteiro", () => {
    const where = scopedPatientWhereOrEmpty(tenantId, {
      activeIntraUser: member,
      denied: false,
    });
    assert.deepEqual(where, { userId: tenantId });
  });

  it("denied=true mesmo com activeIntraUser presente → ainda fail-closed", () => {
    // Caller marca denied explicitamente; não promover a ADMIN/MEMBER.
    const where = scopedPatientWhereOrEmpty(tenantId, {
      activeIntraUser: admin,
      denied: true,
    });
    assert.deepEqual(where.id, EMPTY_PATIENT_SCOPE.id);
  });
});

describe("canManagePatientServicesAccess", () => {
  it("sem perfil → negado", () => {
    assert.equal(canManagePatientServicesAccess(null), false);
  });

  it("ADMIN sempre pode", () => {
    assert.equal(canManagePatientServicesAccess(admin), true);
    assert.equal(
      canManagePatientServicesAccess({
        ...admin,
        canManagePatientServices: false,
      }),
      true,
    );
  });

  it("MEMBER também lança no caixa da conta", () => {
    assert.equal(canManagePatientServicesAccess(member), true);
    assert.equal(
      canManagePatientServicesAccess({
        ...member,
        canManagePatientServices: false,
      }),
      true,
    );
  });
});

describe("limites de plano Intra User", () => {
  it("a conta do laboratório aceita vários operadores", () => {
    assert.equal(maxIntraUsersForPlan("CONSULTORIO"), 10);
    assert.equal(maxIntraUsersForPlan("CLINICA"), 10);
    assert.equal(maxIntraUsersForPlan("BASICO"), 10);
    assert.equal(maxIntraUsersForPlan("PROFISSIONAL"), 10);
    assert.equal(maxIntraUsersForPlan("PREMIUM"), 10);
  });

  it("qualquer conta pode ter mais de um operador", () => {
    assert.equal(planSupportsIntraUsers("CONSULTORIO"), true);
    assert.equal(planSupportsIntraUsers("CLINICA"), true);
    assert.equal(planSupportsIntraUsers("BASICO"), true);
    assert.equal(planSupportsIntraUsers("PREMIUM"), true);
  });
});
