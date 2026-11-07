import bpy, sys
argv = sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
print('ENGINES', [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items])
for o in bpy.data.objects:
    print('OBJ', o.name, o.type, 'parent=', o.parent.name if o.parent else None, 'ptype=', o.parent_type, 'pbone=', o.parent_bone, 'mats=', [m.name for m in o.data.materials] if o.type=='MESH' else '', 'verts=', len(o.data.vertices) if o.type=='MESH' else '', 'dim=', tuple(round(x,2) for x in o.dimensions), 'cons=', [c.type for c in o.constraints], 'vis=', not o.hide_render)
acts = sorted(bpy.data.actions.keys())
print('N_ACTIONS', len(acts))
for n in acts:
    a=bpy.data.actions[n]
    print('ACT', n, tuple(round(x,1) for x in a.frame_range))
print('IMAGES', [(i.name, i.size[0], i.size[1]) for i in bpy.data.images])
for m in bpy.data.materials:
    print('MAT', m.name, [ (n.type, n.name) for n in m.node_tree.nodes] if m.use_nodes else None)
