const std = @import("std");
const grid_mod = @import("grid.zig");
const Grid = grid_mod.Grid;
const Cell = grid_mod.Cell;
const params = @import("params.zig");

pub fn scatter(g: *Grid, rng: std.Random) void {
    g.burning_count = 0;
    g.fire_current_size = 0;
    for (g.cells) |*cell| {
        cell.* = if (rng.float(f32) < 0.25) .tree else .empty;
    }
}

pub fn tick(g: *Grid, rng: std.Random) void {
    g.tick_count += 1;

    const can_grow = !params.p.pause_on_fire or g.burning_count == 0;
    if (can_grow) {
        growStep(g, rng);
        lightningStep(g, rng);
    }
    fireStep(g, rng);

    if (g.burning_count == 0 and g.fire_current_size > 0) {
        g.recordFireEvent();
    }
}

// Geometric-skip growth: for each per-cell event with probability p,
// sample the gap to the next "hit" instead of rolling for every cell.
// This collapses ~N RNG calls per tick into ~N*p, a 50–100× speedup at
// realistic growth rates.
fn growStep(g: *Grid, rng: std.Random) void {
    const p: f64 = @floatCast(params.p.tree_growth);
    if (p <= 0.0) return;
    if (p >= 1.0) {
        for (g.cells) |*cell| {
            if (cell.* == .empty or cell.* == .ash) cell.* = .tree;
        }
        return;
    }

    const log1mp = @log(1.0 - p);
    const total = g.cells.len;
    var i: usize = 0;
    while (i < total) {
        const u = @max(rng.float(f64), 1e-300);
        const skip: usize = @intFromFloat(@floor(@log(u) / log1mp));
        i += skip;
        if (i >= total) break;
        if (g.cells[i] == .empty or g.cells[i] == .ash) g.cells[i] = .tree;
        i += 1;
    }
}

// Per-tree lightning (canonical DS): each tree has independent probability f
// per tick of being struck. Implemented with the same geometric-skip trick as
// growth — we sample landing positions across all cells at rate f and ignite
// the ones that happen to be trees.
fn lightningStep(g: *Grid, rng: std.Random) void {
    const f: f64 = @floatCast(params.p.lightning_chance);
    if (f <= 0.0) return;
    if (f >= 1.0) {
        for (g.cells, 0..) |cell, i| {
            if (cell == .tree) g.igniteCell(i);
        }
        return;
    }

    const log1mf = @log(1.0 - f);
    const total = g.cells.len;
    var i: usize = 0;
    while (i < total) {
        const u = @max(rng.float(f64), 1e-300);
        const skip: usize = @intFromFloat(@floor(@log(u) / log1mf));
        i += skip;
        if (i >= total) break;
        if (g.cells[i] == .tree) g.igniteCell(i);
        i += 1;
    }
}

// List-based fire step: only iterate currently-burning cells (snapshot at
// step start), spread to neighbors, then ash. New ignitions accumulate
// at the tail of burning_indices and become the next tick's queue.
fn fireStep(g: *Grid, rng: std.Random) void {
    const ignition = params.p.ignition_chance;
    const start = g.burning_count;
    if (start == 0) return;

    var k: u32 = 0;
    while (k < start) : (k += 1) {
        const i = g.burning_indices[k];
        const x = @as(u32, @intCast(i % g.width));
        const y = @as(u32, @intCast(i / g.width));
        if (x > 0)            tryIgnite(g, g.idx(x - 1, y), ignition, rng);
        if (x < g.width - 1)  tryIgnite(g, g.idx(x + 1, y), ignition, rng);
        if (y > 0)            tryIgnite(g, g.idx(x, y - 1), ignition, rng);
        if (y < g.height - 1) tryIgnite(g, g.idx(x, y + 1), ignition, rng);
        g.cells[i] = .ash;
    }

    // Compact: shift the new ignitions (at [start, burning_count)) to the front.
    const remaining = g.burning_count - start;
    if (remaining > 0) {
        std.mem.copyForwards(u32, g.burning_indices[0..remaining], g.burning_indices[start..start + remaining]);
    }
    g.burning_count = remaining;
}

fn tryIgnite(g: *Grid, i: usize, chance: f32, rng: std.Random) void {
    if (g.cells[i] == .tree and rng.float(f32) < chance) g.igniteCell(i);
}
