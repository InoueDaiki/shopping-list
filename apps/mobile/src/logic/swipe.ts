// 行を払って消すときの判定。縦のスクロールと区別し、指を離したときに消すかを決める

// 払い始めとみなす横の距離
const START_DX = 12;
// 消すのに要る、行の幅に対する割合
const DELETE_RATIO = 0.4;
// 速く払ったときは短くても消す。速さの下限(px/ms)と、そのときの最低の距離
const FLING_VX = 0.8;
const FLING_MIN_DX = 60;

export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > START_DX && Math.abs(dx) > Math.abs(dy) * 2;
}

export function isDeleteSwipe(dx: number, vx: number, width: number): boolean {
  if (width <= 0) return false;
  if (Math.abs(dx) >= width * DELETE_RATIO) return true;
  return Math.abs(vx) >= FLING_VX && Math.abs(dx) >= FLING_MIN_DX && Math.sign(vx) === Math.sign(dx);
}
