// TASK-012 C1·리뷰 ①-22: 저장 권유 시트. 제목 -> 본문 -> 보조 한 줄 -> [Google 계정으로 계속](흰색) -> [나중에].
// 스크림을 눌러도 [나중에]와 같다 (§16 Q7). 주황 버튼 없음.
import { View } from 'react-native';

import { Text } from '@/components/app-text';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { fit, fitText, text } from '@/planning/theme';

import { GoogleButton } from './google-button';
import { SheetFrame, sheetStyles } from './sheet-frame';

const SHEET = fit['sheet-confirm'];

export function SaveSheet({ busy, onGoogle, onLater }: { busy: boolean; onGoogle: () => void; onLater: () => void }) {
  return (
    <SheetFrame testID="save-sheet" scrimTestID="save-sheet-scrim" scrimLabel="나중에" onScrim={onLater}>
      <Text style={fitText(SHEET)}>저장해 둘래?</Text>
      <Text style={[fitText(SHEET.note), sheetStyles.note]}>앱을 지우면 사라져</Text>
      <Text style={[text('caption', 'muted'), sheetStyles.note]}>Google 계정에 이어 두면 다른 폰에서도 볼 수 있어</Text>
      <View style={sheetStyles.buttons}>
        <GoogleButton disabled={busy} onPress={onGoogle} />
        <SecondaryButton testID="save-later" label="나중에" disabled={busy} onPress={onLater} />
      </View>
    </SheetFrame>
  );
}
