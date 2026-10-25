"use client";

import { useRef, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { landingPanelMobileLeadAccentClass } from "@/components/landing/landing-panel-styles";
import type { InstallTutorialDef } from "@/lib/app-install-tutorials";
import { cn } from "@/lib/utils";

type Props = {
  tutorial: InstallTutorialDef;
};

type VideoStatus = "loading" | "ready" | "missing";

export function InstallTutorialCard({ tutorial }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<VideoStatus>("loading");

  function openTutorial() {
    const el = videoRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (status === "ready") {
      void el.play().catch(() => undefined);
    }
  }

  return (
    <Card id={tutorial.id} className="flex flex-col border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Smartphone className="h-5 w-5 text-primary" aria-hidden />
          {tutorial.title}
        </CardTitle>
        <p className={cn("text-sm leading-relaxed", landingPanelMobileLeadAccentClass)}>
          Tutorial em vídeo passo a passo
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <video
            ref={videoRef}
            src={tutorial.videoSrc}
            className="h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            poster={tutorial.posterSrc}
            onLoadedMetadata={() => setStatus("ready")}
            onError={() => setStatus("missing")}
          />

          {status === "loading" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60">
              <Loader2 className="h-8 w-8 animate-spin text-foreground" aria-hidden />
              <p className="text-xs text-foreground/90">Carregando vídeo…</p>
            </div>
          )}

          {status === "missing" && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <p className="text-sm font-medium text-muted-foreground">Em breve</p>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full font-semibold text-primary"
          onClick={openTutorial}
          disabled={status === "missing"}
        >
          {tutorial.buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
