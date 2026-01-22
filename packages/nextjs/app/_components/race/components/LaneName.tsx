"use client";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

interface LaneNameProps {
  tokenId: bigint;
  fallback: string;
}

export const LaneName = ({ tokenId, fallback }: LaneNameProps) => {
  const enabled = tokenId !== 0n;
  const { data: nameData } = useScaffoldReadContract({
    contractName: "GiraffeNFT",
    functionName: "nameOf",
    args: [enabled ? tokenId : undefined],
    query: { enabled },
  });

  const name = (nameData as string | undefined) ?? "";
  return <span>{name.trim() ? name : fallback}</span>;
};
