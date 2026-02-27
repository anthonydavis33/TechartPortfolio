export default function Footer() {
  return (
    <footer className="border-t border-neutral-900">
      <div className="mx-auto max-w-6xl px-5 py-10 text-sm text-neutral-400">
        <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <div>© {new Date().getFullYear()} — Anthony Davis</div>
          <div className="text-neutral-500">
            Technical Art Portfolio
          </div>
        </div>
      </div>
    </footer>
  );
}