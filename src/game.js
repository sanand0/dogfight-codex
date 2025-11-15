// @ts-check
import * as THREE from "three";
import { html, render } from "lit-html";

const SKY_COLOR = 0x70c8ff;
const HORIZON_COLOR = 0x2360a5;
const CLOUD_COLOR = 0xffffff;
const BOOST_MULTIPLIER = 1.6;
const BASE_SPEED = 260;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} hudRoot
 * @returns {{ dispose: () => void, updateFlightInfo: (info: { speed?: number; altitude?: number; }) => void }}
 */
export function createGame(canvas, hudRoot, win = window) {
  const renderer = buildRenderer(canvas, win);
  const scene = buildScene();
  const camera = new THREE.PerspectiveCamera(
    70,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    5000,
  );
  camera.position.set(0, 4, 12);

  const jet = buildJet();
  scene.add(jet);
  const exhaust = buildExhaust();
  jet.add(exhaust);

  addLights(scene);
  addSky(scene);
  addClouds(scene);
  addHorizon(scene);

  const hud = createHud(hudRoot);
  const audio = ensureEngineAudio(win);
  hud.update({ speed: 0, altitude: 0 });

  const state = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    speed: BASE_SPEED,
    altitude: 0,
    targetSpeed: BASE_SPEED,
    boost: false,
    controls: new Map(),
    disposed: false,
  };

  const clock = new THREE.Clock();
  const followOffset = new THREE.Vector3(0, 4, 12);
  const lookOffset = new THREE.Vector3(0, 0, -40);
  const tmpForward = new THREE.Vector3(0, 0, -1);
  const tmpUp = new THREE.Vector3(0, 1, 0);

  const handleKeyDown = (event) => {
    state.controls.set(event.key.toLowerCase(), true);
    if (event.code === "Space") {
      event.preventDefault();
    }
  };

  const handleKeyUp = (event) => {
    state.controls.set(event.key.toLowerCase(), false);
  };

  win.addEventListener("keydown", handleKeyDown);
  win.addEventListener("keyup", handleKeyUp);

  const resizeObserver =
    typeof win.ResizeObserver === "function"
      ? new win.ResizeObserver(() => {
          resizeRenderer(renderer, camera, canvas, win);
        })
      : { observe: () => {}, disconnect: () => {} };
  resizeObserver.observe?.(canvas);
  resizeRenderer(renderer, camera, canvas, win);

  const animate = () => {
    if (state.disposed) {
      return;
    }
    const delta = clock.getDelta();
    updateControls(state, delta);
    updateJetPhysics(jet, state, delta);
    updateCamera(camera, jet, followOffset, lookOffset, tmpForward, tmpUp);
    updateExhaust(exhaust, state.speed, win);
    hud.update({
      speed: Math.round(state.speed),
      altitude: Math.round(state.altitude),
    });
    renderer.render(scene, camera);
    requestFrame(win, animate);
  };

  requestFrame(win, animate);
  playEngineLoop(audio);

  const dispose = () => {
    state.disposed = true;
    win.removeEventListener("keydown", handleKeyDown);
    win.removeEventListener("keyup", handleKeyUp);
    resizeObserver.disconnect();
    if (!audio.paused) {
      audio.pause();
    }
  };

  const updateFlightInfo = ({ speed, altitude }) => {
    if (typeof speed === "number" && Number.isFinite(speed)) {
      state.speed = speed;
      state.targetSpeed = speed;
    }
    if (typeof altitude === "number" && Number.isFinite(altitude)) {
      state.altitude = altitude;
      jet.position.y = altitude * 0.01;
    }
    hud.update({
      speed: Math.round(state.speed),
      altitude: Math.round(state.altitude),
    });
  };

  return { dispose, updateFlightInfo };
}

/**
 * @returns {THREE.WebGLRenderer & { render: (scene: THREE.Scene, camera: THREE.Camera) => void }}
 */
function buildRenderer(canvas, win) {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(win.devicePixelRatio || 1);
    const width = canvas.clientWidth || win.innerWidth;
    const height = canvas.clientHeight || win.innerHeight;
    renderer.setSize(width, height, false);
    return renderer;
  } catch (error) {
    const stub = {
      domElement: canvas,
      render: () => {},
      setPixelRatio: () => {},
      setSize: () => {},
    };
    return /** @type {THREE.WebGLRenderer & { render: (scene: THREE.Scene, camera: THREE.Camera) => void }} */ (
      stub
    );
  }
}

/** @returns {THREE.Scene} */
function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.FogExp2(SKY_COLOR, 0.0009);
  return scene;
}

