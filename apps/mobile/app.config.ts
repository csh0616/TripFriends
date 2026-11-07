// TASK-006 B1·ADR-014: app.json 위에 개발 빌드 설정을 얹는다.
// 지도 키는 .env.local의 GOOGLE_MAPS_IOS_API_KEY를 빌드 때 읽는다 (Expo CLI가 환경에 넣어 준다. EXPO_PUBLIC_ 아님).
// 키는 react-native-maps 자체 config plugin의 iosGoogleMapsApiKey 옵션으로 들어간다(Info.plist GMSApiKey + AppDelegate + Podfile의 Google subspec).
// 이 옵션은 plugins 배열에 담기므로 앱 설정(Constants.expoConfig.plugins)과 개발 서버 manifest에도 키가 보인다. 앱 코드는 extra.googleMapsKeyPresent(있다/없다)만 읽는다.
// ADR-014: 앱 안에 들어가는 공개 키라 괜찮지만 저장소에는 올리지 않고, Google Cloud에서 번들 ID로 제한한다. ios.config.googleMapsApiKey는 쓰지 않는다:
// Expo 내장 mod가 옛 포드(react-native-google-maps)를 Podfile에 넣어 pod install이 실패한다.
// 키가 없어도 빌드는 되고, 지도 자리에 안내가 나온다 (TASK-006 §7).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_IOS_API_KEY;
  const hasKey = typeof key === 'string' && key.length > 0;
  const name = (plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin);
  // 키가 없으면 옵션 없이 넣는다: 플러그인이 AppDelegate의 Google 코드를 지우고 Podfile에 Google subspec을 넣지 않아 빌드는 된다
  const mapsPlugin = hasKey ? (['react-native-maps', { iosGoogleMapsApiKey: key }] as [string, object]) : 'react-native-maps';
  const plugins = (config.plugins ?? []).filter((plugin) => name(plugin) !== 'react-native-maps');
  if (!plugins.some((plugin) => name(plugin) === 'expo-dev-client')) plugins.push('expo-dev-client');
  plugins.push(mapsPlugin);
  return {
    ...config,
    name: 'Tripfriends',
    slug: config.slug ?? 'mobile',
    ios: { ...config.ios, bundleIdentifier: 'com.csh0616.tripfriends' },
    plugins,
    extra: { ...config.extra, googleMapsKeyPresent: hasKey },
  };
};
