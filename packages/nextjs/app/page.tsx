"use client";

import type { NextPage } from "next";
import { AnimalRaceHome } from "~~/app/_components/AnimalRaceHome";

const Home: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <AnimalRaceHome />
    </div>
  );
};

export default Home;
