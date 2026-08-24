"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface TicketSetPanelProps {
  projectId: string;
  selectedVersion: number | null;
  onSelectVersion: (version: number) => void;
}

interface TicketSetSummary {
  version: number;
  current: boolean;
  files: Array<{ filename: string }>;
}

export default function TicketSetPanel({
  projectId,
  selectedVersion,
  onSelectVersion,
}: TicketSetPanelProps) {
  const [versions, setVersions] = useState<TicketSetSummary[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/ticket-sets`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setVersions(data.versions ?? []);
        if (selectedVersion === null && typeof data.currentVersion === "number") {
          onSelectVersion(data.currentVersion);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [onSelectVersion, projectId, selectedVersion]);

  if (versions.length === 0) return null;
  const activeVersion = selectedVersion ?? versions.at(-1)?.version ?? 0;
  return (
    <section className="border-b border-border bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-left text-xs font-semibold text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          Tickets · v{activeVersion}
        </button>
        <a
          href={`/api/projects/${projectId}/ticket-sets/${activeVersion}/download`}
          download
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          下载整套
        </a>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1">
          {versions.map((version) => (
            <Button
              key={version.version}
              type="button"
              variant={version.version === activeVersion ? "secondary" : "ghost"}
              size="sm"
              className="h-7 w-full justify-between px-2 text-xs"
              onClick={() => onSelectVersion(version.version)}
            >
              <span>v{version.version}{version.current ? " · 当前" : ""}</span>
              <span>{version.files.length} 张</span>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
