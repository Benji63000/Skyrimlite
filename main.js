import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165/build/three.module.js';

// ---- Simple 2D value-noise (no external perlin) ----
function fract(x){ return x - Math.floor(x); }
function rand2(i, j){
  // deterministic hash → [0,1)
  return fract(Math.sin(i*127.1 + j*311.7) * 43758.5453);
}
function smoothstep(t){ return t*t*(3-2*t); }
function noise2D(x, z){
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const v00 = rand2(xi, zi);
  const v10 = rand2(xi+1, zi);
  const v01 = rand2(xi, zi+1);
  const v11 = rand2(xi+1, zi+1);
  const u = smoothstep(xf), v = smoothstep(zf);
  const a = v00*(1-u) + v10*u;
  const b = v01*(1-u) + v11*u;
  return a*(1-v) + b*v; // [0,1)
}

// ---- Config knobs (tuned for Pi 5) ----
const WORLD_SIZE = 400;         // terrain size
const GRID = 128;               // terrain resolution (lower = faster)

// ---- DOM ----
const resScale = document.getElementById('resScale');
const drawDist = document.getElementById('drawDist');
const resVal = document.getElementById('resVal');
const distVal = document.getElementById('distVal');
const logBox = document.getElementById('log');
const lockBtn = document.getElementById('lock');
const resetBtn = document.getElementById('reset');

// ---- Renderer & Scene ----
const renderer = new THREE.WebGLRenderer({ antialias:false, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0e11, 0.006);

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
camera.position.set(0, 4, 8);

// Lighting
const hemi = new THREE.HemisphereLight(0xe0f7ff, 0x223344, 1.0);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(80, 120, 60);
scene.add(dir);

// Materials
const matGround = new THREE.MeshStandardMaterial({ color:0x557755, roughness:1, metalness:0, flatShading:true });
const matRock = new THREE.MeshStandardMaterial({ color:0x666666, roughness:1, metalness:0, flatShading:true });
const matWood = new THREE.MeshStandardMaterial({ color:0x8b5a2b, roughness:1, metalness:0, flatShading:true });
const matSkin = new THREE.MeshStandardMaterial({ color:0x50372b, roughness:1, metalness:0, flatShading:true });
const matCloth = new THREE.MeshStandardMaterial({ color:0x2f4f6f, roughness:1, metalness:0, flatShading:true });
const matFire = new THREE.MeshBasicMaterial({ color:0xff7a00 });

// ---- Resize / performance ----
function applyResScale() {
  const scale = parseFloat(resScale.value);
  resVal.textContent = scale.toFixed(2);
  const w = Math.floor(window.innerWidth * scale);
  const h = Math.floor(window.innerHeight * scale);
  renderer.setSize(w, h, false);
}
function applyDrawDist() {
  const dist = parseFloat(drawDist.value);
  distVal.textContent = dist.toFixed(0);
  camera.far = dist;
  camera.updateProjectionMatrix();
}
function onResize() { applyResScale(); }
window.addEventListener('resize', onResize);
resScale.addEventListener('input', applyResScale);
drawDist.addEventListener('input', applyDrawDist);
applyResScale();
applyDrawDist();

// ---- Terrain generation using noise2D ----
function heightAt(x,z){ 
  const n = 0.6*noise2D(x/24, z/24) + 0.35*noise2D(x/12, z/12) + 0.05*noise2D(x/6, z/6);
  return (n*2 - 1) * 16; // approx [-16,16]
}
function makeTerrain(size, grid) {
  const geo = new THREE.PlaneGeometry(size, size, grid, grid);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for (let i=0; i<pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  geo.computeVertexNormals();
  const arr = pos.array;
  for (let i=0; i<arr.length; i++) arr[i] = Math.round(arr[i]*100)/100;
  return geo;
}

const ground = new THREE.Mesh(makeTerrain(WORLD_SIZE, GRID), matGround);
scene.add(ground);

// Props
function rand(min,max){ return Math.random()*(max-min)+min; }
const propGroup = new THREE.Group();
scene.add(propGroup);
for (let i=0;i<120;i++){
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4,2.2),0), matRock);
  const x = rand(-WORLD_SIZE/2, WORLD_SIZE/2);
  const z = rand(-WORLD_SIZE/2, WORLD_SIZE/2);
  stone.position.set(x, heightAt(x,z), z);
  propGroup.add(stone);
}
for (let i=0;i<60;i++){
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.4, rand(2,4), 6), matWood);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(rand(1.2,2.2), rand(2,3), 7), matGround);
  const x = rand(-WORLD_SIZE/2, WORLD_SIZE/2);
  const z = rand(-WORLD_SIZE/2, WORLD_SIZE/2);
  const y = heightAt(x,z);
  trunk.position.set(x, y+1.2, z);
  crown.position.set(x, y+2.8, z);
  propGroup.add(trunk); propGroup.add(crown);
}

