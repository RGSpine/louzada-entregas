# Clinical Calm — Guia de linguagem de design (Louzada Entregas)

Linguagem própria **HIG-first**, adaptativa para web (PWA), iOS, Android e desktop (Windows/macOS).

## Princípios

1. **Clareza clínica** — hierarquia tipográfica forte; superfícies grouped list; menos ornamento.
2. **Confiança** — azul médico (`--primary`) + teal clínico (`--clinical` / `--accent`).
3. **Baixa fadiga** — tema automático consultório (7h–19h BRT claro); dark à noite.
4. **Fluidez controlada** — Motion ≤400ms em fluxos críticos; respeitar `prefers-reduced-motion`.
5. **Multiplataforma** — tokens CSS/TS compartilhados; touch ≥44px; safe-area.

## Tokens

| Token | Uso |
|-------|-----|
| `--background` / `--foreground` | Superfície base |
| `--card` | Grouped lists, cards |
| `--primary` | CTAs, links, navegação ativa |
| `--clinical` / `--accent` | IA, chat clínico, estados de processamento |
| `--success` | Confirmação, evolução salva |
| `--warning` | Limites de plano, alertas não críticos |
| `--destructive` | Exclusão, erros graves |
| `--muted` | Fundos secundários, placeholders |

Arquivos: `src/design/tokens.css`, `src/design/tokens.ts`, `apps/mobile/lib/design-tokens.ts`.

## Componentes

- **Button / Card** — elevação leve (`--shadow-elevation-*`), sem skeuomorfismo pesado.
- **ThemeToggle** — auto | claro | escuro | sistema.
- **DashboardDesktopSidebar** — navegação persistente ≥1024px.
- **EvolutionStateTransition / RecordMicButton** — Motion no fluxo de evolução.

## Referências oficiais (adaptação)

- [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) — grouped lists, touch, safe-area.
- Material 3 — elevation leve, estados de superfície (Android/desktop).
- Fluent — densidade moderada em telas largas Windows.

## Anti-padrões (não usar)

- Sombras em 4+ camadas ou inset pesado.
- Cores Tailwind raw (`slate-600`, `blue-600`) em código novo — usar tokens semânticos.
- Animações >400ms em gravação/processamento/revisão.
- Emojis como ícones de navegação (usar Lucide / SF Symbols-like).

## Escopo migrado (2026-06-28)

- Páginas críticas: dashboard hub, new-evolution, patients/[id], clinical-chat, landing
- **Todos** os componentes em `src/components/dashboard/**` (~51 arquivos)
- UI auxiliar: `Sidebar`, `PageHeader`, `ShareButton`, `DashboardPagesMenu`
- **Planos / PWA / Premium:** `src/components/planos/**`, `src/components/pwa/**`, `src/components/premium/**`
- **Upgrade / install / admin:** `UpgradeModal`, `ProFeatureGate`, `install-app/**`, `admin/**`, `src/app/admin/**`
- **Auth:** `src/app/(auth)/**` — login, registro, recuperação de senha, termos, privacidade
- **Varredura global (2026-06-28):** páginas dashboard restantes, `platform-customization`, `como-baixar-app`, `planos` público
- **Gráficos:** `src/lib/chart-colors.ts` — Recharts/uPlot derivados de `clinicalCalmColors`
- **Mobile (completo):** `apps/mobile/**` — `useMobileTheme()` + `useThemedStyles()` (claro/escuro do sistema)
- **Motion P3:** `ClinicalCalmModal`, `UpgradeModal`, `PlanLimitUpgradeModal`, `PwaInstallGuideModal`, `AgendaEditAppointmentModal`, `DashboardHubStagger`
