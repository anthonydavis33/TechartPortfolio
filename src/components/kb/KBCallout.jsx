import { Info, AlertTriangle, Lightbulb, AlertOctagon, Bookmark } from "lucide-react";

const CALLOUT_CONFIG = {
  note: { icon: Info, color: "blue" },
  info: { icon: Info, color: "blue" },
  tip: { icon: Lightbulb, color: "emerald" },
  hint: { icon: Lightbulb, color: "emerald" },
  warning: { icon: AlertTriangle, color: "amber" },
  caution: { icon: AlertTriangle, color: "amber" },
  danger: { icon: AlertOctagon, color: "red" },
  error: { icon: AlertOctagon, color: "red" },
  abstract: { icon: Bookmark, color: "cyan" },
  summary: { icon: Bookmark, color: "cyan" },
};

const COLOR_CLASSES = {
  blue: "border-blue-400/50 bg-blue-400/5",
  emerald: "border-emerald-400/50 bg-emerald-400/5",
  amber: "border-amber-400/50 bg-amber-400/5",
  red: "border-red-400/50 bg-red-400/5",
  cyan: "border-cyan-400/50 bg-cyan-400/5",
};

const ICON_CLASSES = {
  blue: "text-blue-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
};

export default function KBCallout({ type, title, children }) {
  const config = CALLOUT_CONFIG[type] || CALLOUT_CONFIG.note;
  const Icon = config.icon;

  return (
    <div
      className={`my-4 rounded-xl border-l-4 px-4 py-3 ${COLOR_CLASSES[config.color]}`}
    >
      <div
        className={`flex items-center gap-2 mb-1 font-semibold text-sm ${ICON_CLASSES[config.color]}`}
      >
        <Icon size={16} />
        {title}
      </div>
      <div className="text-neutral-300 text-sm">{children}</div>
    </div>
  );
}
