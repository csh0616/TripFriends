# Google 로그인 버튼 G 로고 (K7, 11-12)

- 출처: Google 공식 "Download Pre-Approved Brand Icons" (`signin-assets.zip`, https://developers.google.com/identity/branding-guidelines)
- 원본: `signin-icon-light-square-ios.svg` = zip의 `iOS/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=iOS.svg` 그대로 (44×44 버튼, G는 가운데 20×20)
- 앱에서 쓰는 파일: `g-logo.png`·`g-logo@2x.png`·`g-logo@3x.png` (20pt)
  - zip의 iOS 공식 PNG(@2x·@3x·@4x, 같은 버튼)에서 **G 자리 20×20만 잘라 냄**. 색·모양은 손대지 않음. @1x는 @4x를 줄임
  - SVG를 쓰지 않는 이유: 2025년 새 G 로고 SVG는 `foreignObject`(conic-gradient)·blur 필터로 그려져 react-native-svg가 그리지 못한다
- 버튼 모양은 DESIGN-001 §4-12 `google-btn` (흰 바탕, 테두리 #747775 1px, 글자 「Google 계정으로 계속」)
