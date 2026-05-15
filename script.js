// --layout-scale on <html> (sync SCSS + index inline).
(() => {
  const DESIGN_WIDTH = 1920;
  const MIN_WIDTH = 1024;
  /** Floor scale on narrow viewports so UI stays readable when ref is clamped to MIN_WIDTH. */
  const MIN_SCALE_NARROW = 0.8;
  const root = document.documentElement;

  const syncLayoutScale = () => {
    const w = window.innerWidth;
    const ref = Math.max(w, MIN_WIDTH);
    let scale = Math.min(1, ref / DESIGN_WIDTH);
    if (w <= MIN_WIDTH) {
      scale = Math.max(scale, MIN_SCALE_NARROW);
    }
    root.style.setProperty("--layout-scale", String(scale));
  };

  syncLayoutScale();
  window.addEventListener("resize", syncLayoutScale, { passive: true });
})();

// Hero H1: per-char reveal on desktop (script adds .hero__title--chars); aria-label preserved.
(() => {
  const title = document.querySelector(".hero__title");
  if (!title) return;

  let plainHtml = null;

  const mqDesk = window.matchMedia("(min-width: 1024px)");
  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  const buildFragment = (html) => {
    const ariaLabel = html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const segments = html.split(/<br\s*\/?>/i);
    let idx = 0;
    const frag = document.createDocumentFragment();

    segments.forEach((segment) => {
      const text = segment.replace(/<[^>]*>/g, "").trim();
      const line = document.createElement("span");
      line.className = "hero__title-line";
      line.setAttribute("aria-hidden", "true");

      for (const ch of text) {
        const span = document.createElement("span");
        span.className = "hero__title-char";
        span.textContent = ch === " " ? "\u00a0" : ch;
        span.style.setProperty("--hero-char-i", String(idx));
        line.appendChild(span);
        idx += 1;
      }

      frag.appendChild(line);
    });

    return { frag, ariaLabel };
  };

  const toChars = () => {
    if (!mqDesk.matches || mqReduce.matches) return;
    if (title.classList.contains("hero__title--chars")) return;
    if (plainHtml === null) plainHtml = title.innerHTML;

    const { frag, ariaLabel } = buildFragment(plainHtml);
    title.setAttribute("aria-label", ariaLabel);
    title.replaceChildren(frag);
    title.classList.add("hero__title--chars");
  };

  const toPlain = () => {
    if (plainHtml === null || !title.classList.contains("hero__title--chars")) return;
    title.innerHTML = plainHtml;
    title.classList.remove("hero__title--chars");
    title.removeAttribute("aria-label");
  };

  const sync = () => {
    if (!mqDesk.matches || mqReduce.matches) {
      toPlain();
      return;
    }
    toChars();
  };

  mqDesk.addEventListener("change", sync);
  mqReduce.addEventListener("change", sync);
  requestAnimationFrame(sync);
})();

// Lenis → window.__L3_LENIS (hero flight scroll hook).
(() => {
  if (typeof Lenis === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const lenis = new Lenis({
    autoRaf: true,
    lerp: 0.11,
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 1,
  });
  window.__L3_LENIS = lenis;

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0 });
    });
  });
})();

