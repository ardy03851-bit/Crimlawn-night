# Crimlawn-night

A serious, iPad-first, browser horror game about one bedroom, one door, one phone and one night. The game contains only the requested mechanics.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

On iPad, landscape fills the screen; portrait keeps the same 4:3 room with black letterboxing. The page disables scrolling, selection, pinch gestures and double-tap zoom.

- **Drag the hand upward** from the lower-right toward the door, then release.
- Keep it raised. After exactly one second, the phone light appears as a static lit room plate.
- If there is no anomaly, drag the hand back down and let the hour pass.
- If **BECKTON TYNE** or **the open door** is visible, press and hold the lit door area until it is gone.
- If the phone stays down for twelve seconds, the hour passes. An anomaly left unobserved ends the night.

The only animated object is the arm while the player moves or settles it. The room, light, creature, HUD and ending plates change instantly; there are no idle animations, flickers, audio, menus, levels or extra content.

## Battery

The phone starts at **60%** — one full night's charge, with no recharge and no way to use the light constantly.

- Raising the phone costs **5%**.
- Removing an anomaly costs **3%**.
- There are ten fixed hours and five scheduled anomalies.

Checking every hour and removing every anomaly would cost `10 × 5% + 5 × 3% = 65%`, five points more than the charge. One safe hour must be left unobserved, reaching dawn at **0%** if nothing else is wasted. A wasted re-check can leave less than the **3%** needed to remove Beckton Tyne, or too little charge to raise the phone at all.

The two anomalies are:

1. **Beckton Tyne** — a low-quality realistic figure with an unnervingly clean, flat, vector-like head that does not quite belong to the photographic room.
2. **The open door** — the same door, revealing an unlit hall.

## Assets

All room images are deterministic composites of `assets/source/room_master.png`; the walls, bed, carpet, baseboard and door frame are therefore the same room in every state. The open door is composited only as a masked patch.

- `assets/rooms/` — 48 room states: `2 door states × 4 light states × 6 anomaly states`.
- `assets/arm_phone_off.png` and `assets/arm_phone_on.png` — transparent arm-and-phone PNGs, with the screen rotated away from the player's face.
- `assets/phone_light_reflection.png` and `assets/phone_light_mask.png` — the separate phone-light reflection/luminance plates.
- `assets/door_open_patch.png` — the door-state patch.
- `assets/beckton_tyne_*.png` — transparent Beckton Tyne cutouts and generated variants.
- `assets/states.json` — the room-state filename manifest.
- `assets/source/` — the generated master plates.

Room filenames follow `room_{closed|open}_{unlit|dying|weak|lit}_{clear|tyne_far|tyne_mid|tyne_near|tyne_left|tyne_reach}.jpg`.

To regenerate every derived asset after changing a source plate:

```sh
python3 -m venv .venv
.venv/bin/pip install Pillow
.venv/bin/python tools/build_assets.py
```
