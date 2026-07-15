function te(e, t) {
    let n = (65535 & e) + (65535 & t);
    return (e >> 16) + (t >> 16) + (n >> 16) << 16 | 65535 & n
}

function tt(...e) {
    var t;
    let [n, r, a, i, s, o] = e;
    return te((t = te(te(r, n), te(i, o))) << s | t >>> 32 - s, a)
}

function tn(...e) {
    let [t, n, r, a, i, s, o] = e;
    return tt(n & r | ~n & a, t, n, i, s, o)
}

function tr(...e) {
    let [t, n, r, a, i, s, o] = e;
    return tt(n & a | r & ~a, t, n, i, s, o)
}

function ta(...e) {
    let [t, n, r, a, i, s, o] = e;
    return tt(n ^ r ^ a, t, n, i, s, o)
}

function ti(...e) {
    let [t, n, r, a, i, s, o] = e;
    return tt(r ^ (n | ~a), t, n, i, s, o)
}

function ts(e) {
    var t;
    return function(e) {
        let t, n;
        let r = "0123456789abcdef",
            a = "";
        for (n = 0; n < e.length; n += 1) a += r.charAt((t = e.charCodeAt(n)) >>> 4 & 15) + r.charAt(15 & t);
        return a
    }(function(e) {
        let t;
        let n = "",
            r = 32 * e.length;
        for (t = 0; t < r; t += 8) n += String.fromCharCode(e[t >> 5] >>> t % 32 & 255);
        return n
    }(function(e, t) {
        let n, r, a, i, s;
        e[t >> 5] |= 128 << t % 32, e[(t + 64 >>> 9 << 4) + 14] = t;
        let o = 0x67452301,
            d = -0x10325477,
            u = -0x67452302,
            c = 0x10325476;
        for (n = 0; n < e.length; n += 16) r = o, a = d, i = u, s = c, o = tn(o, d, u, c, e[n], 7, -0x28955b88), c = tn(c, o, d, u, e[n + 1], 12, -0x173848aa), u = tn(u, c, o, d, e[n + 2], 17, 0x242070db), d = tn(d, u, c, o, e[n + 3], 22, -0x3e423112), o = tn(o, d, u, c, e[n + 4], 7, -0xa83f051), c = tn(c, o, d, u, e[n + 5], 12, 0x4787c62a), u = tn(u, c, o, d, e[n + 6], 17, -0x57cfb9ed), d = tn(d, u, c, o, e[n + 7], 22, -0x2b96aff), o = tn(o, d, u, c, e[n + 8], 7, 0x698098d8), c = tn(c, o, d, u, e[n + 9], 12, -0x74bb0851), u = tn(u, c, o, d, e[n + 10], 17, -42063), d = tn(d, u, c, o, e[n + 11], 22, -0x76a32842), o = tn(o, d, u, c, e[n + 12], 7, 0x6b901122), c = tn(c, o, d, u, e[n + 13], 12, -0x2678e6d), u = tn(u, c, o, d, e[n + 14], 17, -0x5986bc72), d = tn(d, u, c, o, e[n + 15], 22, 0x49b40821), o = tr(o, d, u, c, e[n + 1], 5, -0x9e1da9e), c = tr(c, o, d, u, e[n + 6], 9, -0x3fbf4cc0), u = tr(u, c, o, d, e[n + 11], 14, 0x265e5a51), d = tr(d, u, c, o, e[n], 20, -0x16493856), o = tr(o, d, u, c, e[n + 5], 5, -0x29d0efa3), c = tr(c, o, d, u, e[n + 10], 9, 0x2441453), u = tr(u, c, o, d, e[n + 15], 14, -0x275e197f), d = tr(d, u, c, o, e[n + 4], 20, -0x182c0438), o = tr(o, d, u, c, e[n + 9], 5, 0x21e1cde6), c = tr(c, o, d, u, e[n + 14], 9, -0x3cc8f82a), u = tr(u, c, o, d, e[n + 3], 14, -0xb2af279), d = tr(d, u, c, o, e[n + 8], 20, 0x455a14ed), o = tr(o, d, u, c, e[n + 13], 5, -0x561c16fb), c = tr(c, o, d, u, e[n + 2], 9, -0x3105c08), u = tr(u, c, o, d, e[n + 7], 14, 0x676f02d9), d = tr(d, u, c, o, e[n + 12], 20, -0x72d5b376), o = ta(o, d, u, c, e[n + 5], 4, -378558), c = ta(c, o, d, u, e[n + 8], 11, -0x788e097f), u = ta(u, c, o, d, e[n + 11], 16, 0x6d9d6122), d = ta(d, u, c, o, e[n + 14], 23, -0x21ac7f4), o = ta(o, d, u, c, e[n + 1], 4, -0x5b4115bc), c = ta(c, o, d, u, e[n + 4], 11, 0x4bdecfa9), u = ta(u, c, o, d, e[n + 7], 16, -0x944b4a0), d = ta(d, u, c, o, e[n + 10], 23, -0x41404390), o = ta(o, d, u, c, e[n + 13], 4, 0x289b7ec6), c = ta(c, o, d, u, e[n], 11, -0x155ed806), u = ta(u, c, o, d, e[n + 3], 16, -0x2b10cf7b), d = ta(d, u, c, o, e[n + 6], 23, 0x4881d05), o = ta(o, d, u, c, e[n + 9], 4, -0x262b2fc7), c = ta(c, o, d, u, e[n + 12], 11, -0x1924661b), u = ta(u, c, o, d, e[n + 15], 16, 0x1fa27cf8), d = ta(d, u, c, o, e[n + 2], 23, -0x3b53a99b), o = ti(o, d, u, c, e[n], 6, -0xbd6ddbc), c = ti(c, o, d, u, e[n + 7], 10, 0x432aff97), u = ti(u, c, o, d, e[n + 14], 15, -0x546bdc59), d = ti(d, u, c, o, e[n + 5], 21, -0x36c5fc7), o = ti(o, d, u, c, e[n + 12], 6, 0x655b59c3), c = ti(c, o, d, u, e[n + 3], 10, -0x70f3336e), u = ti(u, c, o, d, e[n + 10], 15, -1051523), d = ti(d, u, c, o, e[n + 1], 21, -0x7a7ba22f), o = ti(o, d, u, c, e[n + 8], 6, 0x6fa87e4f), c = ti(c, o, d, u, e[n + 15], 10, -0x1d31920), u = ti(u, c, o, d, e[n + 6], 15, -0x5cfebcec), d = ti(d, u, c, o, e[n + 13], 21, 0x4e0811a1), o = ti(o, d, u, c, e[n + 4], 6, -0x8ac817e), c = ti(c, o, d, u, e[n + 11], 10, -0x42c50dcb), u = ti(u, c, o, d, e[n + 2], 15, 0x2ad7d2bb), d = ti(d, u, c, o, e[n + 9], 21, -0x14792c6f), o = te(o, r), d = te(d, a), u = te(u, i), c = te(c, s);
        return [o, d, u, c]
    }(function(e) {
        let t;
        let n = [];
        for (t = 0, n[(e.length >> 2) - 1] = void 0; t < n.length; t += 1) n[t] = 0;
        let r = 8 * e.length;
        for (t = 0; t < r; t += 8) n[t >> 5] |= (255 & e.charCodeAt(t / 8)) << t % 32;
        return n
    }(t = unescape(encodeURIComponent(e))), 8 * t.length)))
}

module.exports = ts;