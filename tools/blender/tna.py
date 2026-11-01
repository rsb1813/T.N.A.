"""T.N.A. Blender 헬퍼. 헤드리스 Blender 스크립트에서 import 해서 쓴다.

    blender -b --factory-startup -P tools/blender/examples/crate.py -- out/crate.glb

스크립트 맨 위에서 이 폴더를 sys.path 에 넣는다:

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    import tna

좌표 규칙: Blender 는 Z-up, glTF 는 Y-up. 내보낼 때 자동 변환되고,
Blender 의 -Y 방향(정면 뷰에서 보이는 면)이 glTF/게임 엔진의 +Z(앞)가 된다. 1 단위 = 1m.
"""

import os
import sys

import bpy
import bmesh
import numpy as np


def script_args():
    """명령줄에서 '--' 뒤에 넘긴 인자 목록."""
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def reset_scene():
    """빈 씬으로 초기화(기본 큐브/카메라/라이트 없음)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color=(0.8, 0.8, 0.8, 1.0), roughness=0.6, metallic=0.0, image=None, emission=None):
    """Principled BSDF 머티리얼. glTF metallic-roughness 로 그대로 내보내진다."""
    mat = bpy.data.materials.new(name)
    if not getattr(mat, "use_nodes", True):
        mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.location = (bsdf.location.x - 320, bsdf.location.y)
        links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def image_from_array(name, rgba):
    """numpy 배열(H x W x 3|4, 0..1, 위쪽 행이 이미지 위)로 PNG 이미지를 만들어 .blend 에 묶는다."""
    rgba = np.asarray(rgba, dtype=np.float32)
    if rgba.shape[2] == 3:
        rgba = np.concatenate([rgba, np.ones(rgba.shape[:2] + (1,), np.float32)], axis=2)
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).ravel())  # Blender 는 아래 행부터
    img.file_format = "PNG"
    img.pack()
    return img


def new_mesh_object(name, bm, collection=None):
    """bmesh 로 만든 메쉬를 오브젝트로 씬에 추가한다."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def box_uv(bm, tile=1.0):
    """박스 매핑 UV: 면 방향별로 월드 좌표를 그대로 UV 로(텍스처 1장 = tile 미터)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[ax]
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co[a] / tile, co[b] / tile)


def add_box(bm, size, center, mat_index=0):
    """bmesh 에 축 정렬 박스를 추가한다. size/center 는 (x, y, z) 미터."""
    from mathutils import Matrix

    m = Matrix.Translation(center) @ Matrix.Diagonal((*size, 1.0))
    geom = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat_index
    return geom


def scene_stats():
    """모디파이어 적용 후 기준 삼각형 수 등 요약."""
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
    return {"objects": len(bpy.context.scene.objects), "triangles": tris, "materials": len(bpy.data.materials)}


def export_glb(path, selection=False, **kwargs):
    """씬(또는 선택)을 GLB 로 내보낸다. 모디파이어는 적용되고 Y-up 으로 변환된다."""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    params = dict(
        filepath=path,
        export_format="GLB",
        use_selection=selection,
        export_apply=True,
        export_yup=True,
    )
    params.update(kwargs)
    bpy.ops.export_scene.gltf(**params)
    print(f"[tna] GLB 저장: {path}  {scene_stats()}")
    return path


def save_blend(path):
    """편집 가능한 원본(.blend)도 남긴다. 텍스처는 파일 안에 묶여 있다."""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    print(f"[tna] .blend 저장: {path}")
    return path
