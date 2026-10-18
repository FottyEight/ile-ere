// Table football with Chidi: draws the rods, players and ball from the simulation in
// foosball.js, and turns your mouse, finger or keys into sliding rods and kicks.
import * as THREE from 'three';
import { newMatch, step, kick, computerControl, playerControl, BALL_R } from './foosball.js';

export function createFoosballTable(ctx) {
  const { scene, info } = ctx;
  const c = info.center;
  const host = () => ctx.regular('Chidi');

  // ── The rods and players ──
  const rodMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.9, roughness: 0.25 });
  const handleMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 });
  const teamMats = [
    { shirt: new THREE.MeshStandardMaterial({ color: '#d63031', roughness: 0.5 }), shorts: new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.5 }) },
    { shirt: new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.5 }), shorts: new THREE.MeshStandardMaterial({ color: '#1e3a6b', roughness: 0.5 }) },
  ];
  const skin = new THREE.MeshStandardMaterial({ color: '#5c3a21', roughness: 0.6 });
  const shirtGeo = new THREE.BoxGeometry(0.022, 0.034, 0.03);
  const shortsGeo = new THREE.BoxGeometry(0.022, 0.018, 0.03);
  const legGeo = new THREE.BoxGeometry(0.014, 0.05, 0.026);
  const headGeo = new THREE.SphereGeometry(0.012, 10, 8);
  const rodGeo = new THREE.CylinderGeometry(0.006, 0.006, info.W + 0.34, 8);
  const handleGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.09, 10);

  let match = newMatch();
  const rodNodes = match.rods.map((r) => {
    const rod = new THREE.Group();
    rod.position.set(c.x + r.x, info.rodY, c.z);
    scene.add(rod);
    const bar = new THREE.Mesh(rodGeo, rodMat);
    bar.rotation.x = Math.PI / 2;
    rod.add(bar);
    // handle on the owner's side (yours at +z, Chidi's at -z)
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = (r.team === 0 ? 1 : -1) * (info.W / 2 + 0.14);
    rod.add(handle);
    const men = r.offsets.map((off) => {
      const man = new THREE.Group(); // pivots on the rod, so kicks swing the feet
      man.position.z = off;
      const m = teamMats[r.team];
      const shirt = new THREE.Mesh(shirtGeo, m.shirt);
      shirt.position.y = -0.004;
      const head = new THREE.Mesh(headGeo, skin);
      head.position.y = 0.024;
      const shorts = new THREE.Mesh(shortsGeo, m.shorts);
      shorts.position.y = -0.03;
      const legs = new THREE.Mesh(legGeo, skin);
      legs.position.y = -0.062;
      for (const p of [shirt, head, shorts, legs]) { p.castShadow = true; man.add(p); }
      rod.add(man);
      return man;
    });
    return { rod, men, handle };
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.35 }));
  ball.castShadow = true;
  scene.add(ball);

  function draw(dt = 0) {
    match.rods.forEach((r, i) => {
      const node = rodNodes[i];
      node.rod.position.z = c.z + r.slide;
      // a kick swings the players' feet towards the other goal and back
      const swing = r.kick > 0 ? Math.sin((1 - r.kick / 0.22) * Math.PI) * 1.15 : 0;
      for (const man of node.men) man.rotation.z = (r.team === 0 ? 1 : -1) * swing;
    });
    const b = match.ball;
    ball.position.set(c.x + b.x, info.top + BALL_R, c.z + b.z);
    ball.rotation.z -= (b.vx * dt) / BALL_R;
    ball.rotation.x += (b.vz * dt) / BALL_R;
    ball.visible = match.serveIn <= 0 || match.time < 0.01;
  }
  draw();

  // ── Controls ──
  // Your rods follow the pointer up and down the table (or W/S and the arrow keys); a click,
  // tap or Space kicks with all of them.
  let target = 0;
  let keyDir = 0;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -info.top);
  const hit = new THREE.Vector3();
  function aimAt(ray) {
    if (ray.ray.intersectPlane(plane, hit)) target = THREE.MathUtils.clamp((hit.z - c.z) / (info.W / 2 - 0.06), -1, 1);
  }

  let level = 1;
  let playing = false;
  const ai = {};
  let lastScore = [0, 0];

  function hud() {
    ctx.score([
      { name: 'You', value: match.score[0], active: false },
      { name: 'Chidi', value: match.score[1], active: false },
    ]);
  }

  return {
    id: 'foosball',
    title: 'Table football',
    lead: 'Chidi says nobody beats him at this table. First to 5 goals wins. You’re red, shooting to the right.',
    levelLabel: 'How good is Chidi?',
    rules: [
      'Move your mouse (or drag your finger) up and down the table to slide your four rods.',
      'Click, tap or press <b>Space</b> to kick. All your players swing together.',
      'Keyboard: <b>W</b>/<b>S</b> or the arrow keys slide the rods.',
      'First to <b>5 goals</b> wins.',
    ],
    greetings: ['Ah, you want to try me? Come!', 'Table football? Na my table be this o!', 'Ready? I no dey show mercy.'],
    view: { target: new THREE.Vector3(c.x, info.top + 0.02, c.z + 0.05), yaw: 0, pitch: 1.0, dist: 1.35 },
    focus: () => ball.getWorldPosition(new THREE.Vector3()),

    idle() {
      playing = false;
      match = newMatch();
      match.serveIn = 0;
      draw();
    },
    start(lv) {
      level = lv;
      match = newMatch();
      lastScore = [0, 0];
      target = 0;
      playing = true;
      hud();
      ctx.turn('Kick off!');
      ctx.hint('Move up and down to slide your rods · click, tap or Space to kick');
      ctx.actions([{ label: 'Kick', onClick: () => kick(match, 0) }]);
      ctx.say(ctx.pickLine(['Oya, let’s go!', 'Kick off!', 'Defend well o!']), 'Chidi', 1800);
    },
    update(dt) {
      if (!playing) return;
      if (keyDir) target = THREE.MathUtils.clamp(target + keyDir * dt * 2.2, -1, 1);
      playerControl(match, target, dt);
      computerControl(match, 1, level, dt, ai);
      const events = step(match, dt);
      for (const e of events) {
        if (e.type === 'kick') ctx.sfx.clack();
        if (e.type === 'goal') {
          hud();
          const chidi = host();
          if (e.team === 0) {
            ctx.sfx.capture();
            chidi?.c.gesture('shake', 1.4);
            ctx.me()?.gesture('nod', 1);
            ctx.turn('GOAL! You scored.');
            ctx.say(ctx.pickLine(['Ehn! Lucky shot.', 'Hmm, I wasn’t ready.', 'Okay, okay. Again!']), 'Chidi', 2200);
          } else {
            ctx.sfx.clack();
            chidi?.c.gesture('laugh', 1.8);
            ctx.turn('Chidi scores.');
            ctx.say(ctx.pickLine(['GOOOAL! Haha!', 'You see am? Messi!', 'Na so e be!']), 'Chidi', 2200);
          }
          lastScore = e.score;
        }
        if (e.type === 'win') {
          playing = false;
          const won = e.team === 0;
          host()?.c.gesture(won ? 'clap' : 'laugh', 2.5);
          ctx.say(won ? 'You beat me! Rematch, abeg.' : 'Chidi wins again! Haha.', 'Chidi', 3000);
          setTimeout(() => ctx.finish({
            outcome: won ? 'win' : 'loss',
            title: won ? 'You beat Chidi!' : 'Chidi wins this one',
            detail: `${match.score[0]} – ${match.score[1]}`,
          }), 1200);
        }
      }
      if (match.serveIn <= 0 && match.time > 0.5 && !events.some((e) => e.type === 'goal')) ctx.turn('');
      draw(dt);
    },
    stop() {
      playing = false;
      keyDir = 0;
      this.idle();
    },

    pointerDown(e, ray) {
      aimAt(ray);
      kick(match, 0);
      return true;
    },
    pointerMove(e, ray) {
      aimAt(ray);
      return true;
    },
    pointerUp() { return true; },
    keyDown(e, k) {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); kick(match, 0); }
      if (k === 'w' || k === 'ArrowUp') { keyDir = -1; e.preventDefault(); }
      if (k === 's' || k === 'ArrowDown') { keyDir = 1; e.preventDefault(); }
    },
    keyUp(e, k) {
      if (['w', 's', 'ArrowUp', 'ArrowDown'].includes(k)) keyDir = 0;
    },
  };
}
