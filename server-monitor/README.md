# Server Monitor

Server Monitor is a React web application packaged for Android through Capacitor.

## Required environment

Frontend development requires Node.js `^20.19.0 || >=22.12.0` and npm `>=10.8.2`. These versions are declared in `package.json` and cover the Vite 8 toolchain.

Android development requires JDK 21, Android SDK Platform 35, and an Android emulator or device for instrumentation tests. The Capacitor-generated Android configuration compiles with Java 21; the project uses Android Gradle Plugin 8.7.2 and Gradle 8.11.1 through the checked-in wrapper.

## Development

Start the Vite development server:

```bash
npm run dev
```

Run static checks:

```bash
npm run lint
```

## Builds

Build the web application:

```bash
npm run build
```

Build the Android debug APK. This command builds the web bundle, synchronizes Capacitor assets and plugins, then runs the Gradle debug build:

```bash
npm run android:build
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Tests

Run Android local unit tests:

```bash
npm run android:test:unit
```

Run Android instrumentation tests with a connected emulator or device:

```bash
npm run android:test:instrumented
```
