#!/usr/bin/env python3
"""무장 25 종 + 건물 8 종 GLB 를 한 번에 다시 만든다 (일반 python3 로 실행, 안에서 blender 를 부른다).

    python3 tools/blender/weapons/build_all.py              # 전부 생성 + glTF 검증
    python3 tools/blender/weapons/build_all.py aim120 bunker # 일부만
    python3 tools/blender/weapons/build_all.py --preview     # + tools/preview.mjs 4면 렌더 → out/models/<id>.png

출력: public/models/<id>.glb
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
UNITS = os.path.join(HERE, "..", "units")

WEAPONS = ["aim120", "aim9x", "aim7", "aim54", "agm88", "agm65", "agm158", "agm84", "gbu31", "gbu12", "gbu39",
           "mk82", "b61", "fueltank", "pod_targeting", "pod_irst", "r77", "r73", "r27", "r33", "meteor", "asraam",
           "sam_large", "sam_medium", "sam_small"]
BUILDINGS = ["hangar_has", "hangar_big", "building_block", "building_tower", "factory", "fuel_tank", "bunker",
             "comm_tower"]


def build(mid, preview):
    script = os.path.join(HERE if mid in WEAPONS else UNITS, f"{mid}.py")
    glb = os.path.join(REPO, "public", "models", f"{mid}.glb")
    r = subprocess.run(["blender", "-b", "--factory-startup", "-P", script, "--", glb],
                       capture_output=True, text=True, cwd=REPO)
    line = next((ln for ln in r.stdout.splitlines() if ln.startswith(f"[tna] {mid}:")), None)
    if r.returncode != 0 or line is None:
        return f"{mid}: 실패\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}"
    v = subprocess.run(["npx", "gltf-transform", "validate", glb], capture_output=True, text=True, cwd=REPO)
    ok = "No errors found" in v.stdout and "No warnings found" in v.stdout
    msg = f"{line[6:]}  검증 {'OK' if ok else '문제 있음'}"
    if preview:
        png = os.path.join(REPO, "out", "models", f"{mid}.png")
        subprocess.run(["node", "tools/preview.mjs", glb, png], capture_output=True, cwd=REPO)
        msg += f"  미리보기 {os.path.relpath(png, REPO)}"
    return msg


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    preview = "--preview" in sys.argv
    ids = args or WEAPONS + BUILDINGS
    unknown = [i for i in ids if i not in WEAPONS + BUILDINGS]
    if unknown:
        sys.exit(f"알 수 없는 id: {unknown}")
    with ThreadPoolExecutor(max_workers=4) as ex:
        for msg in ex.map(lambda i: build(i, preview), ids):
            print(msg, flush=True)


if __name__ == "__main__":
    main()
