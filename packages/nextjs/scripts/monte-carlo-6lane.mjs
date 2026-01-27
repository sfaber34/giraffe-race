import os from "node:os";

/**
 * CLI Monte Carlo probability calculator for 6-lane giraffe races.
 * Outputs raw Win, Place, and Show probabilities for each lane in basis points.
 * These probabilities are meant to be committed on-chain; the contract applies house edge.
 *
 * Usage examples:
 *   node packages/nextjs/scripts/monte-carlo-6lane.mjs --scores 10,10,10,10,10,10 --samples 50000
 *   node packages/nextjs/scripts/monte-carlo-6lane.mjs --scores 1,5,7,8,9,10 --samples 100000 --json
 *
 * Output:
 *   - Win probability: chance of finishing 1st
 *   - Place probability: chance of finishing 1st OR 2nd
 *   - Show probability: chance of finishing 1st, 2nd, OR 3rd
 *
 * Dead Heat Rules:
 *   - If tied for last qualifying position, probability is split
 *   - Example: 2-way tie for 2nd → each gets 0.5 credit for Place
 *
 * Note: House edge is NOT applied here. The contract applies edge when converting
 * probabilities to odds: odds = (1 - houseEdge) / probability
 */

const LANE_COUNT = 6;
const SPEED_RANGE = 10;
const TRACK_LENGTH = 1000;
const FINISH_OVERSHOOT = 10; // Run until last place is this far past finish
const MAX_TICKS = 500;

// -----------------------
// Fast PRNG (xorshift128) - ~10-50x faster than keccak256
// -----------------------

class FastRng {
  constructor(seed) {
    // Initialize state from numeric seed
    this.s0 = seed >>> 0 || 0x12345678;
    this.s1 = Math.imul(seed, 0x85ebca6b) >>> 0 || 0x9abcdef0;
    this.s2 = Math.imul(seed, 0xc2b2ae35) >>> 0 || 0xdeadbeef;
    this.s3 = Math.imul(seed, 0x27d4eb2f) >>> 0 || 0xcafebabe;
    // Warm up
    for (let i = 0; i < 20; i++) this.next();
  }

  // xorshift128 - returns 32-bit unsigned integer
  next() {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.s0 = (t ^ s ^ (s >>> 19)) >>> 0;
    return this.s0;
  }

  // Returns random integer in [0, n-1]
  roll(n) {
    if (n <= 1) return 0;
    return this.next() % n;
  }
}

// -----------------------
// Fast seed generator (splitmix32)
// -----------------------

