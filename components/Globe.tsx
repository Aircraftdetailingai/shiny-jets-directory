'use client';

import { useRef, useEffect, useCallback } from 'react';
import AIRPORTS from '@/lib/airports';

interface Detailer {
  id: string;
  company: string;
  name: string;
  home_airport: string;
  plan: string;
  has_online_booking: boolean;
  logo_url?: string;
  slug?: string;
}

interface GlobeProps {
  detailers: Detailer[];
  onPinClick: (detailer: Detailer) => void;
  focusAirport?: string | null;
}

// Simplified continent polygons in lat/lng — rough outlines for recognizability
// Format: arrays of [lat, lng] points forming each landmass
const CONTINENTS: Array<Array<[number, number]>> = [
  // North America
  [[71, -156], [70, -141], [68, -133], [60, -141], [58, -152], [54, -162], [58, -135], [48, -125], [32, -117], [23, -106], [18, -95], [25, -82], [31, -81], [38, -76], [45, -66], [47, -52], [53, -56], [60, -64], [66, -62], [73, -78], [76, -96], [73, -115], [71, -156]],
  // South America
  [[12, -72], [8, -60], [5, -52], [0, -50], [-10, -35], [-23, -40], [-33, -52], [-45, -65], [-55, -68], [-55, -72], [-50, -75], [-38, -73], [-20, -72], [-5, -81], [5, -78], [12, -72]],
  // Greenland
  [[83, -35], [77, -18], [70, -22], [62, -42], [66, -52], [76, -60], [83, -35]],
  // Europe
  [[71, 25], [65, 40], [60, 30], [55, 20], [50, 15], [45, 5], [43, -9], [50, 0], [58, 10], [65, 12], [71, 25]],
  // Africa
  [[37, -8], [32, 10], [32, 22], [30, 32], [22, 37], [12, 43], [0, 42], [-10, 40], [-25, 32], [-35, 20], [-32, 18], [-18, 12], [-6, 9], [5, -3], [15, -17], [25, -15], [30, -9], [37, -8]],
  // Asia (main mass)
  [[72, 55], [75, 90], [72, 140], [65, 178], [60, 160], [55, 138], [50, 128], [35, 125], [22, 115], [10, 105], [5, 97], [20, 92], [25, 70], [35, 55], [45, 47], [55, 55], [65, 60], [72, 55]],
  // India (connected below)
  [[28, 68], [22, 72], [8, 77], [12, 80], [22, 88], [28, 88], [28, 68]],
  // Southeast Asia (Indochina)
  [[22, 100], [15, 100], [10, 105], [5, 102], [10, 110], [20, 108], [22, 100]],
  // Australia
  [[-10, 142], [-18, 146], [-28, 153], [-38, 147], [-37, 140], [-35, 117], [-32, 115], [-22, 113], [-14, 125], [-11, 130], [-10, 142]],
  // Indonesia
  [[-1, 100], [-4, 115], [-8, 125], [-8, 140], [-2, 135], [2, 128], [3, 115], [2, 100], [-1, 100]],
  // UK + Ireland
  [[58, -5], [55, -1], [50, 0], [50, -5], [55, -8], [58, -5]],
  // Japan
  [[45, 142], [40, 140], [35, 135], [32, 130], [35, 138], [40, 142], [45, 142]],
  // Madagascar
  [[-12, 49], [-17, 49], [-22, 47], [-25, 45], [-22, 43], [-15, 46], [-12, 49]],
];

