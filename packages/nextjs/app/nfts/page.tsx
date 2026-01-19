"use client";

import type { NextPage } from "next";
import { GiraffeNfts } from "~~/app/_components/GiraffeNfts";

const NftsPage: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <GiraffeNfts />
    </div>
  );
};

export default NftsPage;
