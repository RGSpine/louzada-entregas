"use client";

import { useRouter } from "next/navigation";
import { BackNavButton } from "@/components/navigation/BackNav";

interface PageHeaderProps {
  title: string;
  showBack?: boolean;
}

export function PageHeader({ title, showBack = true }: PageHeaderProps) {
  const router = useRouter();

  return (
    <div className="mb-8 flex items-center gap-4">
      {showBack ? <BackNavButton onClick={() => router.back()} /> : null}
      <h1 className="text-3xl font-bold text-foreground">{title}</h1>
    </div>
  );
}
