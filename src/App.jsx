import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import ProjectDetail from "./pages/ProjectDetail.jsx";
import Resume from "./pages/Resume";
import KnowledgeBase from "./pages/KnowledgeBase.jsx";
import { useGlassHoverSpotlight } from "./hooks/useGlassHoverSpotlight";
import ScrollToTop from "./components/ScrollToTop";

export default function App() {
  useGlassHoverSpotlight();

  return (
    <div id="app-scroll" className="min-h-screen">
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects/:slug" element={<ProjectDetail />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/kb" element={<KnowledgeBase />} />
        <Route path="/kb/*" element={<KnowledgeBase />} />
      </Routes>
    </div>
  );
}