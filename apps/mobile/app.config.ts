// TASK-006 B1·ADR-014: app.json 위에 개발 빌드 설정을 얹는다.
// 지도 키는 .env.local의 GOOGLE_MAPS_IOS_API_KEY를 빌드 때 읽는다 (Expo CLI가 환경에 넣어 준다. EXPO_PUBLIC_ 아님).
// 키는 네이티브 설정(ios.config)으로만 들어가고 JS 코드에는 "있다/없다"(extra.googleMapsKeyPresent)만 간다.
// 키가 없어도 빌드는 되고, 지도 자리에 안내가 나온다 (TASK-006 §7).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const key = process.env.GOOGLE_MAPS_IOS_API_KEY;
  const hasKey = typeof key === 'string' && key.length > 0;
  const plugins = config.plugins ?? [];
  return {
    ...config,
    name: 'Tripfriends',
    slug: config.slug ?? 'mobile',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.csh0616.tripfriends',
      ...(hasKey ? { config: { ...config.ios?.config, googleMapsApiKey: key } } : {}),
    },
    plugins: plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-dev-client')
      ? plugins
      : [...plugins, 'expo-dev-client'],
    extra: { ...config.extra, googleMapsKeyPresent: hasKey },
  };
};
