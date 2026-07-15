FROM alpine:3.20

# OpenSSH server + python (for an internal-only web server used to prove the tunnel)
# tzdata + a distinctive timezone so the browser clock-spoofing can be verified.
RUN apk add --no-cache openssh python3 curl tzdata && \
    cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    echo 'Asia/Tokyo' > /etc/timezone && \
    ssh-keygen -A && \
    echo 'root:testpass123' | chpasswd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config && \
    mkdir -p /var/www && \
    printf '<h1>Tunnel OK</h1><p>Served from inside the SSH container on 127.0.0.1:8000</p>' > /var/www/index.html

EXPOSE 22

# The HTTP server binds to 127.0.0.1 ONLY and is NOT published to the host.
# It is therefore reachable exclusively through the SSH tunnel (forwardOut),
# which is exactly what proves browser traffic goes through SSH.
CMD ["sh", "-c", "python3 -m http.server 8000 --directory /var/www --bind 127.0.0.1 & exec /usr/sbin/sshd -D -e"]
