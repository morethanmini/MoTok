/**
 * 테스트 런타임에 없는 브라우저 API를 채운다.
 *
 * <p>jsdom은 명세를 다 구현하지 않는다. 여기 있는 것들은 <b>제품 코드의 결함이 아니라</b>
 * 테스트 환경의 공백이라, 컴포넌트에 가드를 넣는 대신(브라우저에서는 쓸모없는 죽은 코드가
 * 된다) 이 파일에서 메운다. vitest.config.ts의 `/assets` 별칭 주석과 같은 판단이다.</p>
 */

/**
 * ResizeObserver — jsdom에 없다.
 *
 * <p>없으면 이걸 쓰는 컴포넌트는 <b>마운트 자체가 ReferenceError로 죽어서</b> 그 파일의
 * 테스트가 본문을 실행해 보지도 못하고 전부 실패한다(ParticipantTile의 볼륨 테스트 3개가
 * 그렇게 깨져 있었다). 지금 이 API를 쓰는 컴포넌트는 6개다 — 참가자 타일·낚시·바디핏 3종·
 * 스티커 오버레이.</p>
 *
 * <p><b>크기를 알려 주지는 않는다.</b> jsdom에는 레이아웃이 없어 알려 줄 크기 자체가 없다.
 * 콜백은 한 번도 불리지 않으므로 관측한 값에 의존하는 테스트는 그 값을 직접 세워야 한다
 * (여기서 가짜 크기를 흘려보내면 실제와 다른 숫자가 통과 근거가 된다).</p>
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverStub
}
