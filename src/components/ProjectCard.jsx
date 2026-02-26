import { Link } from "react-router-dom";
import { ArrowUpRight, Github, FileText } from "lucide-react";
import { asset } from "../utils/asset";

function SmallLink({ href, icon: Icon, label }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-200 hover:border-accent-500/50 hover:bg-neutral-900/70 transition"
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

export default function ProjectCard({ project }) {
  return (
    <div className="glass-card rounded-2xl shadow-soft overflow-hidden">
      {/* Thumbnail */}
      <Link to={`/projects/${project.slug}`} className="block">
        <div className="relative">
          <img
            src={asset(project.thumbnail)}
            alt={`${project.title} thumbnail`}
            className="h-40 w-full object-cover border-b border-neutral-800"
            loading="lazy"
          />
          <div className="absolute top-3 left-3 rounded-full border border-neutral-800 bg-neutral-950/70 px-3 py-1 text-xs text-neutral-100 backdrop-blur">
            {project.tag}
          </div>
        </div>
      </Link>

      {/* Condensed content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-neutral-50 leading-snug">
            <Link to={`/projects/${project.slug}`} className="hover:text-white">
              {project.title}
            </Link>
          </h3>
        </div>

        <p className="mt-2 text-sm text-neutral-300 leading-relaxed">
          {project.short}
        </p>

        {/* Stack chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {project.stack?.slice(0, 4).map((s) => (
            <span
              key={s}
              className="rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-[11px] text-neutral-200"
            >
              {s}
            </span>
          ))}
          {project.stack?.length > 4 ? (
            <span className="rounded-full border border-neutral-800 bg-neutral-900/40 px-3 py-1 text-[11px] text-neutral-400">
              +{project.stack.length - 4}
            </span>
          ) : null}
        </div>

        {/* Buttons */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            to={`/projects/${project.slug}`}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-600/90 px-3 py-2 text-xs font-semibold text-white hover:bg-accent-600 transition"
          >
            <ArrowUpRight className="h-4 w-4" />
            Deep dive
          </Link>

          <SmallLink href={project.links?.writeup} icon={FileText} label="Write-up" />
          <SmallLink href={project.links?.repo} icon={Github} label="Code" />
          <SmallLink href={project.links?.demo} icon={ArrowUpRight} label="Demo" />
        </div>
      </div>
    </div>
  );
}