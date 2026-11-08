# Reference content IDs

This file is the complete ID inventory used by DoD-2. The source is `takeokunn/ts-minecraft` at commit `1133a5546c7b7d47325a154e2ab2f3d462dce909`. The reference ID is preserved exactly as declared; registration-key columns make name differences explicit.

The count table in source `docs/reference/vanilla-parity.md` is older than its current declarations: it says 108 block types, 122 item types, and 12 biomes. The source schemas below declare 120 block IDs, 124 item IDs, and 13 biome IDs. DoD-2 uses the complete source declarations and the 20-mob roster, not those older counts.

Block and item registration comparisons use `nerima-games/mc-kernel` base commit `d078b92e1d3bfb77d670a60328c7161bb6d496e1` (before PR #91). Item IDs absent there are marked K2 / PR #91. Recipe registration keys follow `nerima-games/mc-kernel` PR #91 head `552514dc018a9a528ed08c5bac3199214c956974`; `not registered` entries remain gaps. Mob rows map each reference entity to its expected `mx-gameplay` key; biome keys retain the source enum value.

DoD-2 passes only when every reference ID below resolves to a registered key and the registered recipe covers the source inputs and result. Counts alone do not pass. Extra IDs cannot substitute for a missing reference ID. A shared recipe key counts for multiple reference IDs only if it accepts every listed source recipe shape.

## Block IDs

`takeokunn/ts-minecraft/packages/core/domain/block-type.ts` → `nerima-games/mc-kernel/src/domain/block/block-type-data.ts`.

| Reference ID | mc-kernel key | Registration | Reference ID | mc-kernel key | Registration |
| --- | --- | --- | --- | --- | --- |
| `AIR` | `air` | `present` | `DIRT` | `dirt` | `present` |
| `STONE` | `stone` | `present` | `WOOD` | `oak_log` | `present` |
| `GRASS` | `grass_block` | `present` | `SAND` | `sand` | `present` |
| `WATER` | `water` | `present` | `LEAVES` | `oak_leaves` | `present` |
| `GLASS` | `glass` | `present` | `SNOW` | `snow` | `present` |
| `GRAVEL` | `gravel` | `present` | `COBBLESTONE` | `cobblestone` | `present` |
| `GRANITE` | `granite` | `present` | `DIORITE` | `diorite` | `present` |
| `ANDESITE` | `andesite` | `present` | `DEEPSLATE` | `deepslate` | `present` |
| `BEDROCK` | `bedrock` | `present` | `LAVA` | `lava` | `present` |
| `OBSIDIAN` | `obsidian` | `present` | `COAL_ORE` | `coal_ore` | `present` |
| `IRON_ORE` | `iron_ore` | `present` | `GOLD_ORE` | `gold_ore` | `present` |
| `DIAMOND_ORE` | `diamond_ore` | `present` | `REDSTONE_ORE` | `redstone_ore` | `present` |
| `LAPIS_ORE` | `lapis_ore` | `present` | `EMERALD_ORE` | `emerald_ore` | `present` |
| `DEEPSLATE_COAL_ORE` | `deepslate_coal_ore` | `present` | `DEEPSLATE_IRON_ORE` | `deepslate_iron_ore` | `present` |
| `DEEPSLATE_GOLD_ORE` | `deepslate_gold_ore` | `present` | `DEEPSLATE_DIAMOND_ORE` | `deepslate_diamond_ore` | `present` |
| `DEEPSLATE_REDSTONE_ORE` | `deepslate_redstone_ore` | `present` | `DEEPSLATE_LAPIS_ORE` | `deepslate_lapis_ore` | `present` |
| `DEEPSLATE_EMERALD_ORE` | `deepslate_emerald_ore` | `present` | `COAL_BLOCK` | `coal_block` | `present` |
| `IRON_BLOCK` | `iron_block` | `present` | `GOLD_BLOCK` | `gold_block` | `present` |
| `DIAMOND_BLOCK` | `diamond_block` | `present` | `REDSTONE_BLOCK` | `redstone_block` | `present` |
| `LAPIS_BLOCK` | `lapis_block` | `present` | `EMERALD_BLOCK` | `emerald_block` | `present` |
| `PLANKS` | `oak_planks` | `present` | `CRAFTING_TABLE` | `crafting_table` | `present` |
| `FURNACE` | `furnace` | `present` | `TORCH` | `torch` | `present` |
| `NETHERRACK` | `netherrack` | `present` | `NETHER_PORTAL` | `nether_portal` | `present` |
| `FARMLAND` | `farmland` | `present` | `WHEAT_CROP` | `wheat_crop` | `present` |
| `POTATO_CROP` | `potato_crop` | `present` | `REDSTONE_WIRE` | `redstone_wire` | `present` |
| `REDSTONE_TORCH` | `redstone_torch` | `present` | `LEVER` | `lever` | `present` |
| `STONE_BUTTON` | `stone_button` | `present` | `REPEATER` | `repeater` | `present` |
| `REDSTONE_LAMP` | `redstone_lamp` | `present` | `REDSTONE_LAMP_LIT` | `redstone_lamp_lit` | `present` |
| `BREWING_STAND` | `brewing_stand` | `present` | `NETHER_BRICK` | `nether_brick` | `present` |
| `PISTON` | `piston` | `present` | `BED` | `bed` | `present` |
| `ENCHANTING_TABLE` | `enchanting_table` | `present` | `END_STONE` | `end_stone` | `present` |
| `END_PORTAL_FRAME` | `end_portal_frame` | `present` | `END_PORTAL_FRAME_FILLED` | `end_portal_frame_filled` | `present` |
| `END_PORTAL` | `end_portal` | `present` | `CHORUS_FLOWER` | `chorus_flower` | `present` |
| `CHORUS_PLANT` | `chorus_plant` | `present` | `DRAGON_EGG` | `dragon_egg` | `present` |
| `END_CRYSTAL` | `end_crystal` | `present` | `END_GATEWAY` | `end_gateway` | `present` |
| `END_ROD` | `end_rod` | `present` | `END_STONE_BRICKS` | `end_stone_bricks` | `present` |
| `ENDER_CHEST` | `ender_chest` | `present` | `PURPUR_BLOCK` | `purpur_block` | `present` |
| `PURPUR_PILLAR` | `purpur_pillar` | `present` | `PURPUR_SLAB` | `purpur_slab` | `present` |
| `PURPUR_STAIRS` | `purpur_stairs` | `present` | `SHULKER_BOX` | `shulker_box` | `present` |
| `TNT` | `tnt` | `present` | `CHEST` | `chest` | `present` |
| `DOOR` | `door` | `present` | `DOOR_OPEN` | `door_open` | `present` |
| `GLOWSTONE` | `glowstone` | `present` | `LADDER` | `ladder` | `present` |
| `COBWEB` | `cobweb` | `present` | `SAPLING` | `sapling` | `present` |
| `DANDELION` | `dandelion` | `present` | `POPPY` | `poppy` | `present` |
| `BROWN_MUSHROOM` | `brown_mushroom` | `present` | `RED_MUSHROOM` | `red_mushroom` | `present` |
| `TALL_GRASS` | `tall_grass` | `present` | `FERN` | `fern` | `present` |
| `SUGAR_CANE` | `sugar_cane` | `present` | `CACTUS` | `cactus` | `present` |
| `LILY_PAD` | `lily_pad` | `present` | `ICE` | `ice` | `present` |
| `PRESSURE_PLATE` | `pressure_plate` | `present` | `STONE_SLAB` | `stone_slab` | `present` |
| `OAK_STAIRS` | `oak_stairs` | `present` | `ANVIL` | `anvil` | `present` |
| `CAULDRON` | `cauldron` | `present` | `FIRE` | `fire` | `present` |
| `WATER_CAULDRON` | `water_cauldron` | `present` | `RAIL` | `rail` | `present` |
| `SOUL_SAND` | `soul_sand` | `present` | `NETHER_WART_CROP` | `nether_wart_crop` | `present` |
| `SANDSTONE` | `sandstone` | `present` | `PRISMARINE` | `prismarine` | `present` |
| `OBSERVER` | `observer` | `present` | `HOPPER` | `hopper` | `present` |
| `COMPARATOR` | `comparator` | `present` | `DISPENSER` | `dispenser` | `present` |
| `PISTON_HEAD` | `piston_head` | `present` | `POWERED_RAIL` | `powered_rail` | `present` |
| `KELP` | `kelp` | `present` | `SEAGRASS` | `seagrass` | `present` |
| `SMOOTH_BASALT` | `smooth_basalt` | `present` | `CALCITE` | `calcite` | `present` |
| `AMETHYST_BLOCK` | `amethyst_block` | `present` | `AMETHYST_CLUSTER` | `amethyst_cluster` | `present` |

## Item IDs

`takeokunn/ts-minecraft/packages/core/domain/item-type.ts` → `nerima-games/mc-kernel/src/domain/item/item-type-data.ts`.

| Reference ID | mc-kernel key | Base status | Reference ID | mc-kernel key | Base status |
| --- | --- | --- | --- | --- | --- |
| `STICKS` | `stick` | `present` | `COAL` | `coal` | `present` |
| `WOODEN_SWORD` | `wooden_sword` | `present` | `STONE_SWORD` | `stone_sword` | `present` |
| `IRON_SWORD` | `iron_sword` | `present` | `DIAMOND_SWORD` | `diamond_sword` | `present` |
| `GOLD_SWORD` | `gold_sword` | `present` | `WOODEN_PICKAXE` | `wooden_pickaxe` | `present` |
| `STONE_PICKAXE` | `stone_pickaxe` | `present` | `RAW_IRON` | `raw_iron` | `present` |
| `IRON_INGOT` | `iron_ingot` | `present` | `IRON_PICKAXE` | `iron_pickaxe` | `present` |
| `RAW_GOLD` | `raw_gold` | `present` | `GOLD_INGOT` | `gold_ingot` | `present` |
| `DIAMOND` | `diamond` | `present` | `REDSTONE_DUST` | `redstone_dust` | `present` |
| `GLOWSTONE_DUST` | `glowstone_dust` | `present` | `GLASS_BOTTLE` | `glass_bottle` | `present` |
| `POTION_SWIFTNESS` | `potion_of_swiftness` | `present` | `POTION_HEALING` | `potion_of_healing` | `absent; K2 / PR #91` |
| `LAPIS_LAZULI` | `lapis_lazuli` | `present` | `EMERALD` | `emerald` | `present` |
| `DIAMOND_PICKAXE` | `diamond_pickaxe` | `present` | `GOLD_PICKAXE` | `gold_pickaxe` | `present` |
| `ROTTEN_FLESH` | `rotten_flesh` | `present` | `APPLE` | `apple` | `present` |
| `BREAD` | `bread` | `present` | `CARROT` | `carrot` | `present` |
| `POTATO` | `potato` | `present` | `RAW_PORKCHOP` | `porkchop` | `present` |
| `COOKED_PORKCHOP` | `cooked_porkchop` | `present` | `RAW_MUTTON` | `mutton` | `present` |
| `COOKED_MUTTON` | `cooked_mutton` | `present` | `RAW_CHICKEN` | `chicken` | `present` |
| `COOKED_CHICKEN` | `cooked_chicken` | `present` | `COOKED_BEEF` | `cooked_beef` | `present` |
| `GOLDEN_APPLE` | `golden_apple` | `present` | `RAW_COD` | `cod` | `present` |
| `COOKED_COD` | `cooked_cod` | `present` | `RAW_SALMON` | `salmon` | `present` |
| `COOKED_SALMON` | `cooked_salmon` | `present` | `TROPICAL_FISH` | `tropical_fish` | `present` |
| `PUFFERFISH` | `pufferfish` | `present` | `WHEAT` | `wheat` | `present` |
| `WHEAT_SEEDS` | `wheat_seeds` | `present` | `BONE_MEAL` | `bone_meal` | `present` |
| `RAW_BEEF` | `beef` | `present` | `LEATHER` | `leather` | `present` |
| `WOOL` | `wool` | `present` | `GUNPOWDER` | `gunpowder` | `present` |
| `BONE` | `bone` | `present` | `ARROW` | `arrow` | `present` |
| `SNOWBALL` | `snowball` | `present` | `FEATHER` | `feather` | `present` |
| `INK_SAC` | `ink_sac` | `absent; K2 / PR #91` | `PRISMARINE_SHARD` | `prismarine_shard` | `absent; K2 / PR #91` |
| `AMETHYST_SHARD` | `amethyst_shard` | `present` | `STRING` | `string` | `present` |
| `SPIDER_EYE` | `spider_eye` | `present` | `ENDER_PEARL` | `ender_pearl` | `present` |
| `BOOK` | `book` | `present` | `PAPER` | `paper` | `present` |
| `CHORUS_FRUIT` | `chorus_fruit` | `present` | `DRAGON_BREATH` | `dragon_breath` | `absent; K2 / PR #91` |
| `DRAGON_EGG` | `dragon_egg` | `present` | `ELYTRA` | `elytra` | `absent; K2 / PR #91` |
| `END_CRYSTAL` | `end_crystal` | `present` | `ENDER_EYE` | `eye_of_ender` | `present` |
| `POPPED_CHORUS_FRUIT` | `popped_chorus_fruit` | `absent; K2 / PR #91` | `SHULKER_SHELL` | `shulker_shell` | `absent; K2 / PR #91` |
| `BOW` | `bow` | `present` | `FISHING_ROD` | `fishing_rod` | `present` |
| `SHIELD` | `shield` | `present` | `COMPASS` | `compass` | `absent; K2 / PR #91` |
| `CLOCK` | `clock` | `absent; K2 / PR #91` | `MAP` | `filled_map` | `present` |
| `SPYGLASS` | `spyglass` | `absent; K2 / PR #91` | `WOODEN_HOE` | `wooden_hoe` | `present` |
| `STONE_HOE` | `stone_hoe` | `present` | `IRON_HOE` | `iron_hoe` | `present` |
| `DIAMOND_HOE` | `diamond_hoe` | `present` | `GOLD_HOE` | `gold_hoe` | `present` |
| `WOODEN_SHOVEL` | `wooden_shovel` | `present` | `STONE_SHOVEL` | `stone_shovel` | `present` |
| `IRON_SHOVEL` | `iron_shovel` | `present` | `DIAMOND_SHOVEL` | `diamond_shovel` | `present` |
| `GOLD_SHOVEL` | `gold_shovel` | `present` | `WOODEN_AXE` | `wooden_axe` | `present` |
| `STONE_AXE` | `stone_axe` | `present` | `IRON_AXE` | `iron_axe` | `present` |
| `DIAMOND_AXE` | `diamond_axe` | `present` | `GOLD_AXE` | `gold_axe` | `present` |
| `LEATHER_HELMET` | `leather_helmet` | `absent; K2 / PR #91` | `LEATHER_CHESTPLATE` | `leather_chestplate` | `absent; K2 / PR #91` |
| `LEATHER_LEGGINGS` | `leather_leggings` | `absent; K2 / PR #91` | `LEATHER_BOOTS` | `leather_boots` | `absent; K2 / PR #91` |
| `IRON_HELMET` | `iron_helmet` | `present` | `IRON_CHESTPLATE` | `iron_chestplate` | `present` |
| `IRON_LEGGINGS` | `iron_leggings` | `present` | `IRON_BOOTS` | `iron_boots` | `present` |
| `GOLD_HELMET` | `gold_helmet` | `absent; K2 / PR #91` | `GOLD_CHESTPLATE` | `gold_chestplate` | `absent; K2 / PR #91` |
| `GOLD_LEGGINGS` | `gold_leggings` | `absent; K2 / PR #91` | `GOLD_BOOTS` | `gold_boots` | `absent; K2 / PR #91` |
| `DIAMOND_HELMET` | `diamond_helmet` | `present` | `DIAMOND_CHESTPLATE` | `diamond_chestplate` | `present` |
| `DIAMOND_LEGGINGS` | `diamond_leggings` | `present` | `DIAMOND_BOOTS` | `diamond_boots` | `present` |
| `FLINT` | `flint` | `present` | `FLINT_AND_STEEL` | `flint_and_steel` | `present` |
| `SHEARS` | `shears` | `present` | `BUCKET` | `bucket` | `present` |
| `WATER_BUCKET` | `water_bucket` | `present` | `LAVA_BUCKET` | `lava_bucket` | `present` |
| `BOAT` | `oak_boat` | `present` | `MINECART` | `minecart` | `present` |
| `CHARCOAL` | `charcoal` | `absent; K2 / PR #91` | `BLAZE_ROD` | `blaze_rod` | `absent; K2 / PR #91` |
| `BLAZE_POWDER` | `blaze_powder` | `present` | `NETHER_WART` | `nether_wart` | `present` |
| `POTION_AWKWARD` | `awkward_potion` | `present` | `POTION_SWIFTNESS_II` | `potion_of_swiftness_ii` | `absent; K2 / PR #91` |
| `POTION_HEALING_II` | `potion_of_healing_ii` | `absent; K2 / PR #91` | `POTION_SWIFTNESS_LONG` | `potion_of_swiftness_long` | `absent; K2 / PR #91` |

The 23 rows marked `absent; K2 / PR #91` are the item IDs added by mc-kernel PR #91. The reference `MAP` maps to existing `filled_map`; it is not a missing item ID.

## Recipe IDs

`takeokunn/ts-minecraft/packages/inventory/application/recipes/` declares 112 distinct `RecipeId.make()` IDs. The output column preserves the source `ItemType`; the `mc-kernel key` column is the registration-key crosswalk. The mapped keys are not a claim that every recipe is complete: seven rows are still unregistered at the PR #91 head.

| Reference Recipe ID | Reference output item ID | mc-kernel recipe key | PR #91 head |
|---|---|---|---|
| `leather-to-leather-helmet` | `LEATHER_HELMET` | `minecraft:leather_helmet` | registered at PR #91 head |
| `leather-to-leather-chestplate` | `LEATHER_CHESTPLATE` | `minecraft:leather_chestplate` | registered at PR #91 head |
| `leather-to-leather-leggings` | `LEATHER_LEGGINGS` | `minecraft:leather_leggings` | registered at PR #91 head |
| `leather-to-leather-boots` | `LEATHER_BOOTS` | `minecraft:leather_boots` | registered at PR #91 head |
| `iron-ingot-to-iron-helmet` | `IRON_HELMET` | `minecraft:iron-helmet` | registered at PR #91 head |
| `iron-ingot-to-iron-chestplate` | `IRON_CHESTPLATE` | `minecraft:iron-chestplate` | registered at PR #91 head |
| `iron-ingot-to-iron-leggings` | `IRON_LEGGINGS` | `minecraft:iron-leggings` | registered at PR #91 head |
| `iron-ingot-to-iron-boots` | `IRON_BOOTS` | `minecraft:iron-boots` | registered at PR #91 head |
| `gold-ingot-to-gold-helmet` | `GOLD_HELMET` | `minecraft:gold_helmet` | registered at PR #91 head |
| `gold-ingot-to-gold-chestplate` | `GOLD_CHESTPLATE` | `minecraft:gold_chestplate` | registered at PR #91 head |
| `gold-ingot-to-gold-leggings` | `GOLD_LEGGINGS` | `minecraft:gold_leggings` | registered at PR #91 head |
| `gold-ingot-to-gold-boots` | `GOLD_BOOTS` | `minecraft:gold_boots` | registered at PR #91 head |
| `diamond-to-diamond-helmet` | `DIAMOND_HELMET` | `minecraft:diamond-helmet` | registered at PR #91 head |
| `diamond-to-diamond-chestplate` | `DIAMOND_CHESTPLATE` | `minecraft:diamond-chestplate` | registered at PR #91 head |
| `diamond-to-diamond-leggings` | `DIAMOND_LEGGINGS` | `minecraft:diamond-leggings` | registered at PR #91 head |
| `diamond-to-diamond-boots` | `DIAMOND_BOOTS` | `minecraft:diamond-boots` | registered at PR #91 head |
| `wood-to-planks` | `PLANKS` | `minecraft:oak-planks` | registered at PR #91 head |
| `planks-to-sticks` | `STICKS` | `minecraft:stick` | registered at PR #91 head |
| `planks-to-crafting-table` | `CRAFTING_TABLE` | `minecraft:crafting-table` | registered at PR #91 head |
| `cobblestone-to-furnace` | `FURNACE` | `minecraft:furnace` | registered at PR #91 head |
| `planks-to-chest` | `CHEST` | `minecraft:chest` | registered at PR #91 head |
| `book-diamonds-obsidian-to-enchanting-table` | `ENCHANTING_TABLE` | `minecraft:enchanting-table` | registered at PR #91 head |
| `iron-blocks-iron-ingots-to-anvil` | `ANVIL` | `minecraft:anvil` | registered at PR #91 head |
| `iron-ingots-to-cauldron` | `CAULDRON` | `minecraft:cauldron` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-rails` | `RAIL` | `minecraft:rail` | registered at PR #91 head |
| `gold-redstone-to-powered-rails` | `POWERED_RAIL` | `minecraft:powered-rail` | not registered at PR #91 head |
| `planks-to-door` | `DOOR` | `minecraft:door` | registered at PR #91 head |
| `sticks-to-ladder` | `LADDER` | `minecraft:ladder` | registered at PR #91 head |
| `sugar-cane-to-paper` | `PAPER` | `minecraft:paper` | registered at PR #91 head |
| `iron-ingots-redstone-dust-to-compass` | `COMPASS` | `minecraft:compass` | registered at PR #91 head |
| `gold-ingots-redstone-dust-to-clock` | `CLOCK` | `minecraft:clock` | registered at PR #91 head |
| `paper-compass-to-map` | `MAP` | `minecraft:map` | not registered at PR #91 head |
| `glowstone-dust-to-glowstone` | `GLOWSTONE` | `minecraft:glowstone` | registered at PR #91 head |
| `blaze-rod-and-cobblestone-to-brewing-stand` | `BREWING_STAND` | `minecraft:brewing_stand` | registered at PR #91 head |
| `blaze-rod-to-blaze-powder` | `BLAZE_POWDER` | `minecraft:blaze_powder` | registered at PR #91 head |
| `ender-pearl-and-blaze-powder-to-ender-eye` | `ENDER_EYE` | `minecraft:eye-of-ender` | registered at PR #91 head |
| `glass-to-bottles` | `GLASS_BOTTLE` | `minecraft:glass-bottle` | not registered at PR #91 head |
| `bottle-and-nether-wart-to-awkward` | `POTION_AWKWARD` | `minecraft:awkward_potion` | registered at PR #91 head |
| `awkward-and-redstone-to-swiftness` | `POTION_SWIFTNESS` | `minecraft:swiftness` | registered at PR #91 head |
| `swiftness-and-redstone-to-swiftness-long` | `POTION_SWIFTNESS_LONG` | `minecraft:long_swiftness` | registered at PR #91 head |
| `swiftness-and-glowstone-to-swiftness-ii` | `POTION_SWIFTNESS_II` | `minecraft:strong_swiftness` | registered at PR #91 head |
| `healing-and-glowstone-to-healing-ii` | `POTION_HEALING_II` | `minecraft:strong_healing` | registered at PR #91 head |
| `awkward-and-glowstone-to-healing` | `POTION_HEALING` | `minecraft:healing` | not registered at PR #91 head |
| `glowstone-and-redstone-to-lamp` | `REDSTONE_LAMP` | `minecraft:redstone-lamp` | registered at PR #91 head |
| `coal-and-stick-to-torches` | `TORCH` | `minecraft:torch` | registered at PR #91 head |
| `charcoal-and-stick-to-torches` | `TORCH` | `minecraft:torch` | registered at PR #91 head |
| `string-and-sticks-to-bow` | `BOW` | `minecraft:bow` | registered at PR #91 head |
| `planks-and-iron-ingot-to-shield` | `SHIELD` | `minecraft:shield` | not registered at PR #91 head |
| `planks-to-boat` | `BOAT` | `minecraft:oak-boat` | registered at PR #91 head |
| `iron-ingots-to-minecart` | `MINECART` | `minecraft:minecart` | registered at PR #91 head |
| `gold-and-apple-to-golden-apple` | `GOLDEN_APPLE` | `minecraft:golden-apple` | not registered at PR #91 head |
| `wool-and-planks-to-bed` | `BED` | `minecraft:bed` | registered at PR #91 head |
| `sticks-and-string-to-fishing-rod` | `FISHING_ROD` | `minecraft:fishing-rod` | registered at PR #91 head |
| `iron-ingots-to-shears` | `SHEARS` | `minecraft:shears` | registered at PR #91 head |
| `bone-to-bone-meal` | `BONE_MEAL` | `minecraft:bone-meal` | registered at PR #91 head |
| `wheat-to-bread` | `BREAD` | `minecraft:bread` | registered at PR #91 head |
| `flint-stick-feather-to-arrows` | `ARROW` | `minecraft:arrow` | not registered at PR #91 head |
| `iron-ingots-to-bucket` | `BUCKET` | `minecraft:bucket` | registered at PR #91 head |
| `flint-and-iron-to-flint-and-steel` | `FLINT_AND_STEEL` | `minecraft:flint-and-steel` | registered at PR #91 head |
| `wood-to-charcoal` | `CHARCOAL` | `minecraft:charcoal` | registered at PR #91 head |
| `raw-iron-to-iron-ingot` | `IRON_INGOT` | `minecraft:iron_ingot_from_raw_iron` | registered at PR #91 head |
| `raw-gold-to-gold-ingot` | `GOLD_INGOT` | `minecraft:gold_ingot_from_raw_gold` | registered at PR #91 head |
| `cobblestone-to-stone` | `STONE` | `minecraft:stone` | registered at PR #91 head |
| `stone-to-pressure-plate` | `PRESSURE_PLATE` | `minecraft:pressure-plate` | registered at PR #91 head |
| `stone-to-stone-slab` | `STONE_SLAB` | `minecraft:stone-slab` | registered at PR #91 head |
| `planks-to-oak-stairs` | `OAK_STAIRS` | `minecraft:oak-stairs` | registered at PR #91 head |
| `coal-to-coal-block` | `COAL_BLOCK` | `minecraft:coal-block` | registered at PR #91 head |
| `coal-block-to-coal` | `COAL` | `minecraft:coal-from-block` | registered at PR #91 head |
| `iron-ingots-to-iron-block` | `IRON_BLOCK` | `minecraft:iron-block` | registered at PR #91 head |
| `iron-block-to-iron-ingots` | `IRON_INGOT` | `minecraft:iron-from-block` | registered at PR #91 head |
| `gold-ingots-to-gold-block` | `GOLD_BLOCK` | `minecraft:gold-block` | registered at PR #91 head |
| `gold-block-to-gold-ingots` | `GOLD_INGOT` | `minecraft:gold-ingot` | registered at PR #91 head |
| `diamonds-to-diamond-block` | `DIAMOND_BLOCK` | `minecraft:diamond-block` | registered at PR #91 head |
| `diamond-block-to-diamonds` | `DIAMOND` | `minecraft:diamond-from-block` | registered at PR #91 head |
| `redstone-dust-to-redstone-block` | `REDSTONE_BLOCK` | `minecraft:redstone-block` | registered at PR #91 head |
| `redstone-block-to-redstone-dust` | `REDSTONE_DUST` | `minecraft:redstone-from-block` | registered at PR #91 head |
| `lapis-lazuli-to-lapis-block` | `LAPIS_BLOCK` | `minecraft:lapis-block` | registered at PR #91 head |
| `lapis-block-to-lapis-lazuli` | `LAPIS_LAZULI` | `minecraft:lapis-from-block` | registered at PR #91 head |
| `emeralds-to-emerald-block` | `EMERALD_BLOCK` | `minecraft:emerald-block` | registered at PR #91 head |
| `emerald-block-to-emeralds` | `EMERALD` | `minecraft:emerald-from-block` | registered at PR #91 head |
| `sand-to-glass` | `GLASS` | `minecraft:glass` | registered at PR #91 head |
| `raw-beef-to-cooked-beef` | `COOKED_BEEF` | `minecraft:cooked_beef` | registered at PR #91 head |
| `raw-pork-to-cooked-porkchop` | `COOKED_PORKCHOP` | `minecraft:cooked_porkchop` | registered at PR #91 head |
| `raw-mutton-to-cooked-mutton` | `COOKED_MUTTON` | `minecraft:cooked_mutton` | registered at PR #91 head |
| `raw-chicken-to-cooked-chicken` | `COOKED_CHICKEN` | `minecraft:cooked_chicken` | registered at PR #91 head |
| `raw-cod-to-cooked-cod` | `COOKED_COD` | `minecraft:cooked_cod` | registered at PR #91 head |
| `raw-salmon-to-cooked-salmon` | `COOKED_SALMON` | `minecraft:cooked_salmon` | registered at PR #91 head |
| `planks-and-sticks-to-wooden-sword` | `WOODEN_SWORD` | `minecraft:wooden-sword` | registered at PR #91 head |
| `cobblestone-and-sticks-to-stone-sword` | `STONE_SWORD` | `minecraft:stone-sword` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-iron-sword` | `IRON_SWORD` | `minecraft:iron-sword` | registered at PR #91 head |
| `diamonds-and-sticks-to-diamond-sword` | `DIAMOND_SWORD` | `minecraft:diamond-sword` | registered at PR #91 head |
| `gold-ingots-and-sticks-to-gold-sword` | `GOLD_SWORD` | `minecraft:gold-sword` | registered at PR #91 head |
| `planks-and-sticks-to-wooden-pickaxe` | `WOODEN_PICKAXE` | `minecraft:wooden-pickaxe` | registered at PR #91 head |
| `cobblestone-and-sticks-to-stone-pickaxe` | `STONE_PICKAXE` | `minecraft:stone-pickaxe` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-iron-pickaxe` | `IRON_PICKAXE` | `minecraft:iron-pickaxe` | registered at PR #91 head |
| `diamonds-and-sticks-to-diamond-pickaxe` | `DIAMOND_PICKAXE` | `minecraft:diamond-pickaxe` | registered at PR #91 head |
| `gold-ingots-and-sticks-to-gold-pickaxe` | `GOLD_PICKAXE` | `minecraft:gold-pickaxe` | registered at PR #91 head |
| `planks-and-sticks-to-wooden-shovel` | `WOODEN_SHOVEL` | `minecraft:wooden-shovel` | registered at PR #91 head |
| `cobblestone-and-sticks-to-stone-shovel` | `STONE_SHOVEL` | `minecraft:stone-shovel` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-iron-shovel` | `IRON_SHOVEL` | `minecraft:iron-shovel` | registered at PR #91 head |
| `diamonds-and-sticks-to-diamond-shovel` | `DIAMOND_SHOVEL` | `minecraft:diamond-shovel` | registered at PR #91 head |
| `gold-ingots-and-sticks-to-gold-shovel` | `GOLD_SHOVEL` | `minecraft:gold-shovel` | registered at PR #91 head |
| `planks-and-sticks-to-wooden-hoe` | `WOODEN_HOE` | `minecraft:wooden-hoe` | registered at PR #91 head |
| `cobblestone-and-sticks-to-stone-hoe` | `STONE_HOE` | `minecraft:stone-hoe` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-iron-hoe` | `IRON_HOE` | `minecraft:iron-hoe` | registered at PR #91 head |
| `diamonds-and-sticks-to-diamond-hoe` | `DIAMOND_HOE` | `minecraft:diamond-hoe` | registered at PR #91 head |
| `gold-ingots-and-sticks-to-gold-hoe` | `GOLD_HOE` | `minecraft:gold-hoe` | registered at PR #91 head |
| `planks-and-sticks-to-wooden-axe` | `WOODEN_AXE` | `minecraft:wooden-axe` | registered at PR #91 head |
| `cobblestone-and-sticks-to-stone-axe` | `STONE_AXE` | `minecraft:stone-axe` | registered at PR #91 head |
| `iron-ingots-and-sticks-to-iron-axe` | `IRON_AXE` | `minecraft:iron-axe` | registered at PR #91 head |
| `diamonds-and-sticks-to-diamond-axe` | `DIAMOND_AXE` | `minecraft:diamond-axe` | registered at PR #91 head |
| `gold-ingots-and-sticks-to-gold-axe` | `GOLD_AXE` | `minecraft:gold-axe` | registered at PR #91 head |

## Mob IDs

`takeokunn/ts-minecraft/docs/reference/vanilla-parity.md` defines the required 20-mob roster; source values are from `packages/entity/domain/mob/entity.ts`.

| Reference EntityType | Expected mx-gameplay key | Reference EntityType | Expected mx-gameplay key |
| --- | --- | --- | --- |
| `Zombie` | `zombie` | `Skeleton` | `skeleton` |
| `Creeper` | `creeper` | `Spider` | `spider` |
| `Enderman` | `enderman` | `Witch` | `witch` |
| `Drowned` | `drowned` | `ZombieVillager` | `zombie_villager` |
| `Blaze` | `blaze` | `Ghast` | `ghast` |
| `Shulker` | `shulker` | `EnderDragon` | `ender_dragon` |
| `Villager` | `villager` | `Cow` | `cow` |
| `Pig` | `pig` | `Sheep` | `sheep` |
| `Chicken` | `chicken` | `Bat` | `bat` |
| `Squid` | `squid` | `Bee` | `bee` |

## Biome IDs

`takeokunn/ts-minecraft/packages/world/domain/biome.ts` → `nerima-games/mc-worldgen/src/domain/biome.ts`.

| Reference BiomeType | mc-worldgen key | Registration | Reference BiomeType | mc-worldgen key | Registration |
| --- | --- | --- | --- | --- | --- |
| `PLAINS` | `PLAINS` | `present` | `DESERT` | `DESERT` | `present` |
| `FOREST` | `FOREST` | `present` | `FLOWER_FOREST` | `FLOWER_FOREST` | `present` |
| `OCEAN` | `OCEAN` | `present` | `MOUNTAINS` | `MOUNTAINS` | `present` |
| `SNOW` | `SNOW` | `present` | `SWAMP` | `SWAMP` | `present` |
| `JUNGLE` | `JUNGLE` | `present` | `BEACH` | `BEACH` | `present` |
| `RIVER` | `RIVER` | `present` | `TAIGA` | `TAIGA` | `present` |
| `SAVANNA` | `SAVANNA` | `present` |  |  |  |