// ---- Player ----
const player = new THREE.Group();
player.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 8), matSkin));
scene.add(player);
const sword = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), matRock);
sword.position.set(0.5, 0.8, -0.2);
sword.rotation.set(0, Math.PI/4, 0);
player.add(sword);

let velocity = new THREE.Vector3();
let onGround = false;
let yaw = 0, pitch = 0;
let swordCooldown = 0;

// Camera follow target
const camTarget = new THREE.Object3D();
scene.add(camTarget);
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

document.body.addEventListener('click', () => { document.body.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  lockBtn.textContent = (document.pointerLockElement) ? 'Mouse captured ✔' : 'Click → capture mouse';
});
document.addEventListener('mousemove', (e)=>{
  if (document.pointerLockElement) {
    yaw -= e.movementX * 0.003;
    pitch -= e.movementY * 0.002;
    pitch = clamp(pitch, -1.1, 1.1);
  }
});
const pressed = new Set();
document.addEventListener('keydown', (e)=>{ pressed.add(e.code); });
document.addEventListener('keyup',   (e)=>{ pressed.delete(e.code); });
function key(k){ return pressed.has(k); }

// NPC
const npc = new THREE.Group();
npc.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 8), matCloth));
scene.add(npc);
npc.position.set(6, heightAt(6,0)+1.2, 0);
let npcDir = new THREE.Vector3(1,0,0);
let npcTimer = 0;

// Dragon
const dragon = new THREE.Group();
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.2, 6, 8), matRock);
torso.rotation.set(0,0,Math.PI/2);
dragon.add(torso);
const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 6), matRock);
head.position.set(1.4, 0.2, 0);
dragon.add(head);
const wingL = new THREE.Mesh(new THREE.PlaneGeometry(2.5,1.2,1,1), matRock);
wingL.position.set(0,0,1.1); wingL.rotation.y = Math.PI/2;
const wingR = wingL.clone(); wingR.position.z = -1.1;
dragon.add(wingL); dragon.add(wingR);
scene.add(dragon);
let dragonAngle = 0;
let dragonHP = 5;

// Fire
const fireGeom = new THREE.SphereGeometry(0.1, 6, 6);
const fireGroup = new THREE.Group();
scene.add(fireGroup);
function breatheFire() {
  for (let i=0;i<30;i++){
    const p = new THREE.Mesh(fireGeom, matFire);
    p.position.copy(dragon.position).add(new THREE.Vector3(1.6,0.2,0));
    const dir = new THREE.Vector3(1, (Math.random()*0.4-0.2), (Math.random()*0.6-0.3)).normalize();
    p.userData = { vel: dir.multiplyScalar(8+Math.random()*4), life: 1.0+Math.random()*0.6 };
    fireGroup.add(p);
  }
}
let fireTimer = 0;

function log(msg){ logBox.textContent = msg; }

const clock = new THREE.Clock();
let mouseDown = false;
window.addEventListener('mousedown', ()=>{ mouseDown=true; });
window.addEventListener('mouseup', ()=>{ mouseDown=false; });

