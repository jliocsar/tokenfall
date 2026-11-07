pkill -f 'git-remote-https origin https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures' ; sleep 1; rm -rf /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/kaykit/repo
mkdir -p /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/kaykit/gltf /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/dungeon/gltf
cd /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/kaykit/gltf
curl -sSfL -o LICENSE.txt https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/LICENSE.txt
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Barbarian.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Mage.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Rogue.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/Rogue_Hooded.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/barbarian_texture.png &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/knight_texture.png &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/mage_texture.png &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/rogue_texture.png &
wait
cd /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/dungeon/gltf
curl -sSfL -o LICENSE.txt https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/LICENSE.txt
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_small.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_small_broken_A.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_small_broken_B.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_small_decorated.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_small_weeds_A.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_tile_large.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/floor_dirt_small_A.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/wall.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/wall_broken.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/wall_arched.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/pillar.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/torch_mounted.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/torch_lit.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/barrel_large.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/barrel_small_stack.gltf.glb &
curl -sSfL -O https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf/chest.glb &
wait
echo done > /home/jliocsar/Projects/claude-agents-visualizer/tmp/sprites/download/.ok