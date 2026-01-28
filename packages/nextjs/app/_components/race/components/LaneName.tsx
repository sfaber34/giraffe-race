"use client";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface LaneNameProps {
  tokenId: bigint;
  fallback: string;
}

export const LaneName = ({ tokenId, fallback }: LaneNameProps) => {
  const enabled = tokenId !== 0n;
  const { data: nameData } = useScaffoldReadContract({
    contractName: "RaffeNFT",
    functionName: "nameOf",
    args: [enabled ? tokenId : undefined],
    query: { enabled },
    watch: false, // Names don't change, no need to watch
  });

  const name = (nameData as string | undefined) ?? "";
  return <span>{name.trim() ? name : fallback}</span>;
};
