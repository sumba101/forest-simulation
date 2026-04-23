// All tunable simulation parameters. These will be exposed as sliders/toggles
// in the UI via sim_set_param FFI calls when the Bun layer is added.

pub const Params = struct {
    // Vegetation growth
    empty_to_grass: f32,
    ash_to_grass: f32,
    sapling_spread_chance: f32,  // chance a sapling/tree seeds adjacent grass
    sapling_random_chance: f32,  // chance per tick of a wind-blown sapling anywhere
    sapling_to_tree: f32,

    // Fire
    ignition_chance: f32,
    lightning_chance: f32,
    fuel_min: u8,
    fuel_max: u8,
};

pub var p: Params = .{
    .empty_to_grass       = 0.002,
    .ash_to_grass         = 0.02,
    .sapling_spread_chance = 0.002,
    .sapling_random_chance = 0.0003,
    .sapling_to_tree      = 0.0008,
    .ignition_chance      = 0.4,
    .lightning_chance     = 0.03,
    .fuel_min             = 2,
    .fuel_max             = 6,
};