function drawGlobeTexture(): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Ocean gradient — deep navy with subtle variation
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#001a33');
  gradient.addColorStop(0.5, '#001f3f');
  gradient.addColorStop(1, '#001a33');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Helper: convert lat/lng to canvas x/y (equirectangular projection)
  const toXY = (lat: number, lng: number): [number, number] => {
    const x = ((lng + 180) / 360) * w;
    const y = ((90 - lat) / 180) * h;
    return [x, y];
  };

  // Draw continents
  ctx.fillStyle = '#0d1520';
  ctx.strokeStyle = '#1a2530';
  ctx.lineWidth = 2;

  for (const continent of CONTINENTS) {
    ctx.beginPath();
    for (let i = 0; i < continent.length; i++) {
      const [lat, lng] = continent[i];
      const [x, y] = toXY(lat, lng);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  return canvas;
}

export default function Globe({ detailers, onPinClick, focusAirport }: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;

  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    let frameId: number;
    let disposed = false;

    (async () => {
      const THREE = await import('three');
      if (disposed || !mountRef.current) return;

      function latLngToVector3(lat: number, lng: number, radius: number) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lng + 180) * (Math.PI / 180);
        return new THREE.Vector3(
          -(radius * Math.sin(phi) * Math.cos(theta)),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        );
      }

      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
      camera.position.z = 4;

      // Lights — bright enough to see continents
      const ambient = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambient);
      const directional = new THREE.DirectionalLight(0xffffff, 1.2);
      directional.position.set(5, 3, 5);
      scene.add(directional);

      // Generate canvas texture with continents
      const canvas = drawGlobeTexture();
      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;

      // Globe sphere — larger radius
      const globeRadius = 2.0;
      const globeGeom = new THREE.SphereGeometry(globeRadius, 64, 64);
      const globeMat = new THREE.MeshPhongMaterial({
        map: canvasTexture,
        shininess: 20,
        specular: 0x222233,
      });
      const globe = new THREE.Mesh(globeGeom, globeMat);
      scene.add(globe);

      // Atmosphere glow
      const glowGeom = new THREE.SphereGeometry(globeRadius * 1.03, 64, 64);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x0088cc,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(glowGeom, glowMat));

      // Outer rim glow
      const rimGeom = new THREE.SphereGeometry(globeRadius * 1.08, 64, 64);
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0x0099dd,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
      });
      scene.add(new THREE.Mesh(rimGeom, rimMat));

      // Pins
      const pins: { mesh: any; detailer: Detailer }[] = [];
      const pinGeom = new THREE.SphereGeometry(0.025, 8, 8);

      detailers.forEach(d => {
        const coords = AIRPORTS[d.home_airport?.toUpperCase()];
        if (!coords) return;
        const [lat, lng] = coords;
        const pos = latLngToVector3(lat, lng, globeRadius * 1.01);

        const pinMat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
        const pin = new THREE.Mesh(pinGeom, pinMat);
        pin.position.copy(pos);
        globe.add(pin);

        const dotGeom = new THREE.SphereGeometry(0.01, 6, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const dot = new THREE.Mesh(dotGeom, dotMat);
        dot.position.copy(pos);
        globe.add(dot);

        pins.push({ mesh: pin, detailer: d });
      });

      sceneRef.current = {
        renderer, scene, camera, globe, pins,
        isDragging: false,
        prevMouse: { x: 0, y: 0 },
        startMouse: { x: 0, y: 0 },
        autoRotate: true,
        targetRotation: null,
      };

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const handlePointerDown = (e: PointerEvent) => {
        if (!sceneRef.current) return;
        sceneRef.current.isDragging = true;
        sceneRef.current.autoRotate = false;
        sceneRef.current.prevMouse = { x: e.clientX, y: e.clientY };
        sceneRef.current.startMouse = { x: e.clientX, y: e.clientY };
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!sceneRef.current?.isDragging) return;
        const dx = e.clientX - sceneRef.current.prevMouse.x;
        const dy = e.clientY - sceneRef.current.prevMouse.y;
        sceneRef.current.globe.rotation.y += dx * 0.005;
        sceneRef.current.globe.rotation.x += dy * 0.005;
        sceneRef.current.globe.rotation.x = Math.max(-1.2, Math.min(1.2, sceneRef.current.globe.rotation.x));
        sceneRef.current.prevMouse = { x: e.clientX, y: e.clientY };
      };

      const handlePointerUp = (e: PointerEvent) => {
        if (!sceneRef.current) return;
        const moved = Math.abs(e.clientX - sceneRef.current.startMouse.x) + Math.abs(e.clientY - sceneRef.current.startMouse.y);
        sceneRef.current.isDragging = false;

        if (moved < 5) {
          const rect = el.getBoundingClientRect();
          mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          const meshes = sceneRef.current.pins.map((p: any) => p.mesh);
          const hits = raycaster.intersectObjects(meshes);
          if (hits.length > 0) {
            const hit = sceneRef.current.pins.find((p: any) => p.mesh === hits[0].object);
            if (hit) onPinClickRef.current(hit.detailer);
          }
        }

        setTimeout(() => {
          if (sceneRef.current) sceneRef.current.autoRotate = true;
        }, 3000);
      };

      renderer.domElement.addEventListener('pointerdown', handlePointerDown);
      renderer.domElement.addEventListener('pointermove', handlePointerMove);
      renderer.domElement.addEventListener('pointerup', handlePointerUp);

      const animate = () => {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        if (!sceneRef.current) return;
        const s = sceneRef.current;

        if (s.autoRotate) {
          s.globe.rotation.y += 0.0008;
        }

        if (s.targetRotation) {
          s.globe.rotation.y += (s.targetRotation.y - s.globe.rotation.y) * 0.03;
          s.globe.rotation.x += (s.targetRotation.x - s.globe.rotation.x) * 0.03;
          if (Math.abs(s.targetRotation.y - s.globe.rotation.y) < 0.01) {
            s.targetRotation = null;
          }
        }

        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        if (!mountRef.current) return;
        const nw = mountRef.current.clientWidth || 800;
        const nh = mountRef.current.clientHeight || 600;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener('resize', handleResize);

      (el as any).__globeCleanup = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', handleResize);
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        renderer.domElement.removeEventListener('pointermove', handlePointerMove);
        renderer.domElement.removeEventListener('pointerup', handlePointerUp);
        renderer.dispose();
        if (el.contains(renderer.domElement)) {
          el.removeChild(renderer.domElement);
        }
        sceneRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      if ((el as any).__globeCleanup) {
        (el as any).__globeCleanup();
        delete (el as any).__globeCleanup;
      }
    };
  }, [detailers]);

  // Focus on airport when search triggers
  useEffect(() => {
    if (!focusAirport || !sceneRef.current) return;
    const coords = AIRPORTS[focusAirport.toUpperCase()];
    if (!coords) return;
    const [lat, lng] = coords;
    sceneRef.current.autoRotate = false;
    sceneRef.current.targetRotation = {
      y: -lng * (Math.PI / 180) - Math.PI / 2,
      x: lat * (Math.PI / 180) * 0.5,
    };
    setTimeout(() => {
      if (sceneRef.current) sceneRef.current.autoRotate = true;
    }, 5000);
  }, [focusAirport]);

  const handleZoom = useCallback((dir: 'in' | 'out') => {
    if (!sceneRef.current) return;
    const cam = sceneRef.current.camera;
    const delta = dir === 'in' ? -0.3 : 0.3;
    cam.position.z = Math.max(2.5, Math.min(6.0, cam.position.z + delta));
  }, []);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div
        ref={mountRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />
      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10 }}>
        <button
          onClick={() => handleZoom('in')}
          className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => handleZoom('out')}
          className="w-9 h-9 rounded-full bg-white/10 text-white border border-white/20 flex items-center justify-center text-lg font-bold hover:bg-white/20 transition-colors select-none"
          aria-label="Zoom out"
        >
          &minus;
        </button>
      </div>
    </div>
  );
}
