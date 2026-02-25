import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { projects } from "../data/projects";
import { ArrowLeft, Github, FileText, ArrowUpRight } from "lucide-react";

function LinkButton({ href, icon: Icon, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 hover:border-indigo-500/60 hover:bg-neutral-900/70 transition"
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

function BulletBlock({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
      <div className="text-sm font-semibold text-neutral-100">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-neutral-300 list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ProjectDetail() {
  const { slug } = useParams();

  const project = useMemo(
    () => projects.find((p) => p.slug === slug),
    [slug]
  );

  if (!project) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
          <div className="text-neutral-50 font-semibold">Project not found</div>
          <p className="mt-2 text-neutral-300 text-sm">
            That link doesn’t match a project slug.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600/90 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 transition"
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

      {/* Media */}
      {cs.media?.length ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {cs.media.map((m) => (
            <div
              key={m.src}
              className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4 shadow-soft"
            >
              <img
                src={m.src}
                alt={m.caption || project.title}
                className="w-full rounded-xl border border-neutral-800 object-cover"
              />
              {m.caption && (
                <div className="mt-3 text-sm text-neutral-400">{m.caption}</div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/* Case Study Blocks */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <BulletBlock title="Problem" items={cs.problem} />
        <BulletBlock title="Solution" items={cs.solution} />
        <BulletBlock title="Impact" items={cs.impact} />
      </div>

      {/* Next steps placeholder */}
      <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-6">
        <div className="text-sm font-semibold text-neutral-100">What I’d improve next</div>
        <p className="mt-2 text-sm text-neutral-300 leading-relaxed">
          Add a short section here when you want: edge cases, what you’d refactor,
          perf wins still on the table, or “if we had another sprint…”.
        </p>
      </div>
    </div>
  );
}