#!/usr/bin/env bash
# Codex CLI 설치와 로그인 (클라우드 세션은 매번 새로 시작되므로 세션마다 실행)
# 필요 조건: 환경 설정에 OPENAI_API_KEY 등록, 네트워크 허용 도메인에 api.openai.com 추가
set -e

if ! command -v codex >/dev/null 2>&1; then
  npm i -g @openai/codex
fi
codex --version

if [ -n "$OPENAI_API_KEY" ]; then
  printenv OPENAI_API_KEY | codex login --with-api-key
  codex login status
else
  echo "OPENAI_API_KEY가 없습니다. 환경 설정에 API 키를 등록한 뒤 새 세션에서 다시 실행하세요."
  exit 1
fi
