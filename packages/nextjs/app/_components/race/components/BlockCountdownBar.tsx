"use client";

import { useMemo } from "react";
import { clamp01 } from "../utils";

interface BlockCountdownBarProps {
  label: string;
  current?: bigint;
  start?: bigint;
  end?: bigint;
}

export const BlockCountdownBar = ({ label, current, start, end }: BlockCountdownBarProps) => {
  const progress = useMemo(() => {
    if (current === undefined || start === undefined || end === undefined) return null;
    if (end <= start) return null;
    const p = Number(current - start) / Number(end - start);
    return clamp01(p);
  }, [current, start, end]);

  const remaining = useMemo(() => {
    if (current === undefined || end === undefined) return null;
    if (current >= end) return 0n;
    return end - current;
  }, [current, end]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="opacity-70">{label}</span>
        <span className="font-mono opacity-80">{remaining === null ? "-" : `${remaining.toString()} blocks`}</span>
      </div>
      <progress className="progress progress-primary w-full" value={progress === null ? 0 : progress * 100} max={100} />
    </div>
  );
};
