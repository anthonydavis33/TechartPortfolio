import { Mail, ExternalLink } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const goToSection = (id) => {
    // If we're not on home, go home first, then scroll.
    if (location.pathname !== "/") {
      navigate("/");
      // Let Home render, then scroll
      requestAnimationFrame(() => {
        setTimeout(() => scrollToId(id), 0);
      });
    } else {
      scrollToId(id);
    }
  };

  return (
    <div className="sticky top-0 z-50 border-b border-neutral-900 bg-neutral-950/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5 py-3 flex items-center justify-between">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="font-semibold text-neutral-50"
        >
          <span className="text-accent-400">Tech</span> Art Portfolio
        </a>

        <div className="hidden md:flex items-center gap-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              goToSection("work");
            }}
            className="rounded-xl px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-900/60 transition"
          >
            Projects
          </a>

          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("/resume");
            }}
            className="rounded-xl px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-900/60 transition"
          >
            Resume
          </a>

          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              goToSection("contact");
            }}
            className="rounded-xl px-3 py-2 text-sm text-neutral-200 hover:text-white hover:bg-neutral-900/60 transition"
          >
            Contact
          </a>
        </div>
      </div>
    </div>
  );
}