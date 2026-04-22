const std = @import("std");
const grid_mod = @import("grid.zig");
const Grid = grid_mod.Grid;
const Cell = grid_mod.Cell;

const ignition_chance: f32 = 0.4;
const lightning_chance: f32 = 0.001;
const fuel_min: u8 = 4;
const fuel_max: u8 = 10;

pub fn tick(g: *Grid, rng: std.Random) void {
    growStep(g, rng);
    lightningStep(g, rng);
    fireStep(g, rng);
}

fn growStep(g: *Grid, rng: std.Random) void {
    for (g.cells) |*cell| {
        switch (cell.*) {
            .empty   => if (rng.float(f32) < 0.002) { cell.* = .grass; },
            .grass   => if (rng.float(f32) < 0.008) { cell.* = .sapling; },
            .sapling => if (rng.float(f32) < 0.003) { cell.* = .tree; },
            .ash     => if (rng.float(f32) < 0.02)  { cell.* = .grass; },
            else     => {},
        }
    }
}

fn lightningStep(g: *Grid, rng: std.Random) void {
    if (rng.float(f32) >= lightning_chance) return;
    const x = rng.intRangeLessThan(u32, 0, g.width);
    const y = rng.intRangeLessThan(u32, 0, g.height);
    const i = g.idx(x, y);
    if (isFlammable(g.cells[i])) ignite(g, i, rng);
}

fn fireStep(g: *Grid, rng: std.Random) void {
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

            if (x > 0)             tryIgnite(g, g.idx(x - 1, y), rng);
            if (x < g.width - 1)   tryIgnite(g, g.idx(x + 1, y), rng);
            if (y > 0)             tryIgnite(g, g.idx(x, y - 1), rng);
            if (y < g.height - 1)  tryIgnite(g, g.idx(x, y + 1), rng);
        }
    }
}

fn tryIgnite(g: *Grid, i: usize, rng: std.Random) void {
    if (isFlammable(g.cells[i]) and rng.float(f32) < ignition_chance) {
        ignite(g, i, rng);
    }
}

fn ignite(g: *Grid, i: usize, rng: std.Random) void {
    g.cells[i] = .burning;
    g.fuel[i] = fuel_min + rng.intRangeLessThan(u8, 0, fuel_max - fuel_min);
}

fn isFlammable(cell: Cell) bool {
    return cell == .grass or cell == .sapling or cell == .tree;
}
