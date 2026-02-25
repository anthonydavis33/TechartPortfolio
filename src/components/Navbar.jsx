import { Mail, ExternalLink } from "lucide-react";

const nav = [
  { href: "/#work", label: "Work" },
  { href: "/#skills", label: "Skills" },
  { href: "/#case-studies", label: "Case Studies" },
  { href: "/#contact", label: "Contact" }
];

export default function Navbar() {
  return (
    <div className="sticky top-0 z-50 border-b border-neutral-900 bg-neutral-950/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5 py-3 flex items-center justify-between">
        <a href="#" className="font-semibold text-neutral-50">
          <span className="text-indigo-300">Tech</span> Art Portfolio
        </a>

        <div className="hidden md:flex items-center gap-2">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-xl px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-900/60 transition"
            >
              {n.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href="#contact"
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm hover:border-indigo-500/50 transition"
          >
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Reach out</span>
          </a>

          <a
            href="#work"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600/90 px-3 py-2 text-sm text-white hover:bg-indigo-600 transition"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">View work</span>
          </a>
        </div>
      </div>
    </div>
  );
}