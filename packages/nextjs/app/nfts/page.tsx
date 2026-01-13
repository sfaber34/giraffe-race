"use client";

import type { NextPage } from "next";
import { AnimalNfts } from "~~/app/_components/AnimalNfts";

const NftsPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <AnimalNfts />
    </div>
  );
};

export default NftsPage;
