import Navbar from "./components/Navbar.jsx";
import Section from "./components/Section.jsx";
import ProjectCard from "./components/ProjectCard.jsx";
import Footer from "./components/Footer.jsx";
import { projects } from "./data/projects.js";
import { CheckCircle2, Sparkles, Wrench, Zap } from "lucide-react";

function Pill({ icon, title, text }) {
  const Icon = icon;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-5 shadow-soft">
      <div className="flex items-center gap-2 text-neutral-100">
        <Icon className="h-5 w-5 text-indigo-300" />
        <div className="font-semibold">{title}</div>
      </div>
      <div className="mt-2 text-sm text-neutral-300 leading-relaxed">{text}</div>
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-grid">
      <Navbar />

      {/* HERO */}
      <header className="relative">
        <div className="mx-auto max-w-6xl px-5 pt-16 pb-10">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-950/60 p-8 md:p-12 shadow-soft overflow-hidden">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200">
                <Sparkles className="h-4 w-4 text-indigo-300" />
                Technical Art • Tools • Shaders • Pipelines
              </div>

              <h1 className="mt-4 text-3xl md:text-5xl font-semibold text-neutral-50 leading-tight">
                I build production-ready tools and shaders that make artists faster.
              </h1>

              <p className="mt-4 text-neutral-300 leading-relaxed">
                This site is structured around case studies: what the problem was, how I solved it,
                and what it improved (iteration time, consistency, performance, and UX).
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#work"
                  className="rounded-xl bg-indigo-600/90 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-600 transition"
                >
                  Explore Projects
                </a>
                <a
                  href="#case-studies"
                  className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm font-semibold text-neutral-100 hover:border-indigo-500/50 transition"
                >
                  Read Case Studies
                </a>
                <a
                  href="#contact"
                  className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm font-semibold text-neutral-100 hover:border-indigo-500/50 transition"
                >
                  Contact
                </a>
              </div>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                <Pill
                  icon={Wrench}
                  title="Tooling"
                  text="Editor utilities, validation, batch pipelines, and UX that artists actually enjoy using."
                />
                <Pill
                  icon={Zap}
                  title="Shaders"
                  text="Material systems that are art-directable, performant, and easy to debug."
                />
                <Pill
                  icon={CheckCircle2}
                  title="Production"
                  text="I optimize for stability, clarity, documentation, and long-term maintainability."
                />
              </div>
            </div>

            {/* Accent gradient */}
            <div className="pointer-events-none absolute inset-0 opacity-60">
              <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-indigo-600/25 blur-3xl" />
              <div className="absolute -bottom-48 -left-40 h-96 w-96 rounded-full bg-fuchsia-500/15 blur-3xl" />
            </div>
          </div>
        </div>
      </header>

      {/* WORK */}
      <Section id="work" eyebrow="Selected Work" title="Projects">
        <div className="grid gap-5">
          {projects.map((p) => (
            <ProjectCard key={p.title} project={p} />
          ))}
        </div>
      </Section>

      {/* SKILLS */}
      <Section id="skills" eyebrow="What I do" title="Technical Art Focus Areas">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
            <div className="text-sm font-semibold text-neutral-100">Tools & Pipelines</div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
              <li>Editor tooling (EUW/UMG), batch operations, validation, and asset repair</li>
              <li>Pipeline design: repeatable results, logging, safety rails, and clear UX</li>
              <li>Data-driven workflows and automation for content at scale</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
            <div className="text-sm font-semibold text-neutral-100">Shaders & Rendering</div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
              <li>Layered materials (wear/dirt/damage), debug visualizations, and performance tuning</li>
              <li>Material function libraries and reusable “building block” workflows</li>
              <li>Optimization mindset: readability, cost visibility, and platform constraints</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
            <div className="text-sm font-semibold text-neutral-100">Collaboration</div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
              <li>Cross-team problem solving (art, design, engineering)</li>
              <li>Documentation and onboarding guides to reduce tribal knowledge</li>
              <li>Iteration loops: ship → observe → refine → standardize</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
            <div className="text-sm font-semibold text-neutral-100">Suggested proof points</div>
            <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
              <li>Before/after metrics (iteration time, error rate, performance cost)</li>
              <li>Short GIFs: “artist clicks button → pipeline output is correct”</li>
              <li>Clear “why”: tradeoffs, constraints, and what you’d do next</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* CASE STUDIES */}
      <Section id="case-studies" eyebrow="Deep dives" title="Case Studies (Template)">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Problem → Constraints",
              text:
                "What was broken or slow? Who was affected? What constraints mattered (time, perf, data, team workflows)?"
            },
            {
              title: "Solution → Implementation",
              text:
                "Show architecture, key decisions, and UX. Include screenshots/GIFs and a short explanation of how it works."
            },
            {
              title: "Impact → Next Steps",
              text:
                "Quantify improvements. List edge cases. Explain what you’d improve if you had another week."
            }
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft"
            >
              <div className="text-neutral-50 font-semibold">{c.title}</div>
              <div className="mt-2 text-sm text-neutral-300 leading-relaxed">{c.text}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-6">
          <div className="text-sm font-semibold text-neutral-100">Next iteration idea</div>
          <p className="mt-2 text-sm text-neutral-300 leading-relaxed">
            When you’re ready, we’ll add:
            <span className="text-neutral-100"> a dedicated page per project</span> (with images/GIFs),
            <span className="text-neutral-100"> a “shader gallery”</span>,
            and <span className="text-neutral-100"> a tooling timeline</span>.
          </p>
        </div>
      </Section>

      {/* CONTACT */}
      <Section id="contact" eyebrow="Let’s talk" title="Contact">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
          <p className="text-neutral-300 leading-relaxed">
            Replace these with your real links. If you want, I’ll set this up with a contact form
            (using a free service) so you don’t expose your email.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <a
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-indigo-500/50 transition"
              href="mailto:your.email@example.com"
            >
              <div className="text-sm font-semibold text-neutral-100">Email</div>
              <div className="text-sm text-neutral-400">your.email@example.com</div>
            </a>

            <a
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-indigo-500/50 transition"
              href="https://www.linkedin.com/"
              target="_blank"
              rel="noreferrer"
            >
              <div className="text-sm font-semibold text-neutral-100">LinkedIn</div>
              <div className="text-sm text-neutral-400">linkedin.com/in/you</div>
            </a>

            <a
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 hover:border-indigo-500/50 transition"
              href="https://github.com/"
              target="_blank"
              rel="noreferrer"
            >
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