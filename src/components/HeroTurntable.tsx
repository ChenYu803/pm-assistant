"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import styles from "./HeroTurntable.module.css";
import { deliverables } from "./landingDeliverables";

/**
 * 首屏右侧的「成果转台」：同一份成果的四个面（需求分析 / 原型 / PRD / 任务拆分）。
 *
 * 指针横向拖动让整台带惯性转过去，松手吸附到 90° 档位；无人操作时自己缓慢转，
 * 用来引起第一次接触。每一面按面法线与光向的夹角压暗，而不是按「正对屏幕的
 * 程度」对称压暗——有方向的受光才读得出这是个物体，不是两块并排的面板。
 * 用 CSS 3D 组合而非逐帧物理积分：静止时零开销，静帧就是设计终态。
 */
const FACE_COUNT = deliverables.length;
const STEP = 360 / FACE_COUNT;
/* 拖过一整个版面宽度，转台走过 ≈ 182°（原 260° 的 0.7 倍）：跟手，但不会一碰就飞。 */
const DEG_PER_WIDTH = 182;
/* 无人操作时自己慢慢转：一圈约 72 秒，一个面约 18 秒——看得出在动，又不至于晃。 */
const AUTO_SPEED = 5;
/* 指针离开后多久恢复自转。 */
const RESUME_DELAY = 4200;

type GoTo = (face: number) => void;

const wrapFace = (face: number) => ((face % FACE_COUNT) + FACE_COUNT) % FACE_COUNT;

/**
 * 转台的运动学：拖动直接控角，松手先惯性衰减、再吸附到最近的 90° 档位。
 * 静止（idle）时主动停掉 rAF——不动的帧不许占用主线程。
 */
