"use client";

import type { NextPage } from "next";
import { HomeRacePrototype } from "~~/app/_components/HomeRacePrototype";

const Home: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <HomeRacePrototype />
    </div>
  );
};

export default Home;