// Header burger drawer (<768px, matches $layout-min-width).
(() => {
  const header = document.querySelector(".header");
  const burger = document.querySelector(".header__burger");
  const drawer = document.querySelector("#header-drawer");
  if (!header || !burger || !drawer) return;

  const BREAKPOINT = 768;

  const hero = document.querySelector(".hero");

  const syncHeaderSolid = () => {
    if (!hero) return;
    if (header.classList.contains("header--menu-open")) {
      header.classList.add("header--solid");
      return;
    }
    const hr = hero.getBoundingClientRect();
    const hh = header.offsetHeight;
    header.classList.toggle("header--solid", hr.bottom <= hh);
  };

  const setOpen = (isOpen) => {
    header.classList.toggle("header--menu-open", isOpen);
    burger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    burger.setAttribute("aria-label", isOpen ? "Закрити меню" : "Відкрити меню");
    document.body.style.overflow = isOpen ? "hidden" : "";
    syncHeaderSolid();
  };

  const closeMenu = () => setOpen(false);

  burger.addEventListener("click", () => {
    setOpen(!header.classList.contains("header--menu-open"));
  });

  drawer.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener(
    "resize",
    () => {
      if (window.innerWidth >= BREAKPOINT) closeMenu();
      syncHeaderSolid();
    },
    { passive: true }
  );

  if (window.__L3_LENIS) {
    window.__L3_LENIS.on("scroll", syncHeaderSolid);
  } else {
    let headerSolidRaf = 0;
    window.addEventListener(
      "scroll",
      () => {
        if (headerSolidRaf) return;
        headerSolidRaf = requestAnimationFrame(() => {
          headerSolidRaf = 0;
          syncHeaderSolid();
        });
      },
      { passive: true }
    );
  }

  syncHeaderSolid();
})();

