import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export const HOVER_INTENT_DELAY_MS = 380;
export const TOUCH_ACTIVITY_SUPPRESS_HOVER_MS = 700;

let lastTouchActivityAt = 0;

/**
 * 记录近期发生过触屏交互，用于在移动浏览器派发合成 mouseenter 时阻止误触发桌面悬停浮层。
 */
export function markTouchPointerActivity(now: number = Date.now()): void {
  lastTouchActivityAt = now;
}

export function isRecentTouchActivity(
  now: number = Date.now(),
  suppressWindowMs: number = TOUCH_ACTIVITY_SUPPRESS_HOVER_MS,
): boolean {
  return lastTouchActivityAt > 0 && now - lastTouchActivityAt < suppressWindowMs;
}

export function isFineHoverPointerType(pointerType: string | undefined): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}

export interface HoverIntentControllerOptions {
  readonly delayMs?: number;
  readonly onShow: () => void;
  readonly onHide?: () => void;
}

/**
 * 纯逻辑桌面悬停意图控制器：
 * - 光标进入后需稳定悬停达到 delayMs（默认 380ms）才触发详情展示
 * - 移出、按下点击或开始拖拽时立即取消计时并关闭已有浮层
 */
export function createHoverIntentController(options: HoverIntentControllerOptions) {
  const delayMs = options.delayMs ?? HOVER_INTENT_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const enter = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      shown = true;
      options.onShow();
    }, delayMs);
  };

  const leave = () => {
    clearTimer();
    if (shown) {
      shown = false;
      options.onHide?.();
    }
  };

  const cancel = () => {
    leave();
  };

  const isShown = () => shown;

  return {
    enter,
    leave,
    cancel,
    isShown,
  };
}

export interface UseHoverIntentOptions {
  readonly delayMs?: number;
  readonly disabled?: boolean;
  readonly onHoverShow?: (rect: DOMRect) => void;
  readonly onHoverHide?: () => void;
}

export interface HoverIntentHandlers {
  readonly onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  readonly cancelHover: () => void;
}

/**
 * 桌面端悬停计时 Hook（与移动端手指长按彻底分离）：
 * - 仅响应 mouse / pen 精细指针，严禁在 touch 触控时触发
 * - 悬停停留达到 delayMs（默认 380ms）后读取当前最新几何位置并回调 onHoverShow
 * - 鼠标移出、按下点击或开始拖拽时立即取消并隐藏详情浮层
 */
export function useHoverIntent({
  delayMs = HOVER_INTENT_DELAY_MS,
  disabled = false,
  onHoverShow,
  onHoverHide,
}: UseHoverIntentOptions): HoverIntentHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetElRef = useRef<HTMLElement | null>(null);
  const shownRef = useRef(false);

  const onHoverShowRef = useRef(onHoverShow);
  onHoverShowRef.current = onHoverShow;
  const onHoverHideRef = useRef(onHoverHide);
  onHoverHideRef.current = onHoverHide;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelHover = useCallback(() => {
    clearTimer();
    targetElRef.current = null;
    if (shownRef.current) {
      shownRef.current = false;
      onHoverHideRef.current?.();
    }
  }, [clearTimer]);

  useEffect(() => {
    if (disabled) {
      cancelHover();
    }
  }, [disabled, cancelHover]);

  useEffect(() => {
    const handleGlobalDismiss = () => cancelHover();
    window.addEventListener('blur', handleGlobalDismiss);
    return () => {
      clearTimer();
      window.removeEventListener('blur', handleGlobalDismiss);
    };
  }, [clearTimer, cancelHover]);

  const onPointerEnter = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !onHoverShowRef.current) return;
      if (!isFineHoverPointerType(e.pointerType) || isRecentTouchActivity()) return;

      clearTimer();
      targetElRef.current = e.currentTarget;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const el = targetElRef.current;
        if (!el || !el.isConnected || isRecentTouchActivity()) return;
        shownRef.current = true;
        onHoverShowRef.current?.(el.getBoundingClientRect());
      }, delayMs);
    },
    [disabled, delayMs, clearTimer],
  );

  const onPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!isFineHoverPointerType(e.pointerType)) return;
      cancelHover();
    },
    [cancelHover],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!isFineHoverPointerType(e.pointerType)) {
        markTouchPointerActivity();
      }
      cancelHover();
    },
    [cancelHover],
  );

  return {
    onPointerEnter,
    onPointerLeave,
    onPointerDown,
    cancelHover,
  };
}
