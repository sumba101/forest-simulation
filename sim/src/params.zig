// All tunable simulation parameters. These will be exposed as sliders/toggles
// in the UI via sim_set_param FFI calls when the Bun layer is added.

pub const Params = struct {
    tree_growth: f32,      // p — chance per tick that an empty/ash cell becomes a tree
    ignition_chance: f32,  // chance fire spreads to a flammable neighbor
    lightning_chance: f32, // f — chance per tick that any given tree is struck (per-tree, canonical DS)
    pause_on_fire: bool,   // if true, growth and lightning pause while any fire is active
};

pub var p: Params = .{
    .tree_growth      = 0.01,
    .ignition_chance  = 0.85,
    .lightning_chance = 1.0e-6,
    .pause_on_fire    = false,
};
