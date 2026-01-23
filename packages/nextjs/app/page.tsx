"use client";

import type { NextPage } from "next";
import { RaceDashboard } from "~~/app/_components/RaceDashboard";
import { usePresenceHeartbeat } from "~~/hooks/usePresenceHeartbeat";

const Home: NextPage = () => {
  // Track active users for the race coordinator bot (heartbeat every 10 seconds)
  usePresenceHeartbeat(5_000);

  return (
    <div className="flex items-center flex-col grow">
      <RaceDashboard />
    </div>
  );
};

export default Home;
