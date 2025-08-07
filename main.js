import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165/build/three.module.js';

/* -------------------- Value-noise 2D (sans perlin) -------------------- */
function fract(x){ return x - Math.floor(x); }
function hash2(i, j){ return fract(Math.sin(i*127.1 + j*311.7) * 43758.5453); }
function smoothstep(t){ return t*t*(3-2*t); }
function noise2D(x, z){
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const v00 = hash2(xi, zi), v10 = hash2(xi+1, zi);
  const v01 = hash2(xi, zi+1), v11 = hash2(xi+1, zi+1);
  const u = smoothstep(xf), v = smoothstep(zf);
  const a = v00*(1-u) + v10*u;
  const b = v01*(1-u) + v11*u;
  return a*(1-v) + b*v; // [0,1)
}

/* -------------------- Config Pi 5 -------------------- */
const WORLD_SIZE = 400;
const GRID = 128;
const GRAVITY = 32;
const MOVE_SPEED = 18;
const SPRINT_MULT = 1.5;
const JUMP_VELOCITY = 12;
const SWORD_RANGE = 3.0;
const FIRE_POOL_SIZE = 120;

/* -------------------- UI refs -------------------- */
const resScale = document.getElementById('resScale');
const drawDist = document.getElementById('drawDist');
const resVal = document.getElementById('resVal');
const distVal = document.getElementById('distVal');
const logBox  = document.getElementById('log');
const lockBtn = document.getElementById('lock');
const resetBtn= document.getElementById('reset');

/* -------------------- Renderer/Scene/Camera -------------------- */
const renderer = new THREE.WebGLRenderer({ antialias:false, powerPreference:'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0e11, 0.006);

const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
camera.position.set(0, 4, 8);

/* -------------------- Lumières + cycle jour/nuit -------------------- */
const hemi = new THREE.HemisphereLight(0xe0f7ff, 0x223344, 1.0);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(80, 120, 60);
scene.add(dir);
let dayClock = 0; // secondes simulées

/* -------------------- Materials -------------------- */
const matGround = new THREE.MeshStandardMaterial({ color:0x557755, roughness:1, metalness:0, flatShading:true });
const matRock   = new THREE.MeshStandardMaterial({ color:0x666666, roughness:1, metalness:0, flatShading:true });
const matWood   = new THREE.MeshStandardMaterial({ color:0x8b5a2b, roughness:1, metalness:0, flatShading:true });
const matSkin   = new THREE.MeshStandardMaterial({ color:0x50372b, roughness:1, metalness:0, flatShading:true });
const matCloth  = new THREE.MeshStandardMaterial({ color:0x2f4f6f, roughness:1, metalness:0, flatShading:true });
const matFire   = new THREE.MeshBasicMaterial({ color:0xff7a00 });

/* -------------------- Resize/Perf -------------------- */
function applyResScale(){
  const s = parseFloat(resScale.value);
  resVal.textContent = s.toFixed(2);
  renderer.setSize(Math.floor(window.innerWidth*s), Math.floor(window.innerHeight*s), false);
}
function applyDrawDist(){
  const d = parseFloat(drawDist.value);
  distVal.textContent = d.toFixed(0);
  camera.far = d; camera.updateProjectionMatrix();
}
window.addEventListener('resize', applyResScale);
resScale.addEventListener('input', applyResScale);
drawDist.addEventListener('input', applyDrawDist);
applyResScale(); applyDrawDist();

/* -------------------- Terrain -------------------- */
function heightAt(x,z){
  const n = 0.6*noise2D(x/24, z/24) + 0.35*noise2D(x/12, z/12) + 0.05*noise2D(x/6, z/6);
  return (n*2 - 1) * 16;
}
function makeTerrain(size, grid){
  const geo = new THREE.PlaneGeometry(size, size, grid, grid);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for (let i=0;i<pos.count;i++){
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const arr = pos.array;
  for (let i=0;i<arr.length;i++) arr[i] = Math.round(arr[i]*100)/100; // accentue le low-poly
  return geo;
}
const ground = new THREE.Mesh(makeTerrain(WORLD_SIZE, GRID), matGround);
scene.add(ground);

/* -------------------- Props -------------------- */
function rand(min,max){ return Math.random()*(max-min)+min; }
const propGroup = new THREE.Group(); scene.add(propGroup);
for (let i=0;i<120;i++){
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4,2.2),0), matRock);
  const x = rand(-WORLD_SIZE/2, WORLD_SIZE/2), z = rand(-WORLD_SIZE/2, WORLD_SIZE/2);
  stone.position.set(x, heightAt(x,z), z); propGroup.add(stone);
}
for (let i=0;i<60;i++){
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.4, rand(2,4), 6), matWood);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(rand(1.2,2.2), rand(2,3), 7), matGround);
  const x = rand(-WORLD_SIZE/2, WORLD_SIZE/2), z = rand(-WORLD_SIZE/2, WORLD_SIZE/2), y = heightAt(x,z);
  trunk.position.set(x, y+1.2, z); crown.position.set(x, y+2.8, z); propGroup.add(trunk); propGroup.add(crown);
}

