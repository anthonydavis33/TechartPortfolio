import { Link } from "react-router-dom";

const base = import.meta.env.BASE_URL;

export default function Navbar() {
  return (
    <nav className="...">
      <div className="...">
        {/* Projects -> home + anchor */}
        <a href={`${base}#work`} className="nav-link">
          Projects
        </a>

        {/* Resume -> route */}
        <Link to="/resume" className="nav-link">
          Resume
        </Link>

        {/* Contact -> home + anchor */}
        <a href={`${base}#contact`} className="nav-link">
          Contact
        </a>
      </div>
    </nav>
  );
}