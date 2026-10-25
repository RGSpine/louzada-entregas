import { PRICING } from "@/lib/plan-pricing-display";
import { LANDING_FAQ } from "@/lib/seo/faq";
import {
  CONTACT_EMAILS,
  ORGANIZATION_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/seo/site-config";

type JsonLd = Record<string, unknown>;

const LOGO_URL = `${SITE_URL}/icons/icon-512.png`;
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

/** Escapa `<` para evitar quebra de `</script>` em `dangerouslySetInnerHTML`. */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function organizationSchema(): JsonLd {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: ORGANIZATION_NAME,
    legalName: ORGANIZATION_NAME,
    brand: {
      "@type": "Brand",
      name: SITE_NAME,
    },
    url: SITE_URL,
    logo: LOGO_URL,
    email: CONTACT_EMAILS.geral,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: CONTACT_EMAILS.suporte,
        availableLanguage: ["Portuguese"],
        areaServed: "BR",
      },
      {
        "@type": "ContactPoint",
        contactType: "privacy",
        email: CONTACT_EMAILS.privacidade,
        availableLanguage: ["Portuguese"],
        areaServed: "BR",
      },
    ],
  };
}

function webSiteSchema(): JsonLd {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "pt-BR",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

function softwareApplicationSchema(): JsonLd {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    applicationCategory: "HealthApplication",
    applicationSubCategory:
      "Copiloto de saúde para profissionais e pacientes",
    operatingSystem: "Web, iOS, Android",
    url: SITE_URL,
    image: OG_IMAGE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "pt-BR",
    audience: [
      { "@type": "MedicalAudience", audienceType: "Clinician" },
      { "@type": "PeopleAudience", audienceType: "Patient" },
    ],
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BRL",
      lowPrice: "15.12",
      highPrice: "273.70",
      offerCount: 5,
    },
    featureList: [
      "Assistente de saúde que conecta profissionais e pacientes",
      "Automações clínicas: evolução por áudio, prontuário, documentos e financeiro",
      "Mapa de Saúde do paciente: exames, tarefas e memória em linguagem clara",
      "Marcação de consultas na vitrine, ligando horário do profissional ao mapa do paciente",
      "Copiloto e gestor de saúde com IA, com revisão humana",
      "Agenda, Evolução Visual e agente clínica Ester no consultório",
      "Conformidade com a LGPD",
    ],
    provider: { "@id": `${SITE_URL}/#organization` },
  };
}

function faqPageSchema(): JsonLd {
  return {
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: LANDING_FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

function brlPrice(display: string): string {
  return display.replace(/\./g, "").replace(",", ".");
}

function planOffer(
  name: string,
  monthlyDisplay: string,
  description: string,
): JsonLd {
  return {
    "@type": "Offer",
    name: `Plano ${name}`,
    description,
    price: brlPrice(monthlyDisplay),
    priceCurrency: "BRL",
    url: `${SITE_URL}/planos`,
    availability: "https://schema.org/InStock",
    eligibleCustomerType: "https://schema.org/BusinessCustomer",
  };
}

/** Schemas globais injetados no layout raiz. */
export function globalJsonLdGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), webSiteSchema()],
  };
}

/** Schemas do gateway em `/` (escolha profissional × paciente). */
export function gatewayPageJsonLdGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      webSiteSchema(),
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#gateway`,
        url: SITE_URL,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#organization` },
        mainEntity: [
          {
            "@type": "WebPage",
            name: "Profissional",
            url: `${SITE_URL}/profissional`,
          },
          {
            "@type": "WebPage",
            name: "Paciente",
            url: `${SITE_URL}/paciente`,
          },
        ],
      },
    ],
  };
}

/** @deprecated Use gatewayPageJsonLdGraph — home agora é o gateway. */
export function homePageJsonLdGraph(): JsonLd {
  return gatewayPageJsonLdGraph();
}

/** Schemas da landing do profissional em `/profissional`. */
export function profissionalPageJsonLdGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [softwareApplicationSchema(), faqPageSchema()],
  };
}

/** Schemas da landing do paciente em `/paciente`. */
export function pacientePageJsonLdGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/paciente#webpage`,
        url: `${SITE_URL}/paciente`,
        name: "Louzada Entregas para pacientes — Mapa de Saúde",
        description:
          "Mapa de Saúde, exames em linguagem clara e marcação de consultas com profissionais na Louzada Entregas.",
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };
}

/** Schemas da página pública de planos. */
export function planosPageJsonLdGraph(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${SITE_URL}/planos#product`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        brand: { "@type": "Brand", name: SITE_NAME },
        url: `${SITE_URL}/planos`,
        image: OG_IMAGE_URL,
        offers: [
          planOffer(
            "Básico",
            PRICING.BASICO.monthly,
            "Evoluções clínicas por áudio, pacientes e documentos IA com limites mensais. 14 dias grátis.",
          ),
          planOffer(
            "Profissional",
            PRICING.PROFISSIONAL.monthly,
            "Agenda semanal, Evolução Visual, documentos IA ilimitados e perfil clínico detalhado.",
          ),
          planOffer(
            "Premium",
            PRICING.PREMIUM.monthly,
            "Assistente financeiro, relatórios de agenda por voz e suporte prioritário.",
          ),
          planOffer(
            "Consultório",
            PRICING.CONSULTORIO.monthly,
            "Plano para equipes com até 5 acessos simultâneos.",
          ),
          planOffer(
            "Clínica",
            PRICING.CLINICA.monthly,
            "Plano para equipes com até 10 acessos simultâneos.",
          ),
        ],
      },
    ],
  };
}
