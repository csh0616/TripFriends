// TASK-006 B6: 여행 중 화면의 카드 부품 T-01·T-02·T-03·T-07·T-08. 서버가 준 값을 그리기만 한다 (카드를 고르지 않는다).
// 장소가 들어간 카드는 확인 상태 칩(색 + 글자)이 항상 붙는다 (SCREEN-001 §3-2). 장소가 없는 줄(facts가 빈 목록)은 칩이 없다 (§11 Q6).
import { Children, createContext, useContext, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { MonoText } from '@/components/trips/parts';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { LockIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { HoursChipView, StatusChip, type ChipWords } from '@/components/planning/status-chip';
import { SheetFrame, sheetStyles } from '@/account/sheet-frame';
import { minutesOfAt, toMinutes } from '@/lib/demo-clock';
import { withParticle } from '@/lib/particle';
import { sourceLabel } from '@/lib/source-label';
import type { NowCard, NowCourseItem, NowFact, NowProposal, NowT06Proposal } from '@/lib/now-api';
import { hoursView, todayHoursText } from '@/lib/today-hours-text';
import { hoursRangeText } from '@/planning/format';
import { layout } from '@/planning/layout';
import { color, googleText, radius, space, text } from '@/planning/theme';

const ALWAYS_OPEN_TEXT = '늘 열려 있어';

/** 숙소 없는 하루 끝 T-08 본문 (§31 Q3). 서버 이유 줄이 같은 문장이면 한 번만 보이게 화면이 이유 줄을 숨긴다 (TASK-015 §E ①) */
export const NO_LODGING_BODY = '오늘 일정이 끝났어. 오늘도 수고했어!';

/** 카드 본문과 같은 문장이면 이유 줄을 숨긴다. 줄 자리(위 8 + 22)도 함께 없앤다 */
export const reasonHidden = (card: NowCard | null, reason: string): boolean =>
  card !== null && card.type === 'T-08' && card.lodging == null && reason.trim() === NO_LODGING_BODY;

/** 영업시간 칩 자리 (TASK-011 §9 Q10, §14 N9): 확인 상태 칩 / curated 시간대는 "추천 시간대" / 늘 열림은 그 status 칩(보통 확인됨) + "늘 열려 있어" */
function FactChip({ facts, words = 'short', onOpen }: { facts: NowCourseItem['facts']; words?: ChipWords; onOpen?: () => void }) {
  if (facts.length === 0) return null;
  const view = hoursView(facts);
  // TASK-015 §29 (task-015-design §15-5): "늘 열려 있어"는 값이 영업을 말하니 칩은 짧게
  if (view.text === ALWAYS_OPEN_TEXT)
    return (
      <View style={styles.alwaysOpen}>
        <HoursChipView chip={view.chip} words="short" onOpen={onOpen} />
        <Text style={text('caption', 'muted')}>{ALWAYS_OPEN_TEXT}</Text>
      </View>
    );
  return <HoursChipView chip={view.chip} words={words} onOpen={onOpen} />;
}

/**
 * 칩 시트에 보일 장소 (TASK-015 §29: 미확인 · 모름 칩을 누르면). 서버 값 그대로:
 * kind = 누른 카드(T-01 지금 장소 'now' · T-02 다음 장소 'next' · T-07 고정 일정 'fixed') · seq(T-02 부제 "다음 장소 · N번") · placeId ·
 * canConfirm(§30 can_confirm_hours = T-05가 그 장소로 뜨는 때) · mapUrl(§30 place_map_url)
 */
export type ChipPlace = { kind: 'now' | 'next' | 'fixed'; name: string; seq: number | null; facts: NowFact[]; placeId: string | null; canConfirm: boolean; mapUrl: string | null };

/** TASK-015 §27 칩 ㉠ (task-014-design §10-1 "라벨 줄 24 | 라벨 + 오른쪽 칩"): 라벨 줄 오른쪽 끝에 긴 칩. 이름이 길어도 칩이 밀리거나 이름을 자르지 않는다 */
function LabelRow({ children, place, onChip }: { children: ReactNode; place: ChipPlace; onChip?: (place: ChipPlace) => void }) {
  return (
    <View style={styles.labelRow}>
      {children}
      <View style={styles.grow} />
      <FactChip facts={place.facts} words="long" onOpen={onChip ? () => onChip(place) : undefined} />
    </View>
  );
}

const CHIP_SHEET_QUESTION = '가기 전에 열었는지 볼래?'; // T-05와 같은 문구
const CHIP_SHEET_HINT = '출발 30분 전부터 [열었어] [닫혔어]로 알려 줄 수 있어';

/** "2026-11-01T09:00…" -> "11월 1일" (task-015-design §16-3 출처 줄 "확인: {월 일}") */
const monthDay = (iso: string): string => {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${Number(match[1])}월 ${Number(match[2])}일` : iso;
};

/**
 * TASK-015 §29 · §31 칩 시트 `sheet-fact` (task-015-design §16 보드 ③-T15d1~d3): 장소 이름 · 부제(T-02만 "다음 장소 · N번") · 사실 줄 ·
 * 출처 한 줄 · [구글 지도에서 보기] · 창 안이면 질문 + [열었어][닫혔어] / T-02 창 밖이면 안내 한 줄 · [닫기].
 * 모양은 열 때 받은 place 그대로(시트가 떠 있는 동안 창이 열려도 안 바뀜, §16-4). T-01 · T-07 부제는 문서에 없어(결정권자 답 대기) 넣지 않는다.
 * busy = [열었어][닫혔어] 요청 중(두 버튼 비활성, §16-5). 답이 오면 화면이 시트를 닫는다
 */
export function ChipSheet({
  place,
  busy,
  onClose,
  onVisit,
  onOpenFailed,
}: {
  place: ChipPlace;
  busy: boolean;
  onClose: () => void;
  /** [열었어][닫혔어]: T-05와 같은 요청 (화면이 보낸다) */
  onVisit: (placeId: string, wasOpen: boolean) => void;
  onOpenFailed: () => void;
}) {
  const fact = place.facts.find((one) => one.field === 'opening_hours') ?? place.facts[0];
  const placeId = place.placeId;
  const mapUrl = place.mapUrl;
  const next = place.kind === 'next';
  // 쌍은 서버가 "지금 확인 가능"이라 할 때만(서버는 다음 장소 · 창 안에서만 true, §30 · §16-4). 창 밖 안내는 다음 장소(T-02)에서만
  const pair = place.canConfirm && placeId !== null;
  const hint = next && !place.canConfirm;
  const source = fact ? `${sourceLabel(fact.source_type)} · ${fact.checked_at ? `확인: ${monthDay(fact.checked_at)}` : '확인한 적 없음'}` : '출처 없음 · 확인한 적 없음';
  return (
    <SheetFrame testID="chip-sheet" scrimTestID="chip-sheet-scrim" scrimLabel="닫기" onScrim={onClose} dialogLabel="영업시간 확인">
      <Text numberOfLines={1} style={text('heading')}>
        {place.name}
      </Text>
      {next && place.seq !== null ? (
        // 부제 "다음 장소 · 3번" (번호만 DM Mono, §16-3)
        <View style={styles.subtitleRow}>
          <Text style={text('caption', 'muted')}>다음 장소 · </Text>
          <Text style={text('num-sm', 'muted')}>{String(place.seq)}</Text>
          <Text style={text('caption', 'muted')}>번</Text>
        </View>
      ) : null}
      {/* 사실 줄: 값이 있으면 짧은 칩 + "오늘 시각", 값이 없으면(모름) 긴 칩 하나 (§16-3) */}
      <View style={styles.chipFactRow}>
        {fact && fact.value !== null ? (
          <>
            <StatusChip status={fact.status} />
            <MonoText timesOnly value={`오늘 ${hoursRangeText(todayHoursText([fact]).text)}`} base={text('body')} />
          </>
        ) : (
          <StatusChip status={fact ? fact.status : 'unknown'} words="long" />
        )}
      </View>
      {/* §11 G1: Google 출처 글자는 Roboto 400 (src-google). 번역하지 않는다 */}
      <Text style={fact?.source_type === 'google' ? googleText : text('caption', 'muted')}>{source}</Text>
      {mapUrl !== null ? (
        <SecondaryButton
          small
          testID="chip-sheet-map-link"
          label="구글 지도에서 보기"
          onPress={() => {
            Linking.openURL(mapUrl).catch(onOpenFailed);
          }}
        />
      ) : null}
      {pair ? (
        <>
          <Text style={[text('body'), styles.chipQuestion]}>{CHIP_SHEET_QUESTION}</Text>
          <View style={styles.pair}>
            <View style={styles.grow}>
              <SecondaryButton testID="visit-open" label="열었어" disabled={busy} onPress={() => onVisit(placeId, true)} />
            </View>
            <View style={styles.grow}>
              <SecondaryButton testID="visit-closed" label="닫혔어" disabled={busy} onPress={() => onVisit(placeId, false)} />
            </View>
          </View>
        </>
      ) : null}
      {hint ? (
        <View style={styles.labelRow}>
          <LockIcon color={color.muted} size={layout.factIcon} />
          <Text style={[text('caption', 'muted'), styles.grow]}>{CHIP_SHEET_HINT}</Text>
        </View>
      ) : null}
      <View style={sheetStyles.buttons}>
        <SecondaryButton testID="chip-sheet-close" label="닫기" onPress={onClose} />
      </View>
    </SheetFrame>
  );
}

/** 직선거리 m를 "350m" / "1.0km"로 (10m 단위 반올림, 995m부터 km) */
const metresLabel = (metres: number): string => {
  const rounded = Math.round(metres / 10) * 10;
  return rounded < 1000 ? `${rounded}m` : `${(metres / 1000).toFixed(1)}km`;
};

/** 이동 변화 분: 부호를 붙여 그대로 ("+4분", "−3분", 마이너스는 U+2212) */
const changeLabel = (minutes: number): string => (minutes < 0 ? `\u2212${-minutes}분` : `+${minutes}분`);

/** T-05: 사실마다 상태 칩 + 출처 + 확인 날짜. 서버 값만 쓴다 (영업 여부를 지어내지 않는다) */
function FactLine({ fact }: { fact: NowFact }) {
  const shown = todayHoursText([fact]);
  const checkedLine = `${sourceLabel(fact.source_type)} · ${fact.checked_at ? `확인: ${fact.checked_at.slice(0, 10)}` : '확인한 적 없음'}`;
  return (
    <View style={styles.titleRow}>
      <StatusChip status={fact.status} />
      <Text style={text('body')}>{hoursRangeText(shown.text)}</Text>
      {/* §11 G1: Google 출처 글자는 Roboto 400 (src-google). 번역하지 않는다 */}
      {fact.source_type === 'google' ? (
        <Text style={googleText}>{checkedLine}</Text>
      ) : (
        <MonoText value={checkedLine} base={text('caption', 'muted')} />
      )}
    </View>
  );
}

/** 고르는 칸 (TASK-009 A1): 눌러서 고르고 다시 누르면 해제. 서버에는 아무것도 보내지 않는다. 고른 칸 = sel-bg + sel-ring + radio 채움 */
function ChoiceRow({
  id,
  chosen,
  onChoose,
  minHeight,
  children,
}: {
  id: string;
  chosen: boolean;
  onChoose: () => void;
  minHeight: number;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      onPress={onChoose}
      style={[styles.choice, { minHeight }, chosen && styles.chosen]}
    >
      <View style={[styles.radio, chosen && styles.radioOn]}>{chosen ? <View style={styles.radioDot} /> : null}</View>
      <View style={[styles.grow, styles.choiceBody]}>{children}</View>
    </Pressable>
  );
}

/** T-06 대안 칸. 사실 칩은 제안 items 안 그 대안 줄의 facts에서 읽는다 (§12 Q21). 순서 안내는 서버 reason만 (TASK-009 B4) */
function AlternativeBox({ proposal, chosen, onChoose }: { proposal: NowT06Proposal; chosen: boolean; onChoose: () => void }) {
  const alternative = proposal.closed.alternative;
  if (alternative === null) return null;
  const line = proposal.items.find((item) => item.place_id === alternative.place_id);
  const { distance_m: distance, travel_change_min: change } = proposal.closed;
  return (
    <ChoiceRow id={`proposal-${proposal.proposal_id}`} chosen={chosen} onChoose={onChoose} minHeight={layout.rowAlt}>
      <View style={styles.titleRow}>
        {/* 사진 자리: 기존 자리표시 방식 그대로 (장소 그림은 이번 범위 밖) */}
        <View testID={`proposal-thumb-${proposal.proposal_id}`} style={styles.thumb}>
          <PhotoPlaceholder category="landmark" style={StyleSheet.absoluteFill} />
        </View>
        <Text style={[text('heading'), styles.grow]}>{alternative.name}</Text>
        <FactChip facts={line?.facts ?? []} />
      </View>
      <Text style={text('caption', 'muted')}>{`${distance === null ? '' : `${metresLabel(distance)} · `}이동 ${changeLabel(change)}`}</Text>
      <Text style={text('body')}>{proposal.reason}</Text>
    </ChoiceRow>
  );
}

/** TASK-015 §24 18번: 메인 카드의 마지막 요소(주 버튼 또는 마지막 줄) 자리를 재는 곳. NowCardView가 메인 카드일 때만 넣는다 */
const LastLayout = createContext<((box: { y: number; height: number }) => void) | null>(null);

function Shell({ id, main, children }: { id: string; main: boolean; children: React.ReactNode }) {
  const onLast = useContext(LastLayout);
  const items = Children.toArray(children);
  const last = items.length - 1;
  return (
    <View testID={id} style={[styles.card, !main && styles.sub]}>
      {main && onLast && last >= 0
        ? items.map((item, index) =>
            index === last ? (
              // 마지막 요소만 감싼 상자: 카드 안 y · 높이 = 마지막 요소 아래 끝 (접힌 시트 높이)
              <View key="last" onLayout={(event) => onLast(event.nativeEvent.layout)}>
                {item}
              </View>
            ) : (
              item
            ),
          )
        : children}
    </View>
  );
}

/** 남은 분을 크게 보여 주는 줄: 숫자 한 글자 묶음 + 단위 */
function BigMinutes({ value, unit }: { value: number; unit: string }) {
  return (
    <View style={styles.big}>
      <Text style={text('num-xl')}>{String(value)}</Text>
      <Text style={text('body', 'muted')}>{unit}</Text>
    </View>
  );
}

function ProposalBox({ proposal, chosen, onChoose }: { proposal: NowProposal; chosen: boolean; onChoose: () => void }) {
  return (
    <ChoiceRow id={`proposal-${proposal.proposal_id}`} chosen={chosen} onChoose={onChoose} minHeight={layout.rowAlt}>
      <Text style={text('body')}>{proposal.reason}</Text>
      {proposal.dropped.length > 0 ? (
        <View style={styles.chips}>
          {proposal.dropped.map((place) => (
            <View key={place.place_id} style={styles.dropChip}>
              <Text style={text('caption')}>{place.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={text('caption', 'muted')}>{`${proposal.first_leave_at}에 출발`}</Text>
    </ChoiceRow>
  );
}

export function NowCardView({
  card,
  main,
  onOpenFailed,
  chosenId = null,
  onChoose,
  onDismiss,
  onVisit,
  lateAt = null,
  rehearsal = false,
  onLastLayout,
  onChip,
}: {
  card: NowCard;
  main: boolean;
  onOpenFailed: () => void;
  /** T-04·T-06 고른 칸의 proposal_id와 칸 누름. 고르는 것만으로는 아무것도 바뀌지 않는다 (FR-13, TASK-009 A5) */
  chosenId?: string | null;
  onChoose?: (proposalId: string) => void;
  onDismiss?: (eventId: string) => void;
  /** T-05 [열었어]/[닫혔어]: 답을 서버에 사실로 보낸다 */
  onVisit?: (placeId: string, wasOpen: boolean) => void;
  /** 늦은 상태(delayed)일 때만 지금 시각. G4: 출발 시각이 지났으면 몇 분 지났는지 */
  lateAt?: string | null;
  /** TASK-015 §B4: 연습 중에는 실제 위치에서 길을 여는 [길 안내]를 그리지 않는다 */
  rehearsal?: boolean;
  /** TASK-015 §24 18번: 메인 카드 마지막 요소(주 버튼 또는 마지막 줄)의 카드 안 y · 높이. 접힌 시트 높이를 그 아래 끝에 맞추려고 화면이 잰다 */
  onLastLayout?: (box: { y: number; height: number }) => void;
  /** TASK-015 §29: 라벨 줄의 미확인 · 모름 칩을 누르면 (화면이 칩 시트를 연다) */
  onChip?: (place: ChipPlace) => void;
}) {
  return <LastLayout.Provider value={main ? (onLastLayout ?? null) : null}>{cardBody()}</LastLayout.Provider>;

  function cardBody() {
    switch (card.type) {
      case 'T-01':
        return (
          <Shell id="card-T-01" main={main}>
            <LabelRow place={{ kind: 'now', name: card.item.name, seq: card.item.seq, facts: card.item.facts, placeId: card.item.place_id, canConfirm: card.can_confirm_hours, mapUrl: card.place_map_url }} onChip={onChip}>
              <Text style={text('label', 'muted')}>지금 할 일</Text>
            </LabelRow>
            <Text style={text('title')}>{card.item.name}</Text>
            {card.ends_in_min === null ? (
              <MonoText timesOnly value={`${card.item.start}에 시작해`} base={text('body', 'muted')} />
            ) : (
              <BigMinutes value={card.ends_in_min} unit="분 남았어" />
            )}
            <MonoText timesOnly value={`${card.item.end}에 끝나`} base={text('caption', 'muted')} />
          </Shell>
        );
      case 'T-02': {
        const url = card.map_url;
        const nowMin = lateAt === null ? null : minutesOfAt(lateAt);
        const late = nowMin === null ? 0 : nowMin - toMinutes(card.leave_at);
        const open = () => {
          if (url === null) return;
          Linking.openURL(url).catch(onOpenFailed);
        };
        return (
          <Shell id="card-T-02" main={main}>
            <LabelRow
              place={{
                kind: 'next',
                name: card.next_item.name,
                seq: card.next_item.seq,
                facts: card.next_item.facts,
                placeId: card.next_item.place_id,
                canConfirm: card.can_confirm_hours,
                mapUrl: card.place_map_url,
              }}
              onChip={onChip}
            >
              <Text style={text('label', 'muted')}>다음 이동</Text>
            </LabelRow>
            <Text style={text('title')}>{card.next_item.name}</Text>
            <MonoText
              timesOnly
              base={text('body')}
              value={
                card.leave_in_min > 0
                  ? `${card.leave_at}에 출발 · ${card.leave_in_min}분 뒤`
                  : late > 0
                    ? `출발 시각이 ${late}분 지났어`
                    : `${card.leave_at}에 출발, 지금 나서자`
              }
            />
            {/* TASK-015 §22: 숫자와 단위는 한 덩어리 — 한 줄에 안 들어가면 줄바꿈 대신 글자를 줄인다 */}
            <Text numberOfLines={1} adjustsFontSizeToFit style={text('caption', 'muted')}>{`이동 ${card.travel_min}분`}</Text>
            {url !== null && !rehearsal ? <SecondaryButton small testID="directions-button" label="길 안내" onPress={open} /> : null}
          </Shell>
        );
      }
      case 'T-03':
        return (
          <Shell id="card-T-03" main={main}>
            <Text style={text('label', 'muted')}>남은 일정</Text>
            {card.items.map((item) => (
              <View key={item.seq} testID={`rest-row-${item.seq}`} style={styles.restRow}>
                <Text style={styles.restTime}>{item.start}</Text>
                <View style={styles.number}>
                  <Text style={text('num-md', 'surface')}>{String(item.seq)}</Text>
                </View>
                <Text style={[text('body'), styles.grow]}>{item.name}</Text>
                <FactChip facts={item.facts} words="row" />
              </View>
            ))}
          </Shell>
        );
      case 'T-04':
        return (
          <Shell id="card-T-04" main={main}>
            <Text style={text('label', 'muted')}>일정이 늦어졌어</Text>
            <Text style={text('title')}>{`${card.delay_min}분 늦어지고 있어`}</Text>
            {card.proposals.length === 0 ? (
              <Text style={text('body')}>{`어떻게 해도 ${card.fixed ? card.fixed.title : '일정'}에 늦어`}</Text>
            ) : card.fixed ? (
              <Text style={text('body')}>{`${card.fixed.title} ${card.fixed.start}은 지킬게`}</Text>
            ) : null}
            {card.proposals.map((proposal) => (
              <ProposalBox key={proposal.proposal_id} proposal={proposal} chosen={chosenId === proposal.proposal_id} onChoose={() => onChoose?.(proposal.proposal_id)} />
            ))}
            <SecondaryButton testID="event-dismiss" label="그대로 갈래" onPress={() => onDismiss?.(card.event_id)} />
          </Shell>
        );
      case 'T-05': {
        const url = card.map_url;
        return (
          <Shell id="card-T-05" main={main}>
            <Text style={text('label', 'muted')}>영업 확인</Text>
            <Text style={text('title')}>{card.place.name}</Text>
            <Text style={text('body')}>가기 전에 열었는지 볼래?</Text>
            {card.facts.map((fact) => (
              <FactLine key={fact.field} fact={fact} />
            ))}
            <SecondaryButton
              small
              testID="visit-map-link"
              label="구글 지도에서 보기"
              onPress={() => {
                Linking.openURL(url).catch(onOpenFailed);
              }}
            />
            <View style={styles.pair}>
              <View style={styles.grow}>
                <SecondaryButton testID="visit-open" label="열었어" onPress={() => onVisit?.(card.place.place_id, true)} />
              </View>
              <View style={styles.grow}>
                <SecondaryButton testID="visit-closed" label="닫혔어" onPress={() => onVisit?.(card.place.place_id, false)} />
              </View>
            </View>
          </Shell>
        );
      }
      case 'T-06': {
        const alternatives = card.proposals.filter((proposal) => proposal.closed.alternative !== null);
        const skip = card.proposals.find((proposal) => proposal.closed.alternative === null);
        return (
          <Shell id="card-T-06" main={main}>
            <Text style={text('label', 'muted')}>닫힘 대안</Text>
            <Text style={text('title')}>{`${withParticle(card.closed.name, '이/가')} 닫혔대`}</Text>
            {alternatives.length > 0 ? (
              <Text style={text('body')}>근처에 이런 데 있어</Text>
            ) : skip ? (
              <Text style={text('body')}>근처에 열린 비슷한 곳이 없어</Text>
            ) : (
              <Text style={text('body')}>지금은 바꿀 방법을 못 찾았어</Text>
            )}
            {alternatives.map((proposal) => (
              <AlternativeBox key={proposal.proposal_id} proposal={proposal} chosen={chosenId === proposal.proposal_id} onChoose={() => onChoose?.(proposal.proposal_id)} />
            ))}
            {skip ? (
              <ChoiceRow id="closed-skip" chosen={chosenId === skip.proposal_id} onChoose={() => onChoose?.(skip.proposal_id)} minHeight={layout.rowDrop}>
                <Text style={text('heading')}>빼고 가기</Text>
                <Text style={text('body')}>{skip.reason}</Text>
              </ChoiceRow>
            ) : null}
            <SecondaryButton testID="event-dismiss" label="그대로 둘게" onPress={() => onDismiss?.(card.event_id)} />
          </Shell>
        );
      }
      case 'T-07':
        // TASK-015 §24 2(보드 ①-30대로): 자물쇠 + "고정 일정 · 곧 출발" · 제목 · 장소 줄 "{장소} {시작} 시작" · "N분 뒤에 출발해"(0분이면 "지금 출발해") · "{시각} 출발". 진행 막대 없음
        return (
          <Shell id="card-T-07" main={main}>
            <LabelRow place={{ kind: 'fixed', name: card.fixed.name, seq: null, facts: card.fixed.facts, placeId: null, canConfirm: card.can_confirm_hours, mapUrl: card.place_map_url }} onChip={onChip}>
              <LockIcon color={color.muted} size={layout.factIcon} />
              <Text style={text('label', 'muted')}>고정 일정 · 곧 출발</Text>
            </LabelRow>
            <Text style={text('title')}>{card.fixed.title}</Text>
            <MonoText timesOnly value={`${card.fixed.name} ${card.fixed.start} 시작`} base={text('body')} />
            {card.leave_in_min > 0 ? <BigMinutes value={card.leave_in_min} unit="분 뒤에 출발해" /> : <Text style={text('heading')}>지금 출발해</Text>}
            <MonoText timesOnly value={`${card.leave_by} 출발`} base={text('caption', 'muted')} />
          </Shell>
        );
      case 'T-08': {
        const mapUrl = card.map_url;
        // §31 Q2·Q3: 숙소가 없으면(서버가 lodging·map_url을 null로 준다) 숙소 줄·길 안내 없이 "오늘 일정 끝"
        if (card.lodging == null) {
          return (
            <Shell id="card-T-08" main={main}>
              <Text style={text('title')}>오늘 일정 끝</Text>
              <Text style={text('body')}>{NO_LODGING_BODY}</Text>
            </Shell>
          );
        }
        const minutes = card.go_home_min;
        return (
          <Shell id="card-T-08" main={main}>
            <Text style={text('label', 'muted')}>숙소로</Text>
            {/* TASK-015 §22: 숫자와 단위는 한 덩어리 — 한 줄에 안 들어가면 줄바꿈 대신 글자를 줄인다 */}
            <Text numberOfLines={1} adjustsFontSizeToFit style={text('title')}>{minutes != null && minutes > 0 ? `숙소까지 ${minutes}분` : '숙소로 돌아가자'}</Text>
            {/* §13 E4: 서버가 준 숙소 길찾기 주소를 구글 지도 앱으로 넘긴다 */}
            {/* TASK-015 §24 1: 하루 끝에 할 일이 이것뿐이라 주 버튼(52, 주황). T-08이 메인이면 화면의 주황 주 버튼은 이것 하나 */}
            {mapUrl != null && !rehearsal ? (
              <PrimaryButton
                testID="home-directions-button"
                label="숙소로 길 안내"
                onPress={() => {
                  Linking.openURL(mapUrl).catch(onOpenFailed);
                }}
              />
            ) : null}
          </Shell>
        );
      }
    }
  }
}

const styles = StyleSheet.create({
  card: { gap: space['space-2'] },
  sub: { backgroundColor: color['bg-2'], borderRadius: radius['r-lg'], padding: space['space-4'] },
  grow: { flexShrink: 1, flexGrow: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space['space-1'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'], flexWrap: 'wrap' },
  // 고르는 칸: 안 골랐을 때도 테두리 자리를 같은 굵기로 잡아 골라도 모양이 안 움직인다
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-3'],
    backgroundColor: color.surface,
    borderRadius: radius['r-md'],
    borderWidth: layout.selRing,
    borderColor: color.line,
    padding: space['space-3'],
  },
  chosen: { backgroundColor: color['sel-bg'], borderColor: color.brand },
  choiceBody: { gap: space['space-2'] },
  radio: {
    width: layout.radio,
    height: layout.radio,
    borderRadius: radius['r-full'],
    borderWidth: layout.selRing,
    borderColor: color.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: color.brand },
  radioDot: { width: layout.radioDot, height: layout.radioDot, borderRadius: radius['r-full'], backgroundColor: color.brand },
  thumb: { width: layout.thumbSm, height: layout.thumbSm, borderRadius: radius['r-sm'], overflow: 'hidden' },
  pair: { flexDirection: 'row', gap: space['space-2'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space['space-2'] },
  chipFactRow: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'], marginTop: space['space-3'] },
  chipQuestion: { marginTop: space['space-2'] },
  subtitleRow: { flexDirection: 'row', alignItems: 'baseline' },
  alwaysOpen: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  dropChip: { backgroundColor: color['bg-2'], borderRadius: radius['r-full'], paddingHorizontal: space['space-3'], paddingVertical: space['space-1'] },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: space['space-2'] },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'], minHeight: layout.courseRow },
  restTime: { ...text('num-md'), width: layout.timeColumn },
  number: {
    width: layout.numberCircle,
    height: layout.numberCircle,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
