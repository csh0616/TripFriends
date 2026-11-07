// TASK-006 B6: 여행 중 화면의 카드 부품 T-01·T-02·T-03·T-07·T-08. 서버가 준 값을 그리기만 한다 (카드를 고르지 않는다).
// 장소가 들어간 카드는 확인 상태 칩(색 + 글자)이 항상 붙는다 (SCREEN-001 §3-2). 장소가 없는 줄(facts가 빈 목록)은 칩이 없다 (§11 Q6).
import { Linking, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { StatusChip } from '@/components/planning/status-chip';
import type { NowCard, NowCourseItem, NowProposal } from '@/lib/now-api';
import { todayHoursText } from '@/lib/today-hours-text';
import { layout } from '@/planning/layout';
import { color, radius, space, text } from '@/planning/theme';

function FactChip({ facts }: { facts: NowCourseItem['facts'] }) {
  if (facts.length === 0) return null;
  return <StatusChip status={todayHoursText(facts).chip} />;
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

function ProposalBox({ proposal, onAccept }: { proposal: NowProposal; onAccept: () => void }) {
  return (
    <View testID={`proposal-${proposal.proposal_id}`} style={styles.proposal}>
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
      <PrimaryButton testID={`proposal-accept-${proposal.proposal_id}`} label="이걸로" onPress={onAccept} />
    </View>
  );
}

export function NowCardView({
  card,
  main,
  onOpenFailed,
  onAccept,
  onDismiss,
}: {
  card: NowCard;
  main: boolean;
  onOpenFailed: () => void;
  /** T-04 [이걸로] / [그대로 갈래]: 고르기 전에는 아무것도 바뀌지 않는다 (FR-13) */
  onAccept?: (proposalId: string) => void;
  onDismiss?: (eventId: string) => void;
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
            {card.leave_in_min > 0 ? `${card.leave_at}에 출발 · ${card.leave_in_min}분 뒤` : `${card.leave_at}에 출발, 지금 나서자`}
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
            <ProposalBox key={proposal.proposal_id} proposal={proposal} onAccept={() => onAccept?.(proposal.proposal_id)} />
          ))}
          <SecondaryButton testID="event-dismiss" label="그대로 갈래" onPress={() => onDismiss?.(card.event_id)} />
        </Shell>
      );
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
  proposal: { backgroundColor: color.surface, borderRadius: radius['r-md'], padding: space['space-3'], gap: space['space-2'] },
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
