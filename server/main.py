from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()  # 웹 서버 본체

@app.get("/", response_class=HTMLResponse)
def home():
    # 브라우저가 "/" 주소로 오면 이 HTML을 돌려준다
    return (
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<h1>Hello Motion Party!</h1><p id='s'>확인 중...</p>"
        "<script>document.getElementById('s').textContent = "
        "window.isSecureContext ? '보안 컨텍스트 OK' : '보안 컨텍스트 아님 (HTTPS 필요)';</script>"
    )