/* =====================================================================
   MappaQR — minimalistický QR encoder (byte mode, verze 1–10, ECC L/M/Q/H)
   Bez závislostí. Kód se generuje za běhu z aktuální adresy stránky,
   takže po nasazení vždy ukazuje tam, kde web opravdu běží.
   Použití:  MappaQR.svg('https://…', { ecl:'M', margin:2 })
   ===================================================================== */
(function (global) {
  'use strict';

  var TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346]; // codewords celkem, v1..v10

  // [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2]
  var RS = {
    L: [null, [7,1,19], [10,1,34], [15,1,55], [20,1,80], [26,1,108], [18,2,68],
        [20,2,78], [24,2,97], [30,2,116], [18,2,68,2,69]],
    M: [null, [10,1,16], [16,1,28], [26,1,44], [18,2,32], [24,2,43], [16,4,27],
        [18,4,31], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44]],
    Q: [null, [13,1,13], [22,1,22], [18,2,17], [26,2,24], [18,2,15,2,16], [24,4,19],
        [18,2,14,4,15], [22,4,18,2,19], [20,4,16,4,17], [24,6,19,2,20]],
    H: [null, [17,1,9], [28,1,16], [22,2,13], [16,4,9], [22,2,11,2,12], [28,4,15],
        [26,4,13,1,14], [26,4,14,2,15], [24,4,12,4,13], [28,6,15,2,16]]
  };

  var ALIGN = [[], [], [6,18], [6,22], [6,26], [6,30], [6,34],
               [6,22,38], [6,24,42], [6,26,46], [6,28,50]];

  var VERSION_BITS = { 7:0x07C94, 8:0x085BC, 9:0x09A99, 10:0x0A4D3 };
  var ECL_BITS = { L:1, M:0, Q:3, H:2 };

  // ---------------------------------------------------------- GF(256)
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  // ---------------------------------------------------------- bitový proud
  function utf8(str) {
    var out = [], s = encodeURIComponent(str);
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '%') { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else out.push(s.charCodeAt(i));
    }
    return out;
  }

  function capacity(version, ecl) {
    var t = RS[ecl][version];
    var n = t[1] * t[2] + (t[3] ? t[3] * t[4] : 0);
    return n;
  }

  function pickVersion(byteLen, ecl) {
    for (var v = 1; v <= 10; v++) {
      var countBits = v < 10 ? 8 : 16;
      var need = Math.ceil((4 + countBits + byteLen * 8) / 8);
      if (need <= capacity(v, ecl)) return v;
    }
    return null;
  }

  function buildCodewords(bytes, version, ecl) {
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var cap = capacity(version, ecl) * 8;
    push(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      data.push(v);
    }
    var pads = [0xEC, 0x11], p = 0;
    while (data.length < capacity(version, ecl)) data.push(pads[p++ % 2]);

    // rozdělení na bloky + RS
    var t = RS[ecl][version], ecLen = t[0];
    var blocks = [], pos = 0, groups = [[t[1], t[2]]];
    if (t[3]) groups.push([t[3], t[4]]);
    groups.forEach(function (g) {
      for (var i = 0; i < g[0]; i++) {
        var d = data.slice(pos, pos + g[1]); pos += g[1];
        blocks.push({ d: d, e: rsEncode(d, ecLen) });
      }
    });

    // prokládání
    var out = [], maxD = 0;
    blocks.forEach(function (b) { maxD = Math.max(maxD, b.d.length); });
    for (var i2 = 0; i2 < maxD; i2++)
      blocks.forEach(function (b) { if (i2 < b.d.length) out.push(b.d[i2]); });
    for (var i3 = 0; i3 < ecLen; i3++)
      blocks.forEach(function (b) { out.push(b.e[i3]); });
    return out;
  }

  // ---------------------------------------------------------- matice
  function makeMatrix(version) {
    var size = version * 4 + 17;
    var m = [], fn = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(0));
      fn.push(new Array(size).fill(0));
    }
    function setFn(r, c, v) { if (r >= 0 && r < size && c >= 0 && c < size) { m[r][c] = v; fn[r][c] = 1; } }

    function drawFinder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        var inRing = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6);
        var v = 0;
        if (inRing) {
          var edge = (dr === 0 || dr === 6 || dc === 0 || dc === 6);
          var core = (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          v = (edge || core) ? 1 : 0;
        }
        setFn(r, c, v);
      }
    }
    drawFinder(0, 0); drawFinder(0, size - 7); drawFinder(size - 7, 0);

    // timing
    for (var i = 8; i < size - 8; i++) { setFn(6, i, i % 2 === 0 ? 1 : 0); setFn(i, 6, i % 2 === 0 ? 1 : 0); }

    // alignment
    var centers = ALIGN[version];
    for (var a = 0; a < centers.length; a++) for (var b = 0; b < centers.length; b++) {
      var cr = centers[a], cc = centers[b];
      if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) continue;
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        var d2 = Math.max(Math.abs(dr2), Math.abs(dc2));
        setFn(cr + dr2, cc + dc2, d2 === 1 ? 0 : 1);
      }
    }

    // rezerva pro format info
    for (var k = 0; k < 9; k++) { if (k === 6) continue; setFn(8, k, 0); setFn(k, 8, 0); }
    for (var k2 = 0; k2 < 8; k2++) { setFn(8, size - 1 - k2, 0); setFn(size - 1 - k2, 8, 0); }
    setFn(size - 8, 8, 1); // dark module

    // version info
    if (version >= 7) {
      var vb = VERSION_BITS[version];
      for (var i2 = 0; i2 < 18; i2++) {
        var bit = (vb >>> i2) & 1;
        var rr = Math.floor(i2 / 3), cc2 = i2 % 3;
        setFn(rr, size - 11 + cc2, bit);
        setFn(size - 11 + cc2, rr, bit);
      }
    }
    return { m: m, fn: fn, size: size };
  }

  function placeData(mat, codewords) {
    var size = mat.size, m = mat.m, fn = mat.fn;
    var bitIdx = 0, total = codewords.length * 8;
    function bitAt(i) { return i < total ? (codewords[i >> 3] >>> (7 - (i & 7))) & 1 : 0; }
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var t = 0; t < size; t++) {
        var row = upward ? size - 1 - t : t;
        for (var c2 = 0; c2 < 2; c2++) {
          var cc = col - c2;
          if (fn[row][cc]) continue;
          m[row][cc] = bitAt(bitIdx++);
        }
      }
      upward = !upward;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  function formatBits(ecl, mask) {
    var data = (ECL_BITS[ecl] << 3) | mask;
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function applyFormat(mat, ecl, mask) {
    var bits = formatBits(ecl, mask), size = mat.size, m = mat.m;
    // první kopie: sloupec 8 shora, pak řádek 8 zleva
    for (var i = 0; i <= 5; i++) m[i][8] = (bits >>> i) & 1;
    m[7][8] = (bits >>> 6) & 1;
    m[8][8] = (bits >>> 7) & 1;
    m[8][7] = (bits >>> 8) & 1;
    for (var j = 9; j <= 14; j++) m[8][14 - j] = (bits >>> j) & 1;
    // druhá kopie: řádek 8 zprava, pak sloupec 8 zdola
    for (var k = 0; k <= 7; k++) m[8][size - 1 - k] = (bits >>> k) & 1;
    for (var l = 8; l <= 14; l++) m[size - 15 + l][8] = (bits >>> l) & 1;
    m[size - 8][8] = 1; // vždy tmavý modul
  }

  function penalty(m, size) {
    var score = 0, r, c, run, i;
    // 1 — běhy 5+
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else run = 1;
      }
    }
    // 2 — bloky 2×2
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    // 3 — vzory podobné hledáčku
    var pat1 = [1,0,1,1,1,0,1,0,0,0,0], pat2 = [0,0,0,0,1,0,1,1,1,0,1];
    function match(arr, off, pat) {
      for (var k = 0; k < 11; k++) if (arr[off + k] !== pat[k]) return false;
      return true;
    }
    for (r = 0; r < size; r++) {
      var row = m[r];
      for (c = 0; c + 11 <= size; c++) if (match(row, c, pat1) || match(row, c, pat2)) score += 40;
    }
    for (c = 0; c < size; c++) {
      var col = [];
      for (r = 0; r < size; r++) col.push(m[r][c]);
      for (r = 0; r + 11 <= size; r++) if (match(col, r, pat1) || match(col, r, pat2)) score += 40;
    }
    // 4 — poměr tmavých
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encode(text, ecl) {
    ecl = ecl || 'M';
    var bytes = utf8(text);
    var version = pickVersion(bytes.length, ecl);
    if (!version && ecl !== 'L') { ecl = 'L'; version = pickVersion(bytes.length, 'L'); }
    if (!version) throw new Error('QR: text je příliš dlouhý');

    var cw = buildCodewords(bytes, version, ecl);
    var base = makeMatrix(version);
    placeData(base, cw);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var m = base.m.map(function (row) { return row.slice(); });
      for (var r = 0; r < base.size; r++) for (var c = 0; c < base.size; c++)
        if (!base.fn[r][c] && MASKS[mask](r, c)) m[r][c] ^= 1;
      var cand = { m: m, size: base.size };
      applyFormat(cand, ecl, mask);
      var s = penalty(m, base.size);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return best.m;
  }

  function svg(text, opts) {
    opts = opts || {};
    var margin = opts.margin == null ? 2 : opts.margin;
    var dark = opts.dark || '#101010';
    var m = encode(text, opts.ecl || 'M');
    var size = m.length, dim = size + margin * 2;
    var path = '';
    for (var r = 0; r < size; r++) {
      var c = 0;
      while (c < size) {
        if (!m[r][c]) { c++; continue; }
        var start = c;
        while (c < size && m[r][c]) c++;
        path += 'M' + (start + margin) + ' ' + (r + margin) + 'h' + (c - start) + 'v1h-' + (c - start) + 'z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" width="100%" height="100%" shape-rendering="crispEdges" role="img" aria-label="QR kód s odkazem">' +
      (opts.light ? '<rect width="' + dim + '" height="' + dim + '" fill="' + opts.light + '"/>' : '') +
      '<path d="' + path + '" fill="' + dark + '"/></svg>';
  }

  global.MappaQR = { encode: encode, svg: svg };
})(typeof window !== 'undefined' ? window : globalThis);
