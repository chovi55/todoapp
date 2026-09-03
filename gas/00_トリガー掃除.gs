/**
 * 暴走している myFunction1 のトリガーを、このプロジェクトからまとめて削除します。
 *
 * 【使い方】
 * 1. 暴走しているプロジェクト（「無題のプロジェクト」「ツイート文作成効率化シート」）を開く
 * 2. このファイルの中身を貼り付けて保存
 * 3. 関数 showMyTriggers を実行 → 実行ログで中身を確認（まだ消えません）
 * 4. 納得したら deleteMyFunction1Triggers を実行
 *
 * ※スクリプト本体は消えません。トリガー（定期実行の予約）だけを消します。
 * ※他のプロジェクトのトリガーは消せません。プロジェクトごとに実行してください。
 */

var TARGET_FUNCTIONS = ['myFunction1'];   // 消したい関数名
var KEEP_FUNCTIONS   = ['postScheduledThreads', 'refreshLongLivedToken']; // 絶対に消さない

/** まず中身を見るだけ。何も削除しません。 */
function showMyTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  Logger.log('このプロジェクトのトリガー: ' + ts.length + '件');
  var counts = {};
  ts.forEach(function (t) {
    var fn = t.getHandlerFunction();
    counts[fn] = (counts[fn] || 0) + 1;
  });
  Object.keys(counts).forEach(function (fn) {
    var mark = KEEP_FUNCTIONS.indexOf(fn) >= 0 ? '【残す】'
             : TARGET_FUNCTIONS.indexOf(fn) >= 0 ? '【削除対象】' : '【対象外・残す】';
    Logger.log('  ' + mark + ' ' + fn + ' : ' + counts[fn] + '件');
  });
  return counts;
}

/** TARGET_FUNCTIONS のトリガーだけを削除します。 */
function deleteMyFunction1Triggers() {
  var ts = ScriptApp.getProjectTriggers();
  var deleted = 0, kept = 0;
  ts.forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (KEEP_FUNCTIONS.indexOf(fn) >= 0) { kept++; return; }
    if (TARGET_FUNCTIONS.indexOf(fn) < 0) { kept++; return; }
    ScriptApp.deleteTrigger(t);
    deleted++;
  });
  var msg = '削除: ' + deleted + '件 ／ 残した: ' + kept + '件';
  Logger.log(msg);
  return msg;
}

/**
 * あとで myFunction1 を1本だけ動かしたくなったとき用。
 * ★先に deleteMyFunction1Triggers で全部消してから実行してください。
 * ★毎分ではなく「1時間おき」にしてあります。毎分に戻すと、また枠を食い尽くします。
 */
function recreateOneHourlyTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'myFunction1';
  });
  if (existing.length > 0) {
    throw new Error('まだ myFunction1 のトリガーが ' + existing.length + '件 残っています。先に全部削除してください。');
  }
  ScriptApp.newTrigger('myFunction1').timeBased().everyHours(1).create();
  Logger.log('myFunction1 の1時間おきトリガーを1本だけ作りました。');
}