// Hero → Impact flight (fixed clones). Lenis: call sync() directly—extra rAF = 1-frame gap vs placeholders.
(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const FLIGHT_MIN_WIDTH = 1024;
  const FLIGHT_SCROLL_RANGE_MULT = 1.18;
  const START_P      = 0.012;
  const END_P        = 0.92;
  const END_HYST     = 0.06;
  const END_FRAMES   = 5;
  const LANDED_HOLD_P = END_P - 0.04;
  const STAGGER      = [0, 0.03, 0.06, 0.09];
  const STAGGER_SPAN = 1 - Math.max(...STAGGER);
  const FADE5_U_END = 0.68;

  const hero       = document.querySelector(".hero");
  const main         = document.querySelector(".main");
  const headerEl     = document.querySelector(".header");
  const heroImages = document.querySelector(".hero__images");
  const heroItems  = heroImages?.querySelectorAll(".hero__images-item");
  const impact     = document.querySelector(".impact");
  const slots      = impact?.querySelectorAll(".hero__images-item-placeholder");

  if (!hero || !main || !heroImages || !impact) return;
  if (!heroItems || heroItems.length !== 5) return;
  if (!slots || slots.length !== 4) return;

  const layer = (() => {
    let el = document.getElementById("hero-flight-layer");
    if (!el) {
      el = document.createElement("div");
      el.id = "hero-flight-layer";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return el;
  })();

  const FLIGHT_STACK_Z = [1, 2, 5, 4, 3];

  const clones = [];
  for (let i = 0; i < 5; i++) {
    const srcEl = heroItems[i].querySelector("img");
    if (!srcEl) return;
    const card = document.createElement("div");
    card.className = "hero-flight-card";
    card.style.zIndex = String(FLIGHT_STACK_Z[i]);
    const img = document.createElement("img");
    img.src = srcEl.src;
    img.alt = srcEl.getAttribute("alt") || "";
    img.decoding = "async";
    card.appendChild(img);
    layer.appendChild(card);
    clones.push(card);
  }

  const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
  const lerp    = (a, b, t) => a + (b - a) * t;

  const easeInOutQuad = (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  const easeInOutSine = (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : -(Math.cos(Math.PI * t) - 1) / 2;

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  };

  const updateCard5 = (u, landed) => {
    const hi5 = heroItems[4];
    const clone = clones[4];
    if (!hi5 || !clone) return;

    if (landed) {
      clone.style.visibility = "hidden";
      clone.style.opacity = "0";
      clone.style.transform = "none";
      return;
    }

    const r5 = rectOf(hi5);
    const fan5 = parseFan(hi5);
    const w5 = hi5.offsetWidth;
    const h5 = hi5.offsetHeight;
    const fadeT = easeInOutSine(clamp01(u / FADE5_U_END));

    clone.style.visibility = "visible";
    clone.style.left = `${r5.left + r5.width / 2 - w5 / 2}px`;
    clone.style.top = `${r5.top + r5.height / 2 - h5 / 2}px`;
    clone.style.width = `${w5}px`;
    clone.style.height = `${h5}px`;
    clone.style.transformOrigin = "center center";
    const rot5 = lerp(fan5.rot, 0, fadeT);
    const sc5 = lerp(fan5.sc, 1, fadeT);
    clone.style.transform =
      Math.abs(rot5) < 0.02 && Math.abs(sc5 - 1) < 0.002
        ? "none"
        : `rotate(${rot5}deg) scale(${sc5})`;
    clone.style.opacity = String(1 - fadeT);
  };

  const parseFan = (heroItem) => {
    const st = getComputedStyle(heroItem);
    const rot = parseFloat(st.getPropertyValue("--fan-rot")) || 0;
    const scRaw = parseFloat(st.getPropertyValue("--fan-sc"));
    const sc = Number.isFinite(scRaw) ? scRaw : 1;
    return { rot, sc };
  };

  const applyFlightFrame = (clone, heroItem, toEl, easedT) => {
    const from = rectOf(heroItem);
    const to = rectOf(toEl);
    const fan = parseFan(heroItem);
    const cx = lerp(from.left + from.width / 2, to.left + to.width / 2, easedT);
    const cy = lerp(from.top + from.height / 2, to.top + to.height / 2, easedT);
    const w = lerp(heroItem.offsetWidth, to.width, easedT);
    const h = lerp(heroItem.offsetHeight, to.height, easedT);
    clone.style.left = `${cx - w / 2}px`;
    clone.style.top = `${cy - h / 2}px`;
    clone.style.width = `${w}px`;
    clone.style.height = `${h}px`;
    clone.style.transformOrigin = "center center";
    const rot = lerp(fan.rot, 0, easedT);
    const sc = lerp(fan.sc, 1, easedT);
    clone.style.transform =
      Math.abs(rot) < 0.02 && Math.abs(sc - 1) < 0.002
        ? "none"
        : `rotate(${rot}deg) scale(${sc})`;
  };

  let landedLatch = false;
  let exitStreak = 0;
  let lastP = 0;
  let flightCloneZSnapshotted = false;
  const SOFT_HERO_U = 0.04;

  const scrollP = () => {
    const y  = window.scrollY || 0;
    const vh = window.innerHeight;
    // Offset hero top when <main> is fixed so flight thresholds match “hero under header” at scrollY 0.
    const mainDocTop = main.getBoundingClientRect().top + y;
    const headerFlowOffset =
      mainDocTop < 1 && headerEl ? headerEl.offsetHeight : 0;
    const heroDocTop   = hero.getBoundingClientRect().top + y + headerFlowOffset;
    const impactDocTop = impact.getBoundingClientRect().top + y;
    const start = heroDocTop   - vh * 0.08;
    let   end   = impactDocTop - vh * 0.22;
    let span = end - start;
    if (span < 200) span = 500;
    span *= FLIGHT_SCROLL_RANGE_MULT;
    return (y - start) / span;
  };

  const showClone = (clone) => {
    clone.style.visibility = "visible";
    clone.style.opacity = "1";
  };

  const restoreDefaultCloneZIndex = () => {
    clones.forEach((c, i) => {
      c.style.zIndex = String(FLIGHT_STACK_Z[i]);
    });
    flightCloneZSnapshotted = false;
  };

  /** Snapshot hero z-index onto clones once per flight (slider slot order). */
  const snapshotFlightCloneZFromHero = () => {
    heroItems.forEach((item, i) => {
      const zRaw = getComputedStyle(item).zIndex;
      const n = Number.parseInt(zRaw, 10);
      clones[i].style.zIndex = Number.isFinite(n)
        ? String(n)
        : String(FLIGHT_STACK_Z[i]);
    });
    flightCloneZSnapshotted = true;
  };

  const reset = () => {
    landedLatch = false;
    exitStreak = 0;
    lastP = 0;
    heroImages.classList.remove("hero__images--flying", "hero__images--landed");
    restoreDefaultCloneZIndex();
    clones.forEach((c) => {
      c.style.opacity = "0";
      c.style.visibility = "hidden";
      c.style.transform = "";
    });
    layer.style.display = "none";
  };

  /** Place clones at hero fan (u=0) before hiding layer — avoids snap when scrolling back up. */
  const handoffToHero = () => {
    for (let j = 0; j < 4; j++) {
      applyFlightFrame(clones[j], heroItems[j], slots[j], 0);
      clones[j].style.opacity = "0";
    }
    const hi5 = heroItems[4];
    const r5 = rectOf(hi5);
    const w5 = hi5.offsetWidth;
    const h5 = hi5.offsetHeight;
    clones[4].style.left = `${r5.left + r5.width / 2 - w5 / 2}px`;
    clones[4].style.top = `${r5.top + r5.height / 2 - h5 / 2}px`;
    clones[4].style.width = `${w5}px`;
    clones[4].style.height = `${h5}px`;
    clones[4].style.opacity = "0";
    clones[4].style.transform = "";
    heroImages.classList.remove("hero__images--flying", "hero__images--landed");
    restoreDefaultCloneZIndex();
    layer.style.display = "none";
    landedLatch = false;
    exitStreak = 0;
  };

  const sync = () => {
    if (window.innerWidth < FLIGHT_MIN_WIDTH) { reset(); return; }
    layer.style.display = "block";

    const p = clamp01(scrollP());
    const scrollingUp = p < lastP - 1e-5;
    lastP = p;

    if (p <= START_P) {
      reset();
      return;
    }

    // Landed latch: hysteresis near END_P to ignore jitter; exit when scrolling up below threshold.
    if (landedLatch) {
      if (p >= LANDED_HOLD_P) {
        exitStreak = 0;
      } else if (scrollingUp && p < END_P - END_HYST) {
        landedLatch = false;
        exitStreak = 0;
      } else if (!scrollingUp && p < END_P - END_HYST) {
        if (++exitStreak >= END_FRAMES) {
          landedLatch = false;
          exitStreak = 0;
        }
      } else {
        exitStreak = 0;
      }
    } else if (p >= END_P) {
      landedLatch = true;
      exitStreak = 0;
    }
    const landed = landedLatch;
    const u = clamp01((p - START_P) / (END_P - START_P));

    heroImages.classList.add("hero__images--flying");
    heroImages.classList.toggle("hero__images--landed", landed);

    if (!flightCloneZSnapshotted) snapshotFlightCloneZFromHero();

    // Near top of return scroll: smooth handoff to hero instead of abrupt reset().
    if (!landed && scrollingUp && u <= SOFT_HERO_U) {
      handoffToHero();
      return;
    }

    // Fixed clones only; placeholder imgs stay hidden via CSS. At landed, clones stay at t=1.
    for (let j = 0; j < 4; j++) {
      const t = landed ? 1 : easeInOutQuad(clamp01((u - STAGGER[j]) / STAGGER_SPAN));
      applyFlightFrame(clones[j], heroItems[j], slots[j], t);
      showClone(clones[j]);
    }

    updateCard5(u, landed);
  };

  if (window.__L3_LENIS) {
    // Lenis already runs in rAF — call sync() directly (nested rAF lags one frame).
    window.__L3_LENIS.on("scroll", sync);
  } else {
    // Native scroll: single rAF batches before paint.
    let rafId = 0;
    window.addEventListener("scroll", () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; sync(); });
    }, { passive: true });
  }

  window.addEventListener("resize", () => {
    window.__L3_LENIS?.resize();
    sync();
  });

  sync();
})();

