"use client";

import Link from "next/link";
import { BackNavLink } from "@/components/navigation/BackNav";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <BackNavLink href="/" className="mb-6" />

          <h1 className="text-3xl font-bold text-foreground mb-2">
            Política de Privacidade
          </h1>
          <p className="text-muted-foreground">
            Louzada Entregas — <span className="font-medium">localhost:3000</span>
          </p>
          <p className="text-muted-foreground mt-1">
            Última atualização: 28 de maio de 2026
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            Documento complementar aos{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Termos de Uso
            </Link>
            .
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6 text-foreground/90">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              1. Quem somos e escopo
            </h2>
            <p className="mb-3">
              A <strong>Louzada Entregas</strong> (&quot;Plataforma&quot;, &quot;nós&quot;) é um software como serviço (SaaS)
              para profissionais de saúde, disponível em{" "}
              <strong>http://localhost:3000</strong>, operado por Spine Labs / AI Evolui.
            </p>
            <p>
              Esta Política descreve como tratamos <strong>dados pessoais</strong> de profissionais de saúde
              (usuários da conta) e, de forma indireta, dados inseridos por esses profissionais sobre seus pacientes.
              O profissional permanece controlador dos dados clínicos de pacientes perante a LGPD.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Dados que coletamos
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <strong>Cadastro e conta:</strong> nome, e-mail, telefone, profissão, conselho profissional,
                endereço de atendimento, credenciais de acesso (via Supabase Auth).
              </li>
              <li>
                <strong>Uso da plataforma:</strong> evoluções clínicas, áudios, documentos, agenda de consultas,
                dados financeiros do consultório, metadados de uso e logs de segurança.
              </li>
              <li>
                <strong>Pagamentos:</strong> dados processados pela Stripe (não armazenamos números completos de cartão).
              </li>
              <li>
                <strong>Integração Google (opcional):</strong> tokens OAuth e identificadores de eventos/arquivos,
                conforme a seção 8.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              3. Finalidades e bases legais (LGPD)
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Prestação do contrato e funcionalidades solicitadas pelo profissional (Art. 7º, V).</li>
              <li>Autenticação, segurança e prevenção a fraudes (Art. 7º, IX).</li>
              <li>Comunicações sobre o serviço e, com consentimento, marketing (Art. 7º, I).</li>
              <li>Integrações opcionais autorizadas pelo profissional, como Google Agenda (Art. 7º, I).</li>
              <li>Cumprimento de obrigações legais (Art. 7º, II).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              4. Dados de pacientes
            </h2>
            <p className="mb-3">
              Dados clínicos de pacientes são inseridos pelo profissional. A Louzada Entregas atua predominantemente como{" "}
              <strong>operadora</strong> nesse tratamento, limitando-se a processar e armazenar conforme instruções
              do profissional e contrato.
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Não comercializamos dados clínicos de pacientes.</li>
              <li>Não compartilhamos conteúdo clínico identificável com terceiros para marketing.</li>
              <li>
                Administradores acessam apenas estatísticas agregadas quando aplicável, não o prontuário individual.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              5. Compartilhamento com subprocessadores
            </h2>
            <p className="mb-3">Utilizamos provedores essenciais, entre outros:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Supabase (autenticação e armazenamento)</li>
              <li>PostgreSQL hospedado (dados da aplicação)</li>
              <li>Stripe (pagamentos)</li>
              <li>Google (Gemini — processamento de IA, conforme funcionalidades usadas)</li>
              <li>Google (OAuth — login parcial e Agenda, somente se o profissional autorizar)</li>
              <li>Vercel (hospedagem)</li>
            </ul>
            <p className="mt-3 text-sm">
              Contratos e medidas de segurança são adotados conforme natureza sensível dos dados tratados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              6. Segurança
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Criptografia em trânsito (HTTPS/TLS)</li>
              <li>Controle de acesso autenticado e segregação por profissional</li>
              <li>Segredos de API apenas no servidor (sem exposição no navegador)</li>
              <li>Rate limiting em rotas sensíveis e validação de entrada</li>
              <li>Tokens OAuth Google armazenados no banco de dados do servidor, não no cliente</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              7. Retenção e exclusão
            </h2>
            <p className="mb-3">
              Mantemos dados enquanto a conta estiver ativa e conforme obrigações legais. O profissional pode solicitar
              exclusão da conta; tokens Google são revogáveis a qualquer momento pelo próprio usuário na conta Google.
            </p>
          </section>

          <section id="integracao-google">
            <h2 className="text-xl font-semibold text-foreground mb-3">
              8. Integração Google (opcional) — Login e Agenda
            </h2>
            <p className="mb-3">
              A Louzada Entregas usa a conta Google em <strong>dois fluxos distintos</strong>, ambos voluntários:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2 mb-4">
              <li>
                <strong>Login ou cadastro parcial:</strong> em <strong>Entrar</strong> ou <strong>Cadastrar</strong>,
                o profissional pode usar &quot;Continuar com Google&quot; para obter nome e e-mail e completar o perfil
                na plataforma. Não acessamos Google Agenda nem outros dados Google neste fluxo.
              </li>
              <li>
                <strong>Agenda profissional:</strong> em <strong>Agenda → Conectar Google</strong>, o profissional
                autoriza a sincronização com o Google Agenda. Sem essa ação separada, não lemos nem escrevemos eventos
                no calendário Google.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">
              8.1 Escopos OAuth solicitados
            </h3>
            <ul className="list-disc list-inside space-y-2 ml-2 mb-4">
              <li>
                <code className="text-sm bg-muted px-1 rounded">openid</code>,{" "}
                <code className="text-sm bg-muted px-1 rounded">email</code>,{" "}
                <code className="text-sm bg-muted px-1 rounded">profile</code> — no login/cadastro com Google
                (identificar nome e e-mail) e na ligação da Agenda (associar a conta Google correta).
              </li>
              <li>
                <code className="text-sm bg-muted px-1 rounded">
                  https://www.googleapis.com/auth/calendar.events
                </code>{" "}
                — apenas na ligação da Agenda: sincronizar <strong>marcações de consulta</strong> entre a agenda da
                Louzada Entregas e o calendário principal (<em>primary</em>) do Google Agenda do profissional.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">
              8.2 Google Calendar — o que fazemos
            </h3>
            <ul className="list-disc list-inside space-y-2 ml-2 mb-4">
              <li>
                <strong>Enviar para o Google:</strong> ao criar, editar ou cancelar uma marcação na Louzada Entregas, podemos
                criar, atualizar ou remover o evento correspondente no Google Agenda do profissional.
              </li>
              <li>
                <strong>Dados no evento:</strong> título (ex.: &quot;Consulta — [nome do paciente]&quot; ou título
                definido pelo profissional), data/hora de início e fim, fuso horário, descrição genérica
                &quot;Louzada Entregas&quot;. <strong>Não</strong> enviamos prontuário, evolução clínica completa, diagnósticos
                ou anexos clínicos para o Google Calendar.
              </li>
              <li>
                <strong>Importar do Google:</strong> se o profissional usar &quot;Importar do Google&quot; ou
                sincronização automática, lemos eventos com hora definida no calendário principal (janela configurada
                no servidor, tipicamente 7 dias passados a 90 dias futuros) e criamos/atualizamos marcações na Louzada Entregas
                com origem <em>Google Sync</em>. Marcações criadas manualmente na Louzada Entregas não são sobrescritas por
                importação.
              </li>
              <li>
                <strong>Fonte de verdade:</strong> para conflitos de horário, a agenda interna da Louzada Entregas prevalece.
              </li>
              <li>
                Armazenamos o identificador do evento Google (<code className="text-sm">googleCalendarEventId</code>)
                para evitar duplicações e permitir atualizações.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">
              8.3 Tokens e armazenamento
            </h3>
            <p className="mb-3">
              Tokens de acesso e atualização OAuth são guardados de forma segura na base de dados do servidor (tabela
              de contas OAuth), associados apenas ao profissional que autorizou. São usados exclusivamente para as
              operações descritas acima enquanto a ligação estiver ativa.
            </p>

            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">
              8.4 Revogação
            </h3>
            <p className="mb-3">
              O profissional pode revogar o acesso a qualquer momento em{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://myaccount.google.com/permissions
              </a>
              . Após revogação, deixamos de sincronizar com Google até nova autorização.
            </p>

            <h3 className="text-lg font-medium text-foreground mt-4 mb-2">
              8.5 Google API Services User Data Policy
            </h3>
            <p>
              O uso de dados obtidos via Google APIs cumpre a{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , incluindo requisitos de Limited Use: não utilizamos dados Google para publicidade, não vendemos esses
              dados e limitamos o uso ao funcionamento descrito nesta política.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              9. Direitos do titular (LGPD)
            </h2>
            <p className="mb-3">
              Você pode solicitar acesso, correção, exclusão, portabilidade, informação sobre compartilhamentos e
              revogação de consentimento:
            </p>
            <p>
              <strong>privacidade@aievolui.com.br</strong>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              10. Alterações desta política
            </h2>
            <p>
              Podemos atualizar esta Política. Alterações relevantes serão comunicadas por e-mail ou na plataforma.
              A data de &quot;Última atualização&quot; no topo será revisada.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              11. Contato
            </h2>
            <ul className="space-y-1 ml-2">
              <li>
                <strong>Privacidade e dados:</strong>{" "}
                <span className="text-primary">privacidade@aievolui.com.br</span>
              </li>
              <li>
                <strong>Contato geral:</strong>{" "}
                <span className="text-primary">contato@aievolui.com.br</span>
              </li>
              <li>
                <strong>Suporte:</strong>{" "}
                <span className="text-primary">suporte@aievolui.com.br</span>
              </li>
            </ul>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 justify-center">
          <Link
            href="/terms"
            className="inline-flex items-center gap-2 border border-border px-6 py-3 rounded-lg font-medium transition-colors hover:bg-muted"
          >
            Termos de Uso
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </div>
  );
}
