"use client";

import { useMemo } from "react";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-eth";

/**
 * Hook to get the USDC contract info regardless of whether it's MockUSDC (local) or real USDC (Base).
 * This abstracts away the contract name differences between networks.
 *
 * On local network (31337): Uses MockUSDC from deployedContracts
 * On Base (8453): Uses USDC from externalContracts
 * On Base Sepolia (84532): Uses USDC from externalContracts
 */
export function useUsdcContract() {
  const { targetNetwork } = useTargetNetwork();

  // Try to get MockUSDC (for local networks)
  const { data: mockUsdcContract, isLoading: isLoadingMock } = useDeployedContractInfo({
    contractName: "MockUSDC" as any,
  });

  // Try to get USDC (for external networks like Base)
  const { data: usdcContract, isLoading: isLoadingUsdc } = useDeployedContractInfo({
    contractName: "USDC" as any,
  });

  // Determine which contract to use based on network and availability
  const contract = useMemo(() => {
    // For Base networks, prefer real USDC
    if (targetNetwork.id === 8453 || targetNetwork.id === 84532) {
      return usdcContract ?? mockUsdcContract;
    }
    // For local/other networks, prefer MockUSDC
    return mockUsdcContract ?? usdcContract;
  }, [targetNetwork.id, mockUsdcContract, usdcContract]);

  const isLoading = isLoadingMock || isLoadingUsdc;

  // Determine the contract name being used (for useScaffoldWriteContract)
  const contractName = useMemo(() => {
    if (targetNetwork.id === 8453 || targetNetwork.id === 84532) {
      return usdcContract ? ("USDC" as const) : mockUsdcContract ? ("MockUSDC" as const) : null;
    }
    return mockUsdcContract ? ("MockUSDC" as const) : usdcContract ? ("USDC" as const) : null;
  }, [targetNetwork.id, mockUsdcContract, usdcContract]);

  return {
    data: contract,
    isLoading,
    contractName,
    isExternalUsdc: contractName === "USDC",
    isMockUsdc: contractName === "MockUSDC",
  };
}
