import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { projects } from "../data/projects";
import { ArrowLeft, Github, FileText, ArrowUpRight } from "lucide-react";
import { asset } from "../utils/asset";
import CodeBlock from "../components/CodeBlock";
import { useState } from "react";

function LinkButton({ href, icon: Icon, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 hover:border-accent-500/60 hover:bg-neutral-900/70 transition"
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

function BulletBlock({ title, items, className = "" }) {
  if (!items?.length) return null;
  return (
    <div className={`glass-card rounded-2xl p-6 shadow-soft ${className}`}>
      <div className="text-sm font-semibold text-neutral-50 tracking-wide">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function TextGifBlock({ item, flip = false }) {
  const hasMedia = item.gifSrc?.trim();

  return (
    <div className="glass-card rounded-2xl p-6 shadow-soft">
      <div
        className={`grid gap-6 items-center ${
          hasMedia ? "md:grid-cols-2" : ""
        } ${flip && hasMedia ? "md:[&>*:first-child]:order-2" : ""}`}
      >
        {/* Text */}
        <div>
          {item.eyebrow && (
            <div className="text-xs font-semibold tracking-widest text-accent-400/90 uppercase">
              {item.eyebrow}
            </div>
          )}

          <h3 className="mt-2 text-xl font-semibold text-neutral-50">
            {item.title}
          </h3>

          {item.text && (
            <p className="mt-3 text-sm text-neutral-300 leading-relaxed">
              {item.text}
            </p>
          )}

          {item.bullets?.length && (
            <ul className="mt-4 space-y-2 text-sm text-neutral-300 list-disc pl-5">
              {item.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Media — ONLY renders if gifSrc exists */}
        {hasMedia && (
          <div className="rounded-2xl border border-neutral-800 overflow-hidden bg-neutral-950/40">
            <div className="h-100 md:h-115 w-full">
              <img
                src={asset(item.gifSrc)}
                alt=""
                className="w-full h-full object-cover rounded-xl"
                loading="lazy"
              />
            </div>

            {item.caption && (
              <div className="px-4 py-3 text-sm text-neutral-400 border-t border-neutral-800">
                {item.caption}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { slug } = useParams();

  const project = useMemo(
    () => projects.find((p) => p.slug === slug),
    [slug]
  );

  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxCaption, setLightboxCaption] = useState("");

  if (!project) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16">
        <div className="glass-card rounded-2xl shadow-soft">
          <div className="text-neutral-50 font-semibold">Project not found</div>
          <p className="mt-2 text-neutral-300 text-sm">
            That link doesn’t match a project slug.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </div>
      </div>
    );
  }

  const cs = project.caseStudy || {};

  return (
    <div className="min-h-screen bg-grid">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <Link
          to="/#work"
          className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Projects
        </Link>

        <div className="mt-6 rounded-3xl border border-neutral-800 bg-neutral-950/60 p-7 md:p-10 shadow-soft">
          <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200">
            {project.tag}
          </div>

          <h1 className="mt-3 text-3xl md:text-4xl font-semibold text-neutral-50">
            {project.title}
          </h1>

          <p className="mt-3 text-neutral-300 leading-relaxed max-w-3xl">
            {cs.overview || project.short}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {project.stack?.map((s) => (
              <span
                key={s}
                className="rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200"
              >
                {s}
              </span>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <LinkButton href={project.links?.demo} icon={ArrowUpRight} label="Demo" />
            <LinkButton href={project.links?.writeup} icon={FileText} label="Write-up" />
            <LinkButton href={project.links?.repo} icon={Github} label="Code" />
          </div>
        </div>

        {/* Case Study Blocks */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <BulletBlock title="Problem" items={cs.problem} className="glass-card case-gradient-problem rounded-2xl p-5 shadow-soft border border-rose-500/25" />
          <BulletBlock title="Solution" items={cs.solution} className="glass-card case-gradient-solution rounded-2xl p-5 shadow-soft border border-emerald-500/25 bg-emerald-950/10" />
          <BulletBlock title="Impact" items={cs.impact} className="glass-card case-gradient-impact rounded-2xl p-5 shadow-soft border border-sky-500/25 bg-sky-950/10" />
        </div>

        {/* Sections of text and gif */}
        {cs.sections?.length ? (
          <div className="mt-6 space-y-4">
            {cs.sections.map((item, i) => (
              <TextGifBlock key={item.title} item={item} flip={i % 2 === 1} />
            ))}
          </div>
        ) : null}

        {cs.media?.length ? (
          <div className="mt-6 grid gap-4">
            {cs.media.map((m) => {
              const src = typeof m === "string" ? m : m?.src;
              const caption = typeof m === "string" ? "" : m?.caption;

              return (
                <div key={src} className="glass-card rounded-2xl shadow-soft">
                  <img
                    src={asset(src)}
                    alt={caption || project.title}
                    className="w-full h-auto rounded-xl border border-neutral-800 object-contain bg-neutral-950/40 cursor-zoom-in transition-transform duration-200 hover:scale-[1.01]"
                    loading="lazy"
                    onClick={() => {
                      setLightboxSrc(src);
                      setLightboxCaption(caption || project.title);
                    }}
                  />
                  {caption ? (
                    <div className="mt-3 text-sm text-neutral-400">{caption}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* CodeBlock */}
        <div className="flex flex-col gap-10">
          <CodeBlock title={cs?.codeTitle} code={cs?.code} language="cpp" />
        </div>
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={asset(lightboxSrc)}
            alt={lightboxCaption}
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-2xl border border-neutral-700 bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      
    </div>
  );
}