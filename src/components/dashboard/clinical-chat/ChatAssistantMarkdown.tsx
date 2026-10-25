"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ChatAssistantMarkdownProps = {
  content: string;
  className?: string;
};

/** Negrito, itálico e listas — sem HTML cru (seguro para saída da IA). */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(
        <Fragment key={`${keyPrefix}-t-${i++}`}>{text.slice(last, match.index)}</Fragment>,
      );
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong
          key={`${keyPrefix}-b-${i++}`}
          className="font-semibold text-foreground"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(
        <em key={`${keyPrefix}-i-${i++}`} className="text-foreground/90 dark:text-foreground">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(<Fragment key={`${keyPrefix}-t-${i++}`}>{text.slice(last)}</Fragment>);
  }
  return parts.length > 0 ? parts : [text];
}

function isBulletLine(line: string): boolean {
  return /^[-*•]\s+/.test(line.trim());
}

function isNumberedLine(line: string): boolean {
  return /^\d+[.)]\s+/.test(line.trim());
}

function stripBullet(line: string): string {
  return line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
}

export function ChatAssistantMarkdown({ content, className }: ChatAssistantMarkdownProps) {
  const blocks = content.split(/\n{2,}/);
  const nodes: ReactNode[] = [];
  let blockIdx = 0;

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    const allBullets = lines.every(isBulletLine);
    const allNumbered = lines.every(isNumberedLine);

    if (allBullets || allNumbered) {
      const ListTag = allNumbered ? "ol" : "ul";
      nodes.push(
        <ListTag
          key={`blk-${blockIdx++}`}
          className={cn(
            "my-2 space-y-1.5 pl-1",
            allNumbered ? "list-decimal pl-5" : "list-disc pl-5",
          )}
        >
          {lines.map((line, li) => (
            <li
              key={li}
              className="text-[0.9375rem] leading-relaxed text-foreground/90 dark:text-foreground"
            >
              {renderInline(stripBullet(line), `li-${blockIdx}-${li}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const joined = lines.join(" ");
    const isDisclaimer =
      joined.includes("Apoio à decisão clínica") || joined.includes("apoio à decisão");

    nodes.push(
      <p
        key={`blk-${blockIdx++}`}
        className={cn(
          "text-[0.9375rem] leading-relaxed",
          isDisclaimer
            ? "mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs italic text-warning/90 dark:border-warning/40 dark:bg-warning/15 dark:text-warning"
            : "text-foreground/90 dark:text-foreground",
        )}
      >
        {lines.map((line, li) => (
          <Fragment key={li}>
            {li > 0 ? <br /> : null}
            {renderInline(line, `p-${blockIdx}-${li}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={cn("space-y-1", className)}>{nodes}</div>;
}
