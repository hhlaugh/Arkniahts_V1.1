import { advancePhase, createInitialGameState, mulligan, reduceGameAction } from '../game/engine';
import type {
  BoardProfile,
  CardDefinition,
  CardInstanceId,
  CombatLogEvent,
  DeckDefinition,
  GameAction,
  GameState,
  OpenDecisionConfig,
  PlayerId,
} from '../game/types';
import { isActionRequest } from './protocol';
import type { ActionAck, ActionRequest } from './protocol';
import { toPlayerView } from './playerView';
import type { PlayerView } from './playerView';

export interface LocalGameSetup {
  readonly decks: Readonly<Record<PlayerId, DeckDefinition>>;
  readonly cards: readonly CardDefinition[];
  readonly seed: number;
  readonly boardProfile?: BoardProfile;
  readonly cpCurve?: readonly number[];
  readonly openDecisionConfig?: Partial<OpenDecisionConfig>;
}

export interface LocalGameSnapshot {
  readonly state: GameState;
  readonly logHistory: readonly CombatLogEvent[];
}

export interface ActionResult {
  readonly ok: boolean;
  readonly reason?: string;
}

type Listener = () => void;

const AUTO_ADVANCE_GUARD = 10_000;

export class LocalGameController {
  private state: GameState;
  private readonly setup: LocalGameSetup;
  private logHistory: CombatLogEvent[] = [];
  private snapshot: LocalGameSnapshot;
  private readonly listeners: Set<Listener> = new Set();
  private readonly processedRequestIds = new Set<string>();
  private readonly processedRequestOrder: string[] = [];

  private constructor(setup: LocalGameSetup, state: GameState) {
    this.setup = setup;
    this.state = state;
    this.snapshot = { state, logHistory: this.logHistory };
  }

  static create(setup: LocalGameSetup): LocalGameController {
    return new LocalGameController(
      setup,
      createInitialGameState({
        decks: setup.decks,
        cards: setup.cards,
        seed: setup.seed,
        boardProfile: setup.boardProfile,
        cpCurve: setup.cpCurve,
        openDecisionConfig: setup.openDecisionConfig,
      }),
    );
  }

  getSetup(): LocalGameSetup {
    return this.setup;
  }

  getSnapshot = (): LocalGameSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  submitMulligan(playerId: PlayerId, selectedCardInstanceIds: readonly CardInstanceId[]): ActionResult {
    const result = mulligan(this.state, playerId, selectedCardInstanceIds);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.applyStep(this.state, result.value);
    this.autoAdvance();
    this.publish();
    return { ok: true };
  }

  dispatch(actorId: PlayerId, action: GameAction): ActionResult {
    const result = reduceGameAction(this.state, actorId, action);
    if (!result.ok) return { ok: false, reason: result.reason };
    this.applyStep(this.state, result.value);
    this.autoAdvance();
    this.publish();
    return { ok: true };
  }

  submitAction(actorId: PlayerId, request: ActionRequest): ActionAck {
    const stateVersion = this.state.state_version;
    if (!isActionRequest(request)) {
      const requestId = typeof (request as { requestId?: unknown } | null)?.requestId === 'string' ? (request as unknown as ActionRequest).requestId : '';
      return { requestId, ok: false, reason: 'ActionRequest 格式不合法。', stateVersion };
    }
    if (this.processedRequestIds.has(request.requestId)) {
      return { requestId: request.requestId, ok: false, reason: '重复的 requestId，已拒绝重复执行。', stateVersion };
    }
    if (request.expectedStateVersion !== stateVersion) {
      return {
        requestId: request.requestId,
        ok: false,
        reason: `状态版本过期：期望 ${request.expectedStateVersion}，当前 ${stateVersion}。请先同步最新 PlayerView。`,
        stateVersion,
      };
    }
    this.processedRequestIds.add(request.requestId);
    this.processedRequestOrder.push(request.requestId);
    while (this.processedRequestOrder.length > 512) {
      const oldest = this.processedRequestOrder.shift() as string;
      this.processedRequestIds.delete(oldest);
    }
    const result = reduceGameAction(this.state, actorId, request.action);
    if (!result.ok) return { requestId: request.requestId, ok: false, reason: result.reason, stateVersion };
    this.applyStep(this.state, result.value);
    this.autoAdvance();
    this.publish();
    return { requestId: request.requestId, ok: true, stateVersion: this.state.state_version };
  }

  toPlayerView(viewerId: PlayerId): PlayerView {
    return toPlayerView(this.state, viewerId, { logHistory: this.logHistory });
  }

  private applyStep(previous: GameState, next: GameState): void {
    this.appendLogDiff(previous, next);
    this.state = next;
  }

  private autoAdvance(): void {
    for (let guard = 0; guard < AUTO_ADVANCE_GUARD; guard += 1) {
      const { phase } = this.state;
      if (phase === 'mulligan' || phase === 'action' || phase === 'finished') return;
      if (phase === 'turn_start' && this.state.turn_start_prepared && this.state.pending_effect_choices.length > 0) return;
      const result = advancePhase(this.state);
      if (!result.ok) return;
      this.applyStep(this.state, result.value);
    }
  }

  private appendLogDiff(previous: GameState, next: GameState): void {
    if (next.combat_log === previous.combat_log) return;
    let fresh: readonly CombatLogEvent[];
    if (previous.phase === 'combat' && next.phase !== 'combat') {
      fresh = next.combat_log;
    } else if (next.combat_log.length >= previous.combat_log.length) {
      fresh = next.combat_log.slice(previous.combat_log.length);
    } else {
      fresh = next.combat_log;
    }
    if (fresh.length === 0) return;
    const appended = fresh.map((event, index) => ({ ...event, sequence: this.logHistory.length + index }));
    this.logHistory = [...this.logHistory, ...appended];
  }

  private publish(): void {
    this.snapshot = { state: this.state, logHistory: this.logHistory };
    for (const listener of this.listeners) listener();
  }
}
