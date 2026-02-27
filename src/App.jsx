import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import ProjectDetail from "./pages/ProjectDetail.jsx";
import { useGlassHoverSpotlight } from "./hooks/useGlassHoverSpotlight";

export default function App() {
  useGlassHoverSpotlight();
  
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects/:slug" element={<ProjectDetail />} />
    </Routes>
  );
}