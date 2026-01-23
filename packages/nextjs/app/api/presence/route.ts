import { NextRequest, NextResponse } from "next/server";

/**
 * Simple presence tracking for active users.
 * Users send heartbeats, and the endpoint returns count of recently active users.
 *
 * Note: This uses in-memory storage, so counts may be approximate across
 * multiple serverless function instances. For production accuracy, use Redis.
 */

// In-memory store: visitorId -> lastSeen timestamp
const activeUsers = new Map<string, number>();

// How long until a user is considered inactive (30 seconds = 3 missed heartbeats)
const INACTIVE_THRESHOLD_MS = 15_000;

// Clean up stale entries periodically
function cleanupStaleUsers() {
  const now = Date.now();
  for (const [id, lastSeen] of activeUsers.entries()) {
    if (now - lastSeen > INACTIVE_THRESHOLD_MS) {
      activeUsers.delete(id);
    }
  }
}

/**
 * POST /api/presence
 * Body: { visitorId: string }
 * Records a heartbeat for the visitor
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const visitorId = body?.visitorId;

    if (!visitorId || typeof visitorId !== "string") {
      return NextResponse.json({ error: "visitorId required" }, { status: 400 });
    }

    // Record heartbeat
    activeUsers.set(visitorId, Date.now());

    // Cleanup stale users
    cleanupStaleUsers();

    return NextResponse.json({ ok: true, activeUsers: activeUsers.size });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

/**
 * GET /api/presence
 * Returns the count of active users (heartbeat within last 60 seconds)
 */
export async function GET() {
  // Cleanup stale users first
  cleanupStaleUsers();

  return NextResponse.json({
    activeUsers: activeUsers.size,
    timestamp: Date.now(),
  });
}