function useTurntable(
  drumRef: RefObject<HTMLDivElement | null>,
  onFaceChange: (face: number) => void,
): RefObject<GoTo> {
  const goToRef = useRef<GoTo>(() => {});
  const faceChangeRef = useRef(onFaceChange);

  useEffect(() => {
    faceChangeRef.current = onFaceChange;
  }, [onFaceChange]);

  useEffect(() => {
    const drum = drumRef.current;
    if (!drum) return;
    const faces = Array.from(drum.querySelectorAll<HTMLElement>("[data-face]"));
    const platter = drum.parentElement?.querySelector<HTMLElement>("[data-platter]");
    const dot = drum.parentElement?.querySelector<HTMLElement>("[data-orbit]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    let angle = 0;
    let velocity = 0;
    let target = 0;
    let mode: "idle" | "auto" | "drag" | "inertia" | "snap" = "idle";
    let hovering = false;
    let resumeTimer = 0;
    let dragging = false;
    let pointerId = -1;
    let lastX = 0;
    let lastT = 0;
    let frame = 0;
    let lastFrame = 0;
    let currentFace = 0;

    const render = () => {
      /* 先俯一点（-7°），静帧才有「从略高处看一个物体」的透视，而不是一张贴纸。 */
      drum.style.transform = `translateZ(calc(var(--r) * -1)) rotateX(-7deg) rotateY(${angle}deg)`;
      for (let i = 0; i < faces.length; i += 1) {
        /* 光源在左前方：按面法线跟光的夹角压暗，而不是按「正对屏幕」对称压暗。
           对称压暗会让 45° 时两面一样亮，读起来只是两块并排的面板；有方向才像物体。 */
        const theta = ((angle + i * STEP) * Math.PI) / 180;
        const lit = Math.cos(theta + 0.38);
        const dim = Math.min(0.88, 0.58 * (1 - Math.max(0, lit)) + (lit < 0 ? 0.1 : 0));
        faces[i].style.setProperty("--dim", dim.toFixed(3));
        const content = Math.max(0, Math.min(1, (Math.cos(theta) - 0.34) / 0.46));
        faces[i].style.setProperty("--content", content.toFixed(3));
        /* 面侧对屏幕时（±90°）只剩一条 1px 亮边，会像凭空多出一根杂线；±5° 内渐隐掉。 */
        const edge = Math.max(0, Math.min(1, (Math.abs(Math.cos(theta)) - 0.02) / 0.06));
        faces[i].style.opacity = edge.toFixed(3);
      }
      if (dot && platter) {
        const w = platter.clientWidth / 2;
        const h = platter.clientHeight / 2;
        const rad = (angle * Math.PI) / 180;
        dot.style.transform = `translate(${(Math.sin(rad) * w).toFixed(1)}px, ${(Math.cos(rad) * h).toFixed(1)}px)`;
      }
      const face = wrapFace(Math.round(-angle / STEP));
      if (face !== currentFace) {
        currentFace = face;
        faceChangeRef.current(face);
      }
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;

      if (mode === "auto") {
        /* 自转永远朝「下一面」的方向，跟拖动左移是同一个方向。 */
        angle -= AUTO_SPEED * dt;
        if (angle < -1440) angle += 360;
      } else if (mode === "inertia") {
        angle += velocity * dt;
        velocity *= Math.exp(-4.8 * dt);
        if (Math.abs(velocity) < 220) {
          mode = "snap";
          target = Math.round(angle / STEP) * STEP;
        }
      } else if (mode === "snap") {
        angle += (target - angle) * (1 - Math.exp(-9 * dt));
        if (Math.abs(target - angle) < 0.08) {
          angle = target;
          mode = "idle";
          scheduleResume();
        }
      }

      render();
      if (mode === "idle") return;
      frame = requestAnimationFrame(tick);
    };

    const clearResume = () => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = 0;
    };

    /* 空闲一会儿就重新开始自转——页面不能停在一次操作之后的静止帧里。 */
    const scheduleResume = () => {
      clearResume();
      if (reduced.matches || hovering) return;
      resumeTimer = window.setTimeout(() => {
        resumeTimer = 0;
        if (mode === "idle") {
          mode = "auto";
          kick();
        }
      }, RESUME_DELAY);
    };

    const kick = () => {
      if (frame) return;
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const measure = () => {
      const width = drum.getBoundingClientRect().width;
      if (width > 0) drum.style.setProperty("--r", `${width / 2}px`);
      render();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (reduced.matches || event.button !== 0) return;
      clearResume();
      dragging = true;
      pointerId = event.pointerId;
      mode = "drag";
      velocity = 0;
      lastX = event.clientX;
      lastT = performance.now();
      drum.setPointerCapture?.(event.pointerId);
      drum.dataset.dragging = "true";
      kick();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const now = performance.now();
      const dt = Math.max(0.008, (now - lastT) / 1000);
      const delta = ((event.clientX - lastX) * DEG_PER_WIDTH) / Math.max(240, drum.clientWidth);
      angle += delta;
      velocity = velocity * 0.7 + (delta / dt) * 0.3;
      lastX = event.clientX;
      lastT = now;
      render();
    };

    const endDrag = (event: PointerEvent) => {
      if (!dragging || (event.pointerId !== pointerId && event.type !== "pointercancel")) return;
      dragging = false;
      drum.releasePointerCapture?.(pointerId);
      delete drum.dataset.dragging;
      if (reduced.matches) {
        angle = target = Math.round(angle / STEP) * STEP;
        mode = "idle";
        render();
        return;
      }
      if (Math.abs(velocity) > 70) {
        mode = "inertia";
      } else {
        mode = "snap";
        target = Math.round(angle / STEP) * STEP;
      }
      kick();
    };

    const goTo: GoTo = (face) => {
      clearResume();
      const base = -wrapFace(face) * STEP;
      /* 走最近的一圈，不为了跳一页而倒转大半圈。 */
      target = base + 360 * Math.round((angle - base) / 360);
      velocity = 0;
      if (reduced.matches) {
        angle = target;
        mode = "idle";
        render();
        return;
      }
      mode = "snap";
      kick();
    };
    goToRef.current = goTo;

    /* 指针一进场景，自转就停到最近的一面，先让人读得清；离开后再自己转起来。 */
    const onEnter = () => {
      hovering = true;
      clearResume();
      if (mode !== "auto") return;
      mode = "snap";
      target = Math.round(angle / STEP) * STEP;
      kick();
    };

    const onLeave = () => {
      hovering = false;
      scheduleResume();
    };

    const reset = () => {
      if (!reduced.matches) return;
      clearResume();
      angle = target = 0;
      velocity = 0;
      dragging = false;
      mode = "idle";
      render();
    };

    measure();
    const stage = drum.closest<HTMLElement>("[data-turntable]") ?? drum;
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointerleave", onLeave);
    const observer = new ResizeObserver(measure);
    observer.observe(drum);
    drum.addEventListener("pointerdown", onPointerDown);
    drum.addEventListener("pointermove", onPointerMove);
    drum.addEventListener("pointerup", endDrag);
    drum.addEventListener("pointercancel", endDrag);
    reduced.addEventListener("change", reset);
    /* 一进页面就转起来——等用户先摸一下才动，等于不会有第一次接触。 */
    if (!reduced.matches) {
      mode = "auto";
      kick();
    }

    return () => {
      cancelAnimationFrame(frame);
      clearResume();
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
      observer.disconnect();
      drum.removeEventListener("pointerdown", onPointerDown);
      drum.removeEventListener("pointermove", onPointerMove);
      drum.removeEventListener("pointerup", endDrag);
      drum.removeEventListener("pointercancel", endDrag);
      reduced.removeEventListener("change", reset);
    };
  }, [drumRef]);

  return goToRef;
}

export default function HeroTurntable() {
  const drumRef = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState(0);
  const onFaceChange = useCallback((next: number) => setFace(next), []);
  const goTo = useTurntable(drumRef, onFaceChange);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    goTo.current(wrapFace(face + step));
  };

  return (
      <div className={styles.stage} data-turntable>
        <div className={styles.caption}>
          <span><b>AI开发工作流</b></span>
          <span>01 — 04</span>
        </div>

        <div className={styles.drumWrap}>
          <div className={styles.drumBox}>
            <span className={styles.baseShadow} aria-hidden="true" />
            <span className={styles.platter} data-platter aria-hidden="true">
              <i className={styles.tick} data-t="0" />
              <i className={styles.tick} data-t="1" />
              <i className={styles.tick} data-t="2" />
              <i className={styles.tick} data-t="3" />
              <span className={styles.orbitDot} data-orbit />
            </span>
            <div
              ref={drumRef}
              className={styles.drum}
              role="group"
              aria-label="成果转台：一份成果的四个面，可拖动或按左右方向键换面"
              tabIndex={0}
              onKeyDown={onKeyDown}
            >
              <div className={styles.sway}>
                {deliverables.map((item, index) => (
                  <article
                    key={item.file}
                    data-face={index}
                    className={styles.face}
                    style={{ transform: `rotateY(${index * STEP}deg) translateZ(var(--r))` } as CSSProperties}
                  >
                    <header className={styles.faceHead}>
                      <span className={styles.file}>{item.file}</span>
                      <span>0{index + 1} / 04</span>
                    </header>
                    <strong className={styles.verb}>{item.verb}</strong>
                    <ul className={styles.lines}>
                      {item.lines.map((line, i) => (
                        <li key={line}><small>0{i + 1}</small>{line}</li>
                      ))}
                    </ul>
                    <footer className={styles.faceFoot}>
                      <span>AI 产品现场</span>
                      <span>交付结构示意</span>
                    </footer>
                    <span className={styles.ghost} aria-hidden="true">0{index + 1}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.index} role="group" aria-label="直接跳到某一面">
          {deliverables.map((item, index) => (
            <button
              type="button"
              key={item.file}
              aria-pressed={index === face}
              onClick={() => goTo.current(index)}
            >
              <span>0{index + 1}</span>
              <span>{item.title}</span>
            </button>
          ))}
        </div>

        <div className={styles.hint}>
          <span>可拖拽旋转</span>
        </div>
      </div>
  );
}