function splitmix32Next(state) {
  state.x = (state.x + 0x9e3779b9) >>> 0;
  let z = state.x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

// -----------------------
// Score/BPS helpers
// -----------------------

function clampScore(r) {
  const x = Math.floor(Number(r));
  if (!Number.isFinite(x) || x < 1) return 1;
  if (x > 10) return 10;
  return x;
}

// Match Solidity/TS: minBps + (score-1) * (10000-minBps) / 9
function scoreBps(score) {
  const r = clampScore(score);
  const minBps = 9585; // 0.9585x at score=1
  const range = 10_000 - minBps; // 415
  return minBps + Math.floor(((r - 1) * range) / 9);
}

// -----------------------
// Full race simulation (runs until ALL racers finish)
// -----------------------

/**
 * @typedef {Object} PositionInfo
 * @property {number[]} lanes - Lane indices in this position
 * @property {number} count - Number of lanes tied
 */

/**
 * @typedef {Object} FinishOrder
 * @property {PositionInfo} first
 * @property {PositionInfo} second
 * @property {PositionInfo} third
 */

/**
 * Simulate a full race and return the finish order.
 * Runs until ALL racers are past TRACK_LENGTH + FINISH_OVERSHOOT.
 *
 * @param {number} seed - Numeric seed for RNG
 * @param {number[]} scores - Array of 6 scores (1-10)
 * @returns {{ finishOrder: FinishOrder, finalDistances: number[] }}
 */
function simulateFullRace(seed, scores) {
  const rng = new FastRng(seed);
  const distances = [0, 0, 0, 0, 0, 0];
  const bps = [
    scoreBps(scores[0]),
    scoreBps(scores[1]),
    scoreBps(scores[2]),
    scoreBps(scores[3]),
    scoreBps(scores[4]),
    scoreBps(scores[5]),
  ];

  const finishLine = TRACK_LENGTH + FINISH_OVERSHOOT;

  // Run until ALL racers have finished
  for (let t = 0; t < MAX_TICKS; t++) {
    // Check if all finished
    let allFinished = true;
    for (let a = 0; a < LANE_COUNT; a++) {
      if (distances[a] < finishLine) {
        allFinished = false;
        break;
      }
    }
    if (allFinished) break;

    // Move each racer
    for (let a = 0; a < LANE_COUNT; a++) {
      const r = rng.roll(SPEED_RANGE); // 0..9
      const baseSpeed = r + 1; // 1..10

      // Apply handicap with probabilistic rounding
      const raw = baseSpeed * bps[a];
      let q = Math.floor(raw / 10_000);
      const rem = raw % 10_000;
      if (rem > 0) {
        const pick = rng.roll(10_000);
        if (pick < rem) q += 1;
      }
      distances[a] += q > 0 ? q : 1;
    }
  }

  // Calculate finish order from final distances
  const finishOrder = calculateFinishOrder(distances);

  return { finishOrder, finalDistances: distances };
}

/**
 * Calculate finish order with dead heat handling.
 * Groups lanes by their final distance (higher = better).
 *
 * @param {number[]} distances
 * @returns {FinishOrder}
 */
function calculateFinishOrder(distances) {
  // Sort lanes by distance (descending - higher distance = better)
  const sorted = distances.map((d, i) => ({ lane: i, distance: d })).sort((a, b) => b.distance - a.distance);

  // Group by distance for dead heat detection
  const groups = [];
  let currentGroup = { distance: sorted[0].distance, lanes: [sorted[0].lane] };

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].distance === currentGroup.distance) {
      currentGroup.lanes.push(sorted[i].lane);
    } else {
      groups.push(currentGroup);
      currentGroup = { distance: sorted[i].distance, lanes: [sorted[i].lane] };
    }
  }
  groups.push(currentGroup);

  // Assign positions
  const first = { lanes: [], count: 0 };
  const second = { lanes: [], count: 0 };
  const third = { lanes: [], count: 0 };

  let position = 0;
  for (const group of groups) {
    if (position === 0) {
      // First place
      first.lanes = group.lanes;
      first.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 1) {
      // Second place (or tied for first overflowing)
      second.lanes = group.lanes;
      second.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position === 2) {
      // Third place
      third.lanes = group.lanes;
      third.count = group.lanes.length;
      position += group.lanes.length;
    } else if (position >= 3) {
      break; // We have all we need
    }
  }

  return { first, second, third };
}

// -----------------------
// Probability accumulators with dead heat rules
// -----------------------

/**
 * @typedef {Object} LaneStats
 * @property {number} winCredits - Sum of 1/N for each 1st place (N = # tied)
 * @property {number} placeCredits - Sum of credits for 1st or 2nd (with dead heat splits)
 * @property {number} showCredits - Sum of credits for 1st, 2nd, or 3rd (with dead heat splits)
 */

/**
 * Update lane stats based on finish order with STANDARD dead heat rules.
 *
 * Standard Dead Heat Rules (matches real horse racing):
 * - If your animal's position CLEARLY qualifies → full payout
 * - If your animal TIED for the LAST qualifying position → payout ÷ (number tied)
 *
 * WIN (position 1 only):
 * - Single 1st → full credit
 * - Tied for 1st → split credit (1/N each)
 *
 * PLACE (positions 1-2):
 * - Position 1 → always full credit
 * - Position 2 (no tie) → full credit
 * - Tied for 2nd → split one credit among all tied
 * - Note: If 2+ tied for 1st, they occupy ALL place spots (no split needed for them)
 *
 * SHOW (positions 1-3):
 * - Positions 1-2 → always full credit
 * - Position 3 (no tie) → full credit
 * - Tied for 3rd → split one credit among all tied
 *
 * @param {LaneStats[]} stats
 * @param {FinishOrder} finishOrder
 */