function addLights(scene) {
  const ambient = new THREE.HemisphereLight(0xffffff, HORIZON_COLOR, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(200, 400, 100);
  scene.add(sun);
}

function addSky(scene) {
  const geometry = new THREE.SphereGeometry(2000, 16, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(SKY_COLOR) },
      bottomColor: { value: new THREE.Color(HORIZON_COLOR) },
    },
    vertexShader: `varying vec3 vPosition;\nvoid main() {\n  vPosition = position;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}`,
    fragmentShader: `varying vec3 vPosition;\nuniform vec3 topColor;\nuniform vec3 bottomColor;\nvoid main() {\n  float h = normalize(vPosition + vec3(0.0, 200.0, 0.0)).y;\n  vec3 color = mix(bottomColor, topColor, max(pow(h, 0.6), 0.0));\n  gl_FragColor = vec4(color, 1.0);\n}`,
    side: THREE.BackSide,
  });
  const sky = new THREE.Mesh(geometry, material);
  scene.add(sky);
}

function addHorizon(scene) {
  const geometry = new THREE.CylinderGeometry(1500, 1500, 10, 32, 1, true);
  const material = new THREE.MeshBasicMaterial({
    color: HORIZON_COLOR,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const horizon = new THREE.Mesh(geometry, material);
  horizon.position.y = -80;
  scene.add(horizon);
}

function addClouds(scene) {
  const cloudGeometry = new THREE.SphereGeometry(20, 8, 8);
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: CLOUD_COLOR });
  for (let i = 0; i < 30; i += 1) {
    const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloud.scale.setScalar(0.8 + Math.random() * 2.2);
    cloud.position.set(
      (Math.random() - 0.5) * 1600,
      Math.random() * 300 + 80,
      -Math.random() * 2000 - 200,
    );
    scene.add(cloud);
  }
}

/** @returns {THREE.Group} */
function buildJet() {
  const jet = new THREE.Group();
  const bodyGeometry = new THREE.CylinderGeometry(0.3, 1.8, 6, 8, 1, false);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4c6b,
    flatShading: true,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.rotation.z = Math.PI / 2;
  jet.add(body);

  const nose = new THREE.ConeGeometry(1.2, 2.2, 8);
  const noseMesh = new THREE.Mesh(
    nose,
    new THREE.MeshStandardMaterial({ color: 0xd64b4b, flatShading: true }),
  );
  noseMesh.position.set(3.5, 0, 0);
  noseMesh.rotation.z = Math.PI / 2;
  jet.add(noseMesh);

  const tail = new THREE.BoxGeometry(1.6, 0.4, 3.6);
  const tailMesh = new THREE.Mesh(
    tail,
    new THREE.MeshStandardMaterial({ color: 0x2d3b54, flatShading: true }),
  );
  tailMesh.position.set(-3.5, 0.3, 0);
  jet.add(tailMesh);

  const wingGeometry = new THREE.BoxGeometry(2.5, 0.2, 10);
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d7fbf,
    flatShading: true,
  });
  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.position.set(0, 0, 4.5);
  jet.add(leftWing);
  const rightWing = leftWing.clone();
  rightWing.position.z = -4.5;
  jet.add(rightWing);

  const stabilizerGeometry = new THREE.BoxGeometry(1.2, 0.2, 4);
  const stabilizerMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d7fbf,
    flatShading: true,
  });
  const topStabilizer = new THREE.Mesh(stabilizerGeometry, stabilizerMaterial);
  topStabilizer.position.set(-3.5, 1.6, 0);
  topStabilizer.rotation.x = THREE.MathUtils.degToRad(70);
  jet.add(topStabilizer);

  jet.rotation.y = Math.PI;
  jet.position.set(0, 150, 0);
  return jet;
}

/** @returns {THREE.Mesh} */
function buildExhaust() {
  const geometry = new THREE.ConeGeometry(1.2, 3, 12);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffcc66,
    transparent: true,
    opacity: 0.7,
  });
  const exhaust = new THREE.Mesh(geometry, material);
  exhaust.position.set(-4.5, 0, 0);
  exhaust.rotation.z = Math.PI;
  return exhaust;
}

/**
 * @param {HTMLElement} hudRoot
 * @returns {{ update: (values: { speed: number; altitude: number }) => void }}
 */
function createHud(hudRoot) {
  hudRoot.className = "position-absolute top-0 start-0 p-3 text-white fs-5";
  hudRoot.id = "hud";
  const template = ({ speed, altitude }) =>
    html`<div
      class="d-flex flex-column gap-1 bg-dark bg-opacity-50 rounded-3 px-3 py-2"
    >
      <span
        >Speed: <span id="speed-value" class="fw-bold">${speed}</span> m/s</span
      >
      <span
        >Altitude:
        <span id="altitude-value" class="fw-bold">${altitude}</span> m</span
      >
    </div>`;
  const update = (values) => {
    render(template(values), hudRoot);
  };
  return { update };
}

