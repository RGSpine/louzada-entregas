"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BackNavLink } from "@/components/navigation/BackNav";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header com botão voltar */}
        <div className="mb-8">
          <BackNavLink href="/register" label="Voltar ao Cadastro" className="mb-6" />
          
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Termos de Uso
          </h1>
          <p className="text-muted-foreground">
            Última atualização: 28 de maio de 2026
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            O tratamento de dados pessoais está descrito na{" "}
            <Link href="/privacidade" className="text-primary hover:underline">
              Política de Privacidade
            </Link>
            , incluindo a integração opcional com Google (login parcial e Google Agenda).
          </p>
        </div>

        {/* Conteúdo dos Termos */}
        <div className="bg-card border border-border rounded-xl p-6 md:p-8 space-y-6 text-foreground/90">
          
          {/* 1. Aceitação dos Termos */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              1. Aceitação dos Termos
            </h2>
            <p className="mb-3">
              Ao acessar e utilizar a plataforma Louzada Entregas (&quot;Plataforma&quot;), você
              (&quot;Usuário&quot; ou &quot;Profissional de Saúde&quot;) concorda com estes Termos de Uso e com a{" "}
              <Link href="/privacidade" className="text-primary hover:underline">
                Política de Privacidade
              </Link>
              . Caso não concorde, não deverá utilizar nossos serviços.
            </p>
            <p>
              A Louzada Entregas é uma plataforma de Software como Serviço (SaaS) destinada a profissionais de saúde 
              para auxiliar na criação de evoluções clínicas por meio de tecnologia de inteligência artificial.
            </p>
          </section>

          {/* 2. Definições */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Definições
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong>Dados Pessoais do Usuário:</strong> informações fornecidas pelo profissional de saúde durante 
              o cadastro (nome, e-mail, telefone, profissão, número do conselho, endereço de atendimento, etc.).</li>
              <li><strong>Dados de Pacientes:</strong> informações clínicas inseridas na plataforma pelo Usuário 
              para geração de evoluções (transcrições de áudio, exames, laudos, etc.).</li>
              <li><strong>Dados Sensíveis:</strong> conforme a LGPD, dados referentes à saúde, dados genéticos ou 
              biométricos vinculados a uma pessoa natural.</li>
            </ul>
          </section>

          {/* 3. Integrações opcionais (Google) */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              3. Integrações opcionais (Google)
            </h2>
            <p className="mb-3">
              Funcionalidades de login/cadastro com Google (nome e e-mail) e de sincronização com Google Agenda são{" "}
              <strong>opcionais</strong> e só são ativadas quando o profissional clica em &quot;Conectar Google&quot;.
              O detalhe dos dados tratados, escopos OAuth, revogação e conformidade com a política Google está na{" "}
              <Link href="/privacidade#integracao-google" className="text-primary hover:underline">
                seção Integração Google da Política de Privacidade
              </Link>
              .
            </p>
          </section>

          {/* 4. Proteção de Dados dos Pacientes */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              4. Proteção de Dados dos Pacientes (LGPD)
            </h2>
            <p className="mb-3">
              A Louzada Entregas está comprometida com a proteção de dados pessoais em conformidade com a 
              Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD) e demais regulamentações aplicáveis.
            </p>
            <div className="bg-success/10 border border-success/30 rounded-lg p-4 mb-3">
              <p className="text-success font-medium mb-2">Compromisso de Proteção:</p>
              <ul className="list-disc list-inside space-y-1 text-success">
                <li>Os dados de pacientes inseridos na plataforma são de responsabilidade exclusiva do Usuário.</li>
                <li>A Louzada Entregas <strong>NÃO</strong> acessa, compartilha ou comercializa dados clínicos de pacientes.</li>
                <li>Os dados de pacientes são processados de forma volátil pela IA e não são armazenados permanentemente 
                em nossos servidores de forma identificável.</li>
                <li>Apenas o Usuário (profissional de saúde) tem acesso aos dados e evoluções de seus pacientes.</li>
                <li>Administradores da plataforma podem visualizar apenas estatísticas agregadas (número total de 
                pacientes e evoluções), sem acesso a dados identificáveis.</li>
              </ul>
            </div>
            <p>
              O Usuário é o controlador dos dados de seus pacientes e deve garantir que possui base legal 
              adequada para o tratamento desses dados, conforme as normas do seu conselho profissional e a LGPD.
            </p>
          </section>

          {/* 5. Dados do Profissional */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              5. Coleta e Uso de Dados do Profissional
            </h2>
            <p className="mb-3">
              Ao se cadastrar na plataforma, o Usuário fornece dados pessoais e profissionais que serão utilizados para:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2 mb-3">
              <li>Identificação e autenticação na plataforma;</li>
              <li>Geração de documentos clínicos personalizados (evoluções com dados do profissional);</li>
              <li>Comunicações relacionadas ao serviço (suporte, atualizações, novidades);</li>
              <li>Melhoria contínua da plataforma e experiência do usuário;</li>
              <li>Cumprimento de obrigações legais e regulatórias.</li>
            </ul>
          </section>

          {/* 6. Comunicações e Marketing */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              6. Comunicações e Marketing
            </h2>
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-3">
              <p className="text-primary font-medium mb-2">Consentimento para Comunicações:</p>
              <p className="text-primary">
                Ao aceitar estes termos, o Usuário autoriza expressamente a Louzada Entregas a:
              </p>
              <ul className="list-disc list-inside space-y-1 text-primary mt-2">
                <li>Enviar comunicações por e-mail e/ou telefone (SMS, WhatsApp) sobre o serviço;</li>
                <li>Enviar informações sobre novidades, atualizações e novas funcionalidades;</li>
                <li>Enviar ofertas, promoções e comunicações de marketing relacionadas à plataforma;</li>
                <li>Segmentar comunicações com base na profissão informada no cadastro.</li>
              </ul>
            </div>
            <p className="mb-3">
              O Usuário pode, a qualquer momento, optar por não receber comunicações de marketing 
              entrando em contato através do e-mail suporte@aievolui.com.br ou utilizando o link de 
              descadastramento presente nas comunicações.
            </p>
            <p className="text-muted-foreground text-sm">
              <strong>Nota:</strong> Comunicações essenciais ao funcionamento do serviço (alertas de segurança, 
              atualizações de termos, informações sobre a conta) continuarão sendo enviadas independentemente 
              da opção de marketing.
            </p>
          </section>

          {/* 7. Compartilhamento de Dados */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              7. Compartilhamento de Dados
            </h2>
            <p className="mb-3">
              Os dados pessoais do Usuário (profissional de saúde) poderão ser compartilhados com:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2 mb-3">
              <li>Provedores de serviços essenciais ao funcionamento da plataforma 
              (processamento de pagamentos, hospedagem, análise de dados);</li>
              <li>Autoridades públicas, quando exigido por lei ou ordem judicial;</li>
              <li>Parceiros comerciais para fins de marketing e ofertas relevantes ao seu segmento profissional, 
              limitando-se a dados de contato e profissão.</li>
            </ul>
            <p className="text-sm text-success">
              <strong>Importante:</strong> Em nenhuma hipótese os dados de pacientes serão compartilhados 
              com terceiros, exceto por determinação legal expressa.
            </p>
          </section>

          {/* 8. Segurança */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              8. Segurança dos Dados
            </h2>
            <p className="mb-3">
              A Louzada Entregas implementa medidas técnicas e organizacionais adequadas para proteger os dados pessoais, 
              incluindo:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Criptografia de dados em trânsito (HTTPS/TLS) e em repouso;</li>
              <li>Controle de acesso baseado em funções;</li>
              <li>Monitoramento e logs de segurança;</li>
              <li>Backups regulares e planos de recuperação de desastres;</li>
              <li>Treinamento da equipe em proteção de dados.</li>
            </ul>
          </section>

          {/* 9. Direitos do Titular */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              9. Direitos do Titular dos Dados
            </h2>
            <p className="mb-3">
              Conforme a LGPD, o Usuário possui direitos em relação aos seus dados pessoais. Detalhes e contato
              para exercício:{" "}
              <Link href="/privacidade" className="text-primary hover:underline">
                Política de Privacidade
              </Link>
              .
            </p>
          </section>

          {/* 10. Responsabilidades do Usuário */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              10. Responsabilidades do Usuário
            </h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Fornecer informações verdadeiras e atualizadas no cadastro;</li>
              <li>Manter a confidencialidade de suas credenciais de acesso;</li>
              <li>Utilizar a plataforma de forma ética e em conformidade com as normas do seu conselho profissional;</li>
              <li>Garantir o consentimento adequado de seus pacientes para tratamento de dados;</li>
              <li>Não utilizar a plataforma para fins ilícitos ou que violem direitos de terceiros.</li>
            </ul>
          </section>

          {/* 11. Limitação de Responsabilidade */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              11. Limitação de Responsabilidade
            </h2>
            <p className="mb-3">
              A Louzada Entregas é uma ferramenta de auxílio à documentação clínica. O conteúdo gerado pela inteligência 
              artificial deve ser revisado e validado pelo profissional de saúde antes de ser utilizado.
            </p>
            <p>
              A plataforma não substitui o julgamento clínico profissional e não se responsabiliza por 
              decisões clínicas baseadas exclusivamente nas sugestões da IA.
            </p>
          </section>

          {/* 12. Alterações nos Termos */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              12. Alterações nos Termos
            </h2>
            <p>
              A Louzada Entregas reserva-se o direito de modificar estes Termos a qualquer momento. 
              Alterações significativas serão comunicadas por e-mail ou através da plataforma. 
              O uso continuado dos serviços após a publicação de alterações constitui aceitação dos novos termos.
            </p>
          </section>

          {/* 13. Contato */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              13. Contato
            </h2>
            <p className="mb-3">
              Para dúvidas, sugestões ou exercício de direitos relacionados a estes Termos ou à 
              proteção de dados, entre em contato:
            </p>
            <ul className="space-y-1 ml-2">
              <li><strong>E-mail geral:</strong> <span className="text-primary">contato@aievolui.com.br</span></li>
              <li><strong>Privacidade e dados:</strong> <span className="text-primary">privacidade@aievolui.com.br</span></li>
              <li><strong>Suporte:</strong> <span className="text-primary">suporte@aievolui.com.br</span></li>
            </ul>
          </section>

          {/* 14. Foro */}
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              14. Foro
            </h2>
            <p>
              Fica eleito o foro da Comarca de São Paulo, Estado de São Paulo, para dirimir quaisquer 
              controvérsias oriundas destes Termos, com renúncia expressa a qualquer outro, por mais 
              privilegiado que seja.
            </p>
          </section>

        </div>

        <div className="mt-8 flex flex-wrap gap-4 justify-center">
          <Link
            href="/privacidade"
            className="inline-flex items-center gap-2 border border-border px-6 py-3 rounded-lg font-medium transition-colors hover:bg-muted"
          >
            Política de Privacidade
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao Cadastro
          </Link>
        </div>
      </div>
    </div>
  );
}
