export const projects = [
  {
    slug: "character-pipeline-tooling",
    title: "Character Lookdev Tool",
    tag: "Tools + Pipeline",
    thumbnail: "projects/DioramaOnly.png",
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
    slug: "pcg-workflow",
    title: "World-Building / PCG Workflow",
    tag: "PCG + UX",
    thumbnail: "projects/pcg-workflow.jpg",
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
      media: [{ type: "image", src: "projects/pcg-workflow.jpg", caption: "PCG layout + debugging overview." }],
      sections: [
        {
          eyebrow: "Workflow",
          title: "Batch validation with safe previews",
          text: "Artists can see what will change before the operation runs. Logs are generated per batch for auditing.",
          bullets: ["Preview-first UX", "Clear failure reasons", "Per-asset actions"],
          gifSrc: "projects/gifs/validation-preview.gif",
          caption: "Preview mode with validation results and fix actions."
        },
        {
          eyebrow: "UX",
          title: "One-click setup for new assets",
          text: "Automates repetitive steps and enforces naming and folder rules without blocking iteration.",
          bullets: ["Defaults that match production", "Fast iteration", "Guardrails not gates"],
          gifSrc: "projects/gifs/one-click-setup.gif"
        }
      ]
    }
  }
];