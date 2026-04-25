const std = @import("std");
const Io = std.Io;
const Grid = @import("grid.zig").Grid;
const fire = @import("fire.zig");

const W: u32 = 80;
const H: u32 = 40;

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const io = init.io;

    // Seed the RNG from the current monotonic clock timestamp.
    // Io.Timestamp.nanoseconds is i96; we bitcast to u96 then truncate to u64.
    const ts = Io.Timestamp.now(io, .awake);
    const raw: u96 = @bitCast(ts.nanoseconds);
    var prng = std.Random.DefaultPrng.init(@truncate(raw));
    const rng = prng.random();

    var grid = try Grid.init(arena, W, H);
    defer grid.deinit();
    fire.scatter(&grid, rng);

    var buf: [W * H * 8]u8 = undefined;
    var file_writer: Io.File.Writer = .init(.stdout(), io, &buf);
    const out = &file_writer.interface;

    var tick: u64 = 0;
    while (true) : (tick += 1) {
        fire.tick(&grid, rng);
        try render(out, &grid, tick);
        try Io.sleep(io, Io.Duration.fromMilliseconds(100), .awake);
    }
}

fn render(out: anytype, grid: *const Grid, tick: u64) !void {
    try out.writeAll("\x1b[2J\x1b[H");
    var y: u32 = 0;
    while (y < grid.height) : (y += 1) {
        var x: u32 = 0;
        while (x < grid.width) : (x += 1) {
            const ch: u8 = switch (grid.get(x, y)) {
                .empty   => ' ',
                .tree    => 'T',
                .burning => '*',
                .ash     => '_',
            };
            try out.writeAll(&[_]u8{ch});
        }
        try out.writeAll("\n");
    }
    try out.print("tick {d}  |  ' '=empty  T=tree  *=fire  _=ash\n", .{tick});
    try out.flush();
}
