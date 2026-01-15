"use client";

import type { NextPage } from "next";
import { RaceDashboard } from "~~/app/_components/RaceDashboard";

const RaceView: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <RaceDashboard />
    </div>
  );
};

export default RaceView;
