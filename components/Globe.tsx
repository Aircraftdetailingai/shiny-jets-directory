'use client';

import { useRef, useEffect, useCallback } from 'react';
import AIRPORTS from '@/lib/airports';
import { feature } from 'topojson-client';

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

// Cached GeoJSON features so we only fetch once
let cachedFeatures: any[] | null = null;

async function loadCountries(): Promise<any[]> {
  if (cachedFeatures) return cachedFeatures;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    if (!res.ok) return [];
    const topology = await res.json();
    const fc: any = feature(topology, topology.objects.countries);
    cachedFeatures = fc.features || [];
    return cachedFeatures || [];
  } catch (e) {
    console.error('[Globe] Failed to load countries topology:', e);
    return [];
  }
}

// Helper: convert lng/lat to canvas x/y (equirectangular projection)
function lngLatToXY(lng: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lng + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

// Draw a GeoJSON polygon ring on canvas
function drawRing(ctx: CanvasRenderingContext2D, ring: number[][], w: number, h: number) {
  if (ring.length === 0) return;
  ctx.beginPath();
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    const [x, y] = lngLatToXY(lng, lat, w, h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGlobeTexture(features: any[]): HTMLCanvasElement {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Ocean — deep navy
  ctx.fillStyle = '#001f3f';
  ctx.fillRect(0, 0, w, h);

  // Draw all countries from real GeoJSON
  ctx.fillStyle = '#253545';
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.15)';
  ctx.lineWidth = 1.5;

  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        drawRing(ctx, ring, w, h);
        ctx.fill();
        ctx.stroke();
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        for (const ring of polygon) {
          drawRing(ctx, ring, w, h);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  // Hex dot overlay across whole globe for texture
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let x = 0; x < w; x += 22) {
    for (let y = 0; y < h; y += 22) {
      ctx.beginPath();
      ctx.arc(x + (y / 22 % 2 === 0 ? 0 : 11), y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
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

      // Lights — bright enough to clearly show continents
      const ambient = new THREE.AmbientLight(0xffffff, 2.0);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
      keyLight.position.set(5, 3, 5);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(0x6699ff, 1.0);
      fillLight.position.set(-5, -3, 5);
      scene.add(fillLight);
      const pointLight = new THREE.PointLight(0x4488ff, 0.3);
      pointLight.position.set(0, 0, 10);
      scene.add(pointLight);

      // Load real country GeoJSON and generate canvas texture
      const features = await loadCountries();
      if (disposed) return;
      const canvas = drawGlobeTexture(features);
      const canvasTexture = new THREE.CanvasTexture(canvas);
      canvasTexture.colorSpace = THREE.SRGBColorSpace;
      canvasTexture.needsUpdate = true;

      // Globe sphere — larger radius for prominence
      const globeRadius = 2.0;
      const globeGeom = new THREE.SphereGeometry(globeRadius, 64, 64);
      const globeMat = new THREE.MeshPhongMaterial({
        map: canvasTexture,
        shininess: 5,
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
