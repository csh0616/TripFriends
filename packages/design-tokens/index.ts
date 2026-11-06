// 토큰의 유일한 출처는 tokens.json이다. 여기서는 그대로 내보내기만 한다.
import tokens from './tokens.json';

export default tokens;
export type Tokens = typeof tokens;
