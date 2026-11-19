// Single-page vocabulary app, ES5-style, for the device JS probe.
var WORDS = [
  { w: 'ephemeral', m: '短暂的，转瞬即逝的', e: 'Fame is ephemeral.' },
  { w: 'lucid', m: '清晰易懂的', e: 'She gave a lucid account.' },
  { w: 'tenacious', m: '顽强的，坚持的', e: 'A tenacious reader.' }
];
var S = { i: 0, done: 0, flip: false };
function draw() {
  var word = WORDS[S.i], y;
  ui.clear(15);
  ui.text(20, 14, '今日复习  ' + S.done + ' / 32', 1, 4);
  ui.rect(20, 38, 360, 3, 11);
  ui.rect(20, 38, Math.floor(360 * Math.min(S.done, 32) / 32), 3, 0);
  y = ui.text(20, 76, word.w, 3, 0, 360);
  if (S.flip) {
    y = ui.text(20, y + 8, word.m, 2, 0, 360);
    ui.text(20, y + 4, word.e, 1, 5, 360);
    ui.text(20, 272, '上:记得    确认:收起    下:忘了', 1, 5);
  } else {
    ui.text(20, 272, '确认:翻面', 1, 5);
  }
  ui.present();
}
function save() { store.set('progress', JSON.stringify({ i: S.i, done: S.done })); }
function bench() {
  var items = [], i, t = Date.now();
  for (i = 0; i < 2000; i++) items.push({ id: i, due: (i * 7919) % 1009, ef: 2.5 });
  for (i = 0; i < items.length; i++) items[i].due += Math.round(items[i].ef * 3);
  items.sort(function (a, b) { return a.due - b.due; });
  console.log('NOTE4 JS_BENCH items=' + items.length + ' ms=' + (Date.now() - t));
}
function on_start() {
  var raw = store.get('progress');
  if (raw) { var p = JSON.parse(raw); S.i = p.i; S.done = p.done; }
  console.log('NOTE4 JS_RESTORED done=' + S.done + ' i=' + S.i);
  draw();
}
function on_key(k) {
  if (k === 'hang') { while (true) {} }
  if (k === 'oom') { var a = []; while (true) a.push(new Array(4096)); }
  if (k === 'bench') { bench(); return; }
  if (k === 'wave') { S.flip = !S.flip; draw(); return; }
  if (k === 'ok') { S.flip = !S.flip; draw(); return; }
  if (!S.flip) return;
  if (k === 'up') S.done++;
  S.i = (S.i + 1) % WORDS.length;
  S.flip = false;
  save();
  draw();
}
