/**
 * アメトピ台帳：収集ヘルス と 週次分析
 *
 * 【使い方】
 * 1. 台帳（アメブロ記事作成）を開く → 拡張機能 → Apps Script
 * 2. このファイルを貼って保存
 * 3. 関数 setUp を1回だけ実行（承認を求められたら許可）
 *    → 「収集ヘルス」「アメトピ週次分析」の2シートが作られ、
 *      毎時のヘルス更新と、毎週月曜の分析トリガーが入ります
 * 4. 台帳を開き直すと、メニューに「アメトピ」が出ます（手動でも実行できます）
 *
 * ※シート名は自動で見つけます（見出し行の中身で判定）。タブ名は変えても動きます。
 */

var HEALTH_SHEET = '収集ヘルス';
var WEEKLY_SHEET = 'アメトピ週次分析';

/** くるみが入りうる枠。ここ以外（芸能・公式トップブロガー・ニュース）は最初から分けて数えます。 */
var TARGET_CATEGORY = 'ブログニュース';

/** 何時間バッチが来なければ「止まっている」とみなすか */
var STALE_HOURS = 12;

// ───────────────────────────── セットアップ

function onOpen() {
  SpreadsheetApp.getUi().createMenu('アメトピ')
    .addItem('収集ヘルスを更新', 'updateHealth')
    .addItem('週次分析を追記', 'appendWeeklyAnalysis')
    .addToUi();
}

function setUp() {
  updateHealth();
  appendWeeklyAnalysis();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'updateHealth' || fn === 'appendWeeklyAnalysis') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('updateHealth').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('appendWeeklyAnalysis').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  SpreadsheetApp.getActive().toast('セットアップ完了。毎時ヘルス更新／毎週月曜8時に分析を追記します。');
}

// ───────────────────────────── 生データの読み取り

/** 見出し行の中身で「アメトピ生データ」のシートを探します。 */
function findRawSheet_() {
  var must = ['取得時刻', 'アメトピ掲載日時', '見出し'];
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var last = Math.min(sheets[i].getLastColumn(), 30);
    if (last < 3) continue;
    var head = sheets[i].getRange(1, 1, 1, last).getValues()[0].map(String);
    var ok = must.every(function (m) { return head.indexOf(m) >= 0; });
    if (ok) return { sheet: sheets[i], head: head };
  }
  throw new Error('生データのシートが見つかりません（見出しに 取得時刻／アメトピ掲載日時／見出し が必要です）');
}

function readRaw_() {
  var f = findRawSheet_();
  var ix = {};
  ['取得時刻', 'アメトピ掲載日時', 'カテゴリ名', '見出し', '記事URL', '枠タグ', 'ID']
    .forEach(function (k) { ix[k] = f.head.indexOf(k); });

  var values = f.sheet.getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    var t = toDate_(v[ix['取得時刻']]);
    if (!t) continue;
    rows.push({
      fetched:  t,
      category: String(v[ix['カテゴリ名']] || ''),
      headline: String(v[ix['見出し']] || ''),
      url:      String(v[ix['記事URL']] || ''),
      tags:     String(ix['枠タグ'] >= 0 ? v[ix['枠タグ']] || '' : ''),
      id:       String(ix['ID'] >= 0 ? v[ix['ID']] || '' : '')
    });
  }
  return rows;
}

function toDate_(v) {
  if (v instanceof Date) return v;
  var s = String(v || '').trim();
  if (!s) return null;
  var m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function uniqueByArticle_(rows) {
  var seen = {}, out = [];
  rows.forEach(function (r) {
    var key = r.id || r.url || (r.category + '|' + r.headline);
    if (seen[key]) return;
    seen[key] = 1;
    out.push(r);
  });
  return out;
}

// ───────────────────────────── 収集ヘルス

function updateHealth() {
  var rows = readRaw_();
  var sh = getOrCreate_(HEALTH_SHEET);
  var now = new Date();

  if (rows.length === 0) {
    writeBlock_(sh, [['収集ヘルス', ''], ['状態', '⛔ 生データが0件です'], ['更新', fmt_(now)]]);
    return;
  }

  var last = rows.reduce(function (a, b) { return a.fetched > b.fetched ? a : b; }).fetched;
  var hours = (now - last) / 36e5;

  var since = new Date(now.getTime() - 24 * 36e5);
  var recent = rows.filter(function (r) { return r.fetched >= since; });
  var batches = {};
  recent.forEach(function (r) { batches[fmt_(r.fetched)] = 1; });
  var nBatch = Object.keys(batches).length;

  var uniq = uniqueByArticle_(rows);
  var target = uniq.filter(function (r) { return r.category === TARGET_CATEGORY; });

  var state = hours > STALE_HOURS
    ? '⛔ 止まっています（' + Math.floor(hours) + '時間 新しいデータがありません）'
    : (nBatch < 3 ? '⚠ 直近24時間の収集が ' + nBatch + '回です（想定は3回）' : '✅ 正常');

  writeBlock_(sh, [
    ['収集ヘルス', ''],
    ['状態',                 state],
    ['エラーの有無',         hours > STALE_HOURS ? 'あり（収集が来ていません）' : 'なし'],
    ['最終収集日時',         fmt_(last)],
    ['最終収集からの経過',   Math.floor(hours) + ' 時間'],
    ['直近24時間の収集回数', nBatch + ' 回'],
    ['直近24時間の取得件数', recent.length + ' 件'],
    ['', ''],
    ['対象件数（' + TARGET_CATEGORY + '枠・累計）', target.length + ' 件'],
    ['対象外（芸能・公式・ニュース等）',            (uniq.length - target.length) + ' 件'],
    ['累計ユニーク記事',                            uniq.length + ' 件'],
    ['累計の行数（延べ）',                          rows.length + ' 行'],
    ['', ''],
    ['この表の更新',        fmt_(now)]
  ]);
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 380);
}

