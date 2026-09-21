# Pages — candidate context sets

For each key view: the functions/sections it depends on, as a tree with file:line-range
references. `index.html` = `app/index.html`, `shared.js` = `app/shared.js`. Shared by every
page: `h/toast/run` (shared.js:18-56), `render/paintPage` (index.html:3684-3950), `state`
(index.html:1022-1096), `closeForms/FORM_KEYS` (index.html:3085-3113), name helpers
(shared.js:1267-1483), icon helpers (shared.js:1486-1573), theme/mode (shared.js:526-565).

## Command definition page (`state.view === 'slice'`, tab `definition`)

- paintPage command branch — header, icon picker, advisory banner, tabs, steps (index.html:3863-3950)
  - sliceOf / allSlices — the slice derivation (shared.js:768-794)
  - named / qrow / reveal / removeButton / adderSlot / propertyAdder (index.html:2238-2532, 2840-2843)
  - renameDefinitionForm (index.html:2819-2839)
  - advisoryBanner (index.html:1976-1984) ← modelAdvisories (model.js)
  - scenarioTabs (index.html:8897-8914)
  - wizard: WIZARD_STEPS / advanceWizard / wizardBar (index.html:3548-3661)
  - stepTrigger — command inputs (index.html:3969-4023)
    - memberEditor (index.html:2610-2650), enumMemberChips (index.html:5480-5536)
  - stepReads — bindings/rounds (index.html:4313-4519)
    - readCard (index.html:4073-4158), bindingEditor (index.html:4159-4292)
    - roundLabel (4293), queryPopover / dcbQueryWords (index.html:4031-4072)
    - operandPicker / choicesOfType / operandChoicesAbove (index.html:2703-2805)
  - stepRules (index.html:4521-4589)
    - ruleEditor (index.html:4590-4780), ruleSentence (shared.js:1418-1428)
  - stepEmits — published events (index.html:4842-4929)
    - emissionGuardRows — `when:` guards, '+ only while' (index.html:4781-4841)
    - eventFields — field↔value wiring (index.html:4998-5097)
    - warnScripted (4936), copyCommandPropertiesIntoEvent (5340-5367)
  - stepChanges — what events change (index.html:5099-5150)
    - changeAdder (index.html:5150-5340), effectParts (shared.js:1429-1446)
  - stepConsistency — derived DCB (Advanced) (index.html:8091-8188)
  - opRef / paintLit / sourceKey — cross-references (index.html:2254-2294)
  - patch (index.html:2806-2811) / patchSlice (index.html:2812)
  - flowStops / navFlow / focusFlowStopNear (index.html:2544-2584)

## Command page, Scenarios tab (`state.tab === 'scenarios'`)

- scenarioPanel (index.html:8856-8896)
  - SCENARIO_KINDS shared machinery (index.html:8239-8340)
  - scenarioRow (index.html:8643-8718) → outcomeCard (8579-8600), STATUS_WORDS (8295)
  - scenarioDropTarget (8620-8641), scenarioFooter (8724-8747)
  - scenarioEditor (8763-8826), saveScenario (8827), payloadEditor/valueEditor (8443-8554)
  - coverageGapsCard (8838-8855), uncoveredRules/happyPathUntested (8340-8362)
  - runScenario (evaluate.js), fillGivenOptionals (index.html:8196-8238)

## Entity page (`state.view === 'entity'`)

- renderEntity (index.html:5626-5713)
  - identityBlock — the green `.ident` card (index.html:5714-5745)
  - iconPicker / iconForm (index.html:6116-6157), renameDefinitionForm (2819)
  - advisoryBanner (1976), entityPropertyAdder (5610-5625) → newPropertyForm (5429-5479)
  - projectionLedger — the `.ledger` table (index.html:5746-5781)
    - projectionLedgerRow (5782-5827), partitionCells (5763), toggleProjectionRow (5828)
    - projectionDetail — opened row, Definition/Checks tabs (5843-5927)
      - projectionFields (6860-7190), scriptArgumentRows (7190), tagFilterRows (7226),
        projectionDcbPreview (7258-7300), projectionDetailFoot (5998-6033)
      - scripted editor: scriptCodeEditor & Monaco loader (shared.js:265-525),
        scriptHandlerPreamble synthesis (shared.js:103-263)
      - projection scenarios: projectionScenarioList (9214), projectionScenarioRow (8976),
        projectionScenarioEditor (9138) — section C2 (index.html:8941-9258)
    - autoSaveProjectionDraft (5962-5997), projectionChecks (6034)
  - removeEntityProperty (6050), renamePropertyField (6077)
  - propertyUsage (shared.js:1212-1240), boundAs (shared.js:740-754)

## Events page (`state.view === 'events'`)

- renderEvents (index.html:7396-7450)
  - advisoryBanner kind-wide (1976)
  - eventCard (index.html:7451-7539)
    - eventFieldsEditor (8040-8090), eventIconPicker (6158-6170)
    - publishersOf / effectsOf / projectionsHandling / scenariosReferencingEvent
      (shared.js:690-767)
    - qrow / reveal / removeButton, commandRef/entityRef/projectionRef (2861-2916)
  - new-event inline card (7414-7439)

## Sandbox (`state.view === 'sandbox'`)

- Section D (index.html:9259-10007)
- renderSandbox (index.html:9839-10007)
  - session object + sessionReset/sessionRun/sessionDrive (9282-9375)
  - sandboxDriver — the "Do something" command form (9413-9455)
    - payloadEditor / valueEditor / sandboxWhere (8443-8572)
  - sandboxTimeline — `.escrub` icon scrubber (9462-9534), scrubToPointer (9456)
  - sandboxDecision — what the command read (9535-9589)
  - sandboxNow — instance state cards (9784-9838)
    - sessionInstances / sessionInstanceState (9376-9412), instanceStateCard (9673)
  - sandboxWatched / watchCard / projectionWatchCard / watchProjectionAdder (9590-9764)
  - outcomeCard (8579-8600), evaluate.js `evaluateCommand` / projection folds
  - step() layout reused (3962-3967)

## Problems modal (`state.problems`)

- problemsPanel (index.html:1997-2019)
  - problems — aggregation, memoized (1936-1970)
    - looseEnds (1886-1924) ← orphans/propertyUsage (shared.js:1196-1240)
    - modelAdvisories (model.js), scenarioTrouble (index.html:8363-8396)
  - problemsButton + `.badge` (1988-1995), advisoryBanner sibling (1976-1984)
  - overlayAround (1583-1588), renderModals dispatch (1535-1550)
  - navigation targets: goToEvent/goToCommand/goToProjection/goToScenario (2877-2967)

## Other overlays (smaller)

- Settings: renderSettingsModal (1552-1578) + UI_SETTINGS (1401), settingsButton (1446-1459)
- Import/Export: renderImportExportModal (1623-1763), exportEnvelope (1485),
  beginImport/finishImport (1103-1161), decodeShareLink (shared.js:649-680)
- Models modal + splash: modelsModal (1186-1310), renderSplash (1318-1445),
  PREDEFINED_MODELS (model.js)
- Quick open: openPalette/renderPalette/paletteEntries/fuzzyScore (2031-2200)
- Import gate: renderImportGate (1594-1616), envelopeHasScript (model.js)
