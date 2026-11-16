# Crimlawn-night assets

Every room plate is derived from the same photographic room: `source/room_master.png`. The build script composites lighting, the masked open-door patch and transparent Beckton Tyne cutouts over that one master, so no room state redraws the geometry.

## Room state matrix

`rooms/` contains 48 JPGs:

- door: `closed`, `open`
- light: `unlit`, `dying`, `weak`, `lit`
- anomaly: `clear`, `tyne_far`, `tyne_mid`, `tyne_near`, `tyne_left`, `tyne_reach`

Filename: `room_{door}_{light}_{anomaly}.jpg`.

The game normally uses `room_closed_unlit_clear.jpg` while the arm is down so anomalies are only readable in phone light. `dying`, `weak` and `lit` represent the finite battery's light output.

## Standalone plates

- `arm_phone_off.png` / `arm_phone_on.png`: transparent full-stage arm PNGs; screen points away from the player.
- `phone_light_reflection.png` / `phone_light_mask.png`: separate reflected-light and luminance-mask PNGs.
- `phone_light_on_room.jpg`: a standalone lit-room reference plate.
- `door_open_patch.png` / `door_open_mask.png`: masked door anomaly.
- `beckton_tyne_standing.png`, `beckton_tyne_reaching.png`, `beckton_tyne_close.png`: transparent source cutouts.
- `beckton_tyne_distant.png`, `beckton_tyne_at_door.png`, `beckton_tyne_leaning.png`, `beckton_tyne_closer.png`, `beckton_tyne_too_close.png`: additional generated Beckton Tyne variants.
- `room_master_clean.jpg` / `room_master_open.jpg`: clean closed/open master references.
- `states.json`: exact filename map for all 48 combinations.

## Source plates

`source/` holds the generated photographic plates used by `tools/build_assets.py`: the master room, its open-door edit, the off/on green-screen arm, the phone beam, and three Beckton Tyne poses.
