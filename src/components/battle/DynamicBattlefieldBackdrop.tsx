import React, { useEffect, useRef } from 'react';
import { SCENIC_SCENES, type ScenicSceneId } from '../ui/ScenicBackdrop';

interface DynamicBattlefieldBackdropProps {
  /** Arknights 主题战场底图 URL（已静态导入或相对路径资源） */
  readonly backdropUrl?: string;
  /** 半边淡出官方战场远景（根据对战模式切换罗德岛外部/雪原/龙门夜景） */
  readonly scenicScene?: ScenicSceneId;
  /** 关闭动效（用户设置关闭或处于弱动效模式时暂停 canvas 与 CSS 位移） */
  readonly disableMotion?: boolean;
}

export type BattlefieldParticleKind = 'snowflake' | 'debris' | 'ember' | 'light_mote';

interface AmbientParticle {
  kind: BattlefieldParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  twinkleSpeed: number;
  rotation: number;
  rotSpeed: number;
  swayAmp: number;
  hasHalo: boolean;
  tone: 'amber' | 'cyan' | 'frost' | 'slate';
}

const PARTICLE_COUNT = 72;

function createParticles(width: number, height: number): AmbientParticle[] {
  const safeW = Math.max(width, 320);
  const safeH = Math.max(height, 240);
  const particles: AmbientParticle[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // 确定性伪随机分布，避免首次渲染与重置闪烁剧烈变化
    const seedA = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const seedB = Math.sin((i + 1) * 78.233) * 24634.6345;
    const seedC = Math.sin((i + 1) * 45.164) * 19283.7123;
    const seedD = Math.sin((i + 1) * 93.719) * 31572.4193;
    const rA = seedA - Math.floor(seedA);
    const rB = seedB - Math.floor(seedB);
    const rC = seedC - Math.floor(seedC);
    const rD = seedD - Math.floor(seedD);

    // 多样化粒子种类轮转：漂浮雪花、掉落碎屑、上浮源石余烬、光影散景颗粒
    const kindRoll = i % 10;
    const kind: BattlefieldParticleKind =
      kindRoll < 3
        ? 'snowflake'
        : kindRoll < 5
          ? 'debris'
          : kindRoll < 8
            ? 'ember'
            : 'light_mote';

    if (kind === 'snowflake') {
      particles.push({
        kind,
        x: rA * safeW,
        y: rB * safeH,
        vx: -8 + rC * 16,
        vy: 10 + rD * 14, // 轻柔飘落
        size: 2.0 + rC * 2.2,
        alpha: 0.28 + rB * 0.28,
        phase: rA * Math.PI * 2,
        twinkleSpeed: 1.1 + rD * 1.3,
        rotation: rC * Math.PI,
        rotSpeed: (rD - 0.5) * 0.9,
        swayAmp: 12 + rC * 10,
        hasHalo: i % 4 === 0,
        tone: 'frost',
      });
    } else if (kind === 'debris') {
      particles.push({
        kind,
        x: rA * safeW,
        y: rB * safeH,
        vx: (rC - 0.5) * 14,
        vy: 18 + rD * 22, // 较重战尘碎屑向下翻滚掉落
        size: 1.6 + rC * 2.1,
        alpha: 0.22 + rB * 0.26,
        phase: rA * Math.PI * 2,
        twinkleSpeed: 0.8 + rD * 1.1,
        rotation: rC * Math.PI * 2,
        rotSpeed: (rD - 0.5) * 3.4,
        swayAmp: 4 + rC * 6,
        hasHalo: false,
        tone: i % 3 === 0 ? 'amber' : 'slate',
      });
    } else if (kind === 'ember') {
      const isHeroSpark = i % 5 === 0;
      particles.push({
        kind,
        x: rA * safeW,
        y: rB * safeH,
        vx: (rC - 0.38) * 16,
        vy: -(11 + rD * 17), // 热流带动源石火花向上飘升
        size: isHeroSpark ? 2.2 + rC * 1.1 : 1.3 + rC * 0.9,
        alpha: isHeroSpark ? 0.54 + rB * 0.24 : 0.34 + rB * 0.28,
        phase: rA * Math.PI * 2,
        twinkleSpeed: 1.8 + rD * 2.2,
        rotation: Math.PI / 4,
        rotSpeed: (rC - 0.5) * 0.6,
        swayAmp: 8 + rD * 7,
        hasHalo: true,
        tone: 'amber',
      });
    } else {
      // Arknights 战斗场景风格光影颗粒（散景光斑）
      particles.push({
        kind,
        x: rA * safeW,
        y: rB * safeH,
        vx: (rC - 0.5) * 10,
        vy: (rD - 0.52) * 8, // 缓慢悬浮游弋
        size: 2.6 + rC * 2.6,
        alpha: 0.26 + rB * 0.26,
        phase: rA * Math.PI * 2,
        twinkleSpeed: 1.2 + rD * 1.6,
        rotation: 0,
        rotSpeed: 0,
        swayAmp: 10 + rC * 10,
        hasHalo: true,
        tone: i % 2 === 0 ? 'cyan' : 'amber',
      });
    }
  }
  return particles;
}

