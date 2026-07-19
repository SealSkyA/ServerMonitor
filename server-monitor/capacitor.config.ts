import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.servermonitor.app',
  appName: 'Server Monitor',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