// Hero fan: click brings card to slot 3 (front z via data-slot). Gated while flying / entrance / <1024.
(() => {
  const heroImages = document.querySelector(".hero__images");
  if (!heroImages) return;

  const items = Array.from(heroImages.querySelectorAll(".hero__images-item"));
  if (items.length !== 5) return;

  const FRONT_SLOT = 3;
  const SLOT_ATTR = "data-slot";
  const WAVE_CLASS = "hero__images-item--wave";
  const MIN_WIDTH = 1024;
  const ENTRANCE_DELAY_MS = 1500;

  // Inner scale wave; stagger from clicked slot before slot swap.
  const SWAP_DELAY_STEP_MS = 55;
  const WAVE_DELAY_STEP_MS = 72;
  const SWAP_DURATION_MS = 750;
  const WAVE_DURATION_MS = 720;

  const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let entranceDone = noMotion;
  if (!noMotion) {
    setTimeout(() => { entranceDone = true; }, ENTRANCE_DELAY_MS);
  }

  items.forEach((item, idx) => {
    if (!item.hasAttribute(SLOT_ATTR)) {
      item.setAttribute(SLOT_ATTR, String(idx + 1));
    }
  });

  const slotOf = (item) => Number.parseInt(item.getAttribute(SLOT_ATTR), 10);

  let activeWaveTimer = 0;

  const cleanupAfterWave = () => {
    items.forEach((item) => {
      item.classList.remove(WAVE_CLASS);
      item.style.removeProperty("--swap-delay");
      item.style.removeProperty("--wave-delay");
    });
    activeWaveTimer = 0;
  };

  /** Corridor shift toward clicked card → front slot 3; delays by |slot − clicked|. */
  const swapToFront = (clickedItem) => {
    if (window.innerWidth < MIN_WIDTH) return;
    if (heroImages.classList.contains("hero__images--flying")) return;
    if (!entranceDone) return;

    const clickedSlot = slotOf(clickedItem);
    if (!Number.isFinite(clickedSlot)) return;
    if (clickedSlot === FRONT_SLOT) return;

    const dir = Math.sign(clickedSlot - FRONT_SLOT);
    const lo = Math.min(clickedSlot, FRONT_SLOT);
    const hi = Math.max(clickedSlot, FRONT_SLOT);

    // Cancel prior wave if clicking mid-animation.
    if (activeWaveTimer) {
      clearTimeout(activeWaveTimer);
      items.forEach((item) => item.classList.remove(WAVE_CLASS));
    }

    // Delays from clicked slot (before data-slot update).
    let maxDistFromClick = 0;
    items.forEach((item) => {
      const slot = slotOf(item);
      const dist = Math.abs(slot - clickedSlot);
      maxDistFromClick = Math.max(maxDistFromClick, dist);
      item.style.setProperty("--swap-delay", `${dist * SWAP_DELAY_STEP_MS}ms`);
      item.style.setProperty("--wave-delay", `${dist * WAVE_DELAY_STEP_MS}ms`);
    });

    // Update slots in corridor between clicked and front.
    items.forEach((item) => {
      const slot = slotOf(item);
      let next = slot;
      if (item === clickedItem) {
        next = FRONT_SLOT;
      } else if (slot >= lo && slot <= hi) {
        next = slot + dir;
      }
      if (next !== slot) item.setAttribute(SLOT_ATTR, String(next));
    });

    // Restart inner wave keyframes (reflow).
    void heroImages.offsetWidth;
    items.forEach((item) => item.classList.add(WAVE_CLASS));

    // Cleanup after longest stagger from clicked slot.
    const totalMs = Math.max(
      maxDistFromClick * SWAP_DELAY_STEP_MS + SWAP_DURATION_MS,
      maxDistFromClick * WAVE_DELAY_STEP_MS + WAVE_DURATION_MS
    ) + 50;
    activeWaveTimer = window.setTimeout(cleanupAfterWave, totalMs);
  };

  items.forEach((item) => {
    item.addEventListener("click", () => swapToFront(item));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        swapToFront(item);
      }
    });
  });
})();

