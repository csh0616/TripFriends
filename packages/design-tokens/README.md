# design-tokens

DESIGN-001 §1·§2·§4의 확정 값을 `tokens.json` 하나에 옮긴 패키지다. 앱(`apps/mobile`)은 이 값만 쓴다.

## 쓰는 법
```ts
import tokens from 'design-tokens';

tokens.color.brand; // '#FF5A00'
tokens.type.body; // { size: 15, lineHeight: 22, weight: 400 }
tokens.radius['r-lg']; // 20
```
앱에서는 `apps/mobile/src/planning/theme.ts`가 이 값을 화면 스타일로 바꿔 준다. 화면 코드는 `theme.ts`를 거쳐 쓴다.

## 규칙
- 값을 바꾸려면 **DESIGN-001을 먼저** 고친다(PM). 그다음 `tokens.json`을 문서와 똑같이 맞춘다. 테스트(`design-tokens.test.ts`)가 문서의 표와 이 파일을 비교한다.
- 새 토큰을 마음대로 더하지 않는다. 표에 없는 이름이 있으면 테스트가 실패한다.
- 높이·너비·테두리 굵기 같은 **레이아웃 크기**는 토큰이 아니라 `apps/mobile/src/planning/layout.ts` 한 파일에 둔다.

## 금지
- 앱 코드(`apps/mobile/src`)에 색 hex, `rgb(`, `rgba(`, 색 이름(`'white'` 등)을 직접 쓰는 것. `'transparent'`만 허용. 예외는 사진 자리표시 그라데이션을 담은 `lib/placeholder-for.ts` 한 파일뿐이다(G1).
- 글자 크기·줄 높이·모서리 숫자를 직접 쓰는 것. 항상 토큰을 거친다.
- `danger` 색을 SOS 부품 밖에서 쓰는 것(G5).
- 주황 면 위에 흰 글자를 쓰는 것. 주황 위 글자는 `on-brand`다(대비 3.13으로 탈락).
- 옛 `muted` 값(`#6B7280`, 대비 4.39)을 쓰는 것.
