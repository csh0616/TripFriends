// 화면이 흐름(PlanningFlow)에게 받는 것. 화면은 그리기만 하고, 요청은 흐름이 보낸다.
export type NoticeData = { message: string; tone: 'plain' | 'problem'; onRetry?: () => void };

/** 요청을 보내고, 성공해서 서버 응답을 반영했으면 true */
export type Send<Args extends unknown[] = []> = (...args: Args) => Promise<boolean>;
