"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { LogoOrb } from "@/components/logo-orb";
import styles from "./page.module.css";

/* ─── CONFIG ─────────────────────────────────────────────────────────────── */
const NODES = [
  {
    name: "Manual Trigger",
    meta: "entry point",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <polygon points="4,2.5 15.5,9 4,15.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Upload File",
    meta: "csv / pdf",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 11.5V4.5" /><path d="M6 7.5l3-3 3 3" /><path d="M3.5 14.5h11" />
      </svg>
    ),
  },
  {
    name: "CSV Parse",
    meta: "2.1M rows",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="3" width="13" height="12" rx="2" /><path d="M2.5 7h13" /><path d="M7 7v8" />
      </svg>
    ),
  },
  {
    name: "Restructure",
    meta: "7 columns",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 5h5" /><path d="M3 9h12" /><path d="M3 13h8" /><path d="M11 3l2.5 2L11 7" />
      </svg>
    ),
  },
  {
    name: "Transform",
    meta: "x → f(x)",
    accent: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M2.5 14.5C5 14.5 5.5 3.5 9 3.5" /><path d="M9 3.5C12.5 3.5 13 14.5 15.5 14.5" />
        <circle cx="9" cy="3.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    name: "Restructure",
    meta: "5 columns",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 5h5" /><path d="M3 9h12" /><path d="M3 13h8" /><path d="M11 3l2.5 2L11 7" />
      </svg>
    ),
  },
];

const TRACE_DATA = [
  { label: "Manual Trigger", time: "0.02s", pct: 3 },
  { label: "Upload File",    time: "0.18s", pct: 12 },
  { label: "CSV Parse",      time: "1.40s", pct: 80 },
  { label: "Restructure",    time: "0.61s", pct: 54 },
  { label: "Transform",      time: "1.20s", pct: 68 },
  { label: "Restructure",    time: "0.19s", pct: 15 },
];

const VALUE_PROPS = [
  {
    title: "Private by design",
    desc: "Your files never leave the device. No uploads, no accounts, no telemetry — your data stays entirely on your machine.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="16" height="9" rx="2" /><path d="M7 11V7a4 4 0 0 1 8 0v4" />
        <circle cx="11" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Built for big files",
    desc: "Streaming workers and on-disk storage handle millions of rows without exhausting memory or locking the tab.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    title: "Works offline, forever",
    desc: "Install once as a PWA and it runs indefinitely — no internet required, no subscription, no expiry date.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 6s4-4 10-4 10 4 10 4" /><path d="M3.5 9.5s3-3 7.5-3 7.5 3 7.5 3" />
        <circle cx="11" cy="13" r="2.5" fill="currentColor" stroke="none" /><path d="M11 15.5v3.5" />
      </svg>
    ),
  },
];