// ───────────────────────────── 週次分析

function appendWeeklyAnalysis() {
  var rows = readRaw_();
  var sh = getOrCreate_(WEEKLY_SHEET);
  var now = new Date();
  var since = new Date(now.getTime() - 7 * 24 * 36e5);

  var week = uniqueByArticle_(rows.filter(function (r) { return r.fetched >= since; }));
  var all  = uniqueByArticle_(rows);

  var out = [];
  out.push(['【アメトピ週次分析】 ' + fmt_(now), '']);
  out.push(['対象期間', fmt_(since) + ' 〜 ' + fmt_(now)]);
  out.push(['', '']);

  if (week.length === 0) {
    out.push(['■ 観察結果', '今週の新規データは0件です。収集が止まっている可能性があります']);
    out.push(['', '収集ヘルスのシートを確認してください']);
    appendBlock_(sh, out);
    return;
  }

  // 枠の内訳（最初から分ける）
  var byCat = {};
  week.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + 1; });
  out.push(['■ 枠の内訳（今週 ' + week.length + '件）', '']);
  Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).forEach(function (c) {
    var mark = (c === TARGET_CATEGORY) ? '★くるみが入りうる枠' : '（対象外）';
    out.push(['　' + c, byCat[c] + '件　' + mark]);
  });
  out.push(['', '']);

  // 以下はすべて対象枠だけを母数にする
  var t = week.filter(function (r) { return r.category === TARGET_CATEGORY; });
  out.push(['■ ' + TARGET_CATEGORY + '枠だけの観察（母数 ' + t.length + '件）', '']);

  if (t.length === 0) {
    out.push(['　', '今週は対象枠のデータが0件でした']);
  } else {
    var lens = t.map(function (r) { return r.headline.length; }).sort(function (a, b) { return a - b; });
    out.push(['　見出しの文字数', '最小' + lens[0] + '／中央値' + lens[Math.floor(lens.length / 2)] + '／最大' + lens[lens.length - 1]]);
    out.push(['　名詞で終わる（体言止め）', count_(t, function (r) { return !/[たてだるいねよか? ？。]$/.test(r.headline); }) + ' / ' + t.length + '件']);
    out.push(['　疑問符が入る',             count_(t, function (r) { return /[？?]/.test(r.headline); }) + ' / ' + t.length + '件']);
    out.push(['　数字が入る',               count_(t, function (r) { return /[0-9０-９]/.test(r.headline); }) + ' / ' + t.length + '件']);
    out.push(['　家族・人物が出てくる',     count_(t, function (r) { return /夫|妻|嫁|娘|息子|義母|義父|母|父|祖母|旦那|彼|子|孫|親/.test(r.headline); }) + ' / ' + t.length + '件']);
    out.push(['　お金・金額の話',           count_(t, function (r) { return /円|万|お金|ローン|費|代|料|貯金|節約/.test(r.headline); }) + ' / ' + t.length + '件']);
    out.push(['　感情語が入る',             count_(t, function (r) { return /悲し|嬉し|ショック|怒|寂し|驚|後悔|不安|辛|つら|しんど|イライラ|モヤ|涙|泣|幸せ/.test(r.headline); }) + ' / ' + t.length + '件']);

    var tag = {};
    t.forEach(function (r) {
      r.tags.split(/\s+/).forEach(function (x) { if (x) tag[x] = (tag[x] || 0) + 1; });
    });
    var top = Object.keys(tag).sort(function (a, b) { return tag[b] - tag[a]; }).slice(0, 8);
    if (top.length) {
      out.push(['　ジャンルタグ上位', top.map(function (k) { return k + ':' + tag[k]; }).join('　')]);
    }
    out.push(['', '']);
    out.push(['　見出しの実例（5件）', '']);
    t.slice(0, 5).forEach(function (r) { out.push(['　　' + r.headline, r.headline.length + '字']); });
  }

  out.push(['', '']);
  out.push(['■ まだ判断できないこと', '']);
  out.push(['　母数', t.length < 30 ? '対象枠が' + t.length + '件。傾向と呼ぶには不足です' : '対象枠 ' + t.length + '件']);
  out.push(['　くるみの掲載', '掲載実績が0件のため、掲載要因はこのデータから学習できません']);
  out.push(['', '']);
  out.push(['■ 今週試す仮説', '（ここは手で書いてください）']);
  out.push(['■ 前週の仮説の結果', '（ここは手で書いてください）']);
  out.push(['', '']);
  out.push(['※ 断定はしていません。すべて「今回の観察ではこうだった」です', '累計ユニーク ' + all.length + '件']);
  out.push(['', '']);

  appendBlock_(sh, out);
}

function count_(arr, fn) { return arr.filter(fn).length; }

// ───────────────────────────── シート操作

function getOrCreate_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeBlock_(sh, rows) {
  sh.clear();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function appendBlock_(sh, rows) {
  var start = sh.getLastRow() + (sh.getLastRow() ? 2 : 1);
  sh.getRange(start, 1, rows.length, 2).setValues(rows);
  sh.getRange(start, 1, 1, 2).setFontWeight('bold');
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 420);
}

function fmt_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}
