const std = @import("std");
const grid_mod = @import("grid.zig");
const Grid = grid_mod.Grid;
const Cell = grid_mod.Cell;
const params = @import("params.zig");

pub fn scatter(g: *Grid, rng: std.Random) void {
    for (g.cells) |*cell| {
        const roll = rng.float(f32);
        cell.* = if (roll < 0.45) .empty
        else if (roll < 0.85) .grass
        else if (roll < 0.97) .sapling
        else .tree;
    }
}

pub fn tick(g: *Grid, rng: std.Random) void {
    growStep(g, rng);
    seedStep(g, rng);
    lightningStep(g, rng);
    fireStep(g, rng);
}

// Handles cell-state transitions that don't involve seeding or fire.
fn growStep(g: *Grid, rng: std.Random) void {
    const p = params.p;
    for (g.cells) |*cell| {
        switch (cell.*) {
            .empty   => if (rng.float(f32) < p.empty_to_grass)  { cell.* = .grass; },
            .sapling => if (rng.float(f32) < p.sapling_to_tree) { cell.* = .tree; },
            .ash     => if (rng.float(f32) < p.ash_to_grass)    { cell.* = .grass; },
            else     => {},
        }
    }
}

// Saplings and trees spread seeds to adjacent grass cells (patch growth),
// plus a rare random drop anywhere on the map (wind dispersal).
fn seedStep(g: *Grid, rng: std.Random) void {
    const p = params.p;

    var y: u32 = 0;
    while (y < g.height) : (y += 1) {
        var x: u32 = 0;
        while (x < g.width) : (x += 1) {
            const i = g.idx(x, y);
            if (g.cells[i] != .sapling and g.cells[i] != .tree) continue;
            if (x > 0)            trySeed(g, g.idx(x - 1, y), p.sapling_spread_chance, rng);
            if (x < g.width - 1)  trySeed(g, g.idx(x + 1, y), p.sapling_spread_chance, rng);
            if (y > 0)            trySeed(g, g.idx(x, y - 1), p.sapling_spread_chance, rng);
            if (y < g.height - 1) trySeed(g, g.idx(x, y + 1), p.sapling_spread_chance, rng);
        }
    }

    // Wind-blown seed: rare random drop anywhere on the map.
    if (rng.float(f32) < p.sapling_random_chance) {
        const wx = rng.intRangeLessThan(u32, 0, g.width);
        const wy = rng.intRangeLessThan(u32, 0, g.height);
        const i = g.idx(wx, wy);
        if (g.cells[i] == .grass) g.cells[i] = .sapling;
    }
}

fn trySeed(g: *Grid, i: usize, chance: f32, rng: std.Random) void {
    if (g.cells[i] == .grass and rng.float(f32) < chance) {
        g.cells[i] = .sapling;
    }
}

fn lightningStep(g: *Grid, rng: std.Random) void {
    if (rng.float(f32) >= params.p.lightning_chance) return;
    const x = rng.intRangeLessThan(u32, 0, g.width);
    const y = rng.intRangeLessThan(u32, 0, g.height);
    const i = g.idx(x, y);
    if (isFlammable(g.cells[i])) ignite(g, i, rng);
}

fn fireStep(g: *Grid, rng: std.Random) void {
    const p = params.p;
    var y: u32 = 0;
    while (y < g.height) : (y += 1) {
        var x: u32 = 0;
        while (x < g.width) : (x += 1) {
            const i = g.idx(x, y);
            if (g.cells[i] != .burning) continue;

            if (g.fuel[i] == 0) {
                g.cells[i] = .ash;
                continue;
            }
            g.fuel[i] -= 1;

            if (x > 0)            tryIgnite(g, g.idx(x - 1, y), p.ignition_chance, rng);
            if (x < g.width - 1)  tryIgnite(g, g.idx(x + 1, y), p.ignition_chance, rng);
            if (y > 0)            tryIgnite(g, g.idx(x, y - 1), p.ignition_chance, rng);
            if (y < g.height - 1) tryIgnite(g, g.idx(x, y + 1), p.ignition_chance, rng);
        }
    }
}

fn tryIgnite(g: *Grid, i: usize, chance: f32, rng: std.Random) void {
    if (isFlammable(g.cells[i]) and rng.float(f32) < chance) {
        ignite(g, i, rng);
    }
}

fn ignite(g: *Grid, i: usize, rng: std.Random) void {
    const p = params.p;
    g.cells[i] = .burning;
    g.fuel[i] = p.fuel_min + rng.intRangeLessThan(u8, 0, p.fuel_max - p.fuel_min);
}

fn isFlammable(cell: Cell) bool {
    return cell == .grass or cell == .sapling or cell == .tree;
}
