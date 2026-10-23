// --- 1. ENGINE & GRAPHICS SETUP ---
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x92cceb);
    scene.fog = new THREE.FogExp2(0x92cceb, 0.0075);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 800);
    let freeCamera = false;
    let freeCameraYaw = 0;
    let freeCameraPitch = 0.12;
    let freeCameraDistance = 6.2;
    let lastPointerX = null;
    let lastPointerY = null;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping + sRGB output make the standard/physical materials below read
    // as properly lit surfaces instead of flat, washed-out color swatches.
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x556070, 0.85);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xfff7e8, 0.95);
    sun.position.set(100, 160, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    const shadowD = 85;
    sun.shadow.camera.left = -shadowD;
    sun.shadow.camera.right = shadowD;
    sun.shadow.camera.top = shadowD;
    sun.shadow.camera.bottom = -shadowD;
    scene.add(sun);

    // Cool fill light from the opposite side of the sun — softens shadow-side surfaces
    // instead of leaving them flat black, which reads as much more natural / realistic.
    const fillLight = new THREE.DirectionalLight(0x9fc3ff, 0.28);
    fillLight.position.set(-90, 60, -70);
    scene.add(fillLight);

    // --- Gradient Sky Dome (replaces the flat background color with a real horizon) ---
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x4a90d9) },
        bottomColor: { value: new THREE.Color(0xcfe9f7) },
        midColor: { value: new THREE.Color(0x77b9e8) },
        offset: { value: 20 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform vec3 midColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          float t = clamp((h + 0.05) / 1.05, 0.0, 1.0);
          vec3 lower = mix(bottomColor, midColor, smoothstep(0.0, 0.56, t));
          vec3 upper = mix(midColor, topColor, smoothstep(0.42, 1.0, t));
          gl_FragColor = vec4(mix(lower, upper, smoothstep(0.40, 0.72, t)), 1.0);
        }
      `,
      side: THREE.BackSide,
      fog: false
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), skyMat);
    scene.add(skyDome);

    // Visible sun disc and warm horizon bloom keep sunset clearly orange/amber.
    const sunDiscMat = new THREE.SpriteMaterial({ color: 0xffb45b, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
    const sunDisc = new THREE.Sprite(sunDiscMat);
    sunDisc.scale.set(18, 18, 1);
    scene.add(sunDisc);

    const horizonGlowMat = new THREE.SpriteMaterial({ color: 0xff8b3d, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const horizonGlow = new THREE.Sprite(horizonGlowMat);
    horizonGlow.scale.set(95, 38, 1);
    scene.add(horizonGlow);

    // Lightweight rain system: one Points object instead of hundreds of meshes.
    const rainCount = 520;
    const rainPositions = new Float32Array(rainCount * 3);
    const rainVelocities = new Float32Array(rainCount);
    const rainGeo = new THREE.BufferGeometry();
    const rainMat = new THREE.PointsMaterial({ color: 0xbfe7ff, size: 0.16, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const rain = new THREE.Points(rainGeo, rainMat);
    rain.visible = false;
    scene.add(rain);
    function resetRainParticle(i, px, pz, randomY = true) {
      const j = i * 3;
      rainPositions[j] = px + (Math.random() - 0.5) * 95;
      rainPositions[j + 1] = randomY ? 8 + Math.random() * 45 : 45 + Math.random() * 10;
      rainPositions[j + 2] = pz + (Math.random() - 0.5) * 95;
      rainVelocities[i] = 20 + Math.random() * 14;
    }
    for (let i = 0; i < rainCount; i++) resetRainParticle(i, 0, 0);
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    rainGeo.attributes.position.needsUpdate = true;


    // --- Drifting Clouds (new atmospheric layer, tinted by the day/night cycle below) ---
    function makeCloudTexture() {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const grd = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(canvas);
    }
    const cloudTexture = makeCloudTexture();
    const clouds = [];
    function initCloud(x, z) {
      const mat = new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: 0.85, depthWrite: false, fog: false, color: 0xffffff });
      const sprite = new THREE.Sprite(mat);
      const scale = 45 + Math.random() * 55;
      sprite.scale.set(scale * (1.3 + Math.random() * 0.7), scale * 0.55, 1);
      sprite.position.set(x, 95 + Math.random() * 45, z);
      sprite.userData.drift = 0.4 + Math.random() * 0.7;
      scene.add(sprite);
      clouds.push(sprite);
    }
    for (let i = 0; i < 20; i++) {
      initCloud((Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600);
    }
    function updateClouds(delta) {
      const px = playerRoot.position.x, pz = playerRoot.position.z;
      clouds.forEach(c => {
        c.position.x += c.userData.drift * delta;
        // Recycle clouds that drift too far behind/away from the player back out ahead,
        // the same streaming trick used for traffic and pedestrians below.
        if (c.position.distanceTo(new THREE.Vector3(px, c.position.y, pz)) > 420) {
          c.position.set(px - 380 + Math.random() * 80, 95 + Math.random() * 45, pz + (Math.random() - 0.5) * 500);
        }
      });
    }


    function updateRain(delta) {
      if (!rain.visible || !playerRoot) return;
      const px = playerRoot.position.x, pz = playerRoot.position.z;
      for (let i = 0; i < rainCount; i++) {
        const j = i * 3;
        rainPositions[j + 1] -= rainVelocities[i] * delta;
        rainPositions[j] += 2.2 * delta;
        if (rainPositions[j + 1] < 0.5 || Math.abs(rainPositions[j] - px) > 55 || Math.abs(rainPositions[j + 2] - pz) > 55) {
          resetRainParticle(i, px, pz, false);
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    function applySurfaceWeather(weather) {
      if (weather === 'RAIN') {
        mats.road.roughness = 0.28; mats.road.metalness = 0.22;
        mats.sidewalk.roughness = 0.55; mats.curb.roughness = 0.58;
      } else if (weather === 'OVERCAST') {
        mats.road.roughness = 0.72; mats.road.metalness = 0.10;
        mats.sidewalk.roughness = 0.86; mats.curb.roughness = 0.82;
      } else {
        mats.road.roughness = 0.92; mats.road.metalness = 0.05;
        mats.sidewalk.roughness = 0.95; mats.curb.roughness = 0.90;
      }
    }

    // --- 2. MATERIALS PALETTE ---
    // Standard/Physical materials (roughness + metalness) replace the old flat Lambert
    // set wherever it actually reads as a real-world surface — asphalt, chrome, paint,
    // glass, skin. Lambert is kept only for cheap, purely-diffuse cosmetic bits.
    const mats = {
      road: new THREE.MeshStandardMaterial({ color: 0x25292f, roughness: 0.92, metalness: 0.05 }),
      sidewalk: new THREE.MeshStandardMaterial({ color: 0xd4d9e2, roughness: 0.95, metalness: 0 }),
      curb: new THREE.MeshStandardMaterial({ color: 0xa0aab8, roughness: 0.9, metalness: 0 }),
      laneWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      laneYellow: new THREE.MeshBasicMaterial({ color: 0xffb703 }),
      bikeFrame: new THREE.MeshStandardMaterial({ color: 0x06d6a0, roughness: 0.35, metalness: 0.55 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd7dce3, roughness: 0.15, metalness: 0.95 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.95, metalness: 0 }),
      spokes: new THREE.MeshBasicMaterial({ color: 0x999999, wireframe: true }),
      shirt: new THREE.MeshStandardMaterial({ color: 0xef476f, roughness: 0.75, metalness: 0 }),
      pants: new THREE.MeshStandardMaterial({ color: 0x118ab2, roughness: 0.8, metalness: 0 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.7, metalness: 0 }),
      helmet: new THREE.MeshStandardMaterial({ color: 0x073b4c, roughness: 0.3, metalness: 0.1 }),
      bag: new THREE.MeshStandardMaterial({ color: 0xf77f00, roughness: 0.85, metalness: 0 }),
      carColors: [
        new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.3, metalness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.3, metalness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.3, metalness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.3, metalness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0x0077b6, roughness: 0.3, metalness: 0.65 }),
        new THREE.MeshStandardMaterial({ color: 0x38b000, roughness: 0.3, metalness: 0.65 })
      ],
      carGlass: new THREE.MeshStandardMaterial({ color: 0x111c24, roughness: 0.1, metalness: 0.4 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xfffee0 }),
      taillight: new THREE.MeshBasicMaterial({ color: 0xff1e1e }),
      pedShirt: [
        new THREE.MeshStandardMaterial({ color: 0x3a86ff, roughness: 0.8, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0x8338ec, roughness: 0.8, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0xff006e, roughness: 0.8, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0xfb5607, roughness: 0.8, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0x06d6a0, roughness: 0.8, metalness: 0 })
      ],
      buildingTones: [
        new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.85, metalness: 0.05 }),
        new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.85, metalness: 0.05 }),
        new THREE.MeshStandardMaterial({ color: 0xdee2e6, roughness: 0.85, metalness: 0.05 }),
        new THREE.MeshStandardMaterial({ color: 0xced4da, roughness: 0.85, metalness: 0.05 }),
        new THREE.MeshStandardMaterial({ color: 0xadb5bd, roughness: 0.85, metalness: 0.05 }),
        new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.85, metalness: 0.05 })
      ],
      lampPost: new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.5, metalness: 0.6 }),
      lampGlow: new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
      treeFoliage: new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9, metalness: 0 }),
      treeTrunk: new THREE.MeshStandardMaterial({ color: 0x582f0e, roughness: 0.95, metalness: 0 }),
      skidSmoke: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
      bikeAccent: new THREE.MeshBasicMaterial({ color: 0x1b1b1b }),
      parkGround: new THREE.MeshStandardMaterial({ color: 0x4c9a5f, roughness: 0.95, metalness: 0 }),
      water: new THREE.MeshStandardMaterial({ color: 0x2a6f97, roughness: 0.15, metalness: 0.3 }),
      stallAwning: [
        new THREE.MeshStandardMaterial({ color: 0xef476f, roughness: 0.85, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.85, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0x06d6a0, roughness: 0.85, metalness: 0 }),
        new THREE.MeshStandardMaterial({ color: 0x118ab2, roughness: 0.85, metalness: 0 })
      ]
    };

    // Reference-driven building facades. The photos from the Building & Bike pack are
    // used as visual direction while procedural geometry keeps collision/performance intact.
    const assetLoader = new THREE.TextureLoader();
    const buildingTexture01 = assetLoader.load('gedung.jpg');
    const buildingTexture02 = assetLoader.load('gedung 2.jpg');
    [buildingTexture01, buildingTexture02].forEach(t => { t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4); });
    const buildingFacadeMats = [
      new THREE.MeshStandardMaterial({ map: buildingTexture01, color: 0xffffff, roughness: 0.42, metalness: 0.32 }),
      new THREE.MeshStandardMaterial({ map: buildingTexture02, color: 0xffffff, roughness: 0.45, metalness: 0.28 })
    ];

    function addBuildingFacades(chunk, track, bx, bz, bw, bd, bh, rand) {
      const mat = buildingFacadeMats[Math.floor(rand() * buildingFacadeMats.length)];
      const front = new THREE.Mesh(track(new THREE.PlaneGeometry(bw * .92, bh * .82)), mat);
      front.position.set(bx, bh * .5 + .35, bz + bd * .5 + .035);
      chunk.add(front);
      const back = new THREE.Mesh(track(new THREE.PlaneGeometry(bw * .92, bh * .82)), mat);
      back.rotation.y = Math.PI;
      back.position.set(bx, bh * .5 + .35, bz - bd * .5 - .035);
      chunk.add(back);
      const sideGeo = track(new THREE.PlaneGeometry(bd * .92, bh * .82));
      const left = new THREE.Mesh(sideGeo, mat); left.rotation.y = -Math.PI/2; left.position.set(bx-bw*.5-.035, bh*.5+.35, bz); chunk.add(left);
      const right = new THREE.Mesh(track(new THREE.PlaneGeometry(bd * .92, bh * .82)), mat); right.rotation.y = Math.PI/2; right.position.set(bx+bw*.5+.035, bh*.5+.35, bz); chunk.add(right);
    }

    // --- 3. PLAYER RIG (BIKE & COURIER RIDER) ---
    const playerRoot = new THREE.Group(); // Base transform in world coordinates
    const playerVisual = new THREE.Group(); // Handles fish-tailing, skid yaw, and pitch
    playerRoot.add(playerVisual);

    const bikeAssembly = new THREE.Group();
    const tireGeo = new THREE.TorusGeometry(0.38, 0.045, 10, 32);
    const spokeGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.02, 8);
    spokeGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10);
    hubGeo.rotateZ(Math.PI / 2);

    function createWheel(spokeMat = mats.spokes, hubMat = mats.bikeAccent) {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, mats.rubber);
      tire.rotation.y = Math.PI / 2;
      tire.castShadow = true;
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      w.add(tire, spoke, hub);
      return w;
    }

    // BUGFIX: createWheel() defaulted to the shared mats.spokes / mats.bikeAccent
    // materials, which NPC cyclists' wheels also use (see buildNPCCyclist below).
    // Equipping an accessory like gold-plated rims mutated those shared material
    // objects directly, so every NPC's wheels changed color too. Give the player's
    // own wheels dedicated material instances so accessories stay player-only.
    const playerSpokeMat = mats.spokes.clone();
    const playerAccentMat = mats.bikeAccent.clone();
    const frontWheel = createWheel(playerSpokeMat, playerAccentMat);
    frontWheel.position.set(0, 0.38, -0.65);
    const backWheel = createWheel(playerSpokeMat, playerAccentMat);
    backWheel.position.set(0, 0.38, 0.65);
    bikeAssembly.add(frontWheel, backWheel);

    const bikeStyleParts = new THREE.Group();
    bikeAssembly.add(bikeStyleParts);

    function addStyleTube(group, a, b, radius, mat) {
      const v1 = new THREE.Vector3(...a), v2 = new THREE.Vector3(...b);
      const geo = new THREE.CylinderGeometry(radius, radius, v1.distanceTo(v2), 8);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(v1.clone().add(v2).multiplyScalar(.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), v2.clone().sub(v1).normalize());
      mesh.castShadow = true; group.add(mesh); return mesh;
    }

    function buildBikeStyleParts(bike) {
      while (bikeStyleParts.children.length) { const m=bikeStyleParts.children.pop(); if(m.geometry)m.geometry.dispose(); }
      const accent = new THREE.MeshStandardMaterial({ color: bike.accentColor, roughness:.25, metalness:.7 });
      // Front fork legs — visually closer to real track/road bikes.
      addStyleTube(bikeStyleParts, [0,.40,-.61], [.16,1.00,-.58], Math.max(.016,bike.tubeRadius*.65), mats.chrome);
      addStyleTube(bikeStyleParts, [0,.40,-.61], [-.16,1.00,-.58], Math.max(.016,bike.tubeRadius*.65), mats.chrome);
      // Slim seat post and stem.
      addStyleTube(bikeStyleParts, [0,.84,.20], [0,1.08,.16], .014, accent);
      // Drop-bar silhouette for the reference road/track bikes.
      if (bike.id !== 'starter') {
        const bar = new THREE.Mesh(new THREE.TorusGeometry(.17,.018,6,18,Math.PI*1.15), accent);
        bar.rotation.x = Math.PI/2; bar.rotation.z = Math.PI; bar.position.set(0,1.08,-.60); bikeStyleParts.add(bar);
      }
      // Deep-section wheel rings on premium bikes.
      if (bike.id === 'gray_f15' || bike.id === 'titanium_ghost') {
        [frontWheel,backWheel].forEach(w => {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(.355,.055,8,32), accent);
          ring.rotation.y=Math.PI/2; w.add(ring);
        });
      }
      if (bike.id === 'gray_f15') {
        addStyleTube(bikeStyleParts, [0, .38, .65], [0, .72, .34], .022, accent);
        addStyleTube(bikeStyleParts, [0, .72, .34], [0, .96, .18], .018, accent);
      }
    }

    const frameTubes = new THREE.Group();
    function addTube(x1, y1, z1, x2, y2, z2, r=0.032, mat=mats.bikeFrame) {
      const v1 = new THREE.Vector3(x1, y1, z1);
      const v2 = new THREE.Vector3(x2, y2, z2);
      const len = v1.distanceTo(v2);
      const geo = new THREE.CylinderGeometry(r, r, len, 8);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(v1.clone().add(v2).multiplyScalar(0.5));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
      mesh.castShadow = true;
      frameTubes.add(mesh);
    }

    // Tube endpoints are fixed (the frame silhouette); only the radius varies per bike,
    // so this list drives a rebuildable frame instead of one-shot addTube() calls.
    const TUBE_SPECS = [
      [0, 0.38, 0.65, 0, 0.85, 0.2],
      [0, 0.38, 0.65, 0, 0.38, 0.1],
      [0, 0.38, 0.1, 0, 0.85, 0.2],
      [0, 0.85, 0.2, 0, 0.95, -0.48],
      [0, 0.38, 0.1, 0, 0.95, -0.48],
      [0, 0.38, -0.65, 0, 1.05, -0.58]
    ];
    function buildFrameTubes(radius) {
      while (frameTubes.children.length) {
        const m = frameTubes.children.pop();
        m.geometry.dispose();
      }
      TUBE_SPECS.forEach(spec => addTube(...spec, radius, mats.bikeFrame));
    }
    buildFrameTubes(0.032); // default/starter thickness; equipBike() rebuilds this per-bike

    const barStem = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.045), mats.chrome);
    barStem.position.set(0, 1.05, -0.55);
    barStem.castShadow = true;
    bikeAssembly.add(frameTubes, barStem);

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.3), mats.rubber);
    saddle.position.set(0, 0.88, 0.2);
    bikeAssembly.add(saddle);

    const crankL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), mats.chrome);
    crankL.position.set(0.1, 0.38, 0.1);
    const crankR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), mats.chrome);
    crankR.position.set(-0.1, 0.38, 0.1);
    bikeAssembly.add(crankL, crankR);

    // Courier Rider Rig
    const riderGroup = new THREE.Group();
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.22), mats.pants);
    hips.position.set(0, 0.95, 0.18);
    hips.castShadow = true;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.2), mats.shirt);
    torso.position.set(0, 1.15, 0.0);
    torso.rotation.x = 0.55;
    torso.castShadow = true;

    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.25, 0.14), mats.bag);
    bag.position.set(0.04, 1.25, 0.15);
    bag.rotation.x = 0.55;
    bag.rotation.z = -0.15;
    bag.castShadow = true;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), mats.skin);
    head.position.set(0, 1.4, -0.2);
    head.castShadow = true;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.24), mats.helmet);
    helmet.position.set(0, 1.48, -0.2);
    helmet.castShadow = true;

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.shirt);
    leftArm.position.set(0.2, 1.15, -0.28);
    leftArm.rotation.x = -0.7;
    leftArm.rotation.z = -0.2;
    leftArm.castShadow = true;

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.shirt);
    rightArm.position.set(-0.2, 1.15, -0.28);
    rightArm.rotation.x = -0.7;
    rightArm.rotation.z = 0.2;
    rightArm.castShadow = true;

    // Hinged Pivot Legs for Fluid Pedaling
    const legLeftPivot = new THREE.Group();
    legLeftPivot.position.set(0.12, 0.92, 0.18);
    const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), mats.pants);
    legLMesh.position.set(0, -0.2, 0);
    legLMesh.castShadow = true;
    legLeftPivot.add(legLMesh);

    const legRightPivot = new THREE.Group();
    legRightPivot.position.set(-0.12, 0.92, 0.18);
    const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), mats.pants);
    legRMesh.position.set(0, -0.2, 0);
    legRMesh.castShadow = true;
    legRightPivot.add(legRMesh);

    riderGroup.add(hips, torso, bag, head, helmet, leftArm, rightArm, legLeftPivot, legRightPivot);
    playerVisual.add(bikeAssembly, riderGroup);
    scene.add(playerRoot);

    // --- 3b. SKID DUST PARTICLES (uses the previously-unused skidSmoke material) ---
    const SKID_PARTICLE_COUNT = 24;
    const skidParticleGeo = new THREE.SphereGeometry(0.14, 6, 6);
    const skidParticles = [];
    for (let i = 0; i < SKID_PARTICLE_COUNT; i++) {
      const p = new THREE.Mesh(skidParticleGeo, mats.skidSmoke.clone());
      p.visible = false;
      p.userData.life = 0;
      p.userData.maxLife = 0.55;
      scene.add(p);
      skidParticles.push(p);
    }
    let skidParticleCursor = 0;
    let skidSpawnTimer = 0;
    const _skidWorldPos = new THREE.Vector3();

    function spawnSkidDust(worldPos) {
      const p = skidParticles[skidParticleCursor];
      skidParticleCursor = (skidParticleCursor + 1) % skidParticles.length;
      p.position.set(
        worldPos.x + (Math.random() - 0.5) * 0.3,
        0.14,
        worldPos.z + (Math.random() - 0.5) * 0.3
      );
      p.scale.setScalar(0.55 + Math.random() * 0.3);
      p.material.opacity = 0.4;
      p.visible = true;
      p.userData.life = p.userData.maxLife;
    }

    function updateSkidDust(delta) {
      for (let i = 0; i < skidParticles.length; i++) {
        const p = skidParticles[i];
        if (p.userData.life <= 0) continue;
        p.userData.life -= delta;
        if (p.userData.life <= 0) { p.visible = false; continue; }
        const t = 1 - p.userData.life / p.userData.maxLife;
        p.material.opacity = 0.4 * (1 - t);
        p.scale.multiplyScalar(1 + delta * 1.4);
        p.position.y += delta * 0.3;
      }
    }

    // --- 4. PROCEDURAL CITY & BUILDING COLLIDERS ---
    const CHUNK_SIZE = 100;
    const ROAD_WIDTH = 20; // 20-unit asphalt roadway
    const BLOCK_SIZE = (CHUNK_SIZE - ROAD_WIDTH) / 2; // 40x40 city blocks
    const STREAM_RADIUS = 3; // 7x7 active chunks: 700x700 units of loaded city
    const activeChunks = new Map();
    const solidColliders = [];
    // Shared geometries: every chunk is the same footprint, so these never need to vary per-instance
    const roadGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    const lineVGeo = new THREE.PlaneGeometry(0.35, CHUNK_SIZE);
    const lineHGeo = new THREE.PlaneGeometry(CHUNK_SIZE, 0.35);
    const sidewalkGeo = new THREE.BoxGeometry(BLOCK_SIZE, 0.35, BLOCK_SIZE);

    // Deterministic per-chunk PRNG (mulberry32) so a chunk looks the same every time it's revisited
    function chunkRng(cx, cz) {
      let s = (cx * 374761393 + cz * 668265263) ^ 0x9e3779b9;
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Streetlight: post + glowing lamp head. The glow's opacity is driven by the global
    // day/night cycle (see updateDayNightCycle) so the city visibly lights up at dusk.
    const lampGlows = [];
    const lampPostGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.2, 8);
    const lampHeadGeo = new THREE.SphereGeometry(0.22, 10, 8);
    function buildLampPost(registry) {
      const group = new THREE.Group();
      const post = new THREE.Mesh(lampPostGeo, mats.lampPost);
      post.position.y = 2.1;
      post.castShadow = true;
      const glowMat = mats.lampGlow.clone();
      glowMat.transparent = true;
      glowMat.opacity = 0.15;
      const head = new THREE.Mesh(lampHeadGeo, glowMat);
      head.position.y = 4.25;
      group.add(post, head);
      lampGlows.push(glowMat);
      registry.push(glowMat); // per-chunk list so this lamp's material gets cleaned up on despawn
      return group;
    }

    // Building windows: each pane gets its own material so it can independently be a cool,
    // faintly-reflective glass rectangle by day and an emissive lit/unlit square by night —
    // previously every window everywhere shared one flat, always-bright-yellow material,
    // which read as "lit up" even at high noon. windowMats mirrors lampGlows' pattern.
    const windowMats = [];
    function makeWindowMaterial(rand) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x33465c, roughness: 0.12, metalness: 0.35,
        emissive: 0xffdca8, emissiveIntensity: 0
      });
      mat.userData.isLit = rand() < 0.6; // not every window is occupied/lit at night
      windowMats.push(mat);
      return mat;
    }

    function createCityChunk(cx, cz) {
      const rand = chunkRng(cx, cz);
      const chunk = new THREE.Group();
      const chunkBoxes = [];
      const chunkGeos = [];
      const chunkWindowMats = [];
      const track = (geo) => { chunkGeos.push(geo); return geo; };

      // Base Asphalt Road
      const road = new THREE.Mesh(roadGeo, mats.road);
      road.rotation.x = -Math.PI / 2;
      road.receiveShadow = true;
      chunk.add(road);

      // Yellow Center Lines
      const line1 = new THREE.Mesh(lineVGeo, mats.laneYellow);
      line1.rotation.x = -Math.PI / 2;
      line1.position.y = 0.02;
      const line2 = new THREE.Mesh(lineHGeo, mats.laneYellow);
      line2.rotation.x = -Math.PI / 2;
      line2.position.y = 0.02;
      chunk.add(line1, line2);

      // 4 Quadrants
      const quadOffsets = [
        { x: -CHUNK_SIZE/4 - ROAD_WIDTH/4, z: -CHUNK_SIZE/4 - ROAD_WIDTH/4 },
        { x:  CHUNK_SIZE/4 + ROAD_WIDTH/4, z: -CHUNK_SIZE/4 - ROAD_WIDTH/4 },
        { x: -CHUNK_SIZE/4 - ROAD_WIDTH/4, z:  CHUNK_SIZE/4 + ROAD_WIDTH/4 },
        { x:  CHUNK_SIZE/4 + ROAD_WIDTH/4, z:  CHUNK_SIZE/4 + ROAD_WIDTH/4 }
      ];

      quadOffsets.forEach(q => {
        // ~1 in 5 quadrants is a park instead of a building block — adds visual variety
        // to what was otherwise buildings on every single corner of every chunk.
        const isPark = rand() < 0.22;

        // Ground plane for this quadrant — grass for parks, sidewalk paving otherwise
        const sw = new THREE.Mesh(sidewalkGeo, isPark ? mats.parkGround : mats.sidewalk);
        sw.position.set(q.x, 0.17, q.z);
        sw.receiveShadow = true;
        chunk.add(sw);

        if (isPark) {
          // Park quadrant: open green space, scattered trees, a small pond, a couple
          // of benches. No colliders — it's all walkable open ground.
          const treeCount = 4 + Math.floor(rand() * 4);
          for (let t = 0; t < treeCount; t++) {
            const tx = q.x + (rand() - 0.5) * (BLOCK_SIZE - 6);
            const tz = q.z + (rand() - 0.5) * (BLOCK_SIZE - 6);
            const trunk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.2, 0.25, 2.8)), mats.treeTrunk);
            trunk.position.set(tx, 1.4, tz);
            trunk.castShadow = true;
            const foliage = new THREE.Mesh(track(new THREE.DodecahedronGeometry(1.3 + rand() * 0.6, 1)), mats.treeFoliage);
            foliage.position.set(tx, 3.4, tz);
            foliage.castShadow = true;
            chunk.add(trunk, foliage);
          }

          const pond = new THREE.Mesh(track(new THREE.CylinderGeometry(3.5 + rand() * 1.5, 3.5 + rand() * 1.5, 0.06, 16)), mats.water);
          pond.position.set(q.x, 0.2, q.z);
          chunk.add(pond);

          for (let b = 0; b < 2; b++) {
            const bench = new THREE.Mesh(track(new THREE.BoxGeometry(1.4, 0.35, 0.5)), mats.treeTrunk);
            bench.position.set(q.x + (b === 0 ? -5 : 5), 0.4, q.z + 6);
            bench.castShadow = true;
            chunk.add(bench);
          }
          return; // skip the building loop and corner-tree logic below for park quadrants
        }

        // Buildings on inner block area
        const bldRows = 2;
        const subSize = (BLOCK_SIZE - 4) / bldRows;

        for (let ix = 0; ix < bldRows; ix++) {
          for (let iz = 0; iz < bldRows; iz++) {
            const bw = subSize - 1.5;
            const bd = subSize - 1.5;
            const bh = 18 + rand() * 32;
            const bMat = mats.buildingTones[Math.floor(rand() * mats.buildingTones.length)];
            const bld = new THREE.Mesh(track(new THREE.BoxGeometry(bw, bh, bd)), bMat);

            const bx = (q.x - BLOCK_SIZE/2 + 2 + subSize/2) + ix * subSize;
            const bz = (q.z - BLOCK_SIZE/2 + 2 + subSize/2) + iz * subSize;
            bld.position.set(bx, bh / 2 + 0.35, bz);
            bld.castShadow = true;
            bld.receiveShadow = true;
            chunk.add(bld);
            addBuildingFacades(chunk, track, bx, bz, bw, bd, bh, rand);

            if (rand() > 0.3) {
              const winMat = makeWindowMaterial(rand);
              chunkWindowMats.push(winMat);
              const win = new THREE.Mesh(track(new THREE.PlaneGeometry(bw * 0.85, bh * 0.7)), winMat);
              win.position.set(bx, bh / 2 + 0.35, bz + bd / 2 + 0.05);
              chunk.add(win);
            }

            // Global Solid AABB Box
            const worldMinX = cx * CHUNK_SIZE + bx - bw/2;
            const worldMaxX = cx * CHUNK_SIZE + bx + bw/2;
            const worldMinZ = cz * CHUNK_SIZE + bz - bd/2;
            const worldMaxZ = cz * CHUNK_SIZE + bz + bd/2;

            const box = new THREE.Box3(
              new THREE.Vector3(worldMinX, 0, worldMinZ),
              new THREE.Vector3(worldMaxX, bh + 1, worldMaxZ)
            );
            chunkBoxes.push(box);
            solidColliders.push(box);
          }
        }

        // Sidewalk Corner: usually a tree, sometimes a little market stall for street life
        const cornerRoll = rand();
        const cornerX = q.x + (q.x > 0 ? -BLOCK_SIZE/2 + 1.6 : BLOCK_SIZE/2 - 1.6);
        const cornerZ = q.z + (q.z > 0 ? -BLOCK_SIZE/2 + 1.6 : BLOCK_SIZE/2 - 1.6);
        if (cornerRoll > 0.35) {
          const trunk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.2, 0.25, 2.8)), mats.treeTrunk);
          trunk.position.set(cornerX, 1.4, cornerZ);
          trunk.castShadow = true;
          const foliage = new THREE.Mesh(track(new THREE.DodecahedronGeometry(1.5, 1)), mats.treeFoliage);
          foliage.position.set(trunk.position.x, 3.5, trunk.position.z);
          foliage.castShadow = true;
          chunk.add(trunk, foliage);
        } else if (cornerRoll > 0.18) {
          const stand = new THREE.Mesh(track(new THREE.BoxGeometry(1.3, 0.9, 0.8)), mats.treeTrunk);
          stand.position.set(cornerX, 0.8, cornerZ);
          stand.castShadow = true;
          const awningMat = mats.stallAwning[Math.floor(rand() * mats.stallAwning.length)];
          const awning = new THREE.Mesh(track(new THREE.ConeGeometry(1.15, 0.55, 4)), awningMat);
          awning.rotation.y = Math.PI / 4;
          awning.position.set(cornerX, 1.7, cornerZ);
          awning.castShadow = true;
          chunk.add(stand, awning);
        }
      });

      // Streetlights along all four curbs of this chunk's intersection
      const chunkLampMats = [];
      const lampOffset = ROAD_WIDTH / 2 + 0.6;
      [
        [lampOffset, CHUNK_SIZE / 4], [lampOffset, -CHUNK_SIZE / 4],
        [-lampOffset, CHUNK_SIZE / 4], [-lampOffset, -CHUNK_SIZE / 4],
        [CHUNK_SIZE / 4, lampOffset], [-CHUNK_SIZE / 4, lampOffset],
        [CHUNK_SIZE / 4, -lampOffset], [-CHUNK_SIZE / 4, -lampOffset]
      ].forEach(([lx, lz]) => {
        const lamp = buildLampPost(chunkLampMats);
        lamp.position.set(lx, 0, lz);
        chunk.add(lamp);
      });

      chunk.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      chunk.userData = { boxes: chunkBoxes, geometries: chunkGeos, lampMats: chunkLampMats, windowMats: chunkWindowMats };
      scene.add(chunk);
      return chunk;
    }

    function updateChunks(px, pz) {
      const curX = Math.round(px / CHUNK_SIZE);
      const curZ = Math.round(pz / CHUNK_SIZE);
      const radius = STREAM_RADIUS;

      for (let x = curX - radius; x <= curX + radius; x++) {
        for (let z = curZ - radius; z <= curZ + radius; z++) {
          const key = `${x},${z}`;
          if (!activeChunks.has(key)) {
            activeChunks.set(key, createCityChunk(x, z));
          }
        }
      }

      for (const [key, chunk] of activeChunks.entries()) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.hypot(cx - curX, cz - curZ) > radius + 1) {
          chunk.userData.boxes.forEach(b => {
            const idx = solidColliders.indexOf(b);
            if (idx !== -1) solidColliders.splice(idx, 1);
          });
          chunk.userData.geometries.forEach(g => g.dispose()); // free GPU memory (materials are shared, don't dispose those)
          chunk.userData.lampMats.forEach(m => {
            const idx = lampGlows.indexOf(m);
            if (idx !== -1) lampGlows.splice(idx, 1);
            m.dispose(); // these clones are per-lamp, not shared, so safe (and necessary) to free
          });
          chunk.userData.windowMats.forEach(m => {
            const idx = windowMats.indexOf(m);
            if (idx !== -1) windowMats.splice(idx, 1);
            m.dispose();
          });
          scene.remove(chunk);
          activeChunks.delete(key);
        }
      }
    }

    // --- 5. REALISTIC CAR TRAFFIC & RESTRICTED PEDESTRIANS ---
    const traffic = [];
    const pedestrians = [];
    const carWheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 20);
    carWheelGeo.rotateZ(Math.PI / 2);

    function buildSedan(colorMat) {
      const carGroup = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4.4), colorMat);
      body.position.y = 0.6;
      body.castShadow = true;
      body.receiveShadow = true;

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.4), mats.carGlass);
      cabin.position.set(0, 1.15, -0.15);
      cabin.castShadow = true;

      const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.25, 0.2), mats.chrome);
      frontBumper.position.set(0, 0.45, -2.25);
      const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.25, 0.2), mats.chrome);
      rearBumper.position.set(0, 0.45, 2.25);

      const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), mats.headlight);
      hlL.position.set(0.7, 0.65, -2.22);
      const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), mats.headlight);
      hlR.position.set(-0.7, 0.65, -2.22);

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), mats.taillight);
      tlL.position.set(0.7, 0.65, 2.22);
      const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.05), mats.taillight);
      tlR.position.set(-0.7, 0.65, 2.22);

      const wOffsets = [
        [1.05, 0.36, 1.25], [-1.05, 0.36, 1.25],
        [1.05, 0.36, -1.25], [-1.05, 0.36, -1.25]
      ];
      wOffsets.forEach(([wx, wy, wz]) => {
        const w = new THREE.Mesh(carWheelGeo, mats.rubber);
        w.position.set(wx, wy, wz);
        w.castShadow = true;
        carGroup.add(w);
      });

      carGroup.add(body, cabin, frontBumper, rearBumper, hlL, hlR, tlL, tlR);
      return carGroup;
    }

    function initCar() {
      const cMat = mats.carColors[Math.floor(Math.random() * mats.carColors.length)];
      const car = buildSedan(cMat);

      car.axisZ = Math.random() > 0.5;
      car.dir = Math.random() > 0.5 ? 1 : -1;
      car.speed = (0.22 + Math.random() * 0.12) * car.dir;

      const laneOffset = (car.dir === 1) ? 4.8 : -4.8;
      const rX = Math.round((Math.random() - 0.5) * 3) * CHUNK_SIZE;
      const rZ = Math.round((Math.random() - 0.5) * 3) * CHUNK_SIZE;

      if (car.axisZ) {
        car.position.set(rX + laneOffset, 0, (Math.random() - 0.5) * 200);
        // BUGFIX: this was set backwards — cars visually faced the opposite of the
        // direction their speed/dir was actually driving them, so traffic looked
        // like it was reversing down the road.
        car.rotation.y = car.dir === 1 ? Math.PI : 0;
      } else {
        car.position.set((Math.random() - 0.5) * 200, 0, rZ + laneOffset);
        car.rotation.y = car.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      }

      scene.add(car);
      traffic.push(car);
    }

    // Build Animated Walking Pedestrian (Restricted to Sidewalk Boundaries)
    function initPedestrian() {
      const ped = new THREE.Group();
      const pShirt = mats.pedShirt[Math.floor(Math.random() * mats.pedShirt.length)];

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.2), pShirt);
      torso.position.y = 0.95;
      torso.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mats.skin);
      head.position.y = 1.3;
      head.castShadow = true;

      const legLPivot = new THREE.Group();
      legLPivot.position.set(0.08, 0.72, 0);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.45, 0.11), mats.pants);
      legL.position.y = -0.22;
      legL.castShadow = true;
      legLPivot.add(legL);

      const legRPivot = new THREE.Group();
      legRPivot.position.set(-0.08, 0.72, 0);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.45, 0.11), mats.pants);
      legR.position.y = -0.22;
      legR.castShadow = true;
      legRPivot.add(legR);

      ped.add(torso, head, legLPivot, legRPivot);
      ped.legL = legLPivot;
      ped.legR = legRPivot;

      // Safe Sidewalk Coordinates (Strictly outside ROAD_WIDTH/2 = 10 units)
      // Sidewalk corridor is between X: 11 to 13 units, snapped to the nearest
      // real north-south road centerline (roads recur every CHUNK_SIZE units).
      const sideX = (Math.random() > 0.5 ? 1 : -1) * (ROAD_WIDTH / 2 + 1.8 + Math.random() * 1.2);
      ped.position.set(sideX, 0.35, (Math.random() - 0.5) * 140);
      ped.walkSpeed = 0.02 + Math.random() * 0.012;
      ped.dir = Math.random() > 0.5 ? 1 : -1;
      ped.rotation.y = ped.dir === 1 ? Math.PI : 0;
      ped.walkPhase = Math.random() * Math.PI * 2; // stagger stride so peds don't all walk in lockstep

      scene.add(ped);
      pedestrians.push(ped);
    }

    for (let i = 0; i < 22; i++) initCar();
    for (let i = 0; i < 30; i++) initPedestrian();

    // --- 5b. AMBIENT NPC CYCLISTS (ride the road shoulder, don't trigger crashes) ---
    const npcCyclists = [];
    const NPC_FRAME_COLORS = [0xef476f, 0x06d6a0, 0xffd60a, 0x118ab2, 0xf77f00, 0x9b5de5, 0xff6b6b];

    function buildNPCCyclist(frameColorHex) {
      const group = new THREE.Group();
      const frameMat = new THREE.MeshLambertMaterial({ color: frameColorHex });

      const wB = createWheel();
      wB.position.set(0, 0.38, 0.65);
      const wF = createWheel();
      wF.position.set(0, 0.38, -0.65);
      group.add(wB, wF);

      function tube(x1, y1, z1, x2, y2, z2, r = 0.03) {
        const v1 = new THREE.Vector3(x1, y1, z1);
        const v2 = new THREE.Vector3(x2, y2, z2);
        const len = v1.distanceTo(v2);
        const geo = new THREE.CylinderGeometry(r, r, len, 6);
        const m = new THREE.Mesh(geo, frameMat);
        m.position.copy(v1.clone().add(v2).multiplyScalar(0.5));
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v2.clone().sub(v1).normalize());
        m.castShadow = true;
        group.add(m);
      }
      tube(0, 0.38, 0.65, 0, 0.85, 0.2);
      tube(0, 0.38, 0.65, 0, 0.38, 0.1);
      tube(0, 0.38, 0.1, 0, 0.85, 0.2);
      tube(0, 0.85, 0.2, 0, 0.95, -0.48);
      tube(0, 0.38, 0.1, 0, 0.95, -0.48);
      tube(0, 0.38, -0.65, 0, 1.05, -0.58);

      const shirtMat = mats.pedShirt[Math.floor(Math.random() * mats.pedShirt.length)];
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.2), shirtMat);
      torso.position.set(0, 1.12, 0.05);
      torso.rotation.x = 0.5;
      torso.castShadow = true;

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), mats.skin);
      head.position.set(0, 1.36, -0.18);
      head.castShadow = true;

      const legLPivot = new THREE.Group();
      legLPivot.position.set(0.1, 0.9, 0.15);
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), mats.pants);
      legL.position.set(0, -0.2, 0);
      legL.castShadow = true;
      legLPivot.add(legL);

      const legRPivot = new THREE.Group();
      legRPivot.position.set(-0.1, 0.9, 0.15);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), mats.pants);
      legR.position.set(0, -0.2, 0);
      legR.castShadow = true;
      legRPivot.add(legR);

      group.add(torso, head, legLPivot, legRPivot);
      group.legL = legLPivot;
      group.legR = legRPivot;
      group.wheelF = wF;
      group.wheelB = wB;
      return group;
    }

    function initNPCCyclist() {
      const cyc = buildNPCCyclist(NPC_FRAME_COLORS[Math.floor(Math.random() * NPC_FRAME_COLORS.length)]);

      cyc.axisZ = Math.random() > 0.5;
      cyc.dir = Math.random() > 0.5 ? 1 : -1;
      cyc.speed = (0.09 + Math.random() * 0.05) * cyc.dir; // bike pace — slower than car traffic
      cyc.pedalPhase = Math.random() * Math.PI * 2;

      // Ride near the curb, on the shoulder matching their direction of travel
      const laneOffset = (cyc.dir === 1 ? 1 : -1) * 8.3;
      const rX = Math.round((Math.random() - 0.5) * 3) * CHUNK_SIZE;
      const rZ = Math.round((Math.random() - 0.5) * 3) * CHUNK_SIZE;

      if (cyc.axisZ) {
        cyc.position.set(rX + laneOffset, 0, (Math.random() - 0.5) * 200);
        // BUGFIX: same facing/travel-direction mismatch as traffic cars — this made
        // ambient NPC cyclists pedal down the road while visually facing backwards.
        cyc.rotation.y = cyc.dir === 1 ? Math.PI : 0;
      } else {
        cyc.position.set((Math.random() - 0.5) * 200, 0, rZ + laneOffset);
        cyc.rotation.y = cyc.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      }

      scene.add(cyc);
      npcCyclists.push(cyc);
    }

    for (let i = 0; i < 10; i++) initNPCCyclist();

    // --- 5c. AMBIENT BIRDS (new — small flock that circles ahead of the rider) ---
    const birdWingGeo = new THREE.PlaneGeometry(0.55, 0.2);
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide });
    const birds = [];
    function buildBird() {
      const group = new THREE.Group();
      const wingL = new THREE.Mesh(birdWingGeo, birdMat);
      wingL.position.x = -0.26;
      const wingR = new THREE.Mesh(birdWingGeo, birdMat);
      wingR.position.x = 0.26;
      group.add(wingL, wingR);
      group.userData.wingL = wingL;
      group.userData.wingR = wingR;
      return group;
    }
    const BIRD_COUNT = 7;
    for (let i = 0; i < BIRD_COUNT; i++) {
      const b = buildBird();
      b.userData.orbitR = 9 + Math.random() * 12;
      b.userData.orbitSpeed = 0.12 + Math.random() * 0.1;
      b.userData.orbitPhase = Math.random() * Math.PI * 2;
      b.userData.height = 15 + Math.random() * 8;
      b.userData.flapPhase = Math.random() * Math.PI * 2;
      scene.add(b);
      birds.push(b);
    }
    function updateBirds(elapsed) {
      const px = playerRoot.position.x, pz = playerRoot.position.z;
      birds.forEach(b => {
        const t = elapsed * b.userData.orbitSpeed + b.userData.orbitPhase;
        b.position.set(
          px + Math.cos(t) * b.userData.orbitR,
          b.userData.height,
          pz - 45 + Math.sin(t) * b.userData.orbitR
        );
        b.rotation.y = -t - Math.PI / 2;
        const flap = Math.sin(elapsed * 9 + b.userData.flapPhase) * 0.55;
        b.userData.wingL.rotation.z = flap;
        b.userData.wingR.rotation.z = -flap;
      });
    }

    // --- 6. CHECKPOINTS ---
    const cpGeo = new THREE.TorusGeometry(3.2, 0.25, 10, 32);
    const cpMat = new THREE.MeshBasicMaterial({ color: 0xffb703, wireframe: true });
    const cpRing = new THREE.Mesh(cpGeo, cpMat);
    cpRing.rotation.x = Math.PI / 2;
    scene.add(cpRing);

    let score = 0;
    let targetCP = new THREE.Vector3(0, 1.2, -80);
    cpRing.position.copy(targetCP);
    const ORDER_TIME_LIMIT = 45;
    let missionPhase = 'pickup';
    let missionTimeLeft = 0;

    function updateMissionHud() {
      const label = document.getElementById('mission-label');
      const timer = document.getElementById('mission-timer');
      if (!label || !timer) return;
      if (missionPhase === 'pickup') {
        label.innerText = 'ORDER: PICK UP PACKAGE';
        timer.innerText = 'READY';
        timer.classList.remove('urgent');
      } else {
        label.innerText = 'ORDER: DELIVER PACKAGE';
        timer.innerText = `${Math.ceil(missionTimeLeft)}s LEFT`;
        timer.classList.toggle('urgent', missionTimeLeft <= 10);
      }
    }

    function placeNextOrderTarget() {
      const gridX = Math.round((playerRoot.position.x + (Math.random() - 0.5) * 220) / CHUNK_SIZE) * CHUNK_SIZE;
      const gridZ = Math.round((playerRoot.position.z + (Math.random() - 0.5) * 220) / CHUNK_SIZE) * CHUNK_SIZE;
      targetCP.set(gridX, 1.2, gridZ);
      cpRing.position.copy(targetCP);
    }

    function failTimedOrder() {
      missionPhase = 'pickup';
      missionTimeLeft = 0;
      cpMat.color.set(0xffb703);
      updateMissionHud();
      showToast('Order expired. Pick up the next package.');
      placeNextOrderTarget();
    }

    function updateStreakHud() {
      const el = document.getElementById('streak-label');
      if (player.streak >= 2) {
        el.innerText = `STREAK x${player.streak} — ${(1 + Math.min(player.streak * 0.08, 0.8)).toFixed(2)}x PAY`;
        el.classList.add('show');
      } else {
        el.classList.remove('show');
      }
    }

    function nextCheckpoint() {
      if (missionPhase === 'pickup') {
        missionPhase = 'delivery';
        missionTimeLeft = ORDER_TIME_LIMIT;
        cpMat.color.set(0x06d6a0);
        updateMissionHud();
        showToast(`Package picked up. Deliver it in ${ORDER_TIME_LIMIT}s!`);
        placeNextOrderTarget();
        return;
      }

      score++;
      player.streak++;
      document.getElementById('cp-count').innerText = score;
      updateStreakHud();

      // Delivery payout: base amount + streak bonus, scaled by equipped gear coin multiplier
      // and an uncapped streak multiplier that resets whenever the rider crashes — the
      // longer the clean run, the more each drop is worth.
      const basePay = 15 + Math.floor(Math.random() * 16); // 15-30
      const streakBonus = Math.min(score * 2, 40);
      const streakMult = 1 + Math.min(player.streak * 0.08, 0.8);
      const coinMult = getActiveStats().coinMult * streakMult;
      const earned = Math.round((basePay + streakBonus) * coinMult) + 15;
      player.coins += earned;
      updateCoinHud();
      showToast(player.streak >= 3 ? `Delivered! +🪙${earned}  (STREAK x${player.streak})` : `Delivered! +🪙${earned}`);
      addTrainingXP(10 + score); // deliveries build toward pro cyclist ranks, harder streaks earn more
      playChime(player.streak >= 5);

      missionPhase = 'pickup';
      missionTimeLeft = 0;
      cpMat.color.set(0xffb703);
      updateMissionHud();
      placeNextOrderTarget();
    }

    // --- 7. FLUID CONTROLS & ANIMATION SYSTEM ---
    const player = {
      speed: 0,
      heading: 0,
      steer: 0,
      lean: 0,
      skidYaw: 0,
      pitchHop: 0,
      vSpeed: 0,
      isGrounded: true,
      crashed: false,
      pedalPhase: 0,
      skidWobblePhase: 0,
      stamina: 100,
      maxStamina: 100,
      spinning: false,
      spinElapsed: 0,
      spinDuration: 0.55,
      spinYawExtra: 0,
      coins: 700,
      streak: 0,
      ownedBikes: ['starter'],
      ownedGear: [],
      equippedBike: 'starter',
      equippedGear: {}, // slot -> item id
      club: 'none',
      trainingXP: 0,
      rank: 0
    };

    // --- Game Flow State ---
    let gamePaused = true;     // true until the player hits "Ride Out" on the start menu
    let animateStarted = false;

    const SPIN_STAMINA_COST = 34;
    const SPIN_STAMINA_REGEN = 12; // per second
    const SPRINT_STAMINA_DRAIN = 24;
    const SPRINT_SPEED_MULT = 1.28;
    const SPRINT_ACCEL_MULT = 1.55;

    const MOVE_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyB','KeyF']);
    const keys = {};
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
      }
      if (e.code === 'KeyM') { e.preventDefault(); cycleWeather(); return; }
      if (e.code === 'KeyC') {
        e.preventDefault();
        freeCamera = true;
        document.getElementById('camera-mode').classList.add('free');
        document.getElementById('camera-mode').innerText = 'FREE CAMERA';
        lastPointerX = null;
        lastPointerY = null;
        return;
      }
      if (MOVE_KEYS.has(e.code)) e.preventDefault(); // stop arrow/space page-scroll from fighting controls
      keys[e.code] = true;
      if (gamePaused) return; // no menu is open during gameplay for us to worry about here — this just blocks hotkeys before a mode is picked or mid-dialogue
      if (e.code === 'Space' && player.isGrounded && !player.crashed) {
        player.vSpeed = 0.17;
        player.isGrounded = false;
        playHopSound();
      }
      // Air Spin trick: only while airborne, not already spinning, and enough stamina banked
      if (e.code === 'KeyF' && !player.crashed && !player.isGrounded && !player.spinning
          && player.stamina >= SPIN_STAMINA_COST) {
        player.spinning = true;
        player.spinElapsed = 0;
        player.stamina -= SPIN_STAMINA_COST;
        updateStaminaHud();
      }
      if (e.code === 'KeyB') toggleShop();
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'KeyC') {
        freeCamera = false;
        document.getElementById('camera-mode').classList.remove('free');
        document.getElementById('camera-mode').innerText = 'CHASE CAMERA';
        lastPointerX = null;
        lastPointerY = null;
        return;
      }
      if (MOVE_KEYS.has(e.code)) e.preventDefault();
      keys[e.code] = false;
    });
    window.addEventListener('mousemove', e => {
      if (!freeCamera || gamePaused) return;
      if (lastPointerX === null) {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        return;
      }
      freeCameraYaw -= (e.clientX - lastPointerX) * 0.006;
      freeCameraPitch = THREE.MathUtils.clamp(freeCameraPitch - (e.clientY - lastPointerY) * 0.004, -0.25, 0.65);
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    });
    window.addEventListener('wheel', e => {
      if (!freeCamera || gamePaused) return;
      e.preventDefault();
      freeCameraDistance = THREE.MathUtils.clamp(freeCameraDistance + e.deltaY * 0.008, 3.8, 11);
    }, { passive: false });

    // --- 7b. ECONOMY & SHOP: BICYCLES + JEWELRY/GEAR ---
    const BIKE_CATALOG = [
      { id: 'starter', name: 'Alley Runner', price: 0, color: 0x06d6a0, accentColor: 0x1b1b1b, tubeRadius: 0.032, wheelScale: 1.00, speedMult: 1.00, accelMult: 1.00, handleMult: 1.00, style: 'Street Fixie', image: null, desc: 'The reliable starter fixie. Compact frame and neutral street setup.' },
      { id: 'vigorelli_hiu', name: 'Vigorelli Hiu', price: 180, color: 0x00b4d8, accentColor: 0x101820, tubeRadius: 0.029, wheelScale: 1.02, speedMult: 1.14, accelMult: 1.12, handleMult: 1.06, style: 'Track / Aero', image: null, desc: 'Hiu-inspired track geometry with a sharp dark-and-cyan race identity.' },
      { id: 'tsunami_snm100', name: 'Tsunami SNM100', price: 300, color: 0xff5c9a, accentColor: 0x111111, tubeRadius: 0.027, wheelScale: 1.04, speedMult: 1.22, accelMult: 1.18, handleMult: 1.10, style: 'Drop Bar', image: 'tsunami snm100.jpg', isNewModel: true, desc: 'Purchasable reference build with pink chromoly-inspired tubing and drop bars.' },
      { id: 'gray_f15', name: 'Gray F15', price: 430, color: 0xf1f3f5, accentColor: 0x16181c, tubeRadius: 0.025, wheelScale: 1.07, speedMult: 1.30, accelMult: 1.25, handleMult: 1.12, style: 'Aero Road', image: 'gray f15.jpg', isNewModel: true, desc: 'Purchasable reference build with deep wheels, tapered stays, and a sharper aero silhouette.' },
      { id: 'titanium_ghost', name: 'Titanium Ghost', price: 650, color: 0xe5e5e5, accentColor: 0x00b4d8, tubeRadius: 0.023, wheelScale: 1.08, speedMult: 1.38, accelMult: 1.32, handleMult: 1.16, style: 'Premium Track', image: null, desc: 'Original premium procedural model with thin tubes, oversized race wheels, and cyan accents.' }
    ];

    const GEAR_CATALOG = [
      { id: 'gold_chain',    name: 'Gold Chain',           slot: 'neck',  price: 60,  coinMult: 1.05,  desc: '+5% coins per delivery. Pure flex.' },
      { id: 'aviator_shades',name: 'Aviator Shades',       slot: 'eyes',  price: 40,  desc: 'Zero stats. Maximum style.' },
      { id: 'diamond_grillz',name: 'Diamond Grillz',       slot: 'face',  price: 150, coinMult: 1.10,  desc: '+10% coins per delivery. Blinding in direct sunlight.' },
      { id: 'gold_rims',     name: 'Gold-Plated Rims',     slot: 'wheels',price: 90,  speedBonus: 0.04,desc: '+4% top speed. Spins forever, looks incredible.' },
      { id: 'racing_helmet', name: 'Pro Racing Helmet',    slot: 'head',  price: 75,  handleBonus: 0.06,desc: '+6% handling. Also, you know, protects your skull.' },
      { id: 'diamond_bag',   name: 'Diamond-Studded Bag',  slot: 'bag',   price: 200, coinMult: 1.15,  desc: '+15% coins per delivery. Clients notice.' }
    ];

    // Cosmetic team affiliation — free to join/leave, tints your jersey in team colors
    // and gives a small shared team bonus. Purely social layer, no bike stat changes.
    const CLUB_CATALOG = [
      { id: 'none',       name: 'Unaffiliated',    color: 0xef476f, perk: 1.00, desc: 'Ride solo. No team colors, no team bonus.' },
      { id: 'redhawks',   name: 'Red Hawks CC',    color: 0xd90429, perk: 1.03, desc: 'Aggressive sprint-focused crew. +3% coins from team sponsorship.' },
      { id: 'blueline',   name: 'Blueline Couriers', color: 0x0077b6, perk: 1.03, desc: 'Efficient pack riders who know every shortcut. +3% coins.' },
      { id: 'goldwolves', name: 'Gold Wolves',     color: 0xffd60a, perk: 1.03, desc: 'Flashy, loud, and fast. +3% coins from sponsorship deals.' }
    ];

    // Career progression — training XP earned from deliveries and clean tricks builds
    // toward pro cyclist ranks. Purely a status/coin-bonus track, no separate mission UI yet.
    const RANKS = [
      { name: 'Rookie Courier',     xpNeeded: 0,    bonus: 0 },
      { name: 'Junior Cyclist',     xpNeeded: 120,  bonus: 25 },
      { name: 'City Racer',         xpNeeded: 320,  bonus: 50 },
      { name: 'Category 3 Pro',     xpNeeded: 700,  bonus: 100 },
      { name: 'Category 1 Pro',     xpNeeded: 1400, bonus: 200 },
      { name: 'Alleycat Champion',  xpNeeded: 2600, bonus: 400 }
    ];

    function updateRankHud() {
      document.getElementById('rank-label').innerText = 'RANK: ' + RANKS[player.rank].name;
    }

    function addTrainingXP(amount) {
      player.trainingXP += amount;
      while (player.rank < RANKS.length - 1 && player.trainingXP >= RANKS[player.rank + 1].xpNeeded) {
        player.rank++;
        const newRank = RANKS[player.rank];
        player.coins += newRank.bonus;
        updateCoinHud();
        showToast(`Ranked Up: ${newRank.name}! +🪙${newRank.bonus}`);
        playRankUpSound();
      }
      updateRankHud();
    }

    // --- Start Menu wiring ---
    const pauseOverlay = document.getElementById('pause-overlay');
    function setPaused(paused) {
      if (gamePaused === paused && pauseOverlay.classList.contains('open') === paused) return;
      gamePaused = paused;
      pauseOverlay.classList.toggle('open', paused);
      document.getElementById('pause-btn').innerText = paused ? '▶' : '||';
    }
    function togglePause() {
      if (shopOverlay.classList.contains('open')) return;
      if (!document.getElementById('start-menu').style.display || document.getElementById('start-menu').style.display !== 'none') return;
      setPaused(!gamePaused);
    }
    function startGame() {
      document.getElementById('start-menu').style.display = 'none';
      setPaused(false);
      initAudio(); // first user gesture — safe to unlock the Web Audio context here
      if (!animateStarted) {
        animateStarted = true;
        animate();
      }
    }
    document.getElementById('free-mode-btn').addEventListener('click', startGame);
    document.getElementById('pause-btn').addEventListener('click', togglePause);
    document.getElementById('resume-btn').addEventListener('click', () => setPaused(false));
    document.getElementById('restart-btn').addEventListener('click', () => window.location.reload());

    function getBike(id) { return BIKE_CATALOG.find(b => b.id === id) || BIKE_CATALOG[0]; }
    function getGear(id) { return GEAR_CATALOG.find(g => g.id === id); }
    function getClub(id) { return CLUB_CATALOG.find(c => c.id === id) || CLUB_CATALOG[0]; }

    // Combined multipliers currently in effect from equipped bike + gear + club
    function getActiveStats() {
      const bike = getBike(player.equippedBike);
      let speedMult = bike.speedMult, accelMult = bike.accelMult, handleMult = bike.handleMult;
      let coinMult = getClub(player.club).perk;
      Object.values(player.equippedGear).forEach(gid => {
        const g = getGear(gid);
        if (!g) return;
        if (g.speedBonus) speedMult += g.speedBonus;
        if (g.handleBonus) handleMult += g.handleBonus;
        if (g.coinMult) coinMult *= g.coinMult;
      });
      return { speedMult, accelMult, handleMult, coinMult };
    }

    function updateCoinHud() {
      document.getElementById('coin-val').innerText = player.coins;
      document.getElementById('shop-coin-val').innerText = player.coins;
    }

    function updateStaminaHud() {
      const pct = Math.max(0, Math.min(100, (player.stamina / player.maxStamina) * 100));
      const fill = document.getElementById('stamina-fill');
      fill.style.width = pct + '%';
      fill.classList.toggle('low', pct < SPIN_STAMINA_COST);
    }

    let toastTimer = null;
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.innerText = msg;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    function buyBike(id) {
      const bike = getBike(id);
      if (player.ownedBikes.includes(id)) { equipBike(id); return; }
      if (player.coins < bike.price) { showToast("Not enough coins"); return; }
      player.coins -= bike.price;
      player.ownedBikes.push(id);
      equipBike(id);
    }
    // Rebuilds the actual frame geometry, wheel size, and accent color for a bike —
    // not just a paint swap. Also called once at startup to initialize the starter bike.
    function applyBikeVisual(bike) {
      mats.bikeFrame.color.setHex(bike.color);
      buildFrameTubes(bike.tubeRadius);
      frontWheel.scale.setScalar(bike.wheelScale);
      backWheel.scale.setScalar(bike.wheelScale);
      bikeStyleParts.scale.set(1,1,1);
      buildBikeStyleParts(bike);
      applyGearVisuals(); // re-apply so gold_rims (if equipped) still overrides the bike's own accent
    }
    function equipBike(id) {
      player.equippedBike = id;
      applyBikeVisual(getBike(id));
      updateCoinHud();
      renderShopItems();
      showToast(`Riding: ${getBike(id).name}`);
    }

    function buyGear(id) {
      const item = getGear(id);
      if (player.ownedGear.includes(id)) { equipGear(id); return; }
      if (player.coins < item.price) { showToast("Not enough coins"); return; }
      player.coins -= item.price;
      player.ownedGear.push(id);
      equipGear(id);
    }
    function equipGear(id) {
      const item = getGear(id);
      // Toggle off if already equipped in that slot, otherwise equip (swap with anything else in same slot)
      if (player.equippedGear[item.slot] === id) {
        delete player.equippedGear[item.slot];
      } else {
        player.equippedGear[item.slot] = id;
      }
      applyGearVisuals();
      updateCoinHud();
      renderShopItems();
      showToast(player.equippedGear[item.slot] === id ? `Equipped: ${item.name}` : `Unequipped: ${item.name}`);
    }

    // Joining/leaving a club is free — toggle membership and retint the jersey
    function joinClub(id) {
      player.club = (player.club === id) ? 'none' : id;
      const club = getClub(player.club);
      mats.shirt.color.setHex(club.color);
      updateClubHud();
      renderShopItems();
      showToast(player.club === 'none' ? 'Left the team' : `Joined: ${club.name}`);
    }

    function updateClubHud() {
      const club = getClub(player.club);
      const el = document.getElementById('club-badge');
      if (player.club === 'none') {
        el.style.opacity = '0';
      } else {
        el.innerText = club.name.toUpperCase();
        el.style.background = '#' + club.color.toString(16).padStart(6, '0');
        el.style.opacity = '1';
      }
    }

    // --- Cosmetic gear meshes on the rider, hidden until equipped ---
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xffd60a });
    const diamondMat = new THREE.MeshBasicMaterial({ color: 0xd6f7ff });
    const shadeMat = new THREE.MeshLambertMaterial({ color: 0x0a0a0a });

    const chainMesh = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 16), goldMat);
    chainMesh.rotation.x = Math.PI / 2.4;
    chainMesh.position.set(0, 1.28, -0.12);
    chainMesh.visible = false;
    riderGroup.add(chainMesh);

    const grillzMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), diamondMat);
    grillzMesh.position.set(0, 1.36, -0.29);
    grillzMesh.visible = false;
    riderGroup.add(grillzMesh);

    const shadesMesh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.05, 0.03), shadeMat);
    shadesMesh.position.set(0, 1.42, -0.3);
    shadesMesh.visible = false;
    riderGroup.add(shadesMesh);

    function applyGearVisuals() {
      const eq = player.equippedGear;
      chainMesh.visible = eq.neck === 'gold_chain';
      grillzMesh.visible = eq.face === 'diamond_grillz';
      shadesMesh.visible = eq.eyes === 'aviator_shades';
      const bikeAccent = getBike(player.equippedBike).accentColor;
      playerSpokeMat.color.setHex(eq.wheels === 'gold_rims' ? 0xffd60a : 0x999999);
      playerAccentMat.color.setHex(eq.wheels === 'gold_rims' ? 0xffd60a : bikeAccent);
      helmet.material.color.setHex(eq.head === 'racing_helmet' ? 0xd90429 : 0x073b4c);
      bag.material.color.setHex(eq.bag === 'diamond_bag' ? 0xd6f7ff : 0xf77f00);
    }

    // --- Shop UI wiring ---
    const shopOverlay = document.getElementById('shop-overlay');
    let shopTab = 'bikes';

    function toggleShop() {
      shopOverlay.classList.toggle('open');
      if (shopOverlay.classList.contains('open')) renderShopItems();
    }
    document.getElementById('shop-btn').addEventListener('click', toggleShop);
    document.getElementById('shop-close').addEventListener('click', toggleShop);
    document.querySelectorAll('.shop-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        shopTab = btn.dataset.tab;
        document.querySelectorAll('.shop-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderShopItems();
      });
    });

    function renderShopItems() {
      const wrap = document.getElementById('shop-items');
      wrap.innerHTML = '';
      const list = shopTab === 'bikes' ? BIKE_CATALOG : shopTab === 'gear' ? GEAR_CATALOG : CLUB_CATALOG;

      list.forEach(item => {
        const owned = shopTab === 'bikes' ? player.ownedBikes.includes(item.id)
                    : shopTab === 'gear'  ? player.ownedGear.includes(item.id)
                    : true; // clubs are always "owned" — membership is free
        const equipped = shopTab === 'bikes' ? player.equippedBike === item.id
                        : shopTab === 'gear'  ? player.equippedGear[item.slot] === item.id
                        : player.club === item.id;

        const card = document.createElement('div');
        card.className = 'shop-item' + (equipped ? ' equipped' : '') + (item.isNewModel ? ' new-model' : '');

        const bonusBits = [];
        if (item.speedMult) bonusBits.push(`Speed x${item.speedMult.toFixed(2)}`);
        if (item.accelMult) bonusBits.push(`Accel x${item.accelMult.toFixed(2)}`);
        if (item.handleMult && item.handleMult !== 1) bonusBits.push(`Handling x${item.handleMult.toFixed(2)}`);
        if (item.speedBonus) bonusBits.push(`+${Math.round(item.speedBonus * 100)}% top speed`);
        if (item.handleBonus) bonusBits.push(`+${Math.round(item.handleBonus * 100)}% handling`);
        if (item.coinMult) bonusBits.push(`+${Math.round((item.coinMult - 1) * 100)}% coins`);
        if (shopTab === 'club' && item.perk !== 1) bonusBits.push(`+${Math.round((item.perk - 1) * 100)}% coins`);

        let btnLabel, btnClass, disabled = false;
        if (shopTab === 'club') {
          btnLabel = equipped ? (item.id === 'none' ? 'ACTIVE' : 'LEAVE') : (item.id === 'none' ? 'GO SOLO' : 'JOIN');
          btnClass = equipped ? 'equipped-btn' : 'equip-btn';
          disabled = equipped && item.id === 'none';
        } else if (!owned) {
          btnLabel = `BUY — 🪙${item.price}`;
          btnClass = '';
          disabled = player.coins < item.price;
        } else if (equipped) {
          btnLabel = shopTab === 'bikes' ? 'EQUIPPED' : 'UNEQUIP';
          btnClass = shopTab === 'bikes' ? 'equipped-btn' : 'equip-btn';
          disabled = shopTab === 'bikes';
        } else {
          btnLabel = 'EQUIP';
          btnClass = 'equip-btn';
        }

        const thumb = '';
        card.innerHTML = `
          ${thumb}
          <div class="shop-item-meta"><div class="shop-item-name">${item.name}</div>${shopTab === 'bikes' && item.style ? `<span class="style-chip">${item.style}</span>` : ''}</div>
          <div class="shop-item-desc">${item.desc}${bonusBits.length ? '<br><b>' + bonusBits.join(' · ') + '</b>' : ''}</div>
          <div class="shop-item-price">${shopTab === 'club' ? '&nbsp;' : (owned ? 'OWNED' : '🪙 ' + item.price)}</div>
          <button class="shop-item-btn ${btnClass}" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
        `;
        card.querySelector('button').addEventListener('click', () => {
          if (shopTab === 'bikes') buyBike(item.id);
          else if (shopTab === 'gear') buyGear(item.id);
          else joinClub(item.id);
        });
        wrap.appendChild(card);
      });
    }

    updateCoinHud();
    updateStaminaHud();
    updateRankHud();
    updateMissionHud();
    applyBikeVisual(getBike(player.equippedBike));

    // --- Lightweight Procedural SFX (Web Audio synth tones — no audio files needed) ---
    let audioCtx = null;
    function initAudio() {
      if (audioCtx) return;
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    function playTone(freq, startDelay, duration, type = 'sine', peakGain = 0.11) {
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime + startDelay;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }
    function playChime(big) {
      playTone(880, 0, 0.14, 'triangle', 0.09);
      playTone(1320, 0.06, 0.18, 'triangle', 0.08);
      if (big) playTone(1760, 0.12, 0.22, 'triangle', 0.08);
    }
    function playCrashSound() {
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      const bufferSize = audioCtx.sampleRate * 0.28;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t0);
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.35, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
      noise.connect(filter).connect(gain).connect(audioCtx.destination);
      noise.start(t0);
      playTone(90, 0, 0.25, 'square', 0.12);
    }
    function playHopSound() { playTone(520, 0, 0.09, 'square', 0.05); }
    function playRankUpSound() { playTone(660, 0, 0.14, 'triangle', 0.09); playTone(880, 0.09, 0.14, 'triangle', 0.09); playTone(1100, 0.18, 0.28, 'triangle', 0.1); }

    function triggerCarCrash() {
      if (player.crashed) return;
      player.crashed = true;
      player.spinning = false;
      player.spinYawExtra = 0;
      if (player.streak >= 2) showToast(`Streak broken — was x${player.streak}`);
      player.streak = 0;
      updateStreakHud();
      playCrashSound();
      document.getElementById('crash-text').innerText = "HIT BY CAR!";
      document.getElementById('crash-overlay').style.opacity = '1';
      document.getElementById('crash-text').style.transform = 'scale(1.1)';
      playerVisual.rotation.x = Math.PI / 2.3;
      player.speed = 0;

      setTimeout(() => {
        player.crashed = false;
        playerVisual.rotation.x = 0;
        playerRoot.position.y = 0;
        player.vSpeed = 0;
        player.isGrounded = true;
        document.getElementById('crash-overlay').style.opacity = '0';
        document.getElementById('crash-text').style.transform = 'scale(0.9)';
      }, 1500);
    }

    // Check building intersection and compute zero-damage sliding collision
    function resolveBuildingCollision(px, pz, radius = 0.65) {
      let resolvedX = px;
      let resolvedZ = pz;
      let hit = false;

      for (let i = 0; i < solidColliders.length; i++) {
        const box = solidColliders[i];
        if (
          resolvedX + radius > box.min.x && resolvedX - radius < box.max.x &&
          resolvedZ + radius > box.min.z && resolvedZ - radius < box.max.z
        ) {
          hit = true;
          // Find shallowest axis penetration and push bike out softly
          const dxMin = Math.abs((resolvedX + radius) - box.min.x);
          const dxMax = Math.abs(box.max.x - (resolvedX - radius));
          const dzMin = Math.abs((resolvedZ + radius) - box.min.z);
          const dzMax = Math.abs(box.max.z - (resolvedZ - radius));

          const minOverX = Math.min(dxMin, dxMax);
          const minOverZ = Math.min(dzMin, dzMax);

          if (minOverX < minOverZ) {
            resolvedX = (dxMin < dxMax) ? box.min.x - radius : box.max.x + radius;
          } else {
            resolvedZ = (dzMin < dzMax) ? box.min.z - radius : box.max.z + radius;
          }
        }
      }
      return { x: resolvedX, z: resolvedZ, collided: hit };
    }

    // --- 7c. DAY/NIGHT + WEATHER SCENERY ---
    // Explicit time bands make sunrise, sunset, blue hour and night visually distinct.
    // Sunset is intentionally warm and bright at the horizon instead of muddy/dark.
    const DAY_CYCLE_SECONDS = 600;
    let dayPhase = 0.28; // 0 sunrise, .25 noon, .5 sunset, .75 midnight
    const WEATHER_MODES = ['CLEAR', 'OVERCAST', 'RAIN'];
    let weatherMode = 'CLEAR';
    const WEATHER_COLOR_GRADING = {
      CLEAR: 'saturate(1.22) contrast(1.04)',
      OVERCAST: 'saturate(0.68) contrast(0.96) brightness(0.98)',
      RAIN: 'saturate(0.84) contrast(1.08) brightness(0.94)'
    };

    const SKY = {
      dayTop: new THREE.Color(0x3f86d1), dayMid: new THREE.Color(0x77b9e8), dayBottom: new THREE.Color(0xdaf1ff),
      sunriseTop: new THREE.Color(0x624f9f), sunriseMid: new THREE.Color(0xf06f52), sunriseBottom: new THREE.Color(0xffc36e),
      sunsetTop: new THREE.Color(0x3d245f), sunsetMid: new THREE.Color(0xc94f55), sunsetBottom: new THREE.Color(0xff9b4a),
      blueTop: new THREE.Color(0x111a42), blueMid: new THREE.Color(0x243d69), blueBottom: new THREE.Color(0x405879),
      nightTop: new THREE.Color(0x040712), nightMid: new THREE.Color(0x0c1427), nightBottom: new THREE.Color(0x16243a),
      overcastTop: new THREE.Color(0x4f5967), overcastMid: new THREE.Color(0x7e8793), overcastBottom: new THREE.Color(0xb9c0c8)
    };
    const _skyTop = new THREE.Color(), _skyMid = new THREE.Color(), _skyBottom = new THREE.Color();

    function smoothBand(value, start, end) { return THREE.MathUtils.smoothstep(value, start, end); }

    function getTimeBands(phase) {
      const sunrise = phase < 0.16 ? smoothBand(phase, 0.00, 0.08) * (1 - smoothBand(phase, 0.09, 0.16)) : 0;
      const sunset = phase > 0.40 && phase < 0.62 ? smoothBand(phase, 0.40, 0.48) * (1 - smoothBand(phase, 0.55, 0.62)) : 0;
      const blueHour = phase > 0.58 && phase < 0.69 ? smoothBand(phase, 0.58, 0.64) * (1 - smoothBand(phase, 0.67, 0.69)) : 0;
      const dawnBlue = phase > 0.90 ? smoothBand(phase, 0.90, 0.96) * (1 - smoothBand(phase, 0.98, 1.00)) : 0;
      const night = phase >= 0.68 && phase <= 0.90 ? 1 : 0;
      const day = Math.max(0, 1 - Math.min(1, sunrise + sunset + blueHour + dawnBlue + night));
      return { sunrise, sunset, blueHour, dawnBlue, night, day };
    }

    function setWeatherMode(nextMode, announce = true) {
      weatherMode = WEATHER_MODES.includes(nextMode) ? nextMode : 'CLEAR';
      applySurfaceWeather(weatherMode);
      rain.visible = weatherMode === 'RAIN';
      renderer.domElement.style.filter = WEATHER_COLOR_GRADING[weatherMode];
      const pill = document.getElementById('weather-pill');
      const label = document.getElementById('weather-label');
      if (label) label.innerText = weatherMode;
      if (pill) {
        pill.classList.remove('clear', 'overcast', 'rain');
        pill.classList.add(weatherMode.toLowerCase());
        pill.firstChild.textContent = weatherMode === 'RAIN' ? '🌧️ ' : weatherMode === 'OVERCAST' ? '☁️ ' : '☀️ ';
      }
      if (announce && typeof showToast === 'function') showToast(`Weather: ${weatherMode}`);
    }

    function cycleWeather() {
      const i = WEATHER_MODES.indexOf(weatherMode);
      setWeatherMode(WEATHER_MODES[(i + 1) % WEATHER_MODES.length]);
    }

    function updateDayNightCycle(delta) {
      dayPhase = (dayPhase + delta / DAY_CYCLE_SECONDS) % 1;
      const angle = dayPhase * Math.PI * 2;
      const sunHeight = Math.sin(angle);
      const bands = getTimeBands(dayPhase);
      const orbitRadius = 160;
      sun.position.set(Math.cos(angle) * orbitRadius, Math.max(sunHeight, 0.035) * orbitRadius + 18, Math.sin(angle * 0.6) * orbitRadius * 0.5 + 80);
      fillLight.position.set(-sun.position.x * 0.65, 55, -sun.position.z * 0.55);

      let sunIntensity = 0.86, hemiIntensity = 0.84, fillIntensity = 0.20, fogDensity = 0.0042;
      _skyTop.copy(SKY.dayTop); _skyMid.copy(SKY.dayMid); _skyBottom.copy(SKY.dayBottom);
      const sunColor = new THREE.Color(0xfff4dc);
      let horizonStrength = 0;
      let sunDiscColor = new THREE.Color(0xffd38a);

      if (bands.sunrise > 0) {
        _skyTop.copy(SKY.sunriseTop); _skyMid.copy(SKY.sunriseMid); _skyBottom.copy(SKY.sunriseBottom);
        sunColor.set(0xff9c54); sunIntensity = 0.60; hemiIntensity = 0.54; fillIntensity = 0.18; fogDensity = 0.0047;
        horizonStrength = bands.sunrise; sunDiscColor.set(0xffa24d);
      } else if (bands.sunset > 0) {
        _skyTop.copy(SKY.sunsetTop); _skyMid.copy(SKY.sunsetMid); _skyBottom.copy(SKY.sunsetBottom);
        sunColor.set(0xff713c); sunIntensity = 0.64 + bands.sunset * 0.18; hemiIntensity = 0.58; fillIntensity = 0.15; fogDensity = 0.0045;
        horizonStrength = bands.sunset; sunDiscColor.set(0xffb34d);
      } else if (bands.blueHour > 0 || bands.dawnBlue > 0) {
        _skyTop.copy(SKY.blueTop); _skyMid.copy(SKY.blueMid); _skyBottom.copy(SKY.blueBottom);
        sunColor.set(0xff9166); sunIntensity = 0.22; hemiIntensity = 0.38; fillIntensity = 0.20; fogDensity = 0.0055;
        horizonStrength = 0.16; sunDiscColor.set(0xff8f67);
      } else if (bands.night > 0) {
        _skyTop.copy(SKY.nightTop); _skyMid.copy(SKY.nightMid); _skyBottom.copy(SKY.nightBottom);
        sunColor.set(0x6f86b5); sunIntensity = 0.08; hemiIntensity = 0.25; fillIntensity = 0.16; fogDensity = 0.0052;
      }

      if (weatherMode === 'OVERCAST') {
        _skyTop.lerp(SKY.overcastTop, 0.50); _skyMid.lerp(SKY.overcastMid, 0.56); _skyBottom.lerp(SKY.overcastBottom, 0.40);
        sunIntensity *= 0.50; hemiIntensity *= 0.82; fogDensity *= 1.35; horizonStrength *= 0.60;
      } else if (weatherMode === 'RAIN') {
        _skyTop.lerp(new THREE.Color(0x26354c), 0.34); _skyMid.lerp(new THREE.Color(0x52677f), 0.30); _skyBottom.lerp(new THREE.Color(0x7d8fa3), 0.22);
        sunIntensity *= 0.42; hemiIntensity *= 0.74; fogDensity *= 1.50; horizonStrength *= 0.72; rainMat.opacity = 0.58;
      } else {
        rainMat.opacity = 0;
      }

      sun.intensity = sunIntensity; sun.color.copy(sunColor);
      hemiLight.intensity = hemiIntensity; fillLight.intensity = fillIntensity;
      skyMat.uniforms.topColor.value.copy(_skyTop);
      skyMat.uniforms.midColor.value.copy(_skyMid);
      skyMat.uniforms.bottomColor.value.copy(_skyBottom);
      scene.fog.color.copy(_skyBottom); scene.fog.density = fogDensity; scene.background.copy(_skyBottom);

      sunDisc.position.copy(sun.position); sunDisc.position.y = Math.max(sun.position.y, 5);
      sunDisc.material.color.copy(sunDiscColor);
      sunDisc.material.opacity = Math.max(bands.sunrise, bands.sunset, bands.blueHour * 0.30, bands.dawnBlue * 0.30);
      horizonGlow.position.set(playerRoot.position.x, 18, playerRoot.position.z - 120);
      horizonGlow.material.color.set(0xff8b3d); horizonGlow.material.opacity = horizonStrength * 0.45;

      const cloudColor = new THREE.Color(bands.sunset || bands.sunrise ? 0xffc28d : (bands.night || bands.blueHour ? 0x7285a8 : 0xf4f6f8));
      if (weatherMode === 'OVERCAST') cloudColor.lerp(new THREE.Color(0x9aa3ae), 0.55);
      if (weatherMode === 'RAIN') cloudColor.lerp(new THREE.Color(0x667589), 0.62);
      const cloudOpacity = weatherMode === 'CLEAR' ? ((bands.sunset || bands.sunrise) ? 0.72 : 0.58) : weatherMode === 'OVERCAST' ? 0.82 : 0.90;
      clouds.forEach(c => { c.material.color.copy(cloudColor); c.material.opacity = cloudOpacity; });

      const lampLevel = Math.max(bands.sunset * 0.95, bands.sunrise * 0.75, bands.blueHour * 0.90, bands.night);
      for (let i = 0; i < lampGlows.length; i++) lampGlows[i].opacity = 0.08 + lampLevel * 0.95;

      for (let i = 0; i < windowMats.length; i++) {
        const wm = windowMats[i];
        const reflection = (bands.sunset || bands.sunrise) ? new THREE.Color(0xff8d62) : _skyBottom;
        wm.color.copy(reflection).lerp(new THREE.Color(0x172331), bands.night * 0.70 + bands.blueHour * 0.35);
        wm.emissiveIntensity = wm.userData.isLit ? Math.max(bands.night, bands.blueHour * 0.55, bands.sunset * 0.18) * 1.15 : bands.night * 0.08;
        if (weatherMode === 'RAIN') wm.emissiveIntensity *= 1.08;
      }

      const label = document.getElementById('daynight-label'), pill = document.getElementById('daynight-pill');
      if (label && pill) {
        let icon = '☀️', text = 'DAY';
        if (bands.sunset > 0.08) { icon = '🌇'; text = 'SUNSET'; }
        else if (bands.sunrise > 0.08) { icon = '🌅'; text = 'SUNRISE'; }
        else if (bands.night > 0.5) { icon = '🌙'; text = 'NIGHT'; }
        else if (bands.blueHour > 0.08 || bands.dawnBlue > 0.08) { icon = '🌌'; text = 'BLUE HOUR'; }
        else if (dayPhase > 0.10 && dayPhase < 0.20) { icon = '🌤️'; text = 'MORNING'; }
        pill.firstChild.textContent = icon + ' '; label.innerText = text;
      }
    }

    setWeatherMode('CLEAR', false);

    // --- 8. SMOOTH 60FPS GAME LOOP ---
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      updateDayNightCycle(delta);
      updateClouds(delta);
      updateRain(delta);
      updateBirds(clock.elapsedTime);

      if (!gamePaused && !player.crashed && missionPhase === 'delivery') {
        missionTimeLeft = Math.max(0, missionTimeLeft - delta);
        updateMissionHud();
        if (missionTimeLeft <= 0) failTimedOrder();
      }

      // Reference framerate for tuning constants below (values were originally tuned per-frame at ~60fps)
      const dt60 = delta * 60;

      if (!gamePaused && !player.crashed) {
        const stats = getActiveStats(); // combined bike + gear multipliers
        const sprintHeld = keys['ShiftLeft'] || keys['ShiftRight'];
        const sprinting = sprintHeld && player.stamina > 0 && (keys['KeyW'] || keys['ArrowUp']);
        player.sprinting = sprinting;
        const maxPedalSpeed = 0.65 * stats.speedMult * (sprinting ? SPRINT_SPEED_MULT : 1);
        const pedalAccel = 0.009 * stats.accelMult * (sprinting ? SPRINT_ACCEL_MULT : 1);
        const isSkidding = (keys['KeyS'] || keys['ArrowDown']) && Math.abs(player.speed) > 0.08;

        // HUD Skid Badge
        document.getElementById('skid-badge').style.opacity = isSkidding ? '1' : '0';
        document.getElementById('sprint-badge').style.opacity = sprinting ? '1' : '0';

        if (keys['KeyW'] || keys['ArrowUp']) {
          player.speed = Math.min(player.speed + pedalAccel * dt60, maxPedalSpeed);
        } else if (isSkidding) {
          // Smooth Fixed-Gear Skid Braking
          player.speed = THREE.MathUtils.lerp(player.speed, 0, 1 - Math.pow(1 - 0.07, dt60));
        } else {
          // Rolling resistance
          player.speed = THREE.MathUtils.lerp(player.speed, 0, 1 - Math.pow(1 - 0.012, dt60));
        }

        // Steer & Lean Dynamics
        const steerInput = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) - (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
        player.steer = THREE.MathUtils.lerp(player.steer, steerInput * 0.038 * stats.handleMult, 1 - Math.pow(1 - 0.15, dt60));
        player.heading += player.steer * (player.speed / maxPedalSpeed) * dt60;

        const targetLean = -steerInput * 0.35 * (player.speed / maxPedalSpeed);
        player.lean = THREE.MathUtils.lerp(player.lean, targetLean, 1 - Math.pow(1 - 0.12, dt60));

        // Fish-Tail / Skid Yaw Animation — steering drives the fishtail direction; with no
        // steering input it settles into a gentle back-and-forth wobble instead of the old
        // fixed one-sided lean, which always kicked the same way no matter what.
        let targetSkidYaw = 0;
        if (isSkidding) {
          player.skidWobblePhase += dt60 * 0.05;
          targetSkidYaw = steerInput !== 0
            ? steerInput * 0.45
            : Math.sin(player.skidWobblePhase) * 0.22;
        }
        player.skidYaw = THREE.MathUtils.lerp(player.skidYaw, targetSkidYaw, 1 - Math.pow(1 - 0.14, dt60));

        // Skid dust: kick up particles from the rear wheel while actively skidding
        if (isSkidding) {
          skidSpawnTimer -= delta;
          if (skidSpawnTimer <= 0) {
            backWheel.getWorldPosition(_skidWorldPos);
            spawnSkidDust(_skidWorldPos);
            skidSpawnTimer = 0.035;
          }
        }
        updateSkidDust(delta);

        // Air Spin Trick — a full 360° while airborne, gated by stamina (spent on trigger
        // in the keydown handler above). Eased for a snappy feel rather than linear.
        if (player.spinning) {
          player.spinElapsed += delta;
          const progress = Math.min(player.spinElapsed / player.spinDuration, 1);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          player.spinYawExtra = eased * Math.PI * 2;
          if (progress >= 1) {
            player.spinning = false;
            player.spinYawExtra = 0;
            player.coins += 8; // small payout for landing a clean full rotation
            updateCoinHud();
            showToast('Clean Spin! +🪙8');
            addTrainingXP(6);
          }
        }
        // Stamina regenerates steadily whenever it's not actively being spent on a spin
        if (sprinting) {
          player.stamina = Math.max(0, player.stamina - SPRINT_STAMINA_DRAIN * delta);
        } else if (!player.spinning) {
          player.stamina = Math.min(player.maxStamina, player.stamina + SPIN_STAMINA_REGEN * delta);
        }
        updateStaminaHud();

        // Vertical Bunny Hop / Gravity
        if (!player.isGrounded) {
          player.vSpeed -= 0.011 * dt60;
          playerRoot.position.y += player.vSpeed * dt60;
          player.pitchHop = THREE.MathUtils.lerp(player.pitchHop, player.vSpeed * 0.8, 1 - Math.pow(1 - 0.2, dt60));
          if (playerRoot.position.y <= 0) {
            playerRoot.position.y = 0;
            player.isGrounded = true;
            player.vSpeed = 0;
            player.pitchHop = 0;
            if (player.spinning) {
              // Landed before the spin finished — cut it short cleanly, no bonus this time.
              player.spinning = false;
              player.spinYawExtra = 0;
            }
          }
        }

        // Proposed translation
        const nextX = playerRoot.position.x - Math.sin(player.heading) * player.speed * dt60;
        const nextZ = playerRoot.position.z - Math.cos(player.heading) * player.speed * dt60;

        // Zero-Damage Solid Building Collision (Deflects smoothly without crashing)
        const resolved = resolveBuildingCollision(nextX, nextZ);
        playerRoot.position.x = resolved.x;
        playerRoot.position.z = resolved.z;
        if (resolved.collided) {
          player.speed *= Math.pow(0.94, dt60); // Mild friction slowdown when scraping walls
        }

        // Apply Rotations to Root and Visual Rig
        playerRoot.rotation.y = player.heading;
        playerVisual.rotation.set(player.pitchHop, player.skidYaw + player.spinYawExtra, player.lean);

        // Fluid Wheel & Pedaling Animation
        if (!isSkidding) {
          player.pedalPhase += player.speed * 2.8 * dt60;
          frontWheel.rotation.x += player.speed * 2.8 * dt60;
          backWheel.rotation.x += player.speed * 2.8 * dt60;
          // BUGFIX: left/right cranks were rotating in sync (both feet rising and
          // falling together), while the legs above already alternate correctly.
          // Real cranks sit 180° apart on the axle — offset one by PI to match.
          crankL.rotation.x = player.pedalPhase;
          crankR.rotation.x = player.pedalPhase + Math.PI;
        } else {
          // Front wheel still rolls, back wheel locked during skid
          frontWheel.rotation.x += player.speed * 2.8 * dt60;
        }

        barStem.rotation.y = THREE.MathUtils.lerp(barStem.rotation.y, player.steer * 4.2, 1 - Math.pow(1 - 0.2, dt60));

        // Smooth Sinusoidal Rider Leg Cadence
        const legMotion = Math.sin(player.pedalPhase) * 0.48;
        legLeftPivot.rotation.x = legMotion;
        legRightPivot.rotation.x = -legMotion;

        // Lively body animation: subtle torso bob synced to cadence (two bobs per crank
        // revolution, one per leg drive) plus a slight head tilt into turns.
        const bobOffset = Math.abs(Math.sin(player.pedalPhase * 2)) * 0.015 * (Math.abs(player.speed) / maxPedalSpeed);
        torso.position.y = 1.15 - bobOffset;
        head.position.y = 1.4 - bobOffset * 0.7;
        head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, -player.steer * 2.5, 1 - Math.pow(1 - 0.15, dt60));
      }

      // Speed & Skid Camera Feel: FOV pulls wider at speed for a sense of pace,
      // and a small handheld-style shake kicks in while actively skidding.
      const speedRatio = Math.min(Math.abs(player.speed) / (0.65), 1);
      const targetFov = 60 + speedRatio * 8;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.pow(1 - 0.1, dt60));
      camera.updateProjectionMatrix();
      const shakeStrength = (!player.crashed && (keys['KeyS'] || keys['ArrowDown']) && Math.abs(player.speed) > 0.08) ? 0.05 : 0;
      const shakeX = (Math.random() - 0.5) * shakeStrength;
      const shakeY = (Math.random() - 0.5) * shakeStrength;

      // Smooth chase camera by default; holding C lets the player orbit and zoom.
      const cameraYaw = player.heading + (freeCamera ? freeCameraYaw : 0);
      const cameraDistance = freeCamera ? freeCameraDistance : 6.2;
      const cameraHeight = freeCamera ? 3.2 + freeCameraPitch * 5 : 3.2;
      const camOffset = new THREE.Vector3(
        Math.sin(cameraYaw) * cameraDistance + shakeX,
        cameraHeight + shakeY,
        Math.cos(cameraYaw) * cameraDistance
      );
      camera.position.lerp(playerRoot.position.clone().add(camOffset), 1 - Math.pow(1 - (freeCamera ? 0.22 : 0.16), dt60));
      camera.lookAt(playerRoot.position.x, playerRoot.position.y + 1.1 + (freeCamera ? freeCameraPitch * 1.5 : 0), playerRoot.position.z);

      // Stream Infinite World
      updateChunks(playerRoot.position.x, playerRoot.position.z);

      // Traffic AI Simulation
      traffic.forEach(car => {
        if (car.axisZ) {
          car.position.z += car.speed * dt60;
        } else {
          car.position.x += car.speed * dt60;
        }

        if (car.position.distanceTo(playerRoot.position) > 130) {
          const nearestChunkX = Math.round((playerRoot.position.x + (Math.random() - 0.5) * 80) / CHUNK_SIZE) * CHUNK_SIZE;
          const nearestChunkZ = Math.round((playerRoot.position.z + (Math.random() - 0.5) * 80) / CHUNK_SIZE) * CHUNK_SIZE;
          const laneOffset = (car.dir === 1) ? 4.8 : -4.8;

          if (car.axisZ) {
            car.position.set(nearestChunkX + laneOffset, 0, playerRoot.position.z + (car.dir === 1 ? -90 : 90));
          } else {
            car.position.set(playerRoot.position.x + (car.dir === 1 ? -90 : 90), 0, nearestChunkZ + laneOffset);
          }
        }

        // Colliding with moving cars still triggers car crash
        if (!player.crashed && car.position.distanceTo(playerRoot.position) < 2.4) {
          triggerCarCrash();
        }
      });

      // Ambient NPC Cyclist Simulation — ride the shoulder, pedal in sync with their travel,
      // respawn near the player like traffic does. Purely decorative: no collision with the player.
      npcCyclists.forEach(cyc => {
        if (cyc.axisZ) {
          cyc.position.z += cyc.speed * dt60;
        } else {
          cyc.position.x += cyc.speed * dt60;
        }

        cyc.pedalPhase += Math.abs(cyc.speed) * 2.8 * dt60;
        cyc.wheelF.rotation.x += Math.abs(cyc.speed) * 2.8 * dt60;
        cyc.wheelB.rotation.x += Math.abs(cyc.speed) * 2.8 * dt60;
        const npcLegMotion = Math.sin(cyc.pedalPhase) * 0.42;
        cyc.legL.rotation.x = npcLegMotion;
        cyc.legR.rotation.x = -npcLegMotion;

        if (cyc.position.distanceTo(playerRoot.position) > 130) {
          const nearestChunkX = Math.round((playerRoot.position.x + (Math.random() - 0.5) * 80) / CHUNK_SIZE) * CHUNK_SIZE;
          const nearestChunkZ = Math.round((playerRoot.position.z + (Math.random() - 0.5) * 80) / CHUNK_SIZE) * CHUNK_SIZE;
          const laneOffset = (cyc.dir === 1 ? 1 : -1) * 8.3;

          if (cyc.axisZ) {
            cyc.position.set(nearestChunkX + laneOffset, 0, playerRoot.position.z + (cyc.dir === 1 ? -90 : 90));
          } else {
            cyc.position.set(playerRoot.position.x + (cyc.dir === 1 ? -90 : 90), 0, nearestChunkZ + laneOffset);
          }
        }
      });

      // Pedestrians Simulation strictly on Sidewalks + Fluid Walking Motion
      pedestrians.forEach(ped => {
        ped.position.z += ped.walkSpeed * ped.dir * dt60;

        // Animated walking swing — driven by an accumulated phase (not wall-clock time),
        // so strides stay smooth and frame-rate independent instead of jittering.
        ped.walkPhase += ped.walkSpeed * 5.4 * dt60;
        const walkCycle = Math.sin(ped.walkPhase) * 0.45;
        ped.legL.rotation.x = walkCycle;
        ped.legR.rotation.x = -walkCycle;

        if (ped.position.distanceTo(playerRoot.position) > 100) {
          // BUGFIX: pedestrians used to respawn at an offset from the player's raw
          // position, which only lands on an actual sidewalk when the player happens
          // to be sitting exactly on a north-south road. The rest of the time it
          // dropped pedestrians into open space — including the middle of the street.
          // Snap to the nearest real road centerline (roads repeat every CHUNK_SIZE
          // units) so the sidewalk offset always lands on a real sidewalk.
          const nearestRoadX = Math.round(playerRoot.position.x / CHUNK_SIZE) * CHUNK_SIZE;
          const swLaneX = (Math.random() > 0.5 ? 1 : -1) * (ROAD_WIDTH/2 + 1.8 + Math.random() * 1.2);
          ped.position.set(
            nearestRoadX + swLaneX,
            0.35,
            playerRoot.position.z + (Math.random() - 0.5) * 70
          );
          ped.dir = Math.random() > 0.5 ? 1 : -1;
          ped.rotation.y = ped.dir === 1 ? Math.PI : 0;
        }
      });

      // Checkpoint Trigger & Compass Needle
      const cpDist = playerRoot.position.distanceTo(targetCP);
      if (cpDist < 4.5) {
        nextCheckpoint();
      }

      const forward = new THREE.Vector3(-Math.sin(player.heading), 0, -Math.cos(player.heading));
      const targetDir = targetCP.clone().sub(playerRoot.position).normalize();
      const angle = Math.atan2(
        forward.x * targetDir.z - forward.z * targetDir.x,
        forward.x * targetDir.x + forward.z * targetDir.z
      );

      document.getElementById('arrow').style.transform = `rotate(${angle}rad)`;
      document.getElementById('speed-val').innerText = Math.round(Math.abs(player.speed) * 55);
      document.getElementById('dist-val').innerText = Math.round(cpDist);

      cpRing.rotation.z += 0.02 * dt60;

      renderer.render(scene, camera);
    }

    // animate() is now kicked off by startGame() once the player picks a mode
    // from the start menu, rather than running unconditionally from load.

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
