import { ArrowUpRight, Github, FileText } from "lucide-react";

function LinkIcon({ kind }) {
  if (kind === "repo") return <Github className="h-4 w-4" />;
  if (kind === "writeup") return <FileText className="h-4 w-4" />;
  return <ArrowUpRight className="h-4 w-4" />;
}

function ProjectLink({ href, kind, label }) {
  if (!href) {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-500">
        <LinkIcon kind={kind} />
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 hover:border-indigo-500/60 hover:bg-neutral-900/70 transition"
    >
      <LinkIcon kind={kind} />
      {label}
    </a>
  );
}

export default function ProjectCard({ project }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200">
            {project.tag}
          </div>
          <h3 className="mt-3 text-xl font-semibold text-neutral-50">
            {project.title}
          </h3>
          <p className="mt-2 text-neutral-300 leading-relaxed">
            {project.description}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-sm font-semibold text-neutral-200">Highlights</div>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300 list-disc pl-5">
            {project.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-sm font-semibold text-neutral-200">Stack</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {project.stack.map((s) => (
              <span
                key={s}
                className="rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-xs text-neutral-200"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <ProjectLink href={project.links.demo} kind="demo" label="Demo" />
        <ProjectLink href={project.links.writeup} kind="writeup" label="Write-up" />
        <ProjectLink href={project.links.repo} kind="repo" label="Code" />
      </div>
    </div>
  );
}