function ensureEngineAudio(win) {
  const doc = win.document;
  let audio = doc.querySelector('audio[data-role="engine"]');
  if (!audio) {
    audio = doc.createElement("audio");
    audio.dataset.role = "engine";
    doc.body.append(audio);
  }
  audio.loop = true;
  audio.volume = 0.35;
  audio.src = buildEngineLoop();
  return audio;
}

function playEngineLoop(audio) {
  if (audio.readyState >= 2) {
    audio.play().catch(() => {});
    return;
  }
  audio.addEventListener(
    "canplaythrough",
    () => {
      audio.play().catch(() => {});
    },
    { once: true },
  );
  audio.load();
}

function resizeRenderer(renderer, camera, canvas, win) {
  const width = canvas.clientWidth || win.innerWidth;
  const height = canvas.clientHeight || win.innerHeight;
  if (typeof renderer.setSize === "function") {
    renderer.setSize(width, height, false);
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function requestFrame(win, step) {
  const raf = win.requestAnimationFrame?.bind(win);
  if (raf) {
    raf(step);
    return;
  }
  win.setTimeout?.(() => step(win.performance?.now?.() ?? Date.now()), 16);
}

function updateControls(state, delta) {
  const pitchUp = state.controls.get("arrowdown") || state.controls.get("s");
  const pitchDown = state.controls.get("arrowup") || state.controls.get("w");
  const rollLeft = state.controls.get("arrowleft") || state.controls.get("a");
  const rollRight = state.controls.get("arrowright") || state.controls.get("d");
  const yawLeft = state.controls.get("q");
  const yawRight = state.controls.get("e");
  const boost = state.controls.get(" ");

  const pitchTarget = (pitchUp ? -1 : 0) + (pitchDown ? 1 : 0);
  const rollTarget = (rollRight ? -1 : 0) + (rollLeft ? 1 : 0);
  const yawTarget = (yawRight ? -1 : 0) + (yawLeft ? 1 : 0);

  state.pitch = THREE.MathUtils.damp(state.pitch, pitchTarget, 4, delta);
  state.roll = THREE.MathUtils.damp(state.roll, rollTarget, 3, delta);
  state.yaw = THREE.MathUtils.damp(state.yaw, yawTarget, 4, delta);

  state.boost = Boolean(boost);
  const speedGoal = BASE_SPEED * (state.boost ? BOOST_MULTIPLIER : 1);
  state.targetSpeed = THREE.MathUtils.damp(
    state.targetSpeed,
    speedGoal,
    1.5,
    delta,
  );
  state.speed = THREE.MathUtils.damp(
    state.speed,
    state.targetSpeed,
    1.8,
    delta,
  );
}

function updateJetPhysics(jet, state, delta) {
  jet.rotation.x = state.pitch * 0.6;
  jet.rotation.z = state.roll * 0.9;
  jet.rotation.y += state.yaw * delta * 1.5;

  const forward = new THREE.Vector3(1, 0, 0);
  forward.applyQuaternion(jet.quaternion);
  jet.position.addScaledVector(forward, state.speed * delta);
  jet.position.y = THREE.MathUtils.clamp(jet.position.y, 20, 600);
  state.altitude = jet.position.y * 5;
}

function updateCamera(
  camera,
  jet,
  followOffset,
  lookOffset,
  tmpForward,
  tmpUp,
) {
  tmpForward.set(1, 0, 0).applyQuaternion(jet.quaternion);
  tmpUp.set(0, 1, 0).applyQuaternion(jet.quaternion);
  const offsetWorld = followOffset.clone().applyQuaternion(jet.quaternion);
  camera.position.copy(jet.position).add(offsetWorld);
  const lookAt = lookOffset
    .clone()
    .applyQuaternion(jet.quaternion)
    .add(jet.position);
  camera.up.copy(tmpUp);
  camera.lookAt(lookAt);
}

function updateExhaust(exhaust, speed, win) {
  const pulse = 0.5 + Math.sin(win.performance?.now?.() ?? Date.now()) * 0.1;
  exhaust.material.opacity = THREE.MathUtils.clamp(
    0.4 + (speed / 600) * 0.4 + pulse * 0.1,
    0.4,
    0.9,
  );
}

function buildEngineLoop() {
  const chunks = [
    "UklGRtIzAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0Ya4zAAAAAAAAAQADAAYACQANABIA",
    "FwAdACQAKwAyADoAQgBLAFQAXQBmAHAAeQCCAIsAlACcAKUArAC0ALoAwADGAMoAzgDRANMA1ADVANQA",
    "0gDOAMoAxQC+ALYArQCjAJgAjAB+AG8AYABPAD0AKgAXAAIA7v/Y/8H/qv+T/3v/Y/9K/zL/Gf8B/+n+",
    "0f66/qP+jf53/mP+T/48/iv+Gv4M/v798v3o/d/92P3T/dD9zv3P/dH91v3d/eb98f3+/Q3+Hv4x/kb+",
    "Xf53/pL+r/7N/u3+D/8z/1f/ff+l/83/9v8fAEoAdQCgAMwA+AAjAU8BegGkAc4B9wEeAkUCagKOArAC",
    "0ALuAgsDJQM8A1EDZAN0A4EDjAOTA5gDmQOYA5MDiwOAA3IDYQNMAzQDGgP8AtsCuAKRAmgCPAIOAt4B",
    "qwF2AT8BBwHNAJEAVQAXANn/mv9b/xv/2/6c/lz+Hv7g/aT9af0v/fj8wvyO/F38LvwC/Nn7s/uQ+3H7",
    "Vfs9+yn7GPsM+wP7//r/+gP7DPsZ+yr7P/tZ+3f7mfu/++n7F/xI/H78tvzy/DL9dP25/QD+Sv6W/uT+",
    "NP+F/9f/KQB9ANEAJQF5AcwBHgJwAsACDgNbA6UD7QMyBHUEtATvBCcFWwWLBbcF3gUBBh8GOAZLBloG",
    "ZAZoBmcGYAZUBkMGLAYPBu4FxwWbBWoFNAX5BLoEdgQuBOIDkgM+A+cCjQIwAtEBbwEMAaYAQADa/3L/",
    "Qf8D/7j+jP5P/hP+7/24/Rz9g/wb/Db8ivv0+3b7Tfs0+xz7BvsD+//6A/sK+yv7NvtF+2b7o/vL+///",
    "7gL8G/xW/J78xvwW/Uz9ov3f/cD+AP5m/pL+v/7i/vcB/w//Pv9z/7b/5v8sAE8AggCxAOUAEQFJAbQB",
    "6wEOAoQCwgJbA3ADvgPwA+sD3gPaA9sD6QP6A/kD7QNwA3sDeAPBA+kD6wPiA+sD2gPQA5sDdQOjA7kD",
    "6gPsA94DpgOKA3gDcgORA6EDjgN/A4kDvwPGA9EDswOnA38DkQOjA7MDnwNVA4oDfQPRA7UDWgNXA00D",
    "dAPkA70DXwNeA2cDWwOWA9ADZQNmA2sDWANSA1IDWwNeA1kDRgNBA1UDagNgA1QDTQNXA1oDWANaA0sD",
    "RwNLA0sDTANUA2wDfgPFA9YD0gPfA8wDwQO/A9YD0QPBA6EDhAOWA9EDvQN/A2EDZgOJA8YDuAPXA8gD",
    "swPEA8YDzQOxA6QDqAPdA9EDvAOYA5sDuAPJA8cDwQPFA8IDxwPJA8sDwwO5A50DbgNcA1kDYANSA0gD",
    "SQNWA2UDagNkA2MDcAOCA5cDyAPJA8kDzQPOA8wDyQPGA8EDvgO7A8IDugOTA4oDcgNvA3EDfgOaA8gD",
    "ywPPA9ADxgPCA7EDoQOYA3MDaANUA1MDWwNlA3EDfgOWA8sDygPFA8MDvQOoA6ADgwOGA4kDiwOMA4gD",
    "eQNiA1sDVANUA1UDTgNIA0wDWwNqA2wDZwNXA1QDVANeA2MDYwNYA0oDRQM+AzUDRgNWA14DYANfA2sD",
    "dgOCA48DlgPQA8oDvQOoA6gDugPQA8cDrwOSA3ADZANSA1MDRgNCA0UDUgNZAx8DEAMVAx0DIAMuAz4D",
    "TgNVA1YDUwNPA1cDaAOAA4kDnQOgA44DggN8A2wDWANRA0kDQwNGA0gDTANQA1MDVgNYA1sDYANhA14D",
    "XANhA2MDaAN0A3wDfAOCA4cDiAOEA3wDdQNuA2cDXwNPB18=",
  ];
  return `data:audio/wav;base64,${chunks.join("")}`;
}
