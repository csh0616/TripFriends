// 글꼴 번들 (네트워크 없이 표시). 필요한 굵기만 깊은 경로로 가져와 앱이 커지지 않게 한다.
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { NotoSansKR_400Regular } from '@expo-google-fonts/noto-sans-kr/400Regular';
import { NotoSansKR_500Medium } from '@expo-google-fonts/noto-sans-kr/500Medium';
import { NotoSansKR_600SemiBold } from '@expo-google-fonts/noto-sans-kr/600SemiBold';
import { NotoSansKR_700Bold } from '@expo-google-fonts/noto-sans-kr/700Bold';
// TASK-010 §11 G1·G3: "Google Maps" 글자는 Roboto 400. JS 글꼴 불러오기 (네이티브 모듈 추가 없음)
import { Roboto_400Regular } from '@expo-google-fonts/roboto/400Regular';

export const fontAssets = {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_600SemiBold,
  NotoSansKR_700Bold,
  DMMono_500Medium,
  Roboto_400Regular,
};
