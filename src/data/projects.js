export const projects = [
  {
    slug: "character-pipeline-tooling",
    title: "Character Pipeline Tooling",
    tag: "Tools + Pipeline",
    thumbnail: "/projects/character-pipeline.jpg",
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
        "A production toolset to reduce iteration time and prevent asset correctness drift across large character sets.",
      problem: [
        "Artists spent too long performing repetitive setup steps.",
        "Naming/structure drift caused downstream bugs and inconsistent results.",
        "Fixing large batches was risky without clear logging and safeguards."
      ],
      solution: [
        "Built Editor UI for batch operations with previews and validation gates.",
        "Standardized naming rules and automated repairs.",
        "Added structured logging and error reporting for auditability."
      ],
      impact: [
        "Reduced setup time per asset and eliminated common manual mistakes.",
        "Improved consistency across content batches.",
        "Made pipeline issues visible early via validation."
      ],
      media: [
        // You can add more later
        { type: "image", src: "/projects/character-pipeline.jpg", caption: "Tool UI + batch validation output." }
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
      media: [{ type: "image", src: "/projects/shader-wear.jpg", caption: "Layer mask progression example." }]
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
      media: [{ type: "image", src: "/projects/pcg-workflow.jpg", caption: "PCG layout + debugging overview." }]
    }
  }
];