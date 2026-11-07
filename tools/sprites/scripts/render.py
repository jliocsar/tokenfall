"""Headless Blender renderer for hero sprites and tile sprites.
Usage: blender -b --factory-startup --disable-autoexec -P render.py -- config.json
Camera: orthographic 2:1 dimetric (60 deg from vertical). Fixed pixels-per-unit, so
heroes and tiles line up. Ground origin always lands on the pivot in the image.
"""
import bpy, json, math, os, sys, time

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
CELL = cfg.get('cell', 128)
SS = cfg.get('ss', 2)
PPU = cfg.get('ppu', 25.6)          # final pixels per Blender unit
PIVOT_Y = cfg.get('pivot_y', 0.8)   # ground origin, fraction of cell from the top
ELEV_FROM_VERTICAL = math.radians(60)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'BLENDER_EEVEE'
    s.eevee.taa_render_samples = cfg.get('samples', 16)
    s.render.film_transparent = True
    s.render.resolution_x = s.render.resolution_y = CELL * SS
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.render.filter_size = 0.8
    # camera
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = CELL / PPU
    cam.clip_start, cam.clip_end = 0.1, 200
    co = bpy.data.objects.new('cam', cam)
    s.collection.objects.link(co)
    co.rotation_euler = (ELEV_FROM_VERTICAL, 0, 0)
    # pick the look-at so z=0 at the origin lands on the pivot
    offset_units = (PIVOT_Y - 0.5) * cam.ortho_scale
    z_target = offset_units / math.sin(ELEV_FROM_VERTICAL)
    d = 50
    co.location = (0, -d * math.sin(ELEV_FROM_VERTICAL), z_target + d * math.cos(ELEV_FROM_VERTICAL))
    s.camera = co
    # lights: warm key front-left-high, cool rim behind-right
    def sun(name, rot, energy, color, angle=8):
        l = bpy.data.lights.new(name, 'SUN')
        l.energy, l.color, l.angle = energy, color, math.radians(angle)
        l.use_shadow = cfg.get('shadows', True)  # tiles turn this off, or every wall piece gets its own seam
        o = bpy.data.objects.new(name, l)
        s.collection.objects.link(o)
        o.rotation_euler = tuple(math.radians(x) for x in rot)
    sun('key', (50, 0, -12), cfg.get('key', 3.2), (1.0, 0.82, 0.62))
    sun('rim', (70, 0, 145), cfg.get('rim', 2.6), (0.55, 0.68, 1.0))
    w = bpy.data.worlds.new('w')
    s.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background') or w.node_tree.nodes.new('ShaderNodeBackground')
    bg.inputs[0].default_value = (0.42, 0.45, 0.6, 1)
    bg.inputs[1].default_value = cfg.get('ambient', 0.35)
    return s


def matte(o):
    for m in o.data.materials:
        if not m or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Roughness'].default_value = 0.85
                if 'Specular IOR Level' in n.inputs:
                    n.inputs['Specular IOR Level'].default_value = 0.15


def tint(o, hue, sat, val):
    """Per-object hue shift: copies the material so other objects keep their colors."""
    for i, m in enumerate(o.data.materials):
        if not m or not m.node_tree:
            continue
        m = m.copy()
        o.data.materials[i] = m
        t = m.node_tree
        bsdf = next((n for n in t.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf or not bsdf.inputs['Base Color'].links:
            continue
        src = bsdf.inputs['Base Color'].links[0].from_socket
        hs = t.nodes.new('ShaderNodeHueSaturation')
        hs.inputs['Hue'].default_value = hue
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = val
        t.links.new(src, hs.inputs['Color'])
        t.links.new(hs.outputs['Color'], bsdf.inputs['Base Color'])


def assign(rig, action):
    ad = rig.animation_data or rig.animation_data_create()
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    ad.action = action
    slots = [sl for sl in action.slots if sl.target_id_type == 'OBJECT'] or list(action.slots)
    if slots:
        ad.action_slot = slots[0]


def render_to(path):
    s = bpy.context.scene
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


def hero():
    s = reset_scene()
    bpy.ops.import_scene.gltf(filepath=cfg['glb'])
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    hide = set(cfg.get('hide', []))
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        if o.name in hide:
            o.hide_render = True
            o.hide_viewport = True
            continue
        matte(o)
    t = cfg.get('tint')
    if t:
        for o in bpy.data.objects:
            if o.type == 'MESH' and not o.hide_render and not any(k in o.name for k in t.get('skip', [])) and (not t.get('only') or any(k in o.name for k in t['only'])):
                tint(o, t.get('hue', 0.5), t.get('sat', 1.0), t.get('val', 1.0))
    rig.rotation_mode = 'XYZ'
    # keyed bone scale gets re-evaluated at render, so shrink through a constraint
    for b, v in cfg.get('bone_scale', {}).items():
        c = rig.pose.bones[b].constraints.new('LIMIT_SCALE')
        c.use_max_x = c.use_max_y = c.use_max_z = True
        c.max_x = c.max_y = c.max_z = v
        c.owner_space = 'LOCAL'
    os.makedirs(cfg['out'], exist_ok=True)
    t0 = time.time()
    n = 0
    for act, frames in cfg['actions'].items():
        a = bpy.data.actions.get(act)
        if a is None:
            print('RENDER missing action', act)
            continue
        assign(rig, a)
        f0, f1 = a.frame_range
        for fi in range(frames):
            f = f0 + (f1 - f0) * fi / max(frames, 1)
            s.frame_set(int(f), subframe=f - int(f))
            for d in cfg['dirs']:
                rig.rotation_euler = (0, 0, math.radians(45 * d))
                bpy.context.view_layer.update()
                render_to(os.path.join(cfg['out'], f'{act}_d{d}_f{fi}.png'))
                n += 1
    print(f'RENDER {cfg["name"]} frames={n} seconds={time.time() - t0:.1f}')


def tiles():
    os.makedirs(cfg['out'], exist_ok=True)
    t0 = time.time()
    for item in cfg['tiles']:
        s = reset_scene()
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=item['glb'])
        new = [o for o in bpy.data.objects if o not in before]
        roots = [o for o in new if o.parent is None]
        lo = [1e9] * 3
        hi = [-1e9] * 3
        from mathutils import Vector
        for o in new:
            if o.type == 'MESH':
                matte(o)
                for c in o.bound_box:
                    w = o.matrix_world @ Vector(c)
                    for k in range(3):
                        lo[k], hi[k] = min(lo[k], w[k]), max(hi[k], w[k])
        print('BBOX', item['name'], [round(x, 2) for x in lo], [round(x, 2) for x in hi])
        for r in roots:
            r.rotation_mode = 'XYZ'
            # grid axes sit at 45 deg to the camera, that's what makes the diamonds
            r.rotation_euler = (0, 0, math.radians(item.get('rot', 0) + 45))
            r.location = tuple(item.get('loc', (0, 0, 0)))
            r.scale = (item.get('scale', 1),) * 3
        bpy.context.view_layer.update()
        render_to(os.path.join(cfg['out'], item['name'] + '.png'))
    print(f'RENDER tiles n={len(cfg["tiles"])} seconds={time.time() - t0:.1f}')


(hero if cfg['mode'] == 'hero' else tiles)()
