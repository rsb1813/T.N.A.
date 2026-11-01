#!/usr/bin/env bash
# 모든 모델 스크립트(tools/blender/{aircraft,weapons,units}/*.py)를 빌드해 public/models/<이름>.glb 로 내보내고
# gltf-transform 으로 검증한 뒤 요약 표를 출력한다.
#
#   tools/blender/build_all.sh                 # 전부
#   tools/blender/build_all.sh f15ex aim120    # 일부만 (스크립트 이름 = 모델 id)
#   tools/blender/build_all.sh -j 4            # 4 개씩 병렬
#   tools/blender/build_all.sh --list          # 빌드 대상 목록만
#
# 제외: 이름이 _ 로 시작하는 파일, common.py / *_common.py (도우미 모듈), build_*.py (빌드 도구),
#       첫 20 줄 안에 '# tna: helper' 주석이 있는 파일, 모델을 내보내지 않는 파일(finish( / export_glb 없음).
# 로그: out/build/<이름>.log   종료 코드: 실패가 하나라도 있으면 1.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
OUTDIR="$ROOT/public/models"
LOGDIR="$ROOT/out/build"
mkdir -p "$OUTDIR" "$LOGDIR"

JOBS=1
LIST_ONLY=0
IDS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -j) JOBS="$2"; shift 2 ;;
    -j*) JOBS="${1#-j}"; shift ;;
    --list) LIST_ONLY=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) IDS+=("$1"); shift ;;
  esac
done

BLENDER=${BLENDER:-blender}
GT="$ROOT/node_modules/.bin/gltf-transform"
[ -x "$GT" ] || GT="npx gltf-transform"

is_helper() {
  local f="$1" n
  n=$(basename "$f" .py)
  [[ "$n" == _* || "$n" == common || "$n" == *_common || "$n" == build_* ]] && return 0
  head -n 20 "$f" | grep -qE '^#[[:space:]]*tna:[[:space:]]*helper' && return 0
  grep -qE 'finish\(|export_glb' "$f" || return 0
  return 1
}

declare -A SCRIPT CAT
ORDER=()
for cat in aircraft weapons units; do
  for f in tools/blender/$cat/*.py; do
    [ -e "$f" ] || continue
    is_helper "$f" && continue
    n=$(basename "$f" .py)
    SCRIPT[$n]="$f"; CAT[$n]="$cat"; ORDER+=("$n")
  done
done

if [ ${#IDS[@]} -gt 0 ]; then
  SEL=()
  for id in "${IDS[@]}"; do
    if [ -n "${SCRIPT[$id]:-}" ]; then SEL+=("$id"); else echo "알 수 없는 모델 id: $id" >&2; fi
  done
else
  SEL=("${ORDER[@]}")
fi
if [ ${#SEL[@]} -eq 0 ]; then echo "빌드할 스크립트가 없다." >&2; exit 1; fi
if [ $LIST_ONLY -eq 1 ]; then for n in "${SEL[@]}"; do echo "${CAT[$n]}/$n"; done; exit 0; fi

# GLB 에서 삼각형 수 계산 (노드 인스턴스 포함)
tri_count() {
  python3 - "$1" <<'PY'
import json, struct, sys
b = open(sys.argv[1], 'rb').read()
n = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + n])
acc = j.get('accessors', [])
per_mesh = []
for m in j.get('meshes', []):
    t = 0
    for p in m['primitives']:
        mode = p.get('mode', 4)
        cnt = acc[p['indices']]['count'] if 'indices' in p else acc[p['attributes']['POSITION']]['count']
        t += cnt // 3 if mode == 4 else (max(cnt - 2, 0) if mode in (5, 6) else 0)
    per_mesh.append(t)
print(sum(per_mesh[nd['mesh']] for nd in j.get('nodes', []) if 'mesh' in nd))
PY
}

build_one() {
  local n="$1" f="${SCRIPT[$1]}" out="$OUTDIR/$1.glb" log="$LOGDIR/$1.log" res="$LOGDIR/$1.result"
  local t0 t1 status="OK" tris="-" kb="-" errs="-" warns="-"
  t0=$(date +%s)
  rm -f "$res"
  if ! "$BLENDER" -b --factory-startup -P "$f" -- "$out" >"$log" 2>&1 || [ ! -s "$out" ]; then
    status="BUILD_FAIL"
    grep -qE 'Traceback|Error' "$log" || true
  elif ! grep -q '\[tna\] GLB' "$log"; then
    status="BUILD_FAIL"
  fi
  if [ -s "$out" ] && [ "$status" = "OK" ]; then
    local vlog="$LOGDIR/$1.validate.txt"
    $GT validate "$out" >"$vlog" 2>&1
    local vcode=$?
    read -r errs warns < <(python3 - "$vlog" <<'PY'
import re, sys
txt = re.sub(r'\x1b\[[0-9;]*m', '', open(sys.argv[1], encoding='utf-8', errors='replace').read())
counts = {'ERROR': 0, 'WARNING': 0}
sec = None
for line in txt.splitlines():
    s = line.strip()
    if s in ('ERROR', 'WARNING', 'INFO', 'HINT'):
        sec = s
        continue
    if sec in counts and s.startswith('│') and not s.startswith('│ code'):
        counts[sec] += 1
print(counts['ERROR'], counts['WARNING'])
PY
)
    if [ "$vcode" -ne 0 ] || [ "${errs:-0}" != "0" ]; then status="INVALID"; fi
    tris=$(tri_count "$out" 2>/dev/null || echo "?")
    kb=$(( $(stat -c %s "$out") / 1024 ))
  fi
  t1=$(date +%s)
  echo "$n|${CAT[$n]}|$status|$tris|$kb|$errs|$warns|$((t1 - t0))" >"$res"
  printf '  %-22s %s\n' "$n" "$status"
}

echo "빌드 ${#SEL[@]} 개 (병렬 $JOBS) → public/models/"
running=0
for n in "${SEL[@]}"; do
  build_one "$n" &
  running=$((running + 1))
  if [ "$running" -ge "$JOBS" ]; then wait -n; running=$((running - 1)); fi
done
wait

echo
printf '%-10s %-22s %-11s %8s %8s %6s %6s %5s\n' "분류" "모델 id" "상태" "삼각형" "KB" "오류" "경고" "초"
printf '%s\n' "------------------------------------------------------------------------------------"
fail=0
for n in "${SEL[@]}"; do
  IFS='|' read -r name cat status tris kb errs warns secs <"$LOGDIR/$n.result"
  printf '%-10s %-22s %-11s %8s %8s %6s %6s %5s\n' "$cat" "$name" "$status" "$tris" "$kb" "$errs" "$warns" "$secs"
  [ "$status" = "OK" ] || fail=1
done
echo
if [ $fail -ne 0 ]; then
  echo "실패가 있다. 로그: out/build/<id>.log, 검증 결과: out/build/<id>.validate.txt" >&2
  exit 1
fi
echo "모두 성공."
