// TASK-006 B6: 여행 중 화면의 카드 부품 T-01·T-02·T-03·T-07·T-08. 서버가 준 값을 그리기만 한다 (카드를 고르지 않는다).
// 장소가 들어간 카드는 확인 상태 칩(색 + 글자)이 항상 붙는다 (SCREEN-001 §3-2). 장소가 없는 줄(facts가 빈 목록)은 칩이 없다 (§11 Q6).
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { StatusChip } from '@/components/planning/status-chip';
import { minutesOfAt, toMinutes } from '@/lib/demo-clock';
import { withParticle } from '@/lib/particle';
import { sourceLabel } from '@/lib/source-label';
import type { NowCard, NowCourseItem, NowFact, NowProposal, NowT06Proposal } from '@/lib/now-api';
import { todayHoursText } from '@/lib/today-hours-text';
import { layout } from '@/planning/layout';
import { color, googleText, radius, space, text } from '@/planning/theme';

function FactChip({ facts }: { facts: NowCourseItem['facts'] }) {
  if (facts.length === 0) return null;
  return <StatusChip status={todayHoursText(facts).chip} />;
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
  return (
    <View style={styles.titleRow}>
      <StatusChip status={fact.status} />
      <Text style={text('body')}>{shown.text}</Text>
      {/* §11 G1: Google 출처 글자는 Roboto 400 (src-google). 번역하지 않는다 */}
      <Text style={fact.source_type === 'google' ? googleText : text('caption', 'muted')}>
        {`${sourceLabel(fact.source_type)} · ${fact.checked_at ? `확인: ${fact.checked_at.slice(0, 10)}` : '확인한 적 없음'}`}
      </Text>
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

function Shell({ id, main, children }: { id: string; main: boolean; children: React.ReactNode }) {
  return (
    <View testID={id} style={[styles.card, !main && styles.sub]}>
      {children}
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
}) {
  switch (card.type) {
    case 'T-01':
      return (
        <Shell id="card-T-01" main={main}>
          <Text style={text('label', 'muted')}>지금 할 일</Text>
          <View style={styles.titleRow}>
            <Text style={[text('title'), styles.grow]}>{card.item.name}</Text>
            <FactChip facts={card.item.facts} />
          </View>
          {card.ends_in_min === null ? (
            <Text style={text('body', 'muted')}>{`${card.item.start}에 시작해`}</Text>
          ) : (
            <BigMinutes value={card.ends_in_min} unit="분 남았어" />
          )}
          <Text style={text('caption', 'muted')}>{`${card.item.end}에 끝나`}</Text>
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
          <Text style={text('label', 'muted')}>다음 이동</Text>
          <View style={styles.titleRow}>
            <Text style={[text('title'), styles.grow]}>{card.next_item.name}</Text>
            <FactChip facts={card.next_item.facts} />
          </View>
          <Text style={text('body')}>
            {card.leave_in_min > 0
              ? `${card.leave_at}에 출발 · ${card.leave_in_min}분 뒤`
              : late > 0
                ? `출발 시각이 ${late}분 지났어`
                : `${card.leave_at}에 출발, 지금 나서자`}
          </Text>
          <Text style={text('caption', 'muted')}>{`이동 ${card.travel_min}분`}</Text>
          {url !== null ? <SecondaryButton small testID="directions-button" label="길 안내" onPress={open} /> : null}
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
              <FactChip facts={item.facts} />
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
      return (
        <Shell id="card-T-07" main={main}>
          <Text style={text('label', 'muted')}>고정 일정이 곧이야</Text>
          <View style={styles.titleRow}>
            {/* §14: 고정 일정 제목 + 시작~끝 시각 ("저녁 예약 · 18:30~19:30") */}
            <Text style={[text('title'), styles.grow]}>{`${card.fixed.title} · ${card.fixed.start}~${card.fixed.end}`}</Text>
            <FactChip facts={card.fixed.facts} />
          </View>
          <Text style={text('body')}>{`${card.leave_by}까지 출발해야 해`}</Text>
          {card.leave_in_min > 0 ? <BigMinutes value={card.leave_in_min} unit="분 뒤" /> : <Text style={text('heading')}>지금 출발해</Text>}
        </Shell>
      );
    case 'T-08':
      return (
        <Shell id="card-T-08" main={main}>
          <Text style={text('label', 'muted')}>숙소 가는 법</Text>
          <Text style={text('title')}>{card.go_home_min > 0 ? `숙소까지 ${card.go_home_min}분` : '숙소로 돌아가자'}</Text>
          {/* §13 E4: 서버가 준 숙소 길찾기 주소를 구글 지도 앱으로 넘긴다 */}
          <SecondaryButton
            small
            testID="home-directions-button"
            label="숙소로 길 안내"
            onPress={() => {
              Linking.openURL(card.map_url).catch(onOpenFailed);
            }}
          />
        </Shell>
      );
  }
}

const styles = StyleSheet.create({
  card: { gap: space['space-2'] },
  sub: { backgroundColor: color['bg-2'], borderRadius: radius['r-lg'], padding: space['space-4'] },
  grow: { flexShrink: 1, flexGrow: 1 },
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
  chosen: { backgroundColor: color['brand-soft'], borderColor: color.brand },
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
