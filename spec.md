# Skunk Runner

## Current State
A canvas-based 2D side-scrolling game in `CannabisRunner.tsx`. Features: cannabis leaf player with Mickey Mouse gloves, bloodshot eyes, legs/arms; aerosol can and policeman enemies; plant pot gardeners; collectibles (sun/water); moving platforms; HUD with score/lives/spliffs/kills; sound effects; mobile touch controls with left arrow on left, JUMP+right arrow on right, pause in middle-right area. No main menu or settings screen.

The cannabis leaf player is drawn as radiating lobes with serrated edges (drawCannabisLeafShape), centred at `leafCY = top + 19`, radius 30. The leaf has a visible stem/trunk segment below the lobes. Background clouds are simple pixel rectangles.

## Requested Changes (Diff)

### Add
- **Main Menu screen** before gameplay: show game title, high score, START button, SETTINGS button, and animated character preview
- **Settings screen** (accessible from main menu): 
  - Control layout selector (3 variants: Default, Left-Handed, Central)
  - Button size selector (Normal, Large, XL)
  - Sound toggle (On/Off)
- **Cannabis leaf-shaped background clouds**: drawn using a miniature version of the cannabis leaf shape function, floating slowly in background at ~15% parallax, semi-transparent (globalAlpha ~0.35), 3-6 clouds visible at a time
- **Weed leaf clouds use same lobe shape as player** — multi-lobe radiating fingered leaf silhouette, not rectangle clouds

### Modify
- **Player cannabis leaf character**: 
  - Redraw to match reference photo: 7 radiating serrated finger-lobes, correct proportions where bottom lobes nearly reach the boot/leg area, NO visible trunk/stem below the leaf body — the leaf connects directly down to legs
  - Make lobes denser, fuller, more realistic silhouette matching a real cannabis leaf
  - Slightly larger overall (increase radius from 30 to 34)
  - Bottom lobes should extend down close to `top + height - 14` (near the boots)
- **Shears on gardener enemy**: increase shear X size (currently drawn as two crossing lines from gx±8 to gx±18) — make crosses ~30% wider/longer
- **Controls layout** (default): 
  - Jump button stays on LEFT side (move from right group to left), LEFT arrow also on left
  - RIGHT arrow stays right
  - Pause button moves to top-right OVERLAY on canvas (not in bottom bar), styled as small ⏸ icon button
  - Arrow buttons doubled in size (minWidth: 72, fontSize: 22, padding: 10px 14px)
  - Jump button doubled in size as well
- **Settings-defined layout respected at runtime**: if user picks Left-Handed in settings, left/right arrows swap sides; if Central, all 3 buttons centred in a row
- **Sound**: respect sound toggle from settings (pass soundEnabled flag; if false, skip all audio calls)

### Remove
- Rectangle-based background clouds (replace with leaf-shaped clouds)
- Inline pause button from bottom control bar

## Implementation Plan
1. Add `Settings` state type and `useState` for `{ layout: 'default'|'left'|'center', btnSize: 'normal'|'large'|'xl', soundEnabled: boolean }`
2. Add `gamePhase` state: `'menu' | 'settings' | 'playing' | 'paused' | 'gameover'`
3. Implement `drawMainMenu()` — full canvas draw with title, character preview, START/SETTINGS prompt
4. Implement `drawSettingsScreen()` as React overlay (not canvas) with 3 option groups and BACK button
5. Replace `drawBackground` rectangle clouds with `drawLeafCloud(ctx, cx, cy, r, worldOffset)` that calls a simplified version of `drawCannabisLeafShape` with `globalAlpha = 0.35` and `GB.light` fill
6. Modify `drawCannabisLeafShape` lobes array: adjust angles and lengths so bottom lobes reach down close to the base, no stem rect drawn below — or extend the lobe angles to cover the lower area fully
7. Increase leaf radius in `drawPlayer` from 30 → 34, adjust `leafCY` so bottom lobes are near boots
8. Make gardener shears crosses 30% longer (extend endpoint coordinates)
9. Move pause button out of bottom bar into a small absolute-positioned button overlay at top-right of the canvas container
10. Restructure bottom control bar per settings layout state:
    - Default: `[JUMP] [←] ... score ... [→]` 
    - Left-Handed: `[←] [JUMP] ... score ... [→]`
    - Central: `[←] [JUMP] [→]` centred
    - Button sizes from settings state
11. Wire sound toggle: pass `settings.soundEnabled` into sound event handler; skip playback when false
12. Apply `data-ocid` markers to all new interactive elements (settings buttons, menu buttons, layout toggles, size toggles, sound switch)
