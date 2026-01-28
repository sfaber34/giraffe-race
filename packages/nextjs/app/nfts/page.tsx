"use client";

import type { NextPage } from "next";
import { RaffeNfts } from "~~/app/_components/RaffeNfts";

const NftsPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <RaffeNfts />
    </div>
  );
};

export default NftsPage;
