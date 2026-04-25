# Forest Fire — Self-Organized Criticality

Drossel–Schwabl (1992) forest fire model running in a 1024×768 grid, served via WebSocket to a browser UI with real-time controls and a log–log fire-size distribution chart.

## Requirements

- [Zig](https://ziglang.org/) ≥ 0.14
- [Bun](https://bun.sh/) ≥ 1.0

## Build & Run

```bash
# 1. Build the simulation library
cd sim
zig build -Doptimize=ReleaseFast

# 2. Start the server
cd ../server
bun run index.ts
```

Open **http://localhost:3000** in a browser.

## Model Assumptions

**State space** — each cell is one of: `empty`, `tree`, `burning`, `ash`. No intermediate vegetation stages.

**Growth** — each empty/ash cell independently becomes a tree with probability `p` per tick (geometric-skip sampled for efficiency, ~100× fewer RNG calls than a per-cell loop).

**Lightning** — each tree is struck independently with probability `f` per tick (same geometric-skip trick). This is the canonical per-tree DS formulation, not a single random strike per tick.

**Fire spread** — a burning cell ignites each 4-connected tree neighbor with probability `ignition_chance`. All burning cells are processed from a compact index list (O(burning) not O(N)).

**Timescale separation** — controlled by `pause_on_fire` flag (default off). When on, growth and lightning are suspended while any cell is burning, enforcing the infinite timescale-separation limit where each recorded fire event is exactly one connected cluster.

**SOC condition** — requires `f ≪ p` so the forest can regrow between strikes, and the mean cluster size `p/f` must fit well inside the total cell count (786,432 for 1024×768) so the power-law scaling region is visible before finite-size cutoff. Default: `p = 0.01`, `f = 1e-6` gives `p/f = 10,000`.

**Fire recording** — fire size (cells burned) is recorded when `burning_count` drops to zero. Stored in a ring buffer of 4096 events and displayed as a log–log histogram with τ = 1.15 (canonical DS) and τ = 1.00 reference slopes.
