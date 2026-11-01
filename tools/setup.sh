#!/usr/bin/env bash
# T.N.A. 3D 작업 도구 설치 스크립트. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).
#   - Blender (헤드리스 모델링/리깅/애니메이션/GLB 내보내기)
#   - Python 라이브러리 (tools/requirements.txt)
#   - Node 패키지 (three.js, glTF-Transform)
# Linux x64 + root 권한 기준(클라우드 세션용).
set -euo pipefail

BLENDER_VERSION="${BLENDER_VERSION:-5.2.3}"
BLENDER_SERIES="${BLENDER_VERSION%.*}"
BLENDER_DIR="/opt/blender-${BLENDER_VERSION}-linux-x64"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n[setup] %s\n' "$*"; }

# 1) Blender
if [ ! -x "$BLENDER_DIR/blender" ]; then
  log "Blender ${BLENDER_VERSION} 다운로드"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  base="https://download.blender.org/release/Blender${BLENDER_SERIES}"
  tarball="blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$tarball" "$base/$tarball"
  curl -fsSL -o "$tmp/sums" "$base/blender-${BLENDER_VERSION}.sha256"
  (cd "$tmp" && grep -F "$tarball" sums | sha256sum -c -)
  tar -xf "$tmp/$tarball" -C /opt
else
  log "Blender ${BLENDER_VERSION} 이미 설치됨"
fi
ln -sfn "$BLENDER_DIR" /opt/blender
ln -sf /opt/blender/blender /usr/local/bin/blender

# 2) Python 라이브러리
log "Python 라이브러리 설치"
python3 -m pip install -q --root-user-action=ignore -r "$REPO_DIR/tools/requirements.txt"

# 3) Node 패키지
log "Node 패키지 설치"
(cd "$REPO_DIR" && npm ci --no-audit --no-fund --loglevel=error)

# 4) 확인
log "설치 확인"
blender --version | head -1
python3 -c "import trimesh, manifold3d, pygltflib; print('trimesh', trimesh.__version__)"
(cd "$REPO_DIR" && npx --no-install gltf-transform --version | tail -1 | sed 's/^/gltf-transform /')
if node -e "require('playwright')" 2>/dev/null; then
  echo "playwright OK (미리보기 렌더 가능)"
else
  echo "경고: playwright 를 찾을 수 없음. tools/preview.mjs 는 동작하지 않는다." >&2
fi
