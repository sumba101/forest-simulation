const std = @import("std");

pub const Cell = enum(u8) {
    empty = 0,
    grass = 1,
    sapling = 2,
    tree = 3,
    burning = 4,
    ash = 5,
};

pub const Grid = struct {
    cells: []Cell,
    fuel: []u8,
    width: u32,
    height: u32,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, width: u32, height: u32) !Grid {
        const size = width * height;
        const cells = try allocator.alloc(Cell, size);
        const fuel = try allocator.alloc(u8, size);
        @memset(cells, .empty);
        @memset(fuel, 0);
        return .{
            .cells = cells,
            .fuel = fuel,
            .width = width,
            .height = height,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Grid) void {
        self.allocator.free(self.cells);
        self.allocator.free(self.fuel);
    }

    pub fn idx(self: Grid, x: u32, y: u32) usize {
        return y * self.width + x;
    }

    pub fn get(self: Grid, x: u32, y: u32) Cell {
        return self.cells[self.idx(x, y)];
    }

    pub fn set(self: *Grid, x: u32, y: u32, cell: Cell) void {
        self.cells[self.idx(x, y)] = cell;
    }
};
