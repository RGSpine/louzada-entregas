import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("DashboardNotificationsBell wiring", () => {
  it("está no chrome do dashboard (cobre Menu Principal, Pacientes, Nova Evolução, Ester, Agenda)", () => {
    const chrome = readFileSync(
      join(process.cwd(), "src/components/dashboard/DashboardSubnavChrome.tsx"),
      "utf8",
    );
    const bell = readFileSync(
      join(process.cwd(), "src/components/dashboard/DashboardNotificationsBell.tsx"),
      "utf8",
    );
    assert.match(bell, /export function DashboardNotificationsBell/);
    assert.match(chrome, /DashboardNotificationsBell/);
    assert.match(chrome, /DashboardChromeToolbar/);
  });

  it("server action e lib de feed existem", () => {
    const action = readFileSync(
      join(process.cwd(), "src/app/actions/dashboard-notifications.ts"),
      "utf8",
    );
    const lib = readFileSync(join(process.cwd(), "src/lib/dashboard-notifications.ts"), "utf8");
    const bell = readFileSync(
      join(process.cwd(), "src/components/dashboard/DashboardNotificationsBell.tsx"),
      "utf8",
    );
    assert.match(action, /getDashboardNotifications/);
    assert.match(action, /markDashboardNotificationsAsRead/);
    assert.match(lib, /buildDashboardNotificationsFeed/);
    assert.match(lib, /markDashboardNotificationsRead/);
    assert.match(lib, /action_item/);
    assert.match(lib, /appointment/);
    assert.match(lib, /package_ending/);
    assert.match(lib, /appointmentPushDisplayName/);
    assert.match(lib, /appointmentPushKind/);
    assert.match(bell, /Marcar como lido/);
    assert.match(bell, /handleItemClick|router\.push/);
  });

  it("push copy evita paciente fantasma Google no corpo do lembrete", () => {
    const dispatch = readFileSync(
      join(process.cwd(), "src/lib/push-notifications/dispatch.ts"),
      "utf8",
    );
    const copy = readFileSync(
      join(process.cwd(), "src/lib/push-notifications/copy.ts"),
      "utf8",
    );
    assert.match(dispatch, /appointmentPushDisplayName/);
    assert.match(dispatch, /dispatchDailyAgendaDigest/);
    assert.match(dispatch, /agenda_day_digest/);
    assert.match(copy, /appointmentPatientDisplayName/);
    assert.doesNotMatch(
      dispatch,
      /\$\{patientName\} — \$\{timeLabel\}\$\{appt\.title/,
    );
  });
});