function update(dt){
  const speed = 18 * (key('ShiftLeft') || key('ShiftRight') ? 1.5 : 1);
  const forward = key('KeyW') ? 1 : 0;
  const back = key('KeyS') ? 1 : 0;
  const left = key('KeyA') ? 1 : 0;
  const right = key('KeyD') ? 1 : 0;
  const jump = key('Space');
  const interact = key('KeyE');

  player.rotation.y = yaw;

  const camOffset = new THREE.Vector3(0, 2.0 - pitch*0.5, 4.5 + Math.cos(pitch)*0.5);
  camOffset.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
  camTarget.position.copy(player.position).add(new THREE.Vector3(0,1.2,0));
  camera.position.copy(camTarget.position.clone().add(camOffset));
  camera.lookAt(camTarget.position);

  const dirMove = new THREE.Vector3((right-left), 0, (back-forward));
  if (dirMove.lengthSq()>0) {
    dirMove.normalize();
    dirMove.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    velocity.x = THREE.MathUtils.damp(velocity.x, dirMove.x*speed, 8, dt);
    velocity.z = THREE.MathUtils.damp(velocity.z, dirMove.z*speed, 8, dt);
  } else {
    velocity.x = THREE.MathUtils.damp(velocity.x, 0, 8, dt);
    velocity.z = THREE.MathUtils.damp(velocity.z, 0, 8, dt);
  }

  velocity.y -= 32*dt;
  const below = heightAt(player.position.x, player.position.z)+1.2;
  if (player.position.y <= below) {
    player.position.y = below;
    velocity.y = 0;
    onGround = true;
  } else onGround = false;
  if (jump && onGround) { velocity.y = 12; onGround = false; }
  player.position.addScaledVector(velocity, dt);

  if (mouseDown && swordCooldown<=0) {
    swordCooldown = 0.5;
    sword.rotation.z = -1.2;
    const hitTargets = [dragon, npc];
    for (const t of hitTargets){
      const dist = player.position.distanceTo(t.position);
      if (dist < 3.0) {
        if (t===dragon) { dragonHP -= 1; log(`Hit dragon! HP: ${dragonHP}`); }
        else { log('NPC: "Hey! Watch it!"'); }
      }
    }
  }
  swordCooldown -= dt;
  sword.rotation.z = THREE.MathUtils.damp(sword.rotation.z, 0, 8, dt);

  npcTimer -= dt;
  if (npcTimer<=0){
    npcTimer = 2+Math.random()*3;
    const ang = Math.random()*Math.PI*2;
    npcDir.set(Math.cos(ang),0,Math.sin(ang));
  }
  const npcSpeed = 2.2;
  const nx = npc.position.x + npcDir.x*npcSpeed*dt;
  const nz = npc.position.z + npcDir.z*npcSpeed*dt;
  npc.position.set(nx, heightAt(nx,nz)+1.2, nz);

  if (interact && player.position.distanceTo(npc.position) < 2.2){
    log('NPC: "Beautiful day for dragon-watching, isn’t it?"');
  }

  dragonAngle += dt*0.4;
  const radius = 40;
  dragon.position.set(Math.cos(dragonAngle)*radius, 18+Math.sin(dragonAngle*2)*2, Math.sin(dragonAngle)*radius);
  dragon.lookAt(player.position);
  const wingX = Math.sin(performance.now()*0.004)*0.6;
  dragon.children[2].rotation.x = wingX;
  dragon.children[3].rotation.x = -wingX;

  fireTimer -= dt;
  if (fireTimer<=0){
    fireTimer = 3.5 + Math.random()*2.0;
    if (dragonHP>0) breatheFire();
  }
  for (let i=fireGroup.children.length-1;i>=0;i--){
    const p = fireGroup.children[i];
    p.userData.life -= dt;
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 9.8*dt*0.6;
    if (p.userData.life<=0) fireGroup.remove(p);
    else if (p.position.distanceTo(player.position) < 1.2){
      velocity.add(new THREE.Vector3().subVectors(player.position, dragon.position).setY(0).normalize().multiplyScalar(6));
      log('You got scorched!');
    }
  }
  if (dragonHP<=0 && dragon.visible){ dragon.visible = false; log('Dragon defeated!'); }
}

function animate() {
  const dt = Math.min(0.033, clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
