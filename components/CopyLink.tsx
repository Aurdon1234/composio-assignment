"use client";

import { useState } from "react";

export function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link:", window.location.href);
        }
      }}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {copied ? "Link copied ✓" : "Copy link"}
    </button>
  );
}
