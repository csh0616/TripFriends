// @expo-google-fonts/* 가짜: 글꼴 값은 숫자 자산, useFonts는 expo-font의 가짜 함수.
module.exports = new Proxy(
  { __esModule: true },
  {
    get(target: Record<string | symbol, unknown>, name) {
      if (typeof name === 'symbol' || name === 'then' || name in target) return target[name];
      if (name === 'useFonts') return require('expo-font').useFonts;
      return 1;
    },
  },
);
