export const projects = [
  {
    slug: "character-pipeline-tooling",
    title: "Character Lookdev Tool",
    tag: "Tools + Pipeline",
    thumbnail: "projects/diorama.png",
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
      ],
      sections: [
        {
          eyebrow: "Quick Visuals",
          title: "Automated Gear Loading with Material Validation",
          text: "Selecting a gear set automatically loads the associated armor data after import. The tool performs material validation at load time and applies a high-visibility fallback shader when a reference is invalid, making errors immediately obvious to artists and preventing broken assets from silently entering the pipeline.",
          bullets: ["In-game lighting at a glance", "Clear visual error signaling for invalid materials", "Prevents silent pipeline failures"],
          gifSrc: "projects/gifs/Diorama1.gif"
        },
        {
          eyebrow: "Biomes",
          title: "Biome-Based Diorama Previews with Environment Modifiers",
          text: "Each diorama is designed to be easily extensible per biome and includes environment modifiers for post-process color grading. This allows artists to preview armor under multiple in-game lighting scenarios and environmental conditions, reducing lighting-related surprises during integration.",
          bullets: ["Modular diorama setup per biome", "In-game lighting and post-process parity", "Fast visual validation across environments"],
          gifSrc: "projects/gifs/Diorama2.gif"
        },
        {
          eyebrow: "Race and Gender",
          title: "Dynamic Race & Gender Cycling",
          text: "The tool supports cycling through available races and genders, automatically resolving and loading the correct skeletal meshes for each combination. This ensures armor sets are validated across all supported character variants without manual setup or repeated scene configuration.",
          bullets: ["Automatic skeletal mesh resolution", "One-click validation across character variants", "Reduces setup friction for cross-race testing"],
          gifSrc: "projects/gifs/Diorama3.gif"
        },
        {
          eyebrow: "Data Editing",
          title: "Variant Preview with Direct Data Editing",
          text: "Designers and artists can preview player-facing customization options directly within the tool and adjust variant data in place. This enables rapid iteration on armor sets and variants while maintaining alignment with gameplay data, reducing back-and-forth between content creation and data tuning.",
          bullets: ["In-context preview of design customizations", "Direct editing of variant data", "Faster iteration on armor set variants"],
          gifSrc: "projects/gifs/Diorama4.gif"
        }
      ]
    }
  },

  {
    slug: "cloth-lod-tool",
    title: "Automated Cloth LOD Tool",
    tag: "Automation + Tooling", 
    thumbnail: "projects/AutomatedClothLODButton.png",
    short:
      "One-click editor tool that propagates cloth setup from LOD0 across all skeletal mesh LODs, eliminating repetitive manual setup.",
    stack: ["Automation", "Pipeline", "C++"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:
        "An editor-side automation tool that propagates cloth setup from the source LOD to all derived LODs on a skeletal mesh. Designed to eliminate repetitive manual work, reduce integration errors, and ensure consistent cloth configuration across production assets.",
      problem: [
        "Adding cloth data to each LOD required repetitive manual setup for every skeletal mesh.",
        "Manual propagation was error-prone and easy to miss during large content pushes.",
        "Artists were spending significant time on mechanical setup instead of visual iteration."
      ],

      solution: [
        "Built an editor utility that propagates cloth setup from LOD0 to all derived LODs with a single action.",
        "Automatically assigns clothing assets per section based on naming conventions and validation checks.",
        "Integrated safety checks and logging to prevent invalid assignments and surface issues immediately."
      ],

      impact: [
        "Saved ~15 minutes of setup time per skeletal mesh for artists.",
        "Eliminated common cloth assignment errors across LODs.",
        "Improved iteration speed and consistency across large character content batches."
      ],
      media: [],
      sections: [
        {
          eyebrow: "Easy Button",
          title: "Cloth LOD Automation in the Skeletal Mesh Editor",
          text: "Added a one-click action to the Skeletal Mesh Editor that automatically generates and assigns cloth data for all remaining LODs after artists complete setup on LOD0. This removes repetitive manual steps from the workflow and significantly reduces setup time and error potential during character asset production.",
          bullets: [
            "Adds a one-click action directly in the Skeletal Mesh Editor after LOD0 cloth setup.",
            "Automatically generates and assigns clothing data for all remaining LODs.",
            "Eliminates repetitive manual steps and reduces setup errors across character assets."
          ],
          gifSrc: "projects/AutomatedClothLODButton.png",
        }
      ],
      code: `void FGameSystemsEditorPlugin::PerformAutomatedClothLODTool() const
{
    FSkeletalMeshClothBuildParams Params;
    Params.bRemapParameters = true;
    Params.bRemoveFromMesh = false;
    Params.LodIndex = 0;

    UAssetEditorSubsystem* AssetEditorSubsystem = GEditor->GetEditorSubsystem<UAssetEditorSubsystem>();
    if (!AssetEditorSubsystem)
    {
        UE_LOG(LogTemp, Warning, TEXT("AssetEditorSubsystem is not available!"));
        return;
    }

    TArray<UObject*> EditedAssets = AssetEditorSubsystem->GetAllEditedAssets();

    TArray<USkeletalMesh*> EditedSkeletalMeshes;
    for (UObject* EditedAsset : EditedAssets)
    {
        if (IsValid(EditedAsset))
        {
            if (USkeletalMesh* SkeletalMesh = Cast<USkeletalMesh>(EditedAsset))
            {
                if (IsValid(SkeletalMesh))
                {
                    EditedSkeletalMeshes.Add(SkeletalMesh);
                }
            }
        }
    }

    if (EditedSkeletalMeshes.Num() > 1)
    {
        UE_LOG(LogTemp, Warning, TEXT("Multiple SkeletalMeshes are being edited. Only one should be open at a time."));
        FNotificationInfo Info(FText::FromString("Please edit only one SkeletalMesh at a time to use this tool."));
        Info.ExpireDuration = 5.0f;
        Info.bUseLargeFont = true;
        Info.Image = FCoreStyle::Get().GetBrush(TEXT("MessageLog.Warning"));
        FSlateNotificationManager::Get().AddNotification(Info);
        return;
    }

    for (UObject* EditedAsset : EditedAssets)
    {
        if (IsValid(EditedAsset))
        {
            if (USkeletalMesh* SkeletalMesh = Cast<USkeletalMesh>(EditedAsset))
            {
                if (IsValid(SkeletalMesh))
                {
                    if (UPhysicsAsset* PhysicsAsset = SkeletalMesh->GetPhysicsAsset())
                    {
                        if (IsValid(PhysicsAsset))
                        {
                            Params.PhysicsAsset = TSoftObjectPtr<UPhysicsAsset>(
                                FSoftObjectPath(PhysicsAsset->GetPathName())
                            );
                        }
                    }
                    else
                    {
                        UE_LOG(LogTemp, Warning, TEXT("No Physics Asset found for the SkeletalMesh."));
                        Params.PhysicsAsset.Reset();
                    }

                    FSkeletalMeshModel* ImportedModel = SkeletalMesh->GetImportedModel();
                    if (!ImportedModel)
                    {
                        UE_LOG(LogTemp, Warning, TEXT("Invalid skeletal mesh model data!"));
                        return;
                    }

                    const TArray<FSkeletalMaterial>& Materials = SkeletalMesh->GetMaterials();
                    int32 SourceSectionIndex = -1;
                    UClothingAssetBase* SourceClothingAsset = nullptr;

                    // Step 1: Find the source clothing asset from LOD0
                    const FSkeletalMeshLODModel& LODModel = ImportedModel->LODModels[0];
                    for (int32 SectionIndex = 0; SectionIndex < LODModel.Sections.Num(); ++SectionIndex)
                    {
                        const FSkelMeshSection& Section = LODModel.Sections[SectionIndex];

                        if (!Materials.IsValidIndex(Section.MaterialIndex) ||
                            Materials[Section.MaterialIndex].MaterialSlotName.ToString().Contains(TEXT("DRVR")))
                        {
                            Params.SourceSection = SectionIndex;
                            continue;
                        }

                        if (!Materials.IsValidIndex(Section.MaterialIndex) ||
                            Materials[Section.MaterialIndex].MaterialSlotName.ToString().Contains(TEXT("Body")))
                        {
                            continue;
                        }

                        if (Section.HasClothingData())
                        {
                            FGuid ClothingAssetGuid = Section.ClothingData.AssetGuid;
                            UClothingAssetBase* ClothingAsset = SkeletalMesh->GetClothingAsset(ClothingAssetGuid);

                            if (IsValid(ClothingAsset))
                            {
                                UE_LOG(LogTemp, Log, TEXT("Found clothing asset: %s"), *ClothingAsset->GetName());
                                Params.TargetAsset = ClothingAsset;
                            }
                            else
                            {
                                UE_LOG(LogTemp, Warning, TEXT("Section has clothing data but no valid asset."));
                            }
                        }
                    }

                    UE_LOG(LogTemp, Log, TEXT("Source clothing asset found: %s"), *SourceClothingAsset->GetName());

                    // Step 2: Iterate through LODs and assign new clothing assets
                    for (int32 LodIndex = 1; LodIndex < SkeletalMesh->GetLODNum(); ++LodIndex)
                    {
                        Params.TargetLod = LodIndex;

                        for (int32 SectionIndex = 0; SectionIndex < ImportedModel->LODModels[LodIndex].Sections.Num(); ++SectionIndex)
                        {
                            FClothingSystemEditorInterfaceModule& ClothingEditorModule =
                                FModuleManager::LoadModuleChecked<FClothingSystemEditorInterfaceModule>("ClothingSystemEditorInterface");

                            UClothingAssetFactoryBase* AssetFactory = ClothingEditorModule.GetClothingAssetFactory();

                            // Check material slot naming to determine valid cloth targets
                            if (Materials.IsValidIndex(ImportedModel->LODModels[LodIndex].Sections[SectionIndex].MaterialIndex) &&
                                (Materials[ImportedModel->LODModels[LodIndex].Sections[SectionIndex].MaterialIndex]
                                     .MaterialSlotName.ToString().Contains(TEXT("DRVR")) ||
                                 Materials[ImportedModel->LODModels[LodIndex].Sections[SectionIndex].MaterialIndex]
                                     .MaterialSlotName.ToString().Contains(TEXT("Body"))))
                            {
                                continue;
                            }

                            AssetFactory->ImportLodToClothing(SkeletalMesh, Params);

                            if (SectionIndex != Params.SourceSection)
                            {
                                if (UClothingAssetBase* TargetAssetPtr = Params.TargetAsset.Get())
                                {
                                    ApplyClothing(TargetAssetPtr, Params.TargetLod, SectionIndex, LodIndex);
                                }
                            }
                        }
                    }

                    SkeletalMesh->MarkPackageDirty();
                }
            }
        }
    }
}`
    }
  },

  {
    slug: "asset-import-validation-tool",
    title: "Asset Importer & Variant Resolver",
    tag: "Pipeline Automation",
    thumbnail: "projects/Importer.png",
    short:
      "A C++ Unreal Engine importer that detects engine vs. local assets, surfaces only missing data, and intelligently resolves texture variants through parent mesh inheritance.",
    stack: ["Unreal Engine 5", "EUW", "C++", "Data Validation"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:`
        This tool modernizes the character import workflow by detecting engine vs. local asset differences and surfacing only missing data. It intelligently resolves texture-only variants through parent mesh inheritance and centralizes configuration via custom Project Settings.

By eliminating duplication, reducing manual assignment, and externalizing validation rules, the importer improves reliability and scalability across character production pipelines.
        `,
      problem: [
        "Asset drift between engine and local machines led to duplication and inconsistent imports.",
        "Manual variant resolution and parent assignment increased repetitive work.",
        "Hardcoded rules limited pipeline flexibility."
      ],

      solution: [
        "Developed a delta-aware C++ importer that surfaces only missing engine data.",
        "Automated texture-variant parent resolution per character slot.",
        "Externalized import rules into configurable Project Settings."
      ],

      impact: [
        "Reduced duplicate content and manual setup.",
        "Standardized variant handling across character assets.",
        "Improved scalability and long-term pipeline maintainability."
      ],
      media: [],
      sections: [
        {
          eyebrow: "Trusty Importer",
          title: "Every project needs one!",
          text: `
            This tool compares the current engine state against locally available assets and surfaces only the differences. Instead of flooding the user with all possible options, the dropdown dynamically populates only assets that exist locally but are not yet present in the engine.

This prevents duplicate imports, eliminates guesswork, and reduces cognitive load for character artists. The tool ensures that what you see is actionable.

Additionally, the importer supports a texture-variant workflow. If a new item does not contain a skeletal mesh, the system assumes it is a variant and prompts the user to select a valid parent mesh for that specific character slot. The selected parent is then assigned automatically during texture import, maintaining consistency and reducing manual assignment errors.

Because this system interacts with proprietary data structures and validation rules, it is implemented fully in C++ within the Unreal Editor.
            `,
          bullets: [
            "Compares local assets against engine state and surfaces only true deltas.",
            "Prevents duplicate imports by filtering out assets already present in the project.",
            "Reduces cognitive load by dynamically populating dropdowns with actionable options only.",
            "Detects texture-only variants and prompts for valid parent skeletal mesh assignment per slot.",
            "Automates parent assignment during texture import to maintain consistency."
          ],
          gifSrc: "projects/Importer.png"
        },
        {
          eyebrow: "Configurable Pipeline Rules",
          title: "Now the designers have the power!",
          text: `
To eliminate hardcoded slot logic and asset validation rules, I implemented custom Unreal Project Settings panels dedicated to the importer. These configuration layers define parent resolution behavior, asset path expectations, and variant handling rules at the project level.

Externalizing this logic ensures the system remains scalable and adaptable. Pipeline owners can refine behavior without touching source code, reducing technical debt while maintaining production flexibility.
`,
          bullets: [
            "Extended Unreal Project Settings with custom importer configuration panels.",
            "Defined slot-to-parent resolution rules and asset path expectations.",
            "Centralized variant handling behavior and validation constraints.",
            "Removed hardcoded logic, improving scalability and maintainability."
          ],
          gifSrc: "projects/projectsettingsimporter.png"
        }
      ]
    }
  },

  {
  slug: "armor-pipeline-and-naming",
  title: "Armor Pipeline & Naming Conventions",
  tag: "Pipeline Ownership",
  thumbnail: "projects/AssetNamingConventions.png",
  short:
    "Owned the end-to-end armor pipeline and naming conventions, aligning multiple teams on standards that scale—then drove approval through leads and executive stakeholders.",
  stack: ["Unreal Engine 5", "Pipeline Design", "Naming Standards", "Cross-team Alignment", "Documentation"],
  links: { demo: "", repo: "", writeup: "" },

  caseStudy: {
    overview: `
I owned the definition, documentation, and adoption of the armor pipeline and naming conventions—ensuring the workflow was understandable for content creators, enforceable by tools, and scalable across large character sets. This included aligning requirements across multiple teams and driving the final standard through lead and executive approval.
    `.trim(),

    problem: [
      "Without a single agreed-upon pipeline, content production risks drift: inconsistent folder structures, mismatched naming, and ambiguous ownership of steps.",
      "Inconsistent conventions increase tool complexity, reduce validation reliability, and create downstream bugs that are expensive to diagnose.",
      "Large character libraries require standards that scale across asset types, variants, and long-term production changes."
    ],

    solution: [
      "Designed a clear end-to-end armor pipeline that defines responsibilities, review points, and required validations across teams.",
      "Established naming and folder conventions that map cleanly to tool automation and data validation, reducing ambiguity and enabling enforcement.",
      "Drove alignment and approval across discipline leads and executive stakeholders to ensure adoption and long-term consistency."
    ],

    impact: [
      "Improved consistency and predictability across armor content production, reducing rework and correctness drift.",
      "Enabled stronger automation and validation by standardizing the inputs tools depend on (paths, naming, and structure).",
      "Created a shared reference that accelerates onboarding and keeps cross-team collaboration smoother during high-volume production."
    ],

    // If your detail page shows media at the bottom, this will do exactly what you want.
    media: [
      "projects/ArmorPipe1.png",
      "projects/ArmorPipe2.png",
      "projects/AssetNamingConventions.png"
    ],

    sections: [
      {
        eyebrow: "Pipeline Owner",
        title: "A scalable standard for high-volume armor production",
        text: `
This work formalized how armor moves from request → creation → import → validation → approval, and it codified the naming and folder structure needed to keep a large character library stable over time. I owned the effort end-to-end: gathering requirements, resolving cross-team constraints, documenting the final standard, and driving it through reviews with discipline leads and executive stakeholders.

The result is a pipeline that is easier to follow, easier to validate, and easier to automate—reducing ambiguity for artists while enabling tools to reliably enforce correctness.
        `.trim(),
        bullets: [
          "Defined the end-to-end pipeline flow and the review/validation gates.",
          "Standardized naming + folder structure to support automation and drift prevention.",
          "Owned cross-team alignment and approvals to ensure adoption."
        ],
        // No inline gif for this section — the images live in the bottom media gallery.
        gifSrc: ""
      }
    ]
  }
},

  {
    slug: "",
    title: "",
    tag: "",
    thumbnail: "projects/Importer.png",
    short: "",
    stack: ["Unreal Engine 5", "EUW", "C++", "Data Validation"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:`
        
        `,
      problem: [
        ""
      ],

      solution: [
        ""
      ],

      impact: [
        ""
      ],
      media: [],
      sections: [
        {
          eyebrow: "Trusty Importer",
          title: "Every project needs one!",
          text: `
            
            `,
          bullets: [
            ""
          ],
          gifSrc: "projects/Importer.png"
        },
        {
          eyebrow: "",
          title: "",
          text: `

          `,
          bullets: [
            ""
          ],
          gifSrc: "projects/projectsettingsimporter.png"
        }
      ]
    }
  },

  {
    slug: "",
    title: "",
    tag: "",
    thumbnail: "projects/Importer.png",
    short: "",
    stack: ["Unreal Engine 5", "EUW", "C++", "Data Validation"],
    links: { demo: "", repo: "", writeup: "" },
    caseStudy: {
      overview:`
        
        `,
      problem: [
        ""
      ],

      solution: [
        ""
      ],

      impact: [
        ""
      ],
      media: [],
      sections: [
        {
          eyebrow: "Trusty Importer",
          title: "Every project needs one!",
          text: `
            
            `,
          bullets: [
            ""
          ],
          gifSrc: "projects/Importer.png"
        },
        {
          eyebrow: "",
          title: "",
          text: `

          `,
          bullets: [
            ""
          ],
          gifSrc: "projects/projectsettingsimporter.png"
        }
      ]
    }
  }
];