function particleRgb(tone: AmbientParticle['tone']): string {
  switch (tone) {
    case 'amber':
      return '245, 178, 52';
    case 'cyan':
      return '56, 189, 248';
    case 'frost':
      return '224, 242, 254';
    case 'slate':
      return '148, 163, 184';
  }
}

/**
 * BattleView 商业级动态 Arknights 战场氛围背景层：
 * 1. 底层 Arknights 装甲战场底图配合 CSS 合成层轻微缓动呼吸（anim-arena-drift）
 * 2. 反向缓慢漂移的罗德岛塔形暗纹（anim-emblem-drift）与基座对比度压暗遮罩
 * 3. 双层径向渐变（Radial Gradient）聚光灯照明遮罩，通过 CSS 动画缓慢漂移（anim-spotlight-drift）
 * 4. CSS 动画天气遮罩层（anim-weather-haze / anim-weather-shimmer）：轻微模糊滤镜随时间摆动，模拟烟雾与热浪扭曲
 * 5. Canvas 多样化战场粒子系统：漂浮雪花、掉落碎屑、上浮源石余烬与 Arknights 光影散景颗粒
 */
export function DynamicBattlefieldBackdrop({
  backdropUrl,
  scenicScene = 'rhodes-exterior',
  disableMotion = false,
}: DynamicBattlefieldBackdropProps) {
  const scenicMeta = SCENIC_SCENES[scenicScene];
  const scenicMask =
    'linear-gradient(212deg, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.52) 44%, rgba(0,0,0,0.08) 78%, rgba(0,0,0,0) 100%)';
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const motionOff = disableMotion || prefersReducedMotion;

    let width = Math.max(container.clientWidth, 320);
    let height = Math.max(container.clientHeight, 240);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = createParticles(width, height);

    const resizeCanvas = () => {
      if (!container || !canvas) return;
      width = Math.max(container.clientWidth, 320);
      height = Math.max(container.clientHeight, 240);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createParticles(width, height);
    };

    resizeCanvas();

    const drawFrame = (elapsedSec: number, dtSec: number) => {
      ctx.clearRect(0, 0, width, height);

      // 1. 超精细多尺度工业 CAD 基准坐标网格（12px 微格 + 48px 中格 + 96px 主基准格 + 十字准星刻度）
      const gridShiftX = motionOff ? 0 : (elapsedSec * 6) % 96;
      const gridShiftY = motionOff ? 0 : (elapsedSec * 3.5) % 96;
      ctx.save();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.022)';
      ctx.lineWidth = 1;
      for (let fx = -12 + (gridShiftX % 12); fx < width + 12; fx += 12) {
        ctx.beginPath();
        ctx.moveTo(fx, 0);
        ctx.lineTo(fx, height);
        ctx.stroke();
      }
      for (let fy = -12 + (gridShiftY % 12); fy < height + 12; fy += 12) {
        ctx.beginPath();
        ctx.moveTo(0, fy);
        ctx.lineTo(width, fy);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.048)';
      ctx.lineWidth = 1;
      for (let sx = -48 + (gridShiftX % 48); sx < width + 48; sx += 48) {
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      for (let sy = -48 + (gridShiftY % 48); sy < height + 48; sy += 48) {
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.095)';
      ctx.lineWidth = 1;
      for (let gx = -96 + gridShiftX; gx < width + 96; gx += 96) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      for (let gy = -96 + gridShiftY; gy < height + 96; gy += 96) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      // 网格交点精密 '+' 测绘刻度
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.22)';
      ctx.lineWidth = 1;
      for (let gx = -96 + gridShiftX; gx < width + 96; gx += 96) {
        for (let gy = -96 + gridShiftY; gy < height + 96; gy += 96) {
          ctx.beginPath();
          ctx.moveTo(gx - 4, gy);
          ctx.lineTo(gx + 4, gy);
          ctx.moveTo(gx, gy - 4);
          ctx.lineTo(gx, gy + 4);
          ctx.stroke();
        }
      }

      if (!motionOff) {
        const sweepY = ((elapsedSec * 22) % (height + 120)) - 60;
        const grad = ctx.createLinearGradient(0, sweepY - 36, 0, sweepY);
        grad.addColorStop(0, 'rgba(148, 163, 184, 0)');
        grad.addColorStop(1, 'rgba(148, 163, 184, 0.045)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, sweepY - 36, width, 36);
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, sweepY);
        ctx.lineTo(width, sweepY);
        ctx.stroke();
      }
      ctx.restore();

      // 2. 极简低干扰工业微粒：几何雪晶、战损微屑、源石余烬菱晶与精密测绘光点
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!;
        if (!motionOff && dtSec > 0) {
          p.x += (p.vx + Math.sin(elapsedSec * 0.8 + p.phase) * p.swayAmp * 0.7) * dtSec;
          p.y += p.vy * dtSec;
          p.rotation += p.rotSpeed * dtSec;

          if (p.vy >= 0 && p.y > height + 18) {
            p.y = -14;
            p.x = (((p.x + width * 0.29) % width) + width) % width;
          } else if (p.vy < 0 && p.y < -18) {
            p.y = height + 14;
            p.x = (((p.x + width * 0.37) % width) + width) % width;
          }
          if (p.x < -18) p.x = width + 14;
          if (p.x > width + 18) p.x = -14;
        }

        const yNorm = Math.max(0, Math.min(1, p.y / height));
        const edgeFade = Math.min(yNorm / 0.14, (1 - yNorm) / 0.14, 1);
        const pulse = motionOff
          ? 0.85
          : 0.65 + 0.35 * Math.sin(elapsedSec * p.twinkleSpeed + p.phase);
        const alpha = p.alpha * 0.56 * pulse * edgeFade;
        if (alpha <= 0.008) continue;

        const rgb = particleRgb(p.tone);

        if (p.hasHalo) {
          const haloRadius = p.size * 2.1;
          const haloGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloRadius);
          haloGrad.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.32).toFixed(3)})`);
          haloGrad.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        if (p.kind === 'snowflake') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.75, p.size * 0.22);
          for (let arm = 0; arm < 3; arm++) {
            const ang = (arm * Math.PI) / 3;
            const dx = Math.cos(ang) * p.size * 0.85;
            const dy = Math.sin(ang) * p.size * 0.85;
            ctx.beginPath();
            ctx.moveTo(-dx, -dy);
            ctx.lineTo(dx, dy);
            ctx.stroke();
          }
          ctx.restore();
        } else if (p.kind === 'debris') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
          ctx.fillRect(-p.size * 0.65, -p.size * 0.25, p.size * 1.3, p.size * 0.5);
          ctx.restore();
        } else if (p.kind === 'ember') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = `rgba(${rgb}, ${(alpha * 1.15).toFixed(3)})`;
          const s = p.size * 1.15;
          ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
          ctx.restore();
        } else {
          ctx.strokeStyle = `rgba(${rgb}, ${(alpha * 0.85).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          const r = p.size * 0.55;
          ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
        }
      }
    };

    drawFrame(0, 0);

    let rafId = 0;
    let lastTs = performance.now();
    const startTs = lastTs;

    const tick = (now: number) => {
      if (document.hidden) {
        lastTs = now;
        rafId = window.requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min((now - lastTs) / 1000, 0.05);
      const elapsed = (now - startTs) / 1000;
      lastTs = now;
      drawFrame(elapsed, dt);
      rafId = window.requestAnimationFrame(tick);
    };

    if (!motionOff) {
      rafId = window.requestAnimationFrame(tick);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', resizeCanvas);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [disableMotion]);

  return (
    <div
      ref={containerRef}
      data-testid="battlefield-backdrop"
      data-motion-disabled={disableMotion ? 'true' : 'false'}
      data-particle-kinds="snowflake,debris,ember,light_mote"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#090c10]"
    >
      {/* 1. 近未来哑光建筑底图 + 轻微缓动 */}
      {backdropUrl && (
        <img
          src={backdropUrl}
          alt=""
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover opacity-[0.10] grayscale-[58%] contrast-[1.12] will-change-transform ${
            disableMotion ? 'scale-[1.04]' : 'anim-arena-drift'
          }`}
        />
      )}

      {/* 1.5 半边淡出官方场景远景层：低饱和工业滤镜融入 */}
      <img
        data-testid="battlefield-scenic-layer"
        data-scenic-scene={scenicScene}
        src={scenicMeta.src}
        alt=""
        referrerPolicy="no-referrer"
        className={`absolute inset-0 w-full h-full object-cover opacity-[0.12] will-change-transform ${
          disableMotion ? 'scale-[1.03]' : 'anim-arena-drift'
        }`}
        style={{
          filter: `${scenicMeta.defaultFilter ?? ''} saturate(0.58)`.trim(),
          maskImage: scenicMask,
          WebkitMaskImage: scenicMask,
        }}
      />

      {/* 1.8 深色拉丝金属与精细静态网格底衬（SSR 及无动效时同样保持精密纹理） */}
      <div
        aria-hidden="true"
        className="prts-grid absolute inset-0 opacity-75"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.042) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.042) 1px, transparent 1px), linear-gradient(to right, rgba(148,163,184,0.014) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.014) 1px, transparent 1px)',
          backgroundSize: '48px 48px, 48px 48px, 12px 12px, 12px 12px',
        }}
      />

      {/* 2. 反向缓动罗德岛制药塔形徽章暗纹 */}
      <div
        className={`absolute -inset-8 flex items-center justify-center will-change-transform ${
          disableMotion ? '' : 'anim-emblem-drift'
        }`}
      >
        <img
          src="./assets/arknights/logos/rhodes_island_dark.png"
          alt=""
          referrerPolicy="no-referrer"
          className="w-[320px] h-[320px] sm:w-[440px] sm:h-[440px] object-contain opacity-[0.04] select-none"
        />
      </div>

      {/* 3. 极简工业暗角对比度基底 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(9,12,16,0.52) 0%, rgba(9,12,16,0.84) 74%, rgba(6,8,11,0.96) 100%)',
        }}
      />

      {/* 4. 主战区冷冽钛钢顶光照明遮罩层 */}
      <div
        data-testid="battlefield-spotlight-mask"
        className={`absolute -inset-[28%] will-change-transform ${
          disableMotion ? 'opacity-70' : 'anim-spotlight-drift'
        }`}
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(203,213,225,0.085) 0%, rgba(148,163,184,0.04) 28%, rgba(15,23,42,0.12) 52%, rgba(6,8,11,0.75) 100%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* 5. 次级反向漂移 PRTS 冷青探照微光遮罩 */}
      <div
        data-testid="battlefield-spotlight-secondary"
        className={`absolute -inset-[25%] will-change-transform ${
          disableMotion ? 'opacity-45' : 'anim-spotlight-secondary'
        }`}
        style={{
          background:
            'radial-gradient(ellipse 46% 36% at 50% 50%, rgba(56,189,248,0.055) 0%, rgba(56,189,248,0.02) 45%, transparent 72%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* 6. 极简低扰动环境氛围流场遮罩 */}
      <div
        data-testid="battlefield-weather-haze"
        className={`absolute -inset-12 will-change-transform ${
          disableMotion ? 'opacity-20' : 'anim-weather-haze'
        }`}
        style={{
          background:
            'radial-gradient(ellipse 68% 42% at 26% 36%, rgba(148,163,184,0.07) 0%, transparent 68%), radial-gradient(ellipse 64% 48% at 74% 66%, rgba(100,116,139,0.06) 0%, transparent 70%)',
        }}
      />

      <div
        data-testid="battlefield-weather-shimmer"
        className={`absolute -inset-10 will-change-transform ${
          disableMotion ? 'opacity-15' : 'anim-weather-shimmer'
        }`}
        style={{
          background:
            'radial-gradient(ellipse 50% 28% at 52% 54%, rgba(148,163,184,0.055) 0%, rgba(56,189,248,0.025) 45%, transparent 74%)',
          mixBlendMode: 'screen',
        }}
      />

      {/* 7. PRTS 精密光学扫描线纹理层 */}
      <div
        className="prts-scanlines absolute inset-0 opacity-[0.09]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 4px)',
        }}
      />

      {/* 8. Canvas 实时精密坐标网格与微粒测绘层 */}
      <canvas
        ref={canvasRef}
        data-testid="battlefield-ambient-canvas"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 w-full h-full block"
      />

      {/* 9. 边缘暗角聚光收敛框 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 52%, rgba(6,8,11,0.58) 88%, rgba(4,6,9,0.88) 100%)',
        }}
      />
    </div>
  );
}