function accumulateStats(stats, finishOrder) {
  const { first, second, third } = finishOrder;

  // ===== WIN (1 spot) =====
  // Tied for 1st? Split the single win credit
  const winShare = 1 / first.count;
  for (const lane of first.lanes) {
    stats[lane].winCredits += winShare;
  }

  // ===== PLACE (2 spots total) =====
  const placeSpots = 2;
  let placeUsed = 0;

  // First group
  if (first.count <= placeSpots) {
    // All first-placers fit in Place spots → full credit each
    for (const lane of first.lanes) {
      stats[lane].placeCredits += 1;
    }
    placeUsed = first.count;
  } else {
    // More tied for first than Place spots → they're tied for LAST qualifying position
    // Split the available spots among them
    const placeShare = placeSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].placeCredits += placeShare;
    }
    placeUsed = placeSpots; // All spots filled
  }

  // Second group (only if Place spots remain)
  const placeRemaining = placeSpots - placeUsed;
  if (placeRemaining > 0 && second.count > 0) {
    if (second.count <= placeRemaining) {
      // All fit → full credit each
      for (const lane of second.lanes) {
        stats[lane].placeCredits += 1;
      }
    } else {
      // Tied for last qualifying Place position → split remaining spots
      const placeShare = placeRemaining / second.count;
      for (const lane of second.lanes) {
        stats[lane].placeCredits += placeShare;
      }
    }
  }

  // ===== SHOW (3 spots total) =====
  const showSpots = 3;
  let showUsed = 0;

  // First group
  if (first.count <= showSpots) {
    for (const lane of first.lanes) {
      stats[lane].showCredits += 1;
    }
    showUsed = first.count;
  } else {
    // More tied for first than Show spots
    const showShare = showSpots / first.count;
    for (const lane of first.lanes) {
      stats[lane].showCredits += showShare;
    }
    showUsed = showSpots;
  }

  // Second group
  let showRemaining = showSpots - showUsed;
  if (showRemaining > 0 && second.count > 0) {
    if (second.count <= showRemaining) {
      for (const lane of second.lanes) {
        stats[lane].showCredits += 1;
      }
      showUsed += second.count;
    } else {
      const showShare = showRemaining / second.count;
      for (const lane of second.lanes) {
        stats[lane].showCredits += showShare;
      }
      showUsed = showSpots;
    }
  }

  // Third group
  showRemaining = showSpots - showUsed;
  if (showRemaining > 0 && third.count > 0) {
    if (third.count <= showRemaining) {
      for (const lane of third.lanes) {
        stats[lane].showCredits += 1;
      }
    } else {
      const showShare = showRemaining / third.count;
      for (const lane of third.lanes) {
        stats[lane].showCredits += showShare;
      }
    }
  }
}

// -----------------------
// CLI
// -----------------------

function parseArgs(argv) {
  const out = {
    scores: null,
    samples: 10_000,
    salt: 0,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scores") out.scores = String(argv[++i] ?? "");
    else if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a === "--salt") out.salt = Number(argv[++i]) || 0;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log("monte-carlo-6lane.mjs - Win/Place/Show probability calculator");
  console.log("");
  console.log("Usage:");
  console.log("  node monte-carlo-6lane.mjs --scores s1,s2,s3,s4,s5,s6 [options]");
  console.log("");
  console.log("Options:");
  console.log("  --scores  s1,s2,s3,s4,s5,s6   (required; each 1..10)");
  console.log("  --samples N                   (default 10000)");
  console.log("  --salt    X                   (optional; numeric salt for seed variety)");
  console.log("  --json                        (output raw JSON for programmatic use)");
  console.log("");
  console.log("Output:");
  console.log("  Win:   Probability of finishing 1st (in basis points)");
  console.log("  Place: Probability of finishing 1st OR 2nd (in basis points)");
  console.log("  Show:  Probability of finishing 1st, 2nd, OR 3rd (in basis points)");
  console.log("");
  console.log("Dead heats are handled per standard racing rules:");
  console.log("  - If tied for last qualifying position, credit is split");
  console.log("  - e.g., 2-way tie for 2nd → each gets 0.5 Place credit");
  console.log("");
  console.log("Note: House edge is applied ON-CHAIN, not here.");
  console.log("  Contract converts: odds = (1 - houseEdge) / probability");
}

