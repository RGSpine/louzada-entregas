"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  FileText,
  MessageSquarePlus,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ClinicalChatMessageItem } from "@/app/actions/clinical-chat";
import { ChatCitationsList } from "@/components/dashboard/clinical-chat/ChatCitationsList";
import { ChatAssistantMarkdown } from "@/components/dashboard/clinical-chat/ChatAssistantMarkdown";
import { ChatTypingIndicator } from "@/components/dashboard/clinical-chat/ChatTypingIndicator";
import { EsterBrandName } from "@/components/dashboard/clinical-chat/EsterBrandName";
import { ClinicalRecommendationsTrigger } from "@/components/dashboard/clinical-chat/ClinicalRecommendationsTrigger";

type PatientChatThreadProps = {
  patientName: string;
  evolutionCount: number;
  messages: ClinicalChatMessageItem[];
  thinking?: boolean;
  onOpenPatients?: () => void;
  onOpenRecommendations?: () => void;
  onNewConversation?: () => void;
  clearing?: boolean;
};

function formatMessageTime(date: Date): string {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function patientInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

/** Texto limpo para colar no WhatsApp / Instagram (sem marcação markdown). */
function plainTextForClipboard(content: string): string {
  return content
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AssistantCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const text = plainTextForClipboard(content);
    if (!text) {
      toast.error("Nada para copiar nesta resposta.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Resposta copiada.");
      if (resetRef.current) clearTimeout(resetRef.current);
      resetRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Tente novamente.");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => void handleCopy()}
      aria-label={copied ? "Resposta copiada" : "Copiar esta resposta"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{copied ? "Copiado" : "Copiar"}</span>
    </Button>
  );
}

export function PatientChatThread({
  patientName,
  evolutionCount,
  messages,
  thinking = false,
  onOpenPatients,
  onOpenRecommendations,
  onNewConversation,
  clearing = false,
}: PatientChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, thinking]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-muted/80 via-card to-muted/50 dark:from-background dark:via-background dark:to-card/80">
      <header className="shrink-0 border-b border-border/80 bg-card/80 px-3 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3 safe-area-pt">
        <div className="mx-auto flex max-w-3xl items-center gap-2 sm:gap-3">
          {/* Esquerda: lista + paciente */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {onOpenPatients ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg md:hidden"
                onClick={onOpenPatients}
                aria-label="Abrir lista de pacientes"
              >
                <Users className="h-4 w-4" />
              </Button>
            ) : null}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-clinical to-accent text-sm font-bold text-clinical-foreground shadow-sm sm:h-10 sm:w-10"
              aria-hidden
            >
              {patientInitial(patientName)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold leading-tight tracking-tight text-foreground sm:text-base md:text-lg">
                {patientName}
              </h2>
              <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground sm:text-sm">
                <FileText className="mr-1 inline h-3 w-3 shrink-0 align-[-0.1em] sm:h-3.5 sm:w-3.5" aria-hidden />
                {evolutionCount}{" "}
                {evolutionCount === 1 ? "evolução" : "evoluções"} no prontuário
              </p>
            </div>
          </div>

          {/* Direita: Indicações acima de Nova conversa */}
          <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
            {onOpenRecommendations ? (
              <ClinicalRecommendationsTrigger
                variant="header"
                onClick={onOpenRecommendations}
              />
            ) : null}
            {onNewConversation && messages.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg"
                onClick={onNewConversation}
                disabled={clearing || thinking}
                title="Nova conversa"
                aria-label="Iniciar nova conversa"
              >
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !thinking ? (
          <div className="mx-auto flex h-full min-h-[220px] max-w-lg flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-clinical/10 shadow-inner dark:bg-clinical/20">
              <Sparkles className="h-7 w-7 text-clinical" aria-hidden />
            </div>
            <p className="text-2xl font-semibold tracking-tight text-foreground">
              Por onde começamos?
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Pergunte à <EsterBrandName className="text-sm" /> sobre histórico, evolução do caso,
              exames e medicamentos associados ao paciente. Ela cruza o prontuário com referências
              quando relevante.
            </p>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-3xl select-none flex-col gap-6">
            {messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <li
                  key={m.id}
                  className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-2 ring-card dark:ring-background",
                      isUser
                        ? "bg-foreground shadow-md"
                        : "bg-gradient-to-br from-clinical to-accent shadow-md shadow-clinical/20",
                    )}
                    aria-hidden
                  >
                    {isUser ? (
                      <User className="h-4 w-4 text-white" />
                    ) : (
                      <Bot className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-4 py-3.5 shadow-sm",
                      isUser
                        ? "select-text rounded-tr-md bg-primary text-primary-foreground shadow-[var(--shadow-elevation-1)]"
                        : "select-text rounded-tl-md border border-border/90 bg-card",
                    )}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">
                        {m.content}
                      </p>
                    ) : (
                      <>
                        <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                          <EsterBrandName className="text-xs" />
                          <AssistantCopyButton content={m.content} />
                        </div>
                        <ChatAssistantMarkdown content={m.content} />
                      </>
                    )}
                    {!isUser && m.citations && m.citations.length > 0 ? (
                      <ChatCitationsList citations={m.citations} />
                    ) : null}
                    <time
                      className={cn(
                        "mt-2.5 block text-[11px] font-medium uppercase tracking-wide opacity-50",
                        isUser
                          ? "text-right text-primary-foreground"
                          : "text-left text-muted-foreground",
                      )}
                      dateTime={m.createdAt.toISOString()}
                    >
                      {formatMessageTime(m.createdAt)}
                    </time>
                  </div>
                </li>
              );
            })}
            {thinking ? (
              <li className="flex gap-3">
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-clinical to-accent shadow-md ring-2 ring-card dark:ring-background"
                  aria-hidden
                >
                  <Bot className="h-4 w-4 animate-pulse text-clinical-foreground" />
                </div>
                <div className="rounded-2xl rounded-tl-md border border-clinical/30 bg-card px-4 py-3.5 shadow-[var(--shadow-elevation-1)]">
                  <div className="mb-2 flex items-center gap-1.5 border-b border-border/60 pb-2">
                    <EsterBrandName className="text-xs" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ChatTypingIndicator />
                    Analisando prontuário, exames e medicamentos…
                  </div>
                </div>
              </li>
            ) : null}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}
