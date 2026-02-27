import Navbar from "../components/Navbar.jsx";
import Section from "../components/Section.jsx";
import ProjectCard from "../components/ProjectCard.jsx";
import Footer from "../components/Footer.jsx";
import { projects } from "../data/projects.js";
import { CheckCircle2, Sparkles, Wrench, Zap } from "lucide-react";

function Pill({ icon, title, text }) {
  const Icon = icon;
  return (
    <div className="glass-card rounded-2xl shadow-soft">
      <div className="flex items-center gap-2 text-neutral-100">
        <Icon className="h-5 w-5 text-accent-400" />
        <div className="font-semibold">{title}</div>
      </div>
      <div className="mt-2 text-sm text-neutral-300 leading-relaxed">{text}</div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-grid">
      <Navbar />

      {/* HERO */}
      <header className="relative">
        <div className="mx-auto max-w-6xl px-5 pt-16 pb-10">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-8 md:p-12 shadow-soft overflow-hidden">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200">
                <Sparkles className="h-4 w-4 text-accent-400" />
                Technical Art • Tools • Shaders • Pipelines
              </div>

              <h1 className="mt-4 text-3xl md:text-5xl font-semibold text-neutral-50 leading-tight">
                I build production-ready tools and shaders that make artists faster.
              </h1>

              <p className="mt-4 text-neutral-300 leading-relaxed">
                Dense summaries for quick scanning—deep dives for the hiring manager who wants details.
              </p>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <Pill icon={Wrench} title="Tooling" text="Editor utilities, validation, batch pipelines, and UX." />
                <Pill icon={Zap} title="Shaders" text="Art-directable systems with debug views and sane cost." />
                <Pill icon={CheckCircle2} title="Production" text="Stability, documentation, and maintainability." />
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 opacity-60">
              <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-emerald-500/25 blur-3xl" />
              <div className="absolute -bottom-48 -left-40 h-96 w-96 rounded-full bg-lime-400/20 blur-3xl" />
            </div>
          </div>
        </div>
      </header>

      {/* WORK */}
      <Section id="work" eyebrow="Selected Work" title="Projects">
        {/* 3-up grid on large screens */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.slug} project={p} />
          ))}
        </div>
      </Section>

      {/* (Keep the rest of your sections as-is if you want) */}
      <Section id="contact" eyebrow="Let’s talk" title="Contact">
        <div className="glass-card rounded-2xl shadow-soft">
          <p className="text-neutral-300 leading-relaxed">
            Replace these with your real links. We can add a contact form later.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <a className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-accent-500/50 transition" href="mailto:your.email@example.com">
              <div className="text-sm font-semibold text-neutral-100">Email</div>
              <div className="text-sm text-neutral-400">your.email@example.com</div>
            </a>
            <a className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-accent-500/50 transition" href="https://www.linkedin.com/" target="_blank" rel="noreferrer">
              <div className="text-sm font-semibold text-neutral-100">LinkedIn</div>
              <div className="text-sm text-neutral-400">linkedin.com/in/you</div>
            </a>
            <a className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-accent-500/50 transition" href="https://github.com/" target="_blank" rel="noreferrer">
              <div className="text-sm font-semibold text-neutral-100">GitHub</div>
              <div className="text-sm text-neutral-400">github.com/you</div>
            </a>
          </div>
        </div>
      </Section>

      <Footer />
    </div>
  );
}