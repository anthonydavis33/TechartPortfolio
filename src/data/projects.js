export const projects = [
  {
    slug: "character-pipeline-tooling",
    title: "Character Lookdev Tool",
    tag: "Tools + Pipeline",
    thumbnail: "/projects/DioramaOnly.png",
    short:
      "Editor tooling that accelerates character look-dev with validation, batch fixes, and artist-first UX.",
    stack: ["Unreal Engine", "Python", "Blueprints", "Perforce"],
    links: {
      demo: "",
      repo: "",
      writeup: ""
    },
    caseStudy: {
      overview:
      "A character look-development and validation tool that lets artists and designers preview gear, variants, and character combinations under in-game lighting and environments—while enforcing data correctness and surfacing errors early.",

      problem: [
        "Artists and designers lacked a fast, reliable way to preview armor and variants under real in-game lighting and environment conditions.",
        "Validating gear across races, genders, and customization variants required manual scene setup and repeated context switching.",
        "Data or material reference issues often went unnoticed until late in integration, increasing iteration cost and risk."
      ],

      solution: [
        "Built a diorama-driven look-dev tool that loads gear, characters, and variants directly from game data and renders them under biome-specific lighting and post-process conditions.",
        "Added automatic skeletal mesh resolution for race and gender combinations, enabling one-click validation across supported character types.",
        "Integrated data and material validation with high-visibility fallback rendering and structured logging to surface issues immediately."
      ],

      impact: [
        "Significantly reduced iteration time for character look development and variant tuning by centralizing preview, validation, and editing in one tool.",
        "Improved visual consistency and confidence by ensuring assets are reviewed under representative in-game lighting and environments.",
        "Caught data and reference issues earlier in the pipeline, reducing late-stage integration bugs and rework."
      ],
      media: [
        // You can add more later
        { type: "image", src: "/projects/DioramaOnly.png", caption: "Tool UI + batch validation output." }
      ],
      sections: [
        {
          eyebrow: "Quick Visuals",
          title: "Automated Gear Loading with Material Validation",
          text: "Selecting a gear set automatically loads the associated armor data after import. The tool performs material validation at load time and applies a high-visibility fallback shader when a reference is invalid, making errors immediately obvious to artists and preventing broken assets from silently entering the pipeline.",
          bullets: ["In-game lighting at a glance", "Clear visual error signaling for invalid materials", "Prevents silent pipeline failures"],
          gifSrc: "/projects/gifs/Diorama1.gif",
          caption: "Quick preview for immediate validation and lookdev"
        },
        {
          eyebrow: "Biome Look",
          title: "Biome-Based Diorama Previews with Environment Modifiers",
          text: "Each diorama is designed to be easily extensible per biome and includes environment modifiers for post-process color grading. This allows artists to preview armor under multiple in-game lighting scenarios and environmental conditions, reducing lighting-related surprises during integration.",
          bullets: ["Modular diorama setup per biome", "In-game lighting and post-process parity", "Fast visual validation across environments"],
          gifSrc: "/projects/gifs/Diorama2.gif"
        },
        {
          eyebrow: "Race and Gender Look",
          title: "Dynamic Race & Gender Cycling",
          text: "The tool supports cycling through available races and genders, automatically resolving and loading the correct skeletal meshes for each combination. This ensures armor sets are validated across all supported character variants without manual setup or repeated scene configuration.",
          bullets: ["Automatic skeletal mesh resolution", "One-click validation across character variants", "Reduces setup friction for cross-race testing"],
          gifSrc: "/projects/gifs/Diorama3.gif"
        },
        {
          eyebrow: "Data Editing",
          title: "Variant Preview with Direct Data Editing",
          text: "Designers and artists can preview player-facing customization options directly within the tool and adjust variant data in place. This enables rapid iteration on armor sets and variants while maintaining alignment with gameplay data, reducing back-and-forth between content creation and data tuning.",
          bullets: ["In-context preview of design customizations", "Direct editing of variant data", "Faster iteration on armor set variants"],
          gifSrc: "/projects/gifs/Diorama4.gif"
        }
      ]
    }
  },

  {
    slug: "layered-wear-damage-shader",
    title: "Shader System: Layered Wear & Damage",
    tag: "Shaders",
    thumbnail: "/projects/shader-wear.jpg",
    short:
      "Layered, art-directable wear/dirt/damage framework with debug views and performance-minded controls.",
    stack: ["Unreal Materials", "HLSL", "Material Functions"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:
        "A reusable material framework that keeps art direction flexible while staying performant and debuggable.",
      problem: [
        "Wear/damage needed to be consistent across many assets without unique authoring.",
        "Artists needed control without touching low-level shader graphs.",
        "Hard to diagnose cost/incorrect masks without tooling."
      ],
      solution: [
        "Composed layered material functions with clear inputs/outputs.",
        "Exposed parameters in a controlled way (instances + functions).",
        "Added debug visualization options for masks/cost sanity checks."
      ],
      impact: [
        "Faster iteration and more consistent results across assets.",
        "Reduced shader complexity for artists using the system.",
        "Simplified debugging for both art and tech art."
      ],
      media: [{ type: "image", src: "/projects/shader-wear.jpg", caption: "Layer mask progression example." }],
      sections: [
        {
          eyebrow: "Workflow",
          title: "Batch validation with safe previews",
          text: "Artists can see what will change before the operation runs. Logs are generated per batch for auditing.",
          bullets: ["Preview-first UX", "Clear failure reasons", "Per-asset actions"],
          gifSrc: "/projects/gifs/validation-preview.gif",
          caption: "Preview mode with validation results and fix actions."
        },
        {
          eyebrow: "UX",
          title: "One-click setup for new assets",
          text: "Automates repetitive steps and enforces naming and folder rules without blocking iteration.",
          bullets: ["Defaults that match production", "Fast iteration", "Guardrails not gates"],
          gifSrc: "/projects/gifs/one-click-setup.gif"
        }
      ]
    }
  },

  {
    slug: "pcg-workflow",
    title: "World-Building / PCG Workflow",
    tag: "PCG + UX",
    thumbnail: "/projects/pcg-workflow.jpg",
    short:
      "Scalable PCG patterns and tooling for predictable world dressing, fast iteration, and profiling discipline.",
    stack: ["Unreal PCG", "Editor Tools", "Profiling"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:
        "A practical PCG workflow focused on scalability: predictable results, performant graphs, and rapid iteration.",
      problem: [
        "Graphs became fragile and slow as content scale increased.",
        "Hard to keep results predictable and art-directable.",
        "Iteration bottlenecks when profiling wasn’t baked into the workflow."
      ],
      solution: [
        "Established reusable graph patterns and controls.",
        "Created data-driven knobs for art direction.",
        "Built a profiling-first workflow with clear performance budgets."
      ],
      impact: [
        "More scalable graphs with fewer surprise regressions.",
        "Faster iteration for artists and tech art.",
        "Clearer performance expectations on large scenes."
      ],
      media: [{ type: "image", src: "/projects/pcg-workflow.jpg", caption: "PCG layout + debugging overview." }],
      sections: [
        {
          eyebrow: "Workflow",
          title: "Batch validation with safe previews",
          text: "Artists can see what will change before the operation runs. Logs are generated per batch for auditing.",
          bullets: ["Preview-first UX", "Clear failure reasons", "Per-asset actions"],
          gifSrc: "/projects/gifs/validation-preview.gif",
          caption: "Preview mode with validation results and fix actions."
        },
        {
          eyebrow: "UX",
          title: "One-click setup for new assets",
          text: "Automates repetitive steps and enforces naming and folder rules without blocking iteration.",
          bullets: ["Defaults that match production", "Fast iteration", "Guardrails not gates"],
          gifSrc: "/projects/gifs/one-click-setup.gif"
        }
      ]
    }
  }
];