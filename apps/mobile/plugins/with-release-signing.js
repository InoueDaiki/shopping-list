// リリースの署名を環境変数で切り替える設定プラグイン。prebuild の app/build.gradle の末尾に足す。
// ANDROID_KEYSTORE_PATH が無ければ、テンプレートのまま開発用の鍵で署名する(CI と手元の確認)。
// 鍵やパスワードは build.gradle に書かず、ビルドのときに環境変数から読む(README の「配布」)
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// release-signing:";

const GRADLE = `
${MARKER} 配布用の鍵。途中まで設定したまま開発用の鍵で署名すると上書きで更新できないので、足りなければ止める
def releaseKeystorePath = System.getenv("ANDROID_KEYSTORE_PATH") ?: ""
if (releaseKeystorePath) {
    def releaseSigning = ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"].collectEntries { [(it): System.getenv(it) ?: ""] }
    def missing = releaseSigning.findAll { !it.value }.keySet()
    if (missing) {
        throw new GradleException("配布の署名に要る環境変数がありません: \${missing.join(", ")}")
    }
    def releaseKeystore = new File(releaseKeystorePath)
    if (!releaseKeystore.isAbsolute() || !releaseKeystore.isFile()) {
        throw new GradleException("ANDROID_KEYSTORE_PATH は鍵のファイルの絶対パスにしてください")
    }
    android.signingConfigs.create("distribution") {
        storeFile releaseKeystore
        storePassword releaseSigning.ANDROID_KEYSTORE_PASSWORD
        keyAlias releaseSigning.ANDROID_KEY_ALIAS
        keyPassword releaseSigning.ANDROID_KEY_PASSWORD
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.distribution
    logger.lifecycle("リリースは配布用の鍵で署名します")
} else {
    logger.lifecycle("リリースは開発用の鍵で署名します(配布には使えません)")
}
`;

module.exports = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(MARKER)) {
      mod.modResults.contents += GRADLE;
    }
    return mod;
  });
