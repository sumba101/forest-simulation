const std = @import("std");
const grid_mod = @import("grid.zig");
const Grid = grid_mod.Grid;
const fire = @import("fire.zig");
const params = @import("params.zig");

const gpa = std.heap.page_allocator;
var global_prng: std.Random.DefaultPrng = std.Random.DefaultPrng.init(0);

fn getGrid(handle: *anyopaque) *Grid {
    return @ptrCast(@alignCast(handle));
}

export fn sim_create(width: u32, height: u32, seed: u64) ?*anyopaque {
    global_prng = std.Random.DefaultPrng.init(seed);
    const g = gpa.create(Grid) catch return null;
    g.* = Grid.init(gpa, width, height) catch {
        gpa.destroy(g);
        return null;
    };
    fire.scatter(g, global_prng.random());
    return @ptrCast(g);
}

export fn sim_tick(handle: *anyopaque) void {
    fire.tick(getGrid(handle), global_prng.random());
}

export fn sim_get_cells(handle: *anyopaque, out: [*]u8) void {
    const g = getGrid(handle);
    const src: [*]const u8 = @ptrCast(g.cells.ptr);
    @memcpy(out[0..g.cells.len], src[0..g.cells.len]);
}

export fn sim_get_fire_events(handle: *anyopaque, out: [*]u32) u32 {
    const g = getGrid(handle);
    const len = g.fire_events_len;
    for (0..len) |i| out[i] = g.fire_events[i];
    return @intCast(len);
}

export fn sim_set_param(name: [*]const u8, name_len: u32, value: f64) void {
    const n = name[0..name_len];
    const p = &params.p;
    if (std.mem.eql(u8, n, "tree_growth"))
        p.tree_growth = @floatCast(value)
    else if (std.mem.eql(u8, n, "lightning_chance"))
        p.lightning_chance = @floatCast(value)
    else if (std.mem.eql(u8, n, "ignition_chance"))
        p.ignition_chance = @floatCast(value)
    else if (std.mem.eql(u8, n, "pause_on_fire"))
        p.pause_on_fire = value >= 0.5;
}

export fn sim_reset(handle: *anyopaque, seed: u64) void {
    const g = getGrid(handle);
    global_prng = std.Random.DefaultPrng.init(seed);
    @memset(g.cells, .empty);
    g.burning_count = 0;
    g.fire_current_size = 0;
    g.fire_events_len = 0;
    g.fire_events_head = 0;
    g.tick_count = 0;
    fire.scatter(g, global_prng.random());
}

export fn sim_destroy(handle: *anyopaque) void {
    const g = getGrid(handle);
    g.deinit();
    gpa.destroy(g);
}

export fn sim_ignite(handle: *anyopaque, x: u32, y: u32) void {
    const g = getGrid(handle);
    if (x >= g.width or y >= g.height) return;
    const i = g.idx(x, y);
    if (g.cells[i] == .tree) g.igniteCell(i);
}

export fn sim_get_tick(handle: *anyopaque) u64 {
    const g = getGrid(handle);
    return g.tick_count;
}
