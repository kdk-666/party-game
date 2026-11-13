import os
import socket
import subprocess
import sys

import uvicorn

PORT = 8000
CERT = os.path.join("certs", "cert.pem")
KEY = os.path.join("certs", "key.pem")
IP_FILE = os.path.join("certs", "ip.txt")


def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    if os.path.exists(CERT) and os.path.exists(KEY) and os.path.exists(IP_FILE):
        with open(IP_FILE) as f:
            if f.read().strip() == ip:
                return
    os.makedirs("certs", exist_ok=True)
    print(f"IP가 {ip}(으)로 바뀌어 인증서를 새로 만듭니다...")
    try:
        subprocess.run(["mkcert", "-key-file", KEY, "-cert-file", CERT, ip, "localhost"], check=True)
    except FileNotFoundError:
        sys.exit("mkcert를 찾을 수 없어요. 설치 후 PowerShell을 다시 열어 주세요.")
    with open(IP_FILE, "w") as f:
        f.write(ip)


def print_qr(url):
    import qrcode
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make()
    qr.print_ascii(invert=True)


if __name__ == "__main__":
    ip = get_local_ip()
    ensure_cert(ip)
    url = f"https://{ip}:{PORT}"
    print("\n폰으로 아래 QR을 스캔하거나 주소를 입력하세요:")
    print_qr(url)
    print(url, "\n")
    uvicorn.run("server.main:app", host="0.0.0.0", port=PORT, ssl_keyfile=KEY, ssl_certfile=CERT)
