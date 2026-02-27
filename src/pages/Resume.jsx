import { asset } from "../utils/asset";
import { useNavigate } from "react-router-dom";

export default function Resume() {
  const navigate = useNavigate();
  const pdfPath = "resume/Davis_Anthony_Resume_Aug25.pdf";
  const pdfUrl = `${asset(pdfPath)}#toolbar=0&navpanes=0&scrollbar=0`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-lg px-4 py-2 text-sm text-neutral-200 bg-neutral-900/60 border border-neutral-700 hover:bg-neutral-900"
        >
          ← Back Home
        </button>

        <a
          href={asset(pdfPath)}
          className="rounded-lg px-4 py-2 text-sm text-neutral-200 bg-neutral-900/60 border border-neutral-700 hover:bg-neutral-900"
          download
        >
          Download PDF
        </a>
      </div>

      <div className="mt-6 glass-card rounded-2xl shadow-soft overflow-hidden border border-neutral-800">
        <embed
          src={asset(pdfUrl)}
          type="application/pdf"
          className="w-full"
          style={{ height: "85vh" }}
        />
      </div>

      <p className="mt-3 text-sm text-neutral-400">
        If the PDF preview doesn’t load in your browser, use the download button above.
      </p>
    </div>
  );
}