import type { CapacitorConfig } from '@capacitor/cli'

// Android ネイティブアプリ設定。
// server.url に本番(Vercel)を指定した「リモートURLモード」= アプリはシェルとして本番サイトを表示する。
// → フロントを Vercel にデプロイするだけでアプリ側も常に最新（APK 再ビルド不要）。
const config: CapacitorConfig = {
  appId: 'jp.nishino.kintaikeihi',
  appName: '勤怠経費',
  webDir: 'dist',
  server: {
    url: 'https://react-frontend-beige.vercel.app',
    cleartext: false,
  },
}

export default config
