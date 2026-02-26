export const asset = (path) => {
  const base = import.meta.env.BASE_URL || "/"; // "/" locally, "/TechartPortfolio/" on GH Pages
  const baseNorm = base.endsWith("/") ? base : `${base}/`;
  const pathNorm = String(path || "").replace(/^\/+/, ""); // strip leading slashes
  return `${baseNorm}${pathNorm}`;
};