// =============================================================================
// Solutions row: drag / swipe (scrollLeft).
// =============================================================================
(() => {
  const vp = document.querySelector(".solutions__viewport");
  if (!vp) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let activeId = null;
  let startX = 0;
  let startScroll = 0;

  const end = (e) => {
    if (activeId == null || e.pointerId !== activeId) return;
    activeId = null;
    vp.classList.remove("solutions__viewport--dragging");
    try {
      vp.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  vp.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activeId = e.pointerId;
      startX = e.clientX;
      startScroll = vp.scrollLeft;
      vp.classList.add("solutions__viewport--dragging");
      try {
        vp.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    { passive: true }
  );

  vp.addEventListener(
    "pointermove",
    (e) => {
      if (activeId == null || e.pointerId !== activeId) return;
      vp.scrollLeft = startScroll - (e.clientX - startX);
    },
    { passive: true }
  );

  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);

  vp.addEventListener("lostpointercapture", () => {
    activeId = null;
    vp.classList.remove("solutions__viewport--dragging");
  });

  const step = () => Math.min(320, Math.max(120, vp.clientWidth * 0.35));
  vp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      vp.scrollLeft -= step();
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      vp.scrollLeft += step();
      e.preventDefault();
    }
  });
})();

// FAQ accordion (max-height).
(() => {
  const items = Array.from(document.querySelectorAll(".faq__item"));
  if (!items.length) return;

  const DURATION_MS = 400;
  const noMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const panel = (el) => el.querySelector(".faq__item-content");
  const btn   = (el) => el.querySelector(".faq__item-title");

  const clearEnd = (p) => {
    if (!p) return;
    if (p._faqEnd) {
      p.removeEventListener("transitionend", p._faqEnd);
      delete p._faqEnd;
    }
    if (p._faqTimer) {
      clearTimeout(p._faqTimer);
      delete p._faqTimer;
    }
  };

  const oneShotEnd = (p, cb) => {
    clearEnd(p);
    const done = () => { clearEnd(p); cb(); };
    p._faqEnd = (e) => { if (e.target === p && e.propertyName === "max-height") done(); };
    p.addEventListener("transitionend", p._faqEnd);
    p._faqTimer = setTimeout(done, DURATION_MS + 100);
  };

  /** Effective panel height during transition (computed max-height or scrollHeight). */
  const currentHeight = (p) => {
    const v = getComputedStyle(p).maxHeight;
    return v === "none" ? p.scrollHeight : parseFloat(v) || 0;
  };

  const closeItem = (el, animate) => {
    const p = panel(el);
    const b = btn(el);
    if (!p) return;

    clearEnd(p);
    const isOpen = el.classList.contains("faq__item--open");

    if (!animate || noMotion || !isOpen) {
      el.classList.remove("faq__item--open");
      if (b) b.setAttribute("aria-expanded", "false");
      p.style.maxHeight = "0px";
      return;
    }

    // Lock current height before closing.
    p.style.maxHeight = currentHeight(p) + "px";
    void p.offsetHeight;

    // Remove --open immediately so header styles animate from click.
    el.classList.remove("faq__item--open");
    if (b) b.setAttribute("aria-expanded", "false");

    p.style.maxHeight = "0px";
    oneShotEnd(p, () => { p.style.maxHeight = "0px"; });
  };

  const openItem = (el) => {
    const p = panel(el);
    const b = btn(el);
    if (!p || !b) return;

    clearEnd(p);

    el.classList.add("faq__item--open");
    b.setAttribute("aria-expanded", "true");

    if (noMotion) { p.style.maxHeight = "none"; return; }

    // Lock height if reopening mid-close.
    p.style.maxHeight = currentHeight(p) + "px";
    void p.offsetHeight;
    p.style.maxHeight = p.scrollHeight + "px";

    oneShotEnd(p, () => {
      if (el.classList.contains("faq__item--open")) p.style.maxHeight = "none";
    });
  };

  items.forEach((item) => {
    const p = panel(item);
    if (p) p.style.maxHeight = "0px";

    const b = btn(item);
    if (!b) return;

    b.addEventListener("click", () => {
      if (item.classList.contains("faq__item--open")) {
        closeItem(item, true);
      } else {
        items.forEach((other) => { if (other !== item) closeItem(other, true); });
        openItem(item);
      }
    });
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(() => {
      items.forEach((el) => {
        if (!el.classList.contains("faq__item--open")) return;
        const p = panel(el);
        if (p && p.style.maxHeight !== "none") p.style.maxHeight = p.scrollHeight + "px";
      });
    });
  });
})();
