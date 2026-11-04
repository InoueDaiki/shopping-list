// 「品目を追加」の入口を、ホーム画面のウィジェットとアプリのショートカット(アイコンの長押し)に足す設定プラグイン。
// どちらも押すとディープリンク(<scheme>://quick-add)でアプリを開くだけなので、ライブラリを使わず、
// 小さな AppWidgetProvider とリソースを prebuild のときに書き出す(docs/設計メモ.md の「ホーム画面のウィジェット」)。
// 色はデザイントークンの値を app.config.ts から受け取る。options: { light: { primary, onPrimary }, dark: { primary, onPrimary } }
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const ROUTE = "quick-add";
const RECEIVER = ".QuickAddWidget";

// Lucide の plus と同じ形(24 の枠に、太さ 2 の線で十字)
const plusPath = "M5,12h14M12,5v14";

function resources({ light, dark, url, packageName }) {
  const colors = (palette) => `<?xml version="1.0" encoding="utf-8"?>
<!-- with-quick-add.js が作る。手で編集しない -->
<resources>
  <color name="quick_add_primary">${palette.primary}</color>
  <color name="quick_add_on_primary">${palette.onPrimary}</color>
</resources>
`;
  return {
    "values/quick_add_colors.xml": colors(light),
    "values-night/quick_add_colors.xml": colors(dark),
    "values/quick_add_strings.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="quick_add_label">品目を追加</string>
  <string name="quick_add_widget_description">押すと、品目を追加する画面を開きます</string>
</resources>
`,
    // 押せる形はアプリの主な操作のボタン(丸い端の primary)に合わせる
    "drawable/quick_add_widget_background.xml": `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="@color/quick_add_primary" />
  <corners android:radius="999dp" />
</shape>
`,
    "drawable/quick_add_plus.xml": `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:pathData="${plusPath}" android:strokeColor="@color/quick_add_on_primary"
    android:strokeWidth="2" android:strokeLineCap="round" />
</vector>
`,
    // ショートカットの絵。ランチャーが丸く切り抜くので、丸の中に十字を描く
    "drawable/quick_add_shortcut.xml": `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
  <path android:pathData="M24,2a22,22 0,1 1,0 44a22,22 0,1 1,0 -44z" android:fillColor="@color/quick_add_primary" />
  <path android:pathData="M16,24h16M24,16v16" android:strokeColor="@color/quick_add_on_primary"
    android:strokeWidth="3" android:strokeLineCap="round" />
</vector>
`,
    // RemoteViews で描けるのは決まった View だけ。文字の入力欄は置けないので、ボタンだけにする
    "layout/quick_add_widget.xml": `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/quick_add_widget"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:background="@drawable/quick_add_widget_background"
  android:contentDescription="@string/quick_add_label"
  android:gravity="center"
  android:orientation="horizontal"
  android:paddingLeft="12dp"
  android:paddingRight="16dp">
  <ImageView
    android:layout_width="24dp"
    android:layout_height="24dp"
    android:importantForAccessibility="no"
    android:src="@drawable/quick_add_plus" />
  <TextView
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:layout_marginLeft="6dp"
    android:ellipsize="end"
    android:importantForAccessibility="no"
    android:maxLines="1"
    android:text="@string/quick_add_label"
    android:textColor="@color/quick_add_on_primary"
    android:textSize="15sp"
    android:textStyle="bold" />
</LinearLayout>
`,
    // 2×1。中身は変わらないので、定期の更新はしない(置いたときと端末の起動のときだけ onUpdate が呼ばれる)
    "xml/quick_add_widget_info.xml": `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:description="@string/quick_add_widget_description"
  android:initialLayout="@layout/quick_add_widget"
  android:minWidth="110dp"
  android:minHeight="40dp"
  android:previewLayout="@layout/quick_add_widget"
  android:resizeMode="horizontal"
  android:targetCellWidth="2"
  android:targetCellHeight="1"
  android:updatePeriodMillis="0"
  android:widgetCategory="home_screen" />
`,
    "xml/quick_add_shortcuts.xml": `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut
    android:enabled="true"
    android:icon="@drawable/quick_add_shortcut"
    android:shortcutId="quick_add"
    android:shortcutShortLabel="@string/quick_add_label">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="${url}"
      android:targetClass="${packageName}.MainActivity"
      android:targetPackage="${packageName}" />
  </shortcut>
</shortcuts>
`,
  };
}

function widgetSource({ url, packageName }) {
  return `// with-quick-add.js が作る。手で編集しない
package ${packageName}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

// ホーム画面の「品目を追加」。押すとディープリンクでアプリの追加の画面を開く。
// タスクを作り直す(ランチャーのショートカットと同じ)。裏でプロセスだけ落ちてタスクが残っていると、
// 作り直さなければ前のタスクが前に出るだけで、リンクが画面に届かない
class QuickAddWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${url}"), context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    // 前の版の PendingIntent は Intent のフラグを持ったまま残るので、作り直す(UPDATE_CURRENT は extras しか替えない)
    val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT)
    val views = RemoteViews(context.packageName, R.layout.quick_add_widget)
    views.setOnClickPendingIntent(R.id.quick_add_widget, pending)
    manager.updateAppWidget(ids, views)
  }
}
`;
}

function settings(config) {
  const packageName = config.android?.package;
  if (!packageName) throw new Error("with-quick-add: android.package がありません");
  const scheme = [config.scheme].flat()[0];
  if (!scheme) throw new Error("with-quick-add: scheme がありません");
  return { packageName, url: `${scheme}://${ROUTE}` };
}

const withManifest = (config) =>
  withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.receiver = (application.receiver ?? []).filter((receiver) => receiver.$["android:name"] !== RECEIVER);
    application.receiver.push({
      $: { "android:name": RECEIVER, "android:exported": "false", "android:label": "@string/quick_add_label" },
      "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] }],
      "meta-data": [{ $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/quick_add_widget_info" } }],
    });
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    activity["meta-data"] = (activity["meta-data"] ?? []).filter((item) => item.$["android:name"] !== "android.app.shortcuts");
    activity["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/quick_add_shortcuts" } });
    return mod;
  });

const withFiles = (config, options) =>
  withDangerousMod(config, [
    "android",
    (mod) => {
      const { packageName, url } = settings(mod);
      const main = path.join(mod.modRequest.platformProjectRoot, "app/src/main");
      for (const [file, contents] of Object.entries(resources({ ...options, url, packageName }))) {
        const target = path.join(main, "res", file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
      }
      const source = path.join(main, "java", ...packageName.split("."), "QuickAddWidget.kt");
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, widgetSource({ url, packageName }));
      return mod;
    },
  ]);

module.exports = (config, options) => {
  if (!options?.light || !options?.dark) throw new Error("with-quick-add: light と dark の色を渡してください");
  return withFiles(withManifest(config), options);
};
