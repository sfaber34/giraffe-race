"use client";

import type { NextPage } from "next";
import { AdminDashboard } from "~~/app/_components/AdminDashboard";

const Admin: NextPage = () => {
  return (
    <div className="flex items-center flex-col grow">
      <AdminDashboard />
    </div>
  );
};

export default Admin;