/* -------------------- Player + Cam -------------------- */
const player = new THREE.Group();
player.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 8), matSkin));
scene.add(player);

const sword = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), matRock);
sword.position.set(0.5, 0.8, -0.2); sword.rotation.set(0, Math.PI/4, 0);
player.add(sword);

let velocity = new THREE.Vector3();
let onGround = false;
let yaw = 0, pitch = 0; // <-- look up/down
let swordCooldown = 0;
let mouseDown = false;
let timeSinceGrounded = 0;    // coyote time
const MAX_COYOTE = 0.06;      // ~60 ms

const camTarget = new THREE.Object3D(); scene.add(camTarget);
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

/* Pointer lock + souris (yaw + pitch) */
document.body.addEventListener('click', ()=> document.body.requestPointerLock());
document.addEventListener('pointerlockchange', ()=>{
  lockBtn.textContent = (document.pointerLockElement) ? 'Mouse captured ✔' : 'Click → capture mouse';
});
document.addEventListener('mousemove', (e)=>{
  if (!document.pointerLockElement) return;
  yaw   -= e.movementX * 0.003;
  pitch -= e.movementY * 0.002;          // ajout du pitch
  pitch  = clamp(pitch, -1.1, 1.1);      // limite haut/bas
});
window.addEventListener('mousedown', ()=>{ mouseDown=true; });
window.addEventListener('mouseup', ()=>{ mouseDown=false; });

/* Clavier */
const pressed = new Set();
document.addEventListener('keydown', e=> { pressed.add(e.code); });
document.addEventListener('keyup',   e=> { pressed.delete(e.code); });
function key(c){ return pressed.has(c); }

/* -------------------- NPC -------------------- */
const npc = new THREE.Group();
npc.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 8), matCloth));
scene.add(npc);
npc.position.set(6, heightAt(6,0)+1.2, 0);
let npcDir = new THREE.Vector3(1,0,0), npcTimer = 0;

/* -------------------- Dragon + feu (pool) -------------------- */
const dragon = new THREE.Group();
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.2, 6, 8), matRock);
torso.rotation.set(0,0,Math.PI/2); dragon.add(torso);
const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 6), matRock); head.position.set(1.4,0.2,0); dragon.add(head);
const wingL = new THREE.Mesh(new THREE.PlaneGeometry(2.5,1.2,1,1), matRock); wingL.position.set(0,0,1.1); wingL.rotation.y = Math.PI/2;
const wingR = wingL.clone(); wingR.position.z = -1.1; dragon.add(wingL); dragon.add(wingR);
scene.add(dragon);
let dragonAngle = 0, dragonHP = 5;

/* Pool de particules */
const fireGeom = new THREE.SphereGeometry(0.1, 6, 6);
const fireGroup = new THREE.Group(); scene.add(fireGroup);
const firePool = [];
for (let i=0;i<FIRE_POOL_SIZE;i++){
  const p = new THREE.Mesh(fireGeom, matFire);
  p.visible = false; p.userData = { vel:new THREE.Vector3(), life:0 };
  fireGroup.add(p); firePool.push(p);
}
function getFire(){
  for (let i=0;i<fireGroup.children.length;i++){
    const p = fireGroup.children[i];
    if (!p.visible) return p;
  }
  return null; // saturé, on ignore
}
function breatheFire(){
  for (let i=0;i<30;i++){
    const p = getFire(); if (!p) break;
    p.visible = true;
    p.position.copy(dragon.position).add(new THREE.Vector3(1.6,0.2,0));
    const dirv = new THREE.Vector3(1, (Math.random()*0.4-0.2), (Math.random()*0.6-0.3)).normalize();
    p.userData.vel.copy(dirv).multiplyScalar(8+Math.random()*4);
    p.userData.life = 1.0+Math.random()*0.6;
  }
}
let fireTimer = 0;

/* -------------------- Helpers -------------------- */
function log(msg){ logBox.textContent = msg; }
resetBtn.addEventListener('click', ()=>{ player.position.set(0, 20, 0); velocity.set(0,0,0); });

