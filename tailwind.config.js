// tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          400: "#4ade80",   // primary green
          500: "#22c55e",   // buttons / focus
          600: "#16a34a"    // hover
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0,0,0,0.25)"
      }
    }
  },
  plugins: []
};