/* ─── COMPONENT ──────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const nodesRowRef = useRef<HTMLDivElement>(null);
  const traceRowsRef = useRef<HTMLDivElement>(null);
  const vpCardsRef = useRef<HTMLDivElement>(null);
  const showcaseRef = useRef<HTMLElement>(null);

  useEffect(() => {
    /* ── Animate nodes pop-in ── */
    const cards = nodesRowRef.current?.querySelectorAll<HTMLElement>("[data-node-card]");
    cards?.forEach((card, i) => {
      setTimeout(() => card.classList.add(styles.pop), 1100 + i * 170);
    });

    /* ── Animate connector draw + sparks ── */
    const totalDelay = 1100 + (NODES.length * 170) + 220;
    setTimeout(() => {
      const lines  = nodesRowRef.current?.querySelectorAll<SVGLineElement>("[data-conn-line]");
      const sparks = nodesRowRef.current?.querySelectorAll<HTMLElement>("[data-conn-spark]");
      lines?.forEach((line, i) => {
        setTimeout(() => {
          line.style.transition = "stroke-dashoffset 0.5s cubic-bezier(.2,.7,.2,1)";
          line.style.strokeDashoffset = "0";
          setTimeout(() => {
            const spark = sparks?.[i];
            if (!spark) return;
            spark.style.animationDelay = `${i * 0.28}s`;
            spark.classList.add(styles.live);
          }, 520);
        }, i * 155);
      });
    }, totalDelay);

    /* ── Animate trace bars ── */
    const fills = traceRowsRef.current?.querySelectorAll<HTMLElement>("[data-trace-fill]");
    fills?.forEach((fill, i) => {
      const pct = fill.dataset.pct ?? "0";
      setTimeout(() => { fill.style.width = `${pct}%`; }, 1700 + i * 110);
    });

    /* ── Value props scroll reveal ── */
    const vpCards = vpCardsRef.current?.querySelectorAll<HTMLElement>("[data-vp-card]");
    if (!vpCards?.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) (e.target as HTMLElement).classList.add(styles.visible);
      });
    }, { threshold: 0.12 });
    vpCards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  function scrollToShowcase() {
    showcaseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={styles.page}>
      <div className={styles.glowBg} aria-hidden="true" />

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <header>
        <nav className={styles.nav} aria-label="Site navigation">
          <Link href="/" className={styles.navBrand} aria-label="AutoPilot home">
            <LogoOrb size={36} spin />
            <span className={styles.navWordmark}>AutoPilot</span>
          </Link>

          <div className={styles.navLinks}>
            <a href="#how">How it works</a>
            <a href="#why">Why offline</a>
            <a href="#docs">Docs</a>
          </div>

          <Link href="/workflows" className={styles.btnDark} aria-label="Open AutoPilot">
            Open app
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 6.5h8M7 3l3.5 3.5L7 10" />
            </svg>
          </Link>
        </nav>
      </header>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className={styles.hero} id="how" aria-labelledby="hero-h1">
        <div className={styles.eyebrow} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          <span className={styles.eyebrowText}>100% in your browser · no server, no upload</span>
        </div>

        <h1 className={styles.heroHeadline} id="hero-h1">
          <span className={styles.hl1}>Automate your data,</span>
          <span className={styles.hl2}>without leaving the page.</span>
        </h1>

        <p className={styles.heroSub}>
          Drag nodes onto a canvas, wire them together, and hit Run. AutoPilot streams your CSV
          and PDF files through every step entirely on your machine — private, instant, and
          offline forever.
        </p>

        <div className={styles.heroCtas}>
          <Link href="/workflows" className={styles.btnPrimary} aria-label="Launch AutoPilot workflow editor">
            Launch AutoPilot
            <span className={styles.btnArrow} aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>
          <button className={styles.btnGhost} onClick={scrollToShowcase} aria-label="See the workflow demo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <polygon points="3,1.5 13,7 3,12.5" />
            </svg>
            See it run
          </button>
        </div>
      </section>

      {/* ── SHOWCASE CARD ─────────────────────────────────────────────────── */}
      <section className={styles.showcaseWrap} id="showcase" ref={showcaseRef} aria-label="Workflow editor preview">
        <div className={styles.showcaseCard}>
          {/* Chrome */}
          <div className={styles.cardChrome} aria-hidden="true">
            <div className={styles.chromeDots}>
              <div className={`${styles.chromeDot} ${styles.dotR}`} />
              <div className={`${styles.chromeDot} ${styles.dotY}`} />
              <div className={`${styles.chromeDot} ${styles.dotG}`} />
            </div>
            <span className={styles.chromeFilename}>wf_20260505_001</span>
            <div className={styles.chromeStatus}>
              <div className={styles.chromeStatusDot} />
              <span className={styles.chromeStatusText}>completed · 7 nodes</span>
            </div>
          </div>

          {/* Canvas */}
          <div className={styles.canvasArea}>
            <div className={styles.nodesRow} ref={nodesRowRef} role="list" aria-label="Workflow nodes">
              {NODES.map((node, i) => (
                <div key={`${node.name}-${i}`} className={styles.nodeUnit}>
                  <div
                    className={`${styles.nodeCard} ${node.accent ? styles.accentNode : ""}`}
                    data-node-card="true"
                    role="listitem"
                    aria-label={node.name}
                  >
                    <div className={styles.nodeIconWrap}>{node.icon}</div>
                    <span className={styles.nodeName}>{node.name}</span>
                    <span className={styles.nodeMeta}>{node.meta}</span>
                  </div>

                  {i < NODES.length - 1 && (
                    <div className={styles.connWrap} aria-hidden="true">
                      <svg className={styles.connSvg} viewBox="0 0 44 88" xmlns="http://www.w3.org/2000/svg">
                        <line
                          className={styles.connLine}
                          x1="0" y1="44" x2="44" y2="44"
                          strokeDasharray="44"
                          strokeDashoffset="44"
                          data-conn-line="true"
                        />
                      </svg>
                      <div className={styles.connSpark} data-conn-spark="true" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Trace */}
          <div className={styles.tracePanel} aria-label="Execution trace timeline">
            <div className={styles.traceHeader}>
              <span className={styles.traceTitle}>Trace</span>
              <span className={styles.traceBadge}>3.6s total</span>
            </div>
            <div className={styles.traceRows} ref={traceRowsRef} role="list">
              {TRACE_DATA.map((item, i) => (
                <div key={i} className={styles.traceRow} role="listitem">
                  <span className={styles.traceLabel}>{item.label}</span>
                  <div className={styles.traceTrack} role="progressbar" aria-valuenow={item.pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className={styles.traceFill} data-trace-fill="true" data-pct={item.pct} />
                  </div>
                  <span className={styles.traceTime}>{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── VALUE PROPS ───────────────────────────────────────────────────── */}
      <section className={styles.valueSection} id="why" aria-labelledby="vp-title">
        <h2 id="vp-title" className="sr-only">Why AutoPilot</h2>
        <div className={styles.vpGrid} ref={vpCardsRef}>
          {VALUE_PROPS.map((vp, i) => (
            <div
              key={vp.title}
              className={styles.vpCard}
              data-vp-card="true"
              style={{ transitionDelay: `${i * 0.13}s` }}
            >
              <div className={styles.vpChip} aria-hidden="true">{vp.icon}</div>
              <h3 className={styles.vpTitle}>{vp.title}</h3>
              <p className={styles.vpDesc}>{vp.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand} aria-label="AutoPilot home">
          <LogoOrb size={22} />
          <span className={styles.footerWordmark}>AutoPilot</span>
        </Link>
        <p className={styles.footerTagline}>Automate your data, entirely in your browser.</p>
        <div className={styles.footerPowered}>
          <span>Powered by</span>
          <Image
            src="/logos/logoTT.png"
            alt="Tunisie Telecom"
            width={48}
            height={14}
            className="object-contain"
          />
          <span>Tunisie Telecom</span>
        </div>
      </footer>
    </div>
  );
}