/* -------------------- Update loop -------------------- */
const clock = new THREE.Clock();
function update(dt){
  /* Cycle jour/nuit (très léger) */
  dayClock += dt;
  const t = (Math.sin(dayClock*0.1)+1)/2; // 0..1
  hemi.intensity = 0.7 + 0.5*t;
  dir.intensity  = 0.6 + 0.7*t;
  dir.color.setHSL(0.08 + 0.06*t, 0.4, 0.7);
  scene.fog.density = 0.004 + 0.004*(1-t);

  /* Inputs */
  const speed = MOVE_SPEED * (key('ShiftLeft')||key('ShiftRight') ? SPRINT_MULT : 1);
  const forward = key('KeyW') ? 1 : 0, back = key('KeyS') ? 1 : 0;
  const left = key('KeyA') ? 1 : 0, right = key('KeyD') ? 1 : 0;
  const jump = key('Space'); const interact = key('KeyE');

  /* Orientation + caméra (yaw + pitch) */
  player.rotation.y = yaw;
  const camOffset = new THREE.Vector3(0, 2.0 - pitch*0.5, 4.5 + Math.cos(pitch)*0.5);
  camOffset.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
  camTarget.position.copy(player.position).add(new THREE.Vector3(0,1.2,0));
  camera.position.copy(camTarget.position.clone().add(camOffset));
  camera.lookAt(camTarget.position);

  /* Déplacement */
  const dirMove = new THREE.Vector3((right-left), 0, (back-forward));
  if (dirMove.lengthSq()>0){
    dirMove.normalize().applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    velocity.x = THREE.MathUtils.damp(velocity.x, dirMove.x*speed, 8, dt);
    velocity.z = THREE.MathUtils.damp(velocity.z, dirMove.z*speed, 8, dt);
  } else {
    velocity.x = THREE.MathUtils.damp(velocity.x, 0, 8, dt);
    velocity.z = THREE.MathUtils.damp(velocity.z, 0, 8, dt);
  }

  /* Sol + gravité + coyote jump */
  velocity.y -= GRAVITY*dt;
  const below = heightAt(player.position.x, player.position.z)+1.2;
  const wasGrounded = onGround;
  if (player.position.y <= below){
    player.position.y = below; velocity.y = 0; onGround = true;
  } else onGround = false;

  if (onGround) timeSinceGrounded = 0; else timeSinceGrounded += dt;
  if (jump && (onGround || timeSinceGrounded <= MAX_COYOTE)){
    velocity.y = JUMP_VELOCITY; onGround = false; timeSinceGrounded = MAX_COYOTE+1;
  }
  player.position.addScaledVector(velocity, dt);

  /* Attaque + hit test */
  if (mouseDown && swordCooldown<=0){
    swordCooldown = 0.5;
    sword.rotation.z = -1.2;
    const hitTargets = [dragon, npc];
    for (const t of hitTargets){
      if (player.position.distanceTo(t.position) < SWORD_RANGE){
        if (t===dragon){ dragonHP -= 1; log(`Hit dragon! HP: ${dragonHP}`); }
        else { log('NPC: "Hey! Watch it!"'); }
      }
    }
  }
  swordCooldown -= dt;
  sword.rotation.z = THREE.MathUtils.damp(sword.rotation.z, 0, 8, dt);

  /* NPC wander */
  npcTimer -= dt;
  if (npcTimer<=0){ npcTimer = 2+Math.random()*3; const a = Math.random()*Math.PI*2; npcDir.set(Math.cos(a),0,Math.sin(a)); }
  const ns = 2.2; const nx = npc.position.x + npcDir.x*ns*dt; const nz = npc.position.z + npcDir.z*ns*dt;
  npc.position.set(nx, heightAt(nx,nz)+1.2, nz);
  if (interact && player.position.distanceTo(npc.position) < 2.2){
    log('NPC: "Beautiful day for dragon-watching, isn’t it?"');
  }

  /* Dragon + feu (pool) */
  dragonAngle += dt*0.4;
  const radius = 40;
  dragon.position.set(Math.cos(dragonAngle)*radius, 18+Math.sin(dragonAngle*2)*2, Math.sin(dragonAngle)*radius);
  dragon.lookAt(player.position);
  const wingX = Math.sin(performance.now()*0.004)*0.6;
  wingL.rotation.x = wingX; wingR.rotation.x = -wingX;

  fireTimer -= dt;
  if (fireTimer<=0){ fireTimer = 3.5 + Math.random()*2.0; if (dragonHP>0) breatheFire(); }

  for (let i=0;i<fireGroup.children.length;i++){
    const p = fireGroup.children[i];
    if (!p.visible) continue;
    p.userData.life -= dt;
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 9.8*dt*0.6;
    if (p.userData.life<=0){ p.visible=false; continue; }
    if (p.position.distanceTo(player.position) < 1.2){
      velocity.add(new THREE.Vector3().subVectors(player.position, dragon.position).setY(0).normalize().multiplyScalar(6));
      log('You got scorched!');
    }
  }
  if (dragonHP<=0 && dragon.visible){ dragon.visible = false; log('Dragon defeated!'); }
}

/* -------------------- Animate -------------------- */
function animate(){
  const dt = Math.min(0.033, clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
