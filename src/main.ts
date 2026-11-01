// 진입점. 통합 단계에서 화면 흐름(타이틀 → 메뉴 → 브리핑 → 격납고 → 미션 → 결과)을 연결한다.
import { Game } from './core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();
(window as unknown as { __game: Game }).__game = game;
