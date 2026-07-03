# 勤怠経費 Android アプリ（Capacitor）

## Android Studio でのビルド手順
1. Android Studio を起動 → **Open** → この `android/` フォルダを選択
2. Gradle Sync が終わるのを待つ（初回は数分）
3. 実機を USB 接続（開発者オプション＋USBデバッグON）またはエミュレータを起動
4. ▶ **Run 'app'** → 実機にインストールされて起動

## APK を配布したい場合
- **Build → Build App Bundle(s) / APK(s) → Build APK(s)** → `android/app/build/outputs/apk/debug/app-debug.apk`
- APK を端末に送って開けばインストールできる（提供元不明アプリの許可が必要）

## 仕組み（リモートURLモード）
- アプリは https://react-frontend-beige.vercel.app を読み込むシェル。
- **フロントを Vercel にデプロイするだけでアプリも最新になる**（APK再ビルド不要）。
- 接続先を変えたいときは `capacitor.config.ts` の `server.url` を変更 → `npx cap sync android`。

## カメラ（レシート撮影）
- `CAMERA` 権限は AndroidManifest.xml に追加済み。経費ページの 📷 でカメラが起動する。
