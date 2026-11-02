import fs from "node:fs";
const p = "src/components/prototype/HeroTurntablePrototype.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.log("MISS:", a.slice(0, 60)); return; } s = s.replace(a, b); };

rep(`/* 拖过一整个版面宽度，转台走过 ≈ 260°：比 1:1 更跟手，又不至于一碰就飞。 */
const DEG_PER_WIDTH = 260;`, `/* 拖过一整个版面宽度，转台走过 ≈ 182°（原 260° 的 0.7 倍）：跟手，但不会一碰就飞。 */
const DEG_PER_WIDTH = 182;
/* 无人操作时自己慢慢转：一圈约 72 秒，一个面约 18 秒——看得出在动，又不至于晃。 */
const AUTO_SPEED = 5;
/* 指针离开后多久恢复自转。 */
const RESUME_DELAY = 4200;`);

rep(`    let mode: "idle" | "drag" | "inertia" | "snap" = "idle";`, `    let mode: "idle" | "auto" | "drag" | "inertia" | "snap" = "idle";
    let hovering = false;
    let resumeTimer = 0;`);

rep(`    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;

      if (mode === "inertia") {`, `    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;

      if (mode === "auto") {
        /* 自转永远朝「下一面」的方向，跟拖动左移是同一个方向。 */
        angle -= AUTO_SPEED * dt;
        if (angle < -1440) angle += 360;
      } else if (mode === "inertia") {`);

rep(`        if (Math.abs(target - angle) < 0.08) {
          angle = target;
          mode = "idle";
        }
      }`, `        if (Math.abs(target - angle) < 0.08) {
          angle = target;
          mode = "idle";
          scheduleResume();
        }
      }`);

rep(`    const kick = () => {`, `    const clearResume = () => {
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

    const kick = () => {`);

rep(`    const onPointerDown = (event: PointerEvent) => {
      if (reduced.matches || event.button !== 0) return;
      dragging = true;`, `    const onPointerDown = (event: PointerEvent) => {
      if (reduced.matches || event.button !== 0) return;
      clearResume();
      dragging = true;`);

rep(`    const endDrag = (event: PointerEvent) => {
      if (!dragging || (event.pointerId !== pointerId && event.type !== "pointercancel")) return;
      dragging = false;
      drum.releasePointerCapture?.(pointerId);
      delete drum.dataset.dragging;
      if (reduced.matches) {
        angle = target = Math.round(angle / STEP) * STEP;
        mode = "idle";
        render();
        return;
      }`, `    const endDrag = (event: PointerEvent) => {
      if (!dragging || (event.pointerId !== pointerId && event.type !== "pointercancel")) return;
      dragging = false;
      drum.releasePointerCapture?.(pointerId);
      delete drum.dataset.dragging;
      if (reduced.matches) {
        angle = target = Math.round(angle / STEP) * STEP;
        mode = "idle";
        render();
        return;
      }`);

rep(`    const goTo: GoTo = (face) => {
      const base = -wrapFace(face) * STEP;`, `    const goTo: GoTo = (face) => {
      clearResume();
      const base = -wrapFace(face) * STEP;`);

rep(`    const reset = () => {
      if (!reduced.matches) return;
      angle = target = 0;
      velocity = 0;
      dragging = false;
      mode = "idle";
      render();
    };`, `    /* 指针一进场景，自转就停到最近的一面，先让人读得清；离开后再自己转起来。 */
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
    };`);

rep(`    measure();
    const observer = new ResizeObserver(measure);`, `    measure();
    const stage = drum.closest<HTMLElement>("[data-turntable]") ?? drum;
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointerleave", onLeave);
    const observer = new ResizeObserver(measure);`);

rep(`    reduced.addEventListener("change", reset);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();`, `    reduced.addEventListener("change", reset);
    if (!reduced.matches) scheduleResume();

    return () => {
      cancelAnimationFrame(frame);
      clearResume();
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointerleave", onLeave);
      observer.disconnect();`);

rep(`          <div className={styles.stage}>`, `          <div className={styles.stage} data-turntable>`);

rep(`              <span>拖动，或按 ← → 换一面</span>`, `              <span>它会慢慢转 —— 按住就能拨到任意一面</span>`);

fs.writeFileSync(p, s);
