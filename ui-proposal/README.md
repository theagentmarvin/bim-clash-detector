# BIM Clash Detection UI Proposal

Generated with Stitch (Google) using the "Blueprint Precision" design system.

## Project Details
- **Stitch Project ID:** `8877386078220652037`
- **Share Link:** https://stitch.google.com/projects/8877386078220652037
- **Design System:** Blueprint Precision (Inter font, white background, blue accent #0052CC, soft shadows, rounded corners)
- **Screens:** 6 mobile-optimized artboards (812x1768 or 780x1768)

## Screens

### 1. Home/Model Loader (`screen1/`)
- **Title:** Home/Model Loader
- **Description:** Full-screen 3D viewer with two Load Model buttons (Structure/MEP) and ruleset chips at top.
- **Dimensions:** 780 x 1768
- **Files:** screenshot.png, screen.html

### 2. Ruleset Manager (`screen2/`)
- **Title:** Ruleset Manager
- **Description:** Grid of ruleset cards with name, rule count, clash count, and action buttons (New, Edit, Duplicate, Delete). Floating action button for "New Ruleset".
- **Dimensions:** 780 x 3616 (taller due to card list)
- **Files:** screenshot.png, screen.html

### 3. Rule Editor Modal (`screen3/`)
- **Title:** Rule Editor Modal
- **Description:** Modal overlay with fields: Name, Clash Type (HARD/SOFT/CLEARANCE), Tolerance, Group A/B IFC type chip selectors. Buttons: Save, Cancel.
- **Dimensions:** 780 x 1768
- **Files:** screenshot.png, screen.html

### 4. Clash Results Sheet (`screen4/`)
- **Title:** Clash Results Sheet
- **Description:** Bottom sheet (60% height) with clash count header, filter chips (All, Hard, Soft, Clearance), list of clash cards with icons.
- **Dimensions:** 780 x 1768
- **Files:** screenshot.png, screen.html

### 5. Clash Detail Panel (`screen5/`)
- **Title:** Clash Detail Panel
- **Description:** Right side panel (≈400px width) showing element A/B info, volume/gap measurement, clash type icon, actions: View, Resolve, Ignore, Export.
- **Dimensions:** 780 x 1768
- **Files:** screenshot.png, screen.html

### 6. 3D Clash Viewer (`screen6/`)
- **Title:** 3D Clash Viewer
- **Description:** Full-screen 3D viewer with clash highlights (red/yellow), orbit controls, grid floor, axes, top toolbar (visibility, section box, explode view, screenshot), floating navigation buttons.
- **Dimensions:** 812 x 1768
- **Files:** screenshot.png, screen.html

## Design System
The screens use a consistent **Blueprint Precision** design system:
- **Background:** white (#FFFFFF)
- **Typography:** Inter font family
- **Accent color:** blue (#0052CC)
- **Shadows:** soft, subtle (`box-shadow: 0 2px 8px rgba(0,0,0,0.08)`)
- **Rounded corners:** 8–12px
- **Spacing:** generous whitespace
- **Components:** card‑based with subtle borders, no‑line rule, tonal stacking for depth

## Next Steps
1. Review screens in Stitch (share link above) for further edits.
2. Use the exported HTML/CSS as a starting point for implementation.
3. Adapt to desktop/responsive layouts as needed.
4. Integrate with That Open Engine (TOE) for 3D viewer and BIM data.

All assets are saved locally in this directory.