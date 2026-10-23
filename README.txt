ALLEYCAT 3D — SCENERY & WEATHER UPDATE

This build keeps the Building & Bike Edition and refines the scenery.

SCENERY
- Distinct sunrise, day, sunset, blue hour and night palettes.
- The procedural city streams a 7x7 chunk neighborhood around the rider, expanding the loaded map to roughly 700x700 world units while preserving infinite travel.
- Sunset now has an amber/orange horizon, warm red middle sky, purple upper sky, visible sun disc and warm building reflections.
- Fog is reduced during sunset so the city does not look like a storm is arriving.
- Street lamps turn on gradually during sunset and blue hour.
- Building glass/windows follow the current sky and time of day.

WEATHER
- CLEAR: bright, saturated sky and normal road roughness.
- OVERCAST: cooler grey sky, softer sunlight and thicker haze.
- RAIN: rain particles, wet/reflective roads and cooler atmospheric lighting.
- Press M during gameplay to cycle CLEAR -> OVERCAST -> RAIN.

BICYCLES & ORDERS
- Tsunami SNM100 and Gray F15 are purchasable bicycle models in the Courier Shop.
- Their local reference images are shown on their product cards and their geometry/stats are applied when equipped.
- Titanium Ghost is an original procedural model and does not use a reference image.
- Ride to the gold ring to pick up an order, then deliver it at the green ring within 45 seconds for a bonus payout.
- Expired orders reset to the next pickup without ending the ride.

SHOP & PAUSE
- New rides begin with 700 coins so any single bicycle or jewelry item can be tested immediately.
- The pause button, ESC, and P pause the ride and stop the order timer. Resume or restart from the pause menu.

CAMERA
- Hold C and move the mouse to orbit around the rider.
- Use the mouse wheel while holding C to zoom the free camera between close and wide views.
- Release C to return to the smooth chase camera.

FILES
- index.html: page/game markup and Three.js CDN include.
- style.css: UI, environment/weather HUD styling.
- game.js: Three.js scene, day/night, weather, rain, gameplay.

Run index.html in a modern browser. Three.js is still loaded from the CDN, so internet access is required unless you host the library locally.