function parseScores(s) {
  const parts = String(s)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  if (parts.length !== 6) throw new Error("Expected 6 comma-separated scores");
  return parts.map(x => clampScore(Number(x)));
}

function fmtPct(p) {
  return `${(p * 100).toFixed(2)}%`;
}

function fmtBps(p) {
  return Math.round(p * 10000);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }
  if (!args.scores) {
    usage();
    throw new Error("--scores is required");
  }
  if (!Number.isFinite(args.samples) || args.samples <= 0) {
    throw new Error("--samples must be > 0");
  }

  const scores = parseScores(args.scores);

  // Initialize stats
  const stats = Array.from({ length: LANE_COUNT }, () => ({
    winCredits: 0,
    placeCredits: 0,
    showCredits: 0,
  }));

  // Seed generator state
  const seedState = { x: (args.salt * 0x9e3779b9) >>> 0 || 0x12345678 };
  // Mix in scores
  for (const s of scores) {
    seedState.x = (seedState.x ^ (s * 0x85ebca6b)) >>> 0;
    splitmix32Next(seedState);
  }

  const started = Date.now();

  // Run simulations
  for (let i = 0; i < args.samples; i++) {
    const seed = splitmix32Next(seedState);
    const { finishOrder } = simulateFullRace(seed, scores);
    accumulateStats(stats, finishOrder);
  }

  const elapsedMs = Date.now() - started;

  // Calculate probabilities
  const results = stats.map((s, lane) => ({
    lane,
    score: scores[lane],
    winProb: s.winCredits / args.samples,
    placeProb: s.placeCredits / args.samples,
    showProb: s.showCredits / args.samples,
  }));

  // JSON output for programmatic use
  if (args.json) {
    const output = {
      scores,
      samples: args.samples,
      elapsedMs,
      lanes: results.map(r => ({
        lane: r.lane,
        score: r.score,
        winProbBps: fmtBps(r.winProb),
        placeProbBps: fmtBps(r.placeProb),
        showProbBps: fmtBps(r.showProb),
        winProb: r.winProb,
        placeProb: r.placeProb,
        showProb: r.showProb,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  // Human-readable output
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║         MONTE CARLO - WIN/PLACE/SHOW PROBABILITIES (6 lanes)             ║");
  console.log("╠═══════════════════════════════════════════════════════════════════════════╣");
  console.log(`║  Scores:  ${scores.join(", ").padEnd(60)}║`);
  console.log(`║  Samples: ${args.samples.toLocaleString().padEnd(60)}║`);
  console.log(`║  Elapsed: ${elapsedMs}ms (${Math.round(args.samples / elapsedMs * 1000).toLocaleString()} sims/sec)`.padEnd(76) + "║");
  console.log(`║  Host:    ${os.platform()} ${os.arch()} cpu=${os.cpus().length}`.padEnd(76) + "║");
  console.log("╠═══════════════════════════════════════════════════════════════════════════╣");
  console.log("║  Lane │ Score │    Win Prob    │   Place Prob   │   Show Prob    ║");
  console.log("╠═══════════════════════════════════════════════════════════════════════════╣");

  for (const r of results) {
    const winStr = `${fmtPct(r.winProb).padStart(7)} (${fmtBps(r.winProb).toString().padStart(4)} bps)`;
    const placeStr = `${fmtPct(r.placeProb).padStart(7)} (${fmtBps(r.placeProb).toString().padStart(4)} bps)`;
    const showStr = `${fmtPct(r.showProb).padStart(7)} (${fmtBps(r.showProb).toString().padStart(4)} bps)`;
    console.log(`║   ${r.lane}   │   ${r.score.toString().padStart(2)}  │ ${winStr} │ ${placeStr} │ ${showStr} ║`);
  }

  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");

  // Verify sums
  const winSum = results.reduce((a, r) => a + r.winProb, 0);
  const placeSum = results.reduce((a, r) => a + r.placeProb, 0);
  const showSum = results.reduce((a, r) => a + r.showProb, 0);

  console.log("");
  console.log(
    `Sum checks: Win=${winSum.toFixed(4)} (≈1.00), Place=${placeSum.toFixed(4)} (≈2.00), Show=${showSum.toFixed(4)} (≈3.00)`,
  );
}

await main();
