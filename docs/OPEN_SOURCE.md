# 오픈소스 활용 정리 (Motion Party)

## 1. 실행 의존성

| 라이브러리 | 요구 버전 | 일반적인 라이선스 | 용도 |
|---|---|---|---|
| FastAPI | 미고정 | MIT | 웹 서버, WebSocket |
| Uvicorn | 미고정 | BSD-3-Clause | ASGI 서버 |
| qrcode | 미고정 | BSD-3-Clause | 참가 QR 코드 |
| Pillow | 미고정 | MIT-CMU (및 구성 요소별 고지) | 이미지 처리 |
| Pymunk | 7.3.1 | MIT | 공 굴리기 물리 |
| pathfinding | 1.0.23 | MIT | 경로 탐색 |
| Howler.js | 2.2.4 | MIT | 브라우저 BGM 및 효과음 |

Python 패키지는 requirements.txt로 설치하며, 개발용 pytest와 httpx는 requirements-dev.txt에 기록합니다. 미고정 버전 및 전이 의존성의 정확한 라이선스는 실제 설치 환경에서 확인해야 합니다. Docker 이미지나 설치된 패키지 자체를 재배포할 때는 해당 구성 요소의 고지도 유지해야 합니다.

## 2. 저장소에 포함된 외부 파일

- Howler.js: [MIT 라이선스 전문](../web/vendor/howler/LICENSE.md)을 유지합니다.
- 좀비 게임 그래픽: [ASSET-CREDITS.md](../games/monster_escape/client/ASSET-CREDITS.md).
- 좀비 게임 음원: [LICENSE.md](../web/audio/zombie/LICENSE.md).
- 외부 이미지와 음원은 각 출처의 CC0 1.0 조건에 따라 이용하며 출처를 자발적으로 기록합니다. 프로젝트 자체 라이선스와 외부 파일의 라이선스는 구분합니다.

## 3. 개발 도구

pytest (MIT), httpx (BSD-3-Clause), Git (GPL-2.0), mkcert (BSD-3-Clause), cloudflared (Apache-2.0). 도구를 사용하는 것과 도구 바이너리를 재배포하는 것은 별개입니다.

## 4. 확인 방법

```bash
python -m pip list
python -m pip show pymunk pathfinding
python -m pytest -q
```

새 외부 에셋이나 라이브러리를 추가할 때 원본 출처, 라이선스와 실제 파일을 확인하고 관련 고지 문서를 갱신합니다.
