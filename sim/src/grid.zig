const std = @import("std");

pub const MAX_FIRE_EVENTS: usize = 4096;

pub const Cell = enum(u8) {
    empty = 0,
    tree = 1,
    burning = 2,
    ash = 3,
};

pub const Grid = struct {
    cells: []Cell,
    width: u32,
    height: u32,
    allocator: std.mem.Allocator,

    // Burning cells tracked as a compact list of grid indices to avoid
    // O(N) scans inside fireStep / tick.
    burning_indices: []u32,
    burning_count: u32,

    fire_current_size: u32,
    fire_events: []u32,
    fire_events_len: usize,
    fire_events_head: usize,
    tick_count: u64,

    pub fn init(allocator: std.mem.Allocator, width: u32, height: u32) !Grid {
        const size = width * height;
        const cells = try allocator.alloc(Cell, size);
        const burning_indices = try allocator.alloc(u32, size);
        const fire_events = try allocator.alloc(u32, MAX_FIRE_EVENTS);
        @memset(cells, .empty);
        @memset(fire_events, 0);
        return .{
            .cells = cells,
            .width = width,
            .height = height,
            .allocator = allocator,
            .burning_indices = burning_indices,
            .burning_count = 0,
            .fire_current_size = 0,
            .fire_events = fire_events,
            .fire_events_len = 0,
            .fire_events_head = 0,
            .tick_count = 0,
        };
    }

    pub fn deinit(self: *Grid) void {
        self.allocator.free(self.cells);
        self.allocator.free(self.burning_indices);
        self.allocator.free(self.fire_events);
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

    pub fn recordFireEvent(self: *Grid) void {
        self.fire_events[self.fire_events_head] = self.fire_current_size;
        self.fire_events_head = (self.fire_events_head + 1) % MAX_FIRE_EVENTS;
        if (self.fire_events_len < MAX_FIRE_EVENTS) self.fire_events_len += 1;
        self.fire_current_size = 0;
    }

    pub fn igniteCell(self: *Grid, i: usize) void {
        self.cells[i] = .burning;
        self.burning_indices[self.burning_count] = @intCast(i);
        self.burning_count += 1;
        self.fire_current_size += 1;
    